from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.data import PERSONAS
from app.services import (
    DB,
    PayPalAPIError,
    PayPalSandbox,
    get_session_user,
    request_magic_link,
    revoke_session,
    seed_persona,
    verify_magic_link,
)


def test_magic_links_and_sessions_are_hashed_at_rest(monkeypatch, tmp_path):
    monkeypatch.delenv("SMTP_HOST", raising=False)
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("APP_PUBLIC_URL", "http://127.0.0.1:8000")
    db = DB(str(tmp_path / "auth.db"))

    result = request_magic_link(db, "real.person@example.com")
    raw_token = parse_qs(urlparse(result["demo_magic_link"]).query)["token"][0]
    with db.connect() as c:
        user = c.execute("SELECT * FROM users WHERE email=?", ("real.person@example.com",)).fetchone()
        stored_magic = c.execute("SELECT token FROM magic_links WHERE email=?", ("real.person@example.com",)).fetchone()["token"]
    assert user["name"] == "", "Glim must not infer a user's display name from their email"
    assert stored_magic != raw_token
    assert re.fullmatch(r"[0-9a-f]{64}", stored_magic)

    sid = verify_magic_link(db, raw_token)
    assert sid
    with db.connect() as c:
        stored_session = c.execute("SELECT token FROM sessions WHERE email=?", ("real.person@example.com",)).fetchone()["token"]
    assert stored_session != sid
    assert re.fullmatch(r"[0-9a-f]{64}", stored_session)
    assert get_session_user(db, sid)["email"] == "real.person@example.com"
    assert verify_magic_link(db, raw_token) is None, "magic links are one-time"
    revoke_session(db, sid)
    assert get_session_user(db, sid) is None


def test_paypal_setup_requests_canada_and_only_trusted_approval_url(monkeypatch, tmp_path):
    monkeypatch.setenv("PAYPAL_CLIENT_ID", "sandbox-client")
    monkeypatch.setenv("PAYPAL_CLIENT_SECRET", "sandbox-secret")
    monkeypatch.setenv("APP_PUBLIC_URL", "https://glim.example.test")
    db = DB(str(tmp_path / "paypal.db"))
    seed_persona(db, PERSONAS["riley"].__dict__, PERSONAS["riley"].average_monthly_expenses)
    paypal = PayPalSandbox(db)
    paypal.owner_email = "verified.user@example.com"
    paypal.master_db = db
    calls = {}

    class Response:
        status_code = 201

        def __init__(self, payload):
            self.payload = payload

        def json(self):
            return self.payload

    def fake_request(method, path, *, json_body=None, params=None, headers=None):
        calls.update(method=method, path=path, body=json_body, headers=headers)
        return Response({"id": "SETUP-123", "links": [{"rel": "approve", "href": "https://www.sandbox.paypal.com/checkoutnow?token=SETUP-123"}]})

    paypal._request = fake_request
    result = paypal.connect()
    source = calls["body"]["payment_source"]["paypal"]
    assert calls["path"] == "/v3/vault/setup-tokens"
    assert source["country_code"] == "CA"
    assert source["usage_pattern"] == "UNSCHEDULED_PREPAID"
    assert source["experience_context"]["user_action"] == "SETUP_NOW"
    assert result["approval_url"].startswith("https://www.sandbox.paypal.com/")
    assert "setup_token" not in result, "provider token identifiers should not be returned to the browser"
    state = parse_qs(urlparse(calls["body"]["payment_source"]["paypal"]["experience_context"]["return_url"]).query)["state"][0]
    with db.connect() as c:
        stored_state = c.execute("SELECT token FROM integration_states WHERE email=? ORDER BY rowid DESC LIMIT 1", ("verified.user@example.com",)).fetchone()["token"]
    assert stored_state != state and re.fullmatch(r"[0-9a-f]{64}", stored_state), "PayPal callback states are hashes at rest"

    def malicious_request(method, path, *, json_body=None, params=None, headers=None):
        return Response({"id": "SETUP-BAD", "links": [{"rel": "approve", "href": "javascript:alert(1)"}]})

    paypal._request = malicious_request
    try:
        paypal.connect()
        assert False, "untrusted approval URL must be rejected"
    except PayPalAPIError as exc:
        assert "trusted HTTPS" in str(exc)


