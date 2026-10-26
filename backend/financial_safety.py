"""Shared policy and context construction for Glim's financial coach."""
from __future__ import annotations
from typing import Any

SYSTEM_GUIDANCE = """You are Glim, a calm, practical financial education coach for people in Canada.
Use plain language, no shame, and short actionable explanations. This is general financial
education, not individualized professional advice. Do not promise outcomes or claim to be a
licensed advisor. Never invent current interest rates, fees, eligibility requirements, product
terms, or government program details. If product information is not supplied from a verified
source, say it must be checked with the provider. Do not suggest skipping required minimum
payments, missing essential bills, taking on high-cost debt, or sacrificing essential needs to
meet a goal. Do not ask for full card numbers, banking passwords, PINs, security answers, or
other credentials. Do not execute transactions. If a question needs account-specific, legal,
tax, insolvency, or crisis help, recommend contacting the relevant Canadian provider or a
qualified non-profit credit counsellor. Use the calculated data below as authoritative; do not
recalculate or alter numbers. Distinguish estimates from verified facts. Keep advice consistent
across debt, savings, and literacy."""


def build_coach_input(question: str, context: dict[str, Any] | None, tone: str = "balanced", mode: str = "coach") -> str:
    context = context or {}
    tone_map = {
        "gentle": "Tone: gentle and reassuring. Be supportive without minimizing the problem.",
        "balanced": "Tone: balanced and practical. Be supportive and direct.",
        "direct": "Tone: direct and concise. State trade-offs clearly without judgment.",
    }
    mode_map = {
        "coach": "Mode: coach the user through one manageable next step.",
        "educator": "Mode: explain concepts and definitions with a simple example where helpful.",
        "planner": "Mode: compare options and clarify trade-offs; do not make an unsupported product recommendation.",
    }
    safe_context = {
        "currency": "CAD",
        "debts": context.get("debts", []),
        "savings_goals": context.get("savings_goals", []),
        "monthly_debt_budget": context.get("monthly_debt_budget"),
        "selected_plan_summary": context.get("selected_plan_summary"),
    }
    import json
    return (
        f"{SYSTEM_GUIDANCE}\n\n{tone_map.get(tone, tone_map['balanced'])}\n{mode_map.get(mode, mode_map['coach'])}\n\n"
        f"User's current Glim context (user-entered/sample data, not verified account data):\n"
        f"{json.dumps(safe_context, ensure_ascii=False)}\n\nUser question: {question.strip()}\n\n"
        "Answer with a brief explanation, a practical next step, and one important assumption or caution when relevant."
    )


def local_coach_fallback(question: str, context: dict[str, Any] | None) -> str:
    """Transparent fallback for a runnable demo when no Gemini key is configured."""
    q = question.lower()
    debts = (context or {}).get("debts", [])
    goals = (context or {}).get("savings_goals", [])
    total_debt = sum(float(d.get("balance", 0) or 0) for d in debts)
    minimums = sum(float(d.get("minimum_payment", d.get("min_payment", 0)) or 0) for d in debts)
    total_saved = sum(float(g.get("current", 0) or 0) for g in goals)

    if any(word in q for word in ["avalanche", "snowball", "repay", "repayment", "pay off", "debt"]):
        return (
            f"A useful first step is to protect every required minimum payment, then direct any extra amount toward one chosen debt. "
            f"The avalanche method targets the highest APR first and often reduces total interest; the snowball method targets the smallest balance first and can create earlier wins. "
            f"Your current tracked sample debt is ${total_debt:,.2f}, with ${minimums:,.2f} in entered monthly minimums. "
            "Those figures depend on the information entered and should be checked against your latest statements. "
            "Next step: choose a monthly amount that remains affordable after housing, food, utilities, transportation, and other essential costs."
        )
    if any(word in q for word in ["saving", "savings", "emergency fund", "save"]):
        return (
            f"Start with a repeatable contribution that leaves room for essentials and required debt payments. Your tracked goals currently show ${total_saved:,.2f} saved in this demo. "
            "An emergency fund can help prevent an unexpected expense from turning into new high-interest debt. There is no single right target for everyone. "
            "Next step: pick a small amount you can sustain for a few months, then review it when your income or expenses change."
        )
    if any(word in q for word in ["apr", "interest", "rate"]):
        return (
            "APR is an annualized rate used to describe borrowing cost. Credit-card interest is generally determined by your agreement, balance, transaction type, and payment timing; "
            "a simple monthly estimate uses APR divided by 12, but the issuer may calculate interest daily. Check your card agreement for the exact method. "
            "Next step: compare the APRs on your statements and confirm each minimum payment before choosing where to put extra money."
        )
    return (
        "Let's break this into one manageable decision. First, protect essential expenses and required minimum debt payments. Then use the numbers you can verify to compare options, "
        "including what each option costs and how flexible it leaves your cash flow. I can help explain the trade-offs, but any result based on sample or manually entered data is only an estimate. "
        "What matters most right now: lowering interest, getting an early win, or making your month-to-month budget feel more stable?"
    )
