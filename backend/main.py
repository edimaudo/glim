from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Any
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = Path(os.getenv("GLIM_DATABASE_PATH", str(DATA_DIR / "glim.sqlite3")))

from .financial_calculator import PlanValidationError, compare_plans
from .gemini_coach import get_coach_response
from .paypal_rewards import PayPalConfigurationError, create_sandbox_payout
from .qloo_personalization import get_reward_ideas

DEFAULT_STATE: dict[str, Any] = {
    "profile": {"name": "Alex", "email": ""},
    "debts": [
        {"id": "sample-visa", "name": "Rewards credit card", "type": "Credit card", "balance": 4200.0, "apr": 20.99, "minimum_payment": 126.0, "due_date": "2026-11-05", "sample": True},
        {"id": "sample-loc", "name": "Personal line of credit", "type": "Line of credit", "balance": 2300.0, "apr": 11.5, "minimum_payment": 70.0, "due_date": "2026-11-12", "sample": True},
    ],
    "savingsGoals": [
        {"id": "sample-emergency", "name": "Emergency fund", "target": 1000.0, "current": 680.0, "monthly_contribution": 50.0, "sample": True},
        {"id": "sample-buffer", "name": "Monthly breathing room", "target": 500.0, "current": 0.0, "monthly_contribution": 25.0, "sample": True},
    ],
    "monthlyBudget": 500.0,
    "strategy": "avalanche",
    "lastPlan": None,
    "milestones": [],
    "claimedRewardMilestones": [],
    "prefs": {"theme": "light", "fontSize": "medium", "reminderFrequency": "weekly", "coachTone": "balanced", "coachMode": "coach"},
    "dismissedBanner": False,
}


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def _init_db() -> None:
    with _connect() as db:
        db.execute("CREATE TABLE IF NOT EXISTS app_state (state_key TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)")
        row = db.execute("SELECT state_key FROM app_state WHERE state_key='demo' LIMIT 1").fetchone()
        if row is None:
            db.execute("INSERT INTO app_state (state_key, state_json) VALUES ('demo', ?)", (json.dumps(DEFAULT_STATE),))


def _read_state() -> dict[str, Any]:
    with _connect() as db:
        row = db.execute("SELECT state_json FROM app_state WHERE state_key='demo'").fetchone()
    return json.loads(row["state_json"]) if row else json.loads(json.dumps(DEFAULT_STATE))


def _write_state(state: dict[str, Any]) -> None:
    serialized = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
    if len(serialized.encode("utf-8")) > 512_000:
        raise HTTPException(status_code=413, detail="Saved demo state is too large.")
    with _connect() as db:
        db.execute(
            "INSERT INTO app_state (state_key, state_json, updated_at) VALUES ('demo', ?, CURRENT_TIMESTAMP) "
            "ON CONFLICT(state_key) DO UPDATE SET state_json=excluded.state_json, updated_at=CURRENT_TIMESTAMP",
            (serialized,),
        )


_init_db()
app = FastAPI(title="Glim API", version="0.1.0", description="Hackathon prototype backend for Glim financial coaching.")


class StatePayload(BaseModel):
    state: dict[str, Any]


class DebtPlanPayload(BaseModel):
    debts: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    monthly_budget: float = Field(gt=0, le=10_000_000)
    selected_strategy: str = "avalanche"


class CoachPayload(BaseModel):
    question: str = Field(min_length=2, max_length=1200)
    context: dict[str, Any] = Field(default_factory=dict)
    tone: str = "balanced"
    mode: str = "coach"


class RewardIdeasPayload(BaseModel):
    interest_tags: list[str] = Field(default_factory=list, max_length=8)


class RewardClaimPayload(BaseModel):
    milestone_key: str = "plan_created"
    recipient_email: str = Field(min_length=3, max_length=254)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "service": "glim-api", "mode": "prototype"}


@app.get("/api/state")
async def get_state() -> dict[str, Any]:
    return {"state": _read_state()}


@app.put("/api/state")
async def put_state(payload: StatePayload) -> dict[str, Any]:
    state = payload.state
    if not isinstance(state.get("debts", []), list) or not isinstance(state.get("savingsGoals", []), list):
        raise HTTPException(status_code=422, detail="Debts and savings goals must be lists.")
    _write_state(state)
    return {"saved": True}


@app.post("/api/debt/plan")
async def debt_plan(payload: DebtPlanPayload) -> dict[str, Any]:
    try:
        return compare_plans(payload.debts, payload.monthly_budget, payload.selected_strategy)
    except PlanValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/coach")
async def coach(payload: CoachPayload) -> dict[str, Any]:
    try:
        result = await get_coach_response(payload.question, payload.context, payload.tone, payload.mode)
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/integrations/status")
async def integration_status() -> dict[str, Any]:
    return {
        "gemini": bool(os.getenv("GEMINI_API_KEY", "").strip()),
        "gemini_model": os.getenv("GEMINI_MODEL", "gemini-3.8-flash"),
        "paypal_sandbox": bool(os.getenv("PAYPAL_CLIENT_ID", "").strip() and os.getenv("PAYPAL_CLIENT_SECRET", "").strip()) and os.getenv("PAYPAL_ENV", "sandbox").lower() == "sandbox",
        "qloo": bool(os.getenv("QLOO_API_KEY", "").strip()),
        "database": "sqlite",
        "auth": "demo-only",
    }


@app.post("/api/rewards/recommendations")
async def reward_recommendations(payload: RewardIdeasPayload) -> dict[str, Any]:
    try:
        return await get_reward_ideas(payload.interest_tags)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/rewards/claim")
async def claim_reward(payload: RewardClaimPayload) -> dict[str, Any]:
    state = _read_state()
    if payload.milestone_key != "plan_created" or payload.milestone_key not in state.get("milestones", []):
        raise HTTPException(status_code=409, detail="Calculate and review a debt plan before claiming this prototype milestone reward.")
    if payload.milestone_key in state.get("claimedRewardMilestones", []):
        raise HTTPException(status_code=409, detail="A reward request has already been submitted for this milestone in the demo.")
    try:
        result = await create_sandbox_payout(payload.recipient_email.strip(), "1.00")
    except PayPalConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    state.setdefault("claimedRewardMilestones", []).append(payload.milestone_key)
    _write_state(state)
    return result


@app.post("/api/reset-demo")
async def reset_demo() -> dict[str, Any]:
    _write_state(json.loads(json.dumps(DEFAULT_STATE)))
    return {"reset": True, "state": _read_state()}


@app.get("/")
async def landing() -> FileResponse:
    return FileResponse(ROOT / "index.html")


@app.get("/signin.html")
async def signin_page() -> FileResponse:
    return FileResponse(ROOT / "signin.html")


@app.get("/app.html")
async def app_page() -> FileResponse:
    return FileResponse(ROOT / "app.html")


app.mount("/css", StaticFiles(directory=ROOT / "css"), name="css")
app.mount("/js", StaticFiles(directory=ROOT / "js"), name="js")
