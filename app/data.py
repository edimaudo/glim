from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PersonaSeed:
    key: str
    name: str
    age_band: str
    monthly_income: float
    income_range: str
    average_monthly_expenses: float
    savings_pct: float
    floor_balance: float
    debt: dict
    paypal_transactions: list[dict]


RILEY_TX = [
    {"date": "2026-04-02", "merchant": "ACME PAYROLL", "amount": 2600.00, "category": "income"},
    {"date": "2026-04-03", "merchant": "Rent Co.", "amount": -1650.00, "category": "housing"},
    {"date": "2026-04-05", "merchant": "Streamly", "amount": -18.99, "category": "subscription"},
    {"date": "2026-04-06", "merchant": "Metro Market", "amount": -96.20, "category": "groceries"},
    {"date": "2026-04-08", "merchant": "Foodly", "amount": -28.40, "category": "dining"},
    {"date": "2026-04-15", "merchant": "ACME PAYROLL", "amount": 2600.00, "category": "income"},
    {"date": "2026-04-18", "merchant": "Gym Club", "amount": -54.99, "category": "subscription"},
    {"date": "2026-04-21", "merchant": "MusicBox", "amount": -11.99, "category": "subscription"},
    {"date": "2026-04-24", "merchant": "Metro Market", "amount": -112.80, "category": "groceries"},
]

SAM_TX = [
    {"date": "2026-04-01", "merchant": "Campus Payroll", "amount": 1900.00, "category": "income"},
    {"date": "2026-04-03", "merchant": "Home Share", "amount": -900.00, "category": "housing"},
    {"date": "2026-04-06", "merchant": "LearnHub", "amount": -29.00, "category": "subscription"},
    {"date": "2026-04-08", "merchant": "Metro Market", "amount": -74.10, "category": "groceries"},
    {"date": "2026-04-15", "merchant": "Campus Payroll", "amount": 1900.00, "category": "income"},
    {"date": "2026-04-16", "merchant": "RideNow", "amount": -39.20, "category": "transport"},
    {"date": "2026-04-19", "merchant": "MusicBox", "amount": -11.99, "category": "subscription"},
    {"date": "2026-04-25", "merchant": "Metro Market", "amount": -82.60, "category": "groceries"},
]

PERSONAS = {
    "riley": PersonaSeed(
        key="riley", name="Riley", age_band="25–38", monthly_income=5200,
        income_range="$4,500–$6,000", average_monthly_expenses=3900,
        savings_pct=5, floor_balance=1000,
        debt={"name": "Everyday Card", "type": "credit_card", "balance": 4200, "apr": 19.99, "minimum": 110, "due_day": 18},
        paypal_transactions=RILEY_TX,
    ),
    "sam": PersonaSeed(
        key="sam", name="Sam", age_band="21–28", monthly_income=3800,
        income_range="$3,000–$4,500", average_monthly_expenses=2800,
        savings_pct=6, floor_balance=600,
        debt={"name": "Starter Loan", "type": "loan", "balance": 6800, "apr": 7.2, "minimum": 160, "due_day": 12},
        paypal_transactions=SAM_TX,
    ),
}
