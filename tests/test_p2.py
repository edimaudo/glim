import sys
from datetime import datetime, timezone
from pathlib import Path
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.data import PERSONAS
from app.services import (
    DB,
    add_stash_goal,
    allocate_stash_to_goals,
    approve_drip,
    create_squad,
    create_squad_goal,
    get_squad,
    get_state,
    get_stash_goals,
    monthly_auto_deposit_settings,
    monthly_recap,
    process_paypal_event,
    save_monthly_auto_deposit,
    seed_persona,
    write_state,
)


def make_db(td):
    db = DB(str(Path(td) / "glim-test.db"))
    p = PERSONAS["riley"]
    seed_persona(db, p.__dict__, p.average_monthly_expenses)
    return db


def connect_demo_sandbox(db):
    state = get_state(db)
    state["paypal"] = {
        "status": "connected", "mode": "sandbox", "country": "CA", "currency": "CAD",
        "scopes": [], "vault_id": "TEST-Vault",
    }
    write_state(db, state)


def test_named_stash_goals_allocate_future_stash_without_double_counting():
    with tempfile.TemporaryDirectory() as td:
        db = make_db(td)
        add_stash_goal(db, "Laptop", 30, 10)
        add_stash_goal(db, "Trip", 50, 15)
        allocate_stash_to_goals(db, 60)
        result = get_stash_goals(db)
        assert result["stash_balance"] == 260
        goals = {goal["name"]: goal for goal in result["goals"]}
        assert goals["Laptop"]["saved_amount"] == 30
        assert goals["Laptop"]["status"] == "completed"
        assert goals["Trip"]["saved_amount"] == 30
        assert goals["Trip"]["status"] == "active"


def test_monthly_recap_summarizes_drips_for_selected_month():
    with tempfile.TemporaryDirectory() as td:
        db = make_db(td)
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        with db.connect() as c:
            c.execute(
                "INSERT INTO ledger_entries(created_at,kind,amount,stash_share,debt_share,status) VALUES(?,?,?,?,?,?)",
                (f"{month}-03T12:00:00+00:00", "drip", 10, 6.5, 3.5, "accrued"),
            )
            c.execute(
                "INSERT INTO ledger_entries(created_at,kind,amount,stash_share,debt_share,status) VALUES(?,?,?,?,?,?)",
                (f"{month}-03T18:00:00+00:00", "drip", 10, 6.5, 3.5, "accrued"),
            )
        recap = monthly_recap(db, month)
        assert recap["drip_count"] == 2
        assert recap["active_days"] == 1
        assert recap["total_moved"] == 20
        assert recap["stash_contribution"] == 13
        assert recap["debt_contribution"] == 7
        assert recap["bars"] == {"stash_pct": 65.0, "debt_pct": 35.0}


def test_squad_goal_unlocks_group_cosmetic_on_daily_drip():
    with tempfile.TemporaryDirectory() as td:
        db = make_db(td)
        email = "riley@example.test"
        connect_demo_sandbox(db)
        create_squad(db, "Forest Crew", email)
        create_squad_goal(db, "One member-day", 1, 1, email)
        approve_drip(db, True, email=email)
        squad = get_squad(db, email)
        assert squad["goals"][0]["status"] == "completed"
        assert squad["goals"][0]["progress_count"] == 1
        assert any(item["cosmetic_id"] == 1 for item in squad["unlocked_cosmetics"])
        # A second drip on the same UTC day does not increase the same member-day twice.
        approve_drip(db, True, email=email)
        squad = get_squad(db, email)
        assert squad["goals"][0]["progress_count"] == 1


def test_monthly_deposit_requires_consent_and_connected_sandbox():
    with tempfile.TemporaryDirectory() as td:
        db = make_db(td)
        assert monthly_auto_deposit_settings(db)["enabled"] is False
        try:
            save_monthly_auto_deposit(db, True, 25, 1, True)
            assert False, "expected a PayPal connection requirement"
        except ValueError as exc:
            assert "Connect and authorize" in str(exc)
        connect_demo_sandbox(db)
        # No PAYPAL_STASH_EMAIL is assumed in the test environment.
        try:
            save_monthly_auto_deposit(db, True, 25, 1, True)
            assert False, "expected a sandbox recipient requirement"
        except ValueError as exc:
            assert "PAYPAL_STASH_EMAIL" in str(exc)


def test_monthly_deposit_webhook_updates_stash_once_only_after_success():
    with tempfile.TemporaryDirectory() as td:
        db = make_db(td)
        add_stash_goal(db, "Emergency buffer", 20, 20)
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        with db.connect() as c:
            c.execute(
                "UPDATE monthly_auto_deposit SET enabled=1,amount=20,status='payout_submitted',last_run_month=?,payout_batch_id=? WHERE id=1",
                (month, "BATCH-GLIM-1"),
            )
        event = {
            "event_type": "PAYMENT.PAYOUTSBATCH.SUCCESS",
            "resource": {"batch_header": {"payout_batch_id": "BATCH-GLIM-1"}},
        }
        before = get_state(db)["stash"]["balance"]
        assert process_paypal_event(db, event) is True
        after = get_state(db)["stash"]["balance"]
        assert after == before + 20
        assert monthly_auto_deposit_settings(db)["status"] == "completed"
        assert get_stash_goals(db)["goals"][0]["status"] == "completed"
        assert process_paypal_event(db, event) is False
        assert get_state(db)["stash"]["balance"] == after
        with db.connect() as c:
            count = c.execute("SELECT COUNT(*) FROM ledger_entries WHERE kind='monthly_deposit'").fetchone()[0]
        assert count == 1


def test_monthly_deposit_failure_pauses_drips_and_does_not_increment_stash():
    with tempfile.TemporaryDirectory() as td:
        db = make_db(td)
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        with db.connect() as c:
            c.execute(
                "UPDATE monthly_auto_deposit SET enabled=1,amount=35,status='payout_submitted',last_run_month=?,payout_batch_id=? WHERE id=1",
                (month, "BATCH-GLIM-FAILED"),
            )
        before = get_state(db)["stash"]["balance"]
        event = {
            "event_type": "PAYMENT.PAYOUTSBATCH.DENIED",
            "resource": {"batch_header": {"payout_batch_id": "BATCH-GLIM-FAILED"}},
        }
        assert process_paypal_event(db, event) is True
        state = get_state(db)
        assert state["stash"]["balance"] == before
        assert state["paused"] is True
        assert monthly_auto_deposit_settings(db)["status"] == "payout_failed"