def test_paypal_disconnect_refuses_unresolved_settlement(tmp_path):
    db = DB(str(tmp_path / "pending.db"))
    seed_persona(db, PERSONAS["riley"].__dict__, PERSONAS["riley"].average_monthly_expenses)
    from app.services import now_iso

    with db.connect() as c:
        c.execute(
            "INSERT INTO payment_settlements(reference,amount,stash_amount,debt_amount,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
            ("pending-settlement", 10, 6.5, 3.5, "payout_pending", now_iso(), now_iso()),
        )
    try:
        PayPalSandbox(db).disconnect()
        assert False, "disconnect must not strand unresolved funds"
    except PayPalAPIError as exc:
        assert "Resolve settlement pending-settlement" in str(exc)


def test_public_paypal_state_does_not_expose_vault_or_setup_tokens():
    from app.services import public_paypal_state
    safe = public_paypal_state({
        "status": "connected", "country": "CA", "currency": "CAD", "scopes": ["vault:read"],
        "vault_id": "sensitive-vault-value", "setup_token": "sensitive-setup-value",
        "customer_id": "sensitive-customer-value", "approval_url": "https://www.sandbox.paypal.com/approve",
    })
    assert safe["status"] == "connected"
    assert safe["approval_url"].startswith("https://www.sandbox.paypal.com/")
    assert not ({"vault_id", "setup_token", "customer_id"} & set(safe))


