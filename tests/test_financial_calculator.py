import pytest
from backend.financial_calculator import PlanValidationError, calculate_plan, compare_plans


def sample_debts():
    return [
        {"id": "high", "name": "Card", "balance": 4200, "apr": 20.99, "minimum_payment": 126},
        {"id": "low", "name": "Line of credit", "balance": 2300, "apr": 11.5, "minimum_payment": 70},
    ]


def test_plan_pays_off_debt_and_has_zero_final_balance():
    result = calculate_plan(sample_debts(), 500, "avalanche")
    assert result["starting_debt"] == 6500
    assert result["total_interest"] > 0
    assert result["payoff_months"] is not None
    assert result["schedule"][0]["balance"] == 6500
    assert result["schedule"][-1]["balance"] == 0
    assert result["schedule"][-1]["month"] == result["payoff_months"]


def test_comparison_returns_both_strategies():
    result = compare_plans(sample_debts(), 500, "avalanche")
    assert result["selected"]["strategy"] == "avalanche"
    assert result["avalanche"]["strategy"] == "avalanche"
    assert result["snowball"]["strategy"] == "snowball"
    assert result["estimated_interest_difference"] >= 0


def test_budget_below_minimums_is_rejected():
    with pytest.raises(PlanValidationError, match="below the entered minimum payments"):
        calculate_plan(sample_debts(), 150, "avalanche")


def test_empty_debt_list_is_rejected():
    with pytest.raises(PlanValidationError, match="Add at least one debt"):
        calculate_plan([], 500)


def test_invalid_strategy_is_rejected():
    with pytest.raises(PlanValidationError, match="Choose avalanche or snowball"):
        calculate_plan(sample_debts(), 500, "random")


def test_zero_balance_returns_zero_month_plan():
    result = calculate_plan([{"name": "Paid card", "balance": 0, "apr": 20, "minimum_payment": 0}], 50)
    assert result["starting_debt"] == 0
    assert result["payoff_months"] == 0
    assert result["schedule"][-1]["balance"] == 0
