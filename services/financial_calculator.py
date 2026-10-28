"""Deterministic debt repayment projections for Glim.

These are estimates based on monthly interest accrual and the balances, rates,
minimum payments, and budget supplied by the user. They are not issuer quotes.
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any


class PlanValidationError(ValueError):
    pass


def _validate_debts(debts: list[dict[str, Any]]) -> None:
    if not debts:
        raise PlanValidationError("Add at least one debt before calculating a plan.")
    for debt in debts:
        try:
            balance = float(debt.get("balance", 0))
            apr = float(debt.get("apr", 0))
            minimum = float(debt.get("minimum_payment", debt.get("min_payment", 0)))
        except (TypeError, ValueError) as exc:
            raise PlanValidationError("Each debt needs a valid balance, APR, and minimum payment.") from exc
        if balance < 0 or apr < 0 or apr > 100 or minimum < 0:
            raise PlanValidationError("Debt values must be non-negative and APR cannot exceed 100%.")


def calculate_plan(debts: list[dict[str, Any]], monthly_budget: float, strategy: str = "avalanche") -> dict[str, Any]:
    _validate_debts(debts)
    try:
        budget = float(monthly_budget)
    except (TypeError, ValueError) as exc:
        raise PlanValidationError("Enter a valid monthly debt budget.") from exc
    if budget <= 0:
        raise PlanValidationError("The monthly debt budget must be greater than zero.")
    if strategy not in {"avalanche", "snowball"}:
        raise PlanValidationError("Choose avalanche or snowball.")

    accounts = []
    for index, debt in enumerate(debts):
        balance = float(debt.get("balance", 0))
        if balance <= 0:
            continue
        accounts.append({
            "id": debt.get("id", f"debt-{index + 1}"),
            "name": str(debt.get("name", f"Debt {index + 1}")),
            "balance": balance,
            "apr": float(debt.get("apr", 0)),
            "minimum_payment": float(debt.get("minimum_payment", debt.get("min_payment", 0))),
            "starting_balance": balance,
            "total_interest": 0.0,
            "payoff_month": None,
        })
    if not accounts:
        return {"strategy": strategy, "monthly_budget": round(budget, 2), "starting_debt": 0, "total_interest": 0, "total_paid": 0, "payoff_months": 0, "schedule": [{"month": 0, "balance": 0}], "account_results": [], "warning": None}

    starting_debt = sum(a["balance"] for a in accounts)
    first_minimums = sum(min(a["minimum_payment"], a["balance"]) for a in accounts)
    if budget + 0.005 < first_minimums:
        raise PlanValidationError(
            f"Your entered monthly budget (${budget:,.2f}) is below the entered minimum payments "
            f"(${first_minimums:,.2f}). Increase the budget or check the minimum-payment amounts before using this plan."
        )

    schedule: list[dict[str, Any]] = [{"month": 0, "balance": round(starting_debt, 2)}]
    total_interest = 0.0
    total_paid = 0.0
    month = 0
    warning = None

    while sum(a["balance"] for a in accounts) > 0.005 and month < 600:
        month += 1
        month_interest = 0.0
        for account in accounts:
            if account["balance"] <= 0:
                continue
            interest = account["balance"] * (account["apr"] / 100.0) / 12.0
            account["balance"] += interest
            account["total_interest"] += interest
            month_interest += interest
        total_interest += month_interest

        current_minimums = sum(min(a["minimum_payment"], a["balance"]) for a in accounts if a["balance"] > 0)
        if budget + 0.005 < current_minimums:
            warning = "The budget no longer covers all entered minimum payments as interest accrues. Review the inputs and seek help from the lender or a qualified non-profit credit counsellor."
            # Do not silently underpay minimums in a way that looks like a valid plan.
            raise PlanValidationError(warning)

        paid_this_month = 0.0
        for account in accounts:
            if account["balance"] <= 0:
                continue
            payment = min(account["minimum_payment"], account["balance"])
            account["balance"] -= payment
            paid_this_month += payment
            if account["balance"] <= 0.005 and account["payoff_month"] is None:
                account["balance"] = 0.0
                account["payoff_month"] = month

        extra = max(0.0, budget - paid_this_month)
        if strategy == "avalanche":
            priority = sorted(accounts, key=lambda a: (-a["apr"], a["balance"], a["name"].lower()))
        else:
            priority = sorted(accounts, key=lambda a: (a["balance"], -a["apr"], a["name"].lower()))
        for account in priority:
            if extra <= 0.005:
                break
            if account["balance"] <= 0.005:
                continue
            payment = min(extra, account["balance"])
            account["balance"] -= payment
            extra -= payment
            paid_this_month += payment
            if account["balance"] <= 0.005:
                account["balance"] = 0.0
                if account["payoff_month"] is None:
                    account["payoff_month"] = month

        total_paid += paid_this_month
        remaining = sum(a["balance"] for a in accounts)
        schedule.append({"month": month, "balance": round(max(0.0, remaining), 2)})
        if paid_this_month <= month_interest + 0.005 and remaining > 0.005:
            warning = "Your payments are not reducing the principal under these assumptions. Increase the budget or seek qualified debt advice."
            break

    if month >= 600 and sum(a["balance"] for a in accounts) > 0.005:
        warning = "This projection did not reach a payoff within 50 years. Review the APR, minimum payments, and budget."

    account_results = []
    for account in accounts:
        account_results.append({
            "id": account["id"],
            "name": account["name"],
            "starting_balance": round(account["starting_balance"], 2),
            "apr": account["apr"],
            "total_interest": round(account["total_interest"], 2),
            "payoff_month": account["payoff_month"],
            "remaining_balance": round(account["balance"], 2),
        })

    return {
        "strategy": strategy,
        "monthly_budget": round(budget, 2),
        "starting_debt": round(starting_debt, 2),
        "total_interest": round(total_interest, 2),
        "total_paid": round(total_paid, 2),
        "payoff_months": month if sum(a["balance"] for a in accounts) <= 0.005 else None,
        "schedule": schedule,
        "account_results": account_results,
        "warning": warning,
    }


def compare_plans(debts: list[dict[str, Any]], monthly_budget: float, selected_strategy: str = "avalanche") -> dict[str, Any]:
    selected = calculate_plan(debts, monthly_budget, selected_strategy)
    avalanche = calculate_plan(debts, monthly_budget, "avalanche")
    snowball = calculate_plan(debts, monthly_budget, "snowball")
    return {
        "selected": selected,
        "avalanche": avalanche,
        "snowball": snowball,
        "selected_strategy": selected_strategy,
        "estimated_interest_difference": round(abs(avalanche["total_interest"] - snowball["total_interest"]), 2),
    }
