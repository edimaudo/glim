"""Deterministic comparison of user-entered Canadian financial product terms.

This module never fetches or invents live offers. Users must verify terms on the provider site.
"""
from __future__ import annotations
from typing import Any
import math

SUPPORTED_CATEGORIES = {"savings", "credit_card", "line_of_credit", "personal_loan"}


def compare_product_terms(category: str, balance: float, products: list[dict[str, Any]]) -> dict[str, Any]:
    category = str(category or "").strip().lower()
    if category not in SUPPORTED_CATEGORIES:
        raise ValueError("Choose savings, credit card, line of credit, or personal loan.")
    if not isinstance(balance, (int, float)) or not math.isfinite(float(balance)):
        raise ValueError("Comparison balance must be finite and between $0 and $10,000,000 CAD.")
    if balance < 0 or balance > 10_000_000:
        raise ValueError("Comparison balance must be between $0 and $10,000,000 CAD.")
    if not isinstance(products, list) or not 2 <= len(products) <= 10:
        raise ValueError("Add between 2 and 10 products in the same category to compare them.")

    evaluated = []
    for index, item in enumerate(products):
        name = str(item.get("name", "")).strip()[:100]
        provider = str(item.get("provider", "")).strip()[:100]
        rate = float(item.get("annual_rate", 0) or 0)
        annual_fee = float(item.get("annual_fee", 0) or 0)
        monthly_fee = float(item.get("monthly_fee", 0) or 0)
        promo_rate_raw = item.get("promo_rate")
        promo_months = int(item.get("promo_months", 0) or 0)
        post_promo_raw = item.get("post_promo_rate")
        promo_rate = float(promo_rate_raw) if promo_rate_raw not in (None, "") else None
        post_promo_rate = float(post_promo_raw) if post_promo_raw not in (None, "") else rate
        if not name:
            raise ValueError(f"Product {index + 1} needs a name.")
        numeric_values = [rate, annual_fee, monthly_fee, promo_months, post_promo_rate]
        if promo_rate is not None: numeric_values.append(promo_rate)
        if any(not math.isfinite(float(value)) for value in numeric_values):
            raise ValueError(f"Rates and fees for {name} must be finite numbers.")
        if not 0 <= rate <= 100 or not 0 <= annual_fee <= 10_000 or not 0 <= monthly_fee <= 1_000:
            raise ValueError(f"Check the rate and fees for {name}.")
        if not 0 <= promo_months <= 12 or (promo_rate is not None and not 0 <= promo_rate <= 100) or not 0 <= post_promo_rate <= 100:
            raise ValueError(f"Check promotional terms for {name}.")
        if promo_months and promo_rate is None:
            raise ValueError(f"Enter a promotional rate or set promotional months to zero for {name}.")

        if promo_months > 0:
            estimated_rate = (promo_rate * promo_months + post_promo_rate * (12 - promo_months)) / 12
        else:
            estimated_rate = rate
        gross = float(balance) * estimated_rate / 100
        fees = annual_fee + monthly_fee * 12
        net = gross - fees if category == "savings" else gross + fees
        evaluated.append({
            "name": name,
            "provider": provider,
            "category": category,
            "annual_rate": rate,
            "estimated_year_one_rate": round(estimated_rate, 4),
            "annual_fees": round(fees, 2),
            "estimated_gross_interest": round(gross, 2),
            "estimated_annual_value": round(net, 2),
            "product_url": _valid_https_url(item.get("product_url")),
        })

    # Savings: highest net value is best. Borrowing: lowest estimated cost is best.
    evaluated.sort(key=lambda x: x["estimated_annual_value"], reverse=(category == "savings"))
    direction = "highest estimated net interest after stated fees" if category == "savings" else "lowest estimated annual borrowing cost"
    return {
        "category": category,
        "comparison_balance": round(float(balance), 2),
        "direction": direction,
        "products": evaluated,
        "notice": "Estimates use a constant comparison balance, simple annual rate weighting for any promotional period, and the fees entered. They do not model compound interest, balance changes, rewards, eligibility, grace periods, transaction fees, or issuer-specific calculations. Verify current terms with each provider.",
    }


def _valid_https_url(value: Any) -> str | None:
    if not value:
        return None
    text = str(value).strip()
    if text.startswith("https://") and len(text) <= 500:
        return text
    return None
