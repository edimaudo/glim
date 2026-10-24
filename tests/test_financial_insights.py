from datetime import date

from app import main as main_module
from app.services import DB, get_state, write_state
from cryptography.fernet import Fernet


def _local_db(tmp_path, monkeypatch):
    db = DB(str(tmp_path / "tenant-finance.sqlite"))
    monkeypatch.setattr(main_module, "user_data_db", lambda _user: db)
    user = {"email": "finance@example.test", "name": ""}
    state = get_state(db)
    state["profile"] = {**state.get("profile", {}), "country": "CA", "currency": "CAD", "timezone": "America/Toronto", "monthly_income": 5200, "average_monthly_expenses": 4800, "savings_pct": 10}
    state["stash"]["balance"] = 600
    write_state(db, state)
    with db.connect() as conn:
        conn.execute("INSERT INTO debts(name,type,balance,apr,minimum,due_day,status) VALUES(?,?,?,?,?,?,?)", ("Canadian Rewards Card", "credit_card", 4200, 22.9, 110, 15, "active"))
        conn.execute("INSERT INTO debts(name,type,balance,apr,minimum,due_day,status) VALUES(?,?,?,?,?,?,?)", ("Personal Loan", "personal_loan", 8000, 11.5, 180, 24, "active"))
    return db, user


def test_finance_endpoints_persist_transactions_scenarios_and_reconciliation(tmp_path, monkeypatch):
    db, user = _local_db(tmp_path, monkeypatch)
    today = date.today().isoformat()
    month = today[:7]

    income = main_module.finance_transaction({"date": today, "type": "income", "description": "Paycheque", "category": "Income", "amount": 5200}, user)
    expense = main_module.finance_transaction({"date": today, "type": "expense", "description": "Groceries", "category": "Groceries", "amount": 120.5}, user)
    assert income["currency"] if "currency" in income else income["type"] == "income"
    assert expense["source"] == "manual"
    assert len(main_module.finance_transactions(user)) == 2

    imported = main_module.finance_import({"rows": [
        {"date": today, "type": "expense", "description": "Groceries", "category": "Groceries", "amount": 120.5},
        {"date": today, "type": "expense", "description": "Transit", "category": "Transport", "amount": 4.5},
        {"date": "not-a-date", "type": "expense", "description": "Invalid", "amount": 5},
    ]}, user)
    assert imported == {"imported": 1, "skipped": 2}

    report = main_module.finance_report(month=month, user=user)
    assert report["income"] == 5200
    assert report["expenses"] == 125
    assert report["net_cash_flow"] == 5075
    assert report["currency"] == "CAD"
    assert len(report["months"]) == 6

    events = main_module.finance_calendar(month=month, user=user)
    assert {event["title"] for event in events} >= {"Canadian Rewards Card minimum payment", "Monthly budget review"}

    scenario = main_module.finance_scenario({"name": "Extra payment", "extra_monthly_payment": 150, "income_delta": 200, "expense_delta": 50, "unexpected_expense": 900, "lump_sum_payment": 500, "apr_delta": 0.5, "save": False}, user)
    assert scenario["inputs"]["extra_monthly_payment"] == 150
    assert scenario["unexpected_expense_from_debt"] == 300
    assert scenario["savings_balance_after_unexpected_expense"] == 0
    assert scenario["projection"]["months"] > 0
    assert main_module.finance_scenarios(user) == []
    saved = main_module.finance_scenario({"name": "Saved extra payment", "extra_monthly_payment": 50}, user)
    assert saved["id"]
    assert len(main_module.finance_scenarios(user)) == 1

    review = main_module.finance_reconcile({"rows": [{"debt_id": 1, "statement_balance": 4000, "statement_date": today}], "apply_changes": False}, user)
    assert review["applied"] is False
    assert main_module.get_debts(db)[0]["balance"] == 4200
    applied = main_module.finance_reconcile({"rows": [{"debt_id": 1, "statement_balance": 4000, "statement_date": today, "apr": 20.99, "minimum_payment": 100, "due_day": 14}], "apply_changes": True}, user)
    assert applied["applied"] is True
    debt = {row["id"]: row for row in main_module.get_debts(db)}[1]
    assert debt["balance"] == 4000
    assert debt["apr"] == 20.99
    assert debt["minimum"] == 100
    assert debt["due_day"] == 14


def test_canadian_bank_connection_is_optional_and_tokens_are_encrypted(tmp_path, monkeypatch):
    db, user = _local_db(tmp_path, monkeypatch)
    monkeypatch.setenv("PLAID_ENV", "sandbox")
    monkeypatch.setenv("PLAID_CLIENT_ID", "test-client")
    monkeypatch.setenv("PLAID_SECRET", "test-secret")
    key = Fernet.generate_key().decode()
    monkeypatch.setenv("PLAID_TOKEN_ENCRYPTION_KEY", key)
    config = main_module._plaid_settings()
    assert main_module._plaid_ready(config) is True
    assert main_module._plaid_url(config) == "https://sandbox.plaid.com"
    encrypted = main_module._fernet(config).encrypt(b"opaque-access-token")
    assert main_module._fernet(config).decrypt(encrypted) == b"opaque-access-token"
    status = main_module.bank_status(user)
    assert status["country"] == "CA"
    assert status["configured"] is True
    assert status["connected"] is False


def test_scenario_validation_and_transaction_validation(tmp_path, monkeypatch):
    _db, user = _local_db(tmp_path, monkeypatch)
    try:
        main_module.finance_transaction({"date": "bad", "type": "expense", "description": "Invalid", "amount": 5}, user)
    except Exception as exc:
        assert "valid date" in str(exc).lower()
    else:
        raise AssertionError("Invalid transaction date should be rejected")
    try:
        main_module.finance_scenario({"extra_monthly_payment": -1}, user)
    except Exception as exc:
        assert "valid amounts" in str(exc).lower()
    else:
        raise AssertionError("Negative extra payment should be rejected")
