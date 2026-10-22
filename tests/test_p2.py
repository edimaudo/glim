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
            assert "payout destination" in str(exc).lower()


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


def test_recorded_debt_payment_reduces_tracked_balance_and_tracks_due_day():
    from datetime import date
    from app.services import get_debts, record_debt_payment
    with tempfile.TemporaryDirectory() as td:
        db = make_db(td)
        debt = next(d for d in get_debts(db) if d["status"] == "active")
        payment_date = date.today().replace(day=min(date.today().day, int(debt["due_day"])))
        before_balance = float(debt["balance"])
        payment = float(debt["minimum"])
        result = record_debt_payment(db, debt["id"], payment, payment_date)
        updated = next(d for d in get_debts(db) if int(d["id"]) == int(debt["id"]))
        assert round(float(updated["balance"]), 2) == round(max(0, before_balance - payment), 2)
        assert result["recorded"]["paid_on_time"] is True
        assert result["recorded"]["currency_awarded"] == 20
        assert "not independently verified" in (result.get("note") or "") or result["recorded"]["paid_on_time"] is True


def test_savings_contribution_updates_balance_goal_and_monthly_reward():
    from datetime import date
    from app.services import add_stash_goal, get_savings_progress, get_state, record_savings_contribution
    with tempfile.TemporaryDirectory() as td:
        db = make_db(td)
        add_stash_goal(db, "Emergency buffer", 1000, monthly_target=50)
        with db.connect() as c:
            goal = c.execute("SELECT id FROM stash_goals WHERE name='Emergency buffer'").fetchone()
        before = float(get_state(db)["stash"]["balance"])
        result = record_savings_contribution(db, 50, date.today(), int(goal["id"]))
        progress = get_savings_progress(db)
        tracked_goal = next(g for g in progress["goals"] if g["id"] == int(goal["id"]))
        assert round(progress["balance"], 2) == round(before + 50, 2)
        assert round(tracked_goal["saved_amount"], 2) == 50
        assert result["recorded"]["points_awarded"] == 15


def test_percentage_savings_schedule_uses_income_and_finite_term(monkeypatch):
    from app.services import add_stash_goal
    with tempfile.TemporaryDirectory() as td:
        db = make_db(td)
        connect_demo_sandbox(db)
        monkeypatch.setenv("PAYPAL_STASH_EMAIL", "savings@example.test")
        add_stash_goal(db, "Emergency buffer", 1000, monthly_target=100)
        with db.connect() as c:
            goal_id = int(c.execute("SELECT id FROM stash_goals WHERE name='Emergency buffer'").fetchone()["id"])
        profile = get_state(db)["profile"]
        result = save_monthly_auto_deposit(db, True, 0, 1, True, income_pct=5, duration_months=6, goal_id=goal_id)
        assert result["enabled"] is True
        assert result["income_pct"] == 5
        assert result["duration_months"] == 6
        assert result["goal_id"] == goal_id
        assert round(result["amount"], 2) == round(float(profile["monthly_income"]) * 0.05, 2)


def test_debt_chart_projects_combined_portfolio_for_24_months():
    from app.services import debt_chart_data
    with tempfile.TemporaryDirectory() as td:
        db = make_db(td)
        debt_chart_data(db)
        with db.connect() as c:
            c.execute("INSERT INTO debts(name,type,balance,apr,minimum,due_day,status) VALUES(?,?,?,?,?,?,?)",
                      ("Installment loan", "personal_loan", 1500, 9.5, 75, 20, "active"))
        result = debt_chart_data(db)
        assert result["labels"][0] == "Now"
        assert len(result["balances"]) == 25
        assert len(result["minimum_only"]) == 25
        assert result["starting_balance"] == round(sum(float(d["balance"]) for d in __import__("app.services", fromlist=["get_debts"]).get_debts(db) if d["status"] == "active"), 2)
        assert result["balances"][0] == result["minimum_only"][0]