def test_production_magic_link_requires_https_public_url(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("APP_PUBLIC_URL", "http://glim.example.test")
    monkeypatch.delenv("SMTP_HOST", raising=False)
    db = DB(str(tmp_path / "prod-auth.db"))
    try:
        request_magic_link(db, "https.user@example.com")
        assert False, "production magic links must never be issued with an HTTP base URL"
    except RuntimeError as exc:
        assert "HTTPS URL" in str(exc)
    with db.connect() as c:
        assert c.execute("SELECT COUNT(*) FROM magic_links").fetchone()[0] == 0


def test_second_settlement_is_blocked_while_first_has_unknown_outcome(monkeypatch, tmp_path):
    from app.services import approve_drip, get_state, now_iso, settle_week, write_state
    monkeypatch.setenv("PAYPAL_CLIENT_ID", "sandbox-client")
    monkeypatch.setenv("PAYPAL_CLIENT_SECRET", "sandbox-secret")
    monkeypatch.setenv("PAYPAL_STASH_EMAIL", "stash@example.com")
    monkeypatch.setenv("PAYPAL_LENDER_EMAIL", "lender@example.com")
    db = DB(str(tmp_path / "overlap.db"))
    seed_persona(db, PERSONAS["riley"].__dict__, PERSONAS["riley"].average_monthly_expenses)
    state = get_state(db)
    state["paypal"] = {"status": "connected", "mode": "sandbox", "vault_id": "test-vault", "scopes": []}
    write_state(db, state)
    approve_drip(db, True)
    with db.connect() as c:
        c.execute(
            "INSERT INTO payment_settlements(reference,amount,stash_amount,debt_amount,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
            ("uncertain-first-batch", 12, 7.8, 4.2, "capture_unknown", now_iso(), now_iso()),
        )
        c.execute("UPDATE ledger_entries SET status='settlement_pending',settlement_id='uncertain-first-batch'")
        # Simulate a new daily allocation accumulated after the prior batch started.
        c.execute("UPDATE ledger_entries SET status='accrued',settlement_id=NULL")
    try:
        settle_week(db)
        assert False, "a second batch must not run while PayPal outcome is unresolved"
    except ValueError as exc:
        assert "Resolve settlement uncertain-first-batch" in str(exc)
    with db.connect() as c:
        assert c.execute("SELECT COUNT(*) FROM payment_settlements").fetchone()[0] == 1


def test_scheduled_checkin_is_sent_only_once_per_local_day(tmp_path):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from app.services import get_state, scheduled_nudge_tick, write_state

    db = DB(str(tmp_path / "scheduled-notifications.db"))
    seed_persona(db, PERSONAS["riley"].__dict__, PERSONAS["riley"].average_monthly_expenses)
    state = get_state(db)
    state["profile"].update({"setup_completed": True, "timezone": "America/Toronto"})
    state["notifications"].update({"channel": "in_app", "quiet_start": "22:00", "quiet_end": "08:00", "daily_cap": 3})
    write_state(db, state)
    tick = datetime(2026, 10, 15, 10, 0, tzinfo=ZoneInfo("America/Toronto"))

    first = scheduled_nudge_tick(db, now=tick)
    second = scheduled_nudge_tick(db, now=tick)
    assert first["status"] == "ready" and first["scheduled"] is True
    assert second["status"] == "already_scheduled"
    with db.connect() as c:
        assert c.execute("SELECT COUNT(*) FROM nudges").fetchone()[0] == 1


def test_scheduled_checkin_respects_quiet_hours_before_dispatch(tmp_path):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from app.services import get_state, scheduled_nudge_tick, write_state

    db = DB(str(tmp_path / "quiet-notifications.db"))
    seed_persona(db, PERSONAS["riley"].__dict__, PERSONAS["riley"].average_monthly_expenses)
    state = get_state(db)
    state["profile"].update({"setup_completed": True, "timezone": "America/Toronto"})
    state["notifications"].update({"channel": "in_app", "quiet_start": "22:00", "quiet_end": "11:00", "daily_cap": 3})
    write_state(db, state)
    morning = datetime(2026, 10, 15, 10, 0, tzinfo=ZoneInfo("America/Toronto"))
    noon = datetime(2026, 10, 15, 12, 0, tzinfo=ZoneInfo("America/Toronto"))

    blocked = scheduled_nudge_tick(db, now=morning)
    allowed = scheduled_nudge_tick(db, now=noon)
    assert blocked["status"] == "quiet_hours"
    assert allowed["status"] == "ready"
    with db.connect() as c:
        assert c.execute("SELECT COUNT(*) FROM nudges").fetchone()[0] == 1


def test_gemini_function_call_executes_only_the_supplied_tool(monkeypatch):
    import json as json_lib
    import app.services as services

    monkeypatch.setenv("GEMINI_API_KEY", "test-api-key")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-test-model")
    calls = []

    class Response:
        status_code = 200

        def __init__(self, payload):
            self.payload = payload

        def json(self):
            return self.payload

    class Client:
        def __init__(self, timeout):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, json):
            calls.append((url, json))
            if len(calls) == 1:
                return Response({"candidates": [{"content": {"parts": [{"functionCall": {"name": "get_habit_progress", "args": {}}}]}}]})
            return Response({"candidates": [{"content": {"parts": [{"text": json_lib.dumps({"delegate": "Glim", "message": "I checked your progress."})}]}}]})

    monkeypatch.setattr(services.httpx, "Client", Client)
    executed = []
    result = services.GeminiAdapter().ask("system", "How am I doing?", {"get_habit_progress": lambda: executed.append("progress") or {"points": 5}})
    assert executed == ["progress"]
    assert result["tool_results"] == [{"points": 5}]
    assert len(calls) == 2


def test_squad_fallback_label_does_not_expose_email_prefix(tmp_path):
    from app.services import create_squad, get_state, write_state

    db = DB(str(tmp_path / "squad-label.db"))
    seed_persona(db, PERSONAS["riley"].__dict__, PERSONAS["riley"].average_monthly_expenses)
    state = get_state(db)
    state["profile"]["name"] = ""
    write_state(db, state)
    squad = create_squad(db, "Weekend Steps", "private.email@example.com")
    assert squad["members"][0]["display_name"].startswith("Member ")
    assert "private" not in squad["members"][0]["display_name"].lower()


