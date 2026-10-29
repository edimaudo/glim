import pytest
from services.paypal_guardrails import REWARD_AMOUNT_CAD, RewardGuardrailError, validate_reward_milestone


def test_savings_goal_reward_passes_only_when_target_is_reached():
    result = validate_reward_milestone("savings_goal_reached", {"target": 500, "current": 500, "goal_id": "emergency"})
    assert result["check"] == "passed"
    assert result["payout_amount"] == REWARD_AMOUNT_CAD == "1.00"
    with pytest.raises(RewardGuardrailError):
        validate_reward_milestone("savings_goal_reached", {"target": 500, "current": 499.99})


def test_debt_reward_passes_only_after_ten_percent_reduction():
    result = validate_reward_milestone("debt_reduction_10", {"baseline_balance": 1000, "current_balance": 900})
    assert result["check"] == "passed"
    with pytest.raises(RewardGuardrailError):
        validate_reward_milestone("debt_reduction_10", {"baseline_balance": 1000, "current_balance": 900.01})


def test_guardrail_rejects_unknown_milestone_and_invalid_numbers():
    with pytest.raises(RewardGuardrailError):
        validate_reward_milestone("arbitrary_payment", {"target": 1, "current": 1})
    with pytest.raises(RewardGuardrailError):
        validate_reward_milestone("debt_reduction_10", {"baseline_balance": float("nan"), "current_balance": 0})
