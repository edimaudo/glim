"""Deterministic policy checks before Glim submits a PayPal Sandbox payout.

This is a prototype rule gate over user-entered evidence. It does not independently
verify bank/issuer data and is not production fraud prevention.
"""
from __future__ import annotations
import math
from typing import Any

REWARD_AMOUNT_CAD = "1.00"
REWARD_CURRENCY = "CAD"
SUPPORTED_MILESTONES = {"savings_goal_reached", "debt_reduction_10"}


class RewardGuardrailError(ValueError):
    """A claim failed Glim's milestone rules."""


def _amount(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return -1.0
    return number if math.isfinite(number) and 0 <= number <= 10_000_000 else -1.0


def validate_reward_milestone(milestone_key: str, evidence: Any) -> dict[str, Any]:
    """Validate an allowed milestone; payout amount remains fixed server-side."""
    if not isinstance(evidence, dict):
        raise RewardGuardrailError("Milestone evidence is missing or invalid.")

    if milestone_key == "savings_goal_reached":
        target = _amount(evidence.get("target"))
        current = _amount(evidence.get("current"))
        if target <= 0 or current < target:
            raise RewardGuardrailError("This savings goal has not reached its target yet.")
        return {
            "milestone_key": milestone_key,
            "check": "passed",
            "payout_amount": REWARD_AMOUNT_CAD,
            "currency": REWARD_CURRENCY,
            "basis": "user-entered savings goal progress",
        }

    if milestone_key == "debt_reduction_10":
        baseline = _amount(evidence.get("baseline_balance"))
        current = _amount(evidence.get("current_balance"))
        if baseline <= 0 or current < 0 or current > baseline * 0.9:
            raise RewardGuardrailError("The recorded debt balance has not decreased by at least 10%.")
        return {
            "milestone_key": milestone_key,
            "check": "passed",
            "payout_amount": REWARD_AMOUNT_CAD,
            "currency": REWARD_CURRENCY,
            "basis": "user-entered debt balance history",
        }

    raise RewardGuardrailError("This type of reward milestone is not supported.")