def test_core_payment_flow_applies_balances_only_after_confirmed_payout(monkeypatch, tmp_path):
    from app.services import approve_drip, get_debts, get_state, settle_week, write_state

    monkeypatch.setenv("PAYPAL_CLIENT_ID", "sandbox-client")
    monkeypatch.setenv("PAYPAL_CLIENT_SECRET", "sandbox-secret")
    monkeypatch.setenv("PAYPAL_STASH_EMAIL", "stash@example.com")
    monkeypatch.setenv("PAYPAL_LENDER_EMAIL", "lender@example.com")
    db = DB(str(tmp_path / "full-flow.db"))
    seed_persona(db, PERSONAS["riley"].__dict__, PERSONAS["riley"].average_monthly_expenses)
    state = get_state(db)
    state["paypal"] = {"status": "connected", "mode": "sandbox", "country": "CA", "currency": "CAD", "scopes": [], "vault_id": "test-vault"}
    write_state(db, state)
    before_state = get_state(db)
    before_debt = get_debts(db)[0]["balance"]
    approved = approve_drip(db, True)

    def create_order(self, amount, reference, request_id=None):
        return {"id": "ORDER-TEST-1", "status": "CREATED"}

    def capture_order(self, order_id):
        assert order_id == "ORDER-TEST-1"
        return {"id": order_id, "status": "COMPLETED"}

    def create_payout(self, debt_amount, stash_amount, reference, request_id=None):
        assert round(debt_amount + stash_amount, 2) == round(approved["amount"], 2)
        return {"batch_header": {"payout_batch_id": "BATCH-TEST-1", "batch_status": "SUCCESS"}}

    monkeypatch.setattr(PayPalSandbox, "create_order_from_vault", create_order)
    monkeypatch.setattr(PayPalSandbox, "capture_order", capture_order)
    monkeypatch.setattr(PayPalSandbox, "create_payout", create_payout)
    result = settle_week(db)

    assert result["status"] == "confirmed"
    after_state = get_state(db)
    after_debt = get_debts(db)[0]["balance"]
    assert round(after_state["stash"]["balance"], 2) == round(before_state["stash"]["balance"] + approved["stash_share"], 2)
    assert round(after_debt, 2) == round(before_debt - approved["debt_share"], 2)
    with db.connect() as c:
        ledger = c.execute("SELECT status FROM ledger_entries WHERE id=?", (approved["ledger_id"],)).fetchone()
        settlement_count = c.execute("SELECT COUNT(*) FROM payment_settlements WHERE status='completed'").fetchone()[0]
    assert ledger["status"] == "settled"
    assert settlement_count == 1


def test_manual_paypal_approval_link_survives_page_reload_state(monkeypatch, tmp_path):
    from app.services import PayPalAPIError, approve_drip, get_state, payment_readiness, public_paypal_state, settle_week, write_state

    monkeypatch.setenv("PAYPAL_CLIENT_ID", "sandbox-client")
    monkeypatch.setenv("PAYPAL_CLIENT_SECRET", "sandbox-secret")
    monkeypatch.setenv("PAYPAL_STASH_EMAIL", "stash@example.com")
    monkeypatch.setenv("PAYPAL_LENDER_EMAIL", "lender@example.com")
    db = DB(str(tmp_path / "approval-link.db"))
    seed_persona(db, PERSONAS["riley"].__dict__, PERSONAS["riley"].average_monthly_expenses)
    state = get_state(db)
    state["paypal"] = {"status": "connected", "mode": "sandbox", "vault_id": "test-vault", "scopes": []}
    write_state(db, state)
    approve_drip(db, True)

    def reject_vault_charge(self, amount, reference, request_id=None):
        raise PayPalAPIError("Vault capture requires payer approval", 400)

    def make_approval_order(self, amount, reference):
        return {
            "id": "ORDER-APPROVAL-1",
            "links": [{"rel": "approve", "href": "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-APPROVAL-1"}],
        }

    monkeypatch.setattr(PayPalSandbox, "create_order_from_vault", reject_vault_charge)
    monkeypatch.setattr(PayPalSandbox, "create_order_for_approval", make_approval_order)
    result = settle_week(db)
    assert result["status"] == "approval_required"
    state_after = get_state(db)
    safe_state = public_paypal_state(state_after["paypal"])
    assert safe_state["pending_settlement_approval_url"] == result["approval_url"]
    assert payment_readiness(db)["ready"] is True
    with db.connect() as c:
        row = c.execute("SELECT status FROM payment_settlements WHERE reference=?", (result["reference"],)).fetchone()
    assert row["status"] == "awaiting_approval"
