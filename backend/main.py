from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
load_dotenv(ROOT / ".env")

from .financial_calculator import PlanValidationError, compare_plans
from .gemini_coach import get_coach_response
from .paypal_rewards import PayPalConfigurationError, create_sandbox_payout, get_sandbox_payout_status
from .financial_products import compare_product_terms
from .qloo_personalization import get_reward_ideas

app = FastAPI(title="Glim API", version="0.1.0", description="Hackathon prototype backend for Glim financial coaching.")
SESSION_COOKIE = "glim_demo_session"
SESSION_MAX_AGE = 60 * 60 * 8
_SESSION_SECRET = os.getenv("GLIM_SESSION_SECRET", "").strip()
if not _SESSION_SECRET:
    # Convenient local-only default. Production deployments must set GLIM_SESSION_SECRET.
    if os.getenv("VERCEL") or os.getenv("VERCEL_ENV") or os.getenv("ENVIRONMENT", "").lower() == "production":
        _SESSION_SECRET = ""
    else:
        _SESSION_SECRET = "glim-local-development-session-secret-change-before-deploying"


def _session_serializer() -> URLSafeTimedSerializer:
    if not _SESSION_SECRET:
        raise HTTPException(status_code=503, detail="Set GLIM_SESSION_SECRET in the deployment environment before enabling sessions.")
    return URLSafeTimedSerializer(_SESSION_SECRET, salt="glim-demo-session-v1")


def _read_demo_session(request: Request) -> dict[str, str] | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token or not _SESSION_SECRET:
        return None
    try:
        payload = _session_serializer().loads(token, max_age=SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
    if not isinstance(payload, dict):
        return None
    name, email = payload.get("name"), payload.get("email")
    if not isinstance(name, str) or not isinstance(email, str) or "@" not in email:
        return None
    return {"name": name[:80], "email": email[:254].lower()}


def require_demo_session(request: Request) -> dict[str, str]:
    profile = _read_demo_session(request)
    if not profile:
        raise HTTPException(status_code=401, detail="Sign in to your Glim demo session to use this endpoint.")
    return profile


class DemoSessionPayload(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=254)


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


SUPPORTED_REWARD_INTEREST_TAGS = {
    "urn:tag:genre:media:nonfiction",
    "urn:tag:genre:media:action",
}


class ProductOptionPayload(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    provider: str = Field(default="", max_length=100)
    annual_rate: float = Field(ge=0, le=100)
    annual_fee: float = Field(default=0, ge=0, le=10_000)
    monthly_fee: float = Field(default=0, ge=0, le=1_000)
    promo_rate: float | None = Field(default=None, ge=0, le=100)
    promo_months: int = Field(default=0, ge=0, le=12)
    post_promo_rate: float | None = Field(default=None, ge=0, le=100)
    product_url: str | None = Field(default=None, max_length=500)


class ProductComparePayload(BaseModel):
    category: str
    balance: float = Field(ge=0, le=10_000_000)
    products: list[ProductOptionPayload] = Field(min_length=2, max_length=10)


class RewardClaimPayload(BaseModel):
    milestone_key: str
    recipient_email: str = Field(min_length=3, max_length=254)
    evidence: dict[str, Any] = Field(default_factory=dict)
    client_claim_id: str = Field(min_length=8, max_length=120)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "service": "glim-api", "mode": "prototype"}


@app.post("/api/session")
async def create_demo_session(payload: DemoSessionPayload, response: Response) -> dict[str, Any]:
    """Create an eight-hour signed demo session; this is not production authentication."""
    name = payload.name.strip()
    email = payload.email.strip().lower()
    if not name or "@" not in email or email.startswith("@") or email.endswith("@"):
        raise HTTPException(status_code=422, detail="Enter a name and a valid email address.")
    token = _session_serializer().dumps({"name": name, "email": email})
    production = bool(os.getenv("VERCEL") or os.getenv("VERCEL_ENV") or os.getenv("ENVIRONMENT", "").lower() == "production")
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        secure=production,
        samesite="lax",
        path="/",
    )
    return {"profile": {"name": name, "email": email}, "session_type": "demo", "expires_in_seconds": SESSION_MAX_AGE}


@app.get("/api/session")
async def current_demo_session(request: Request) -> dict[str, Any]:
    profile = _read_demo_session(request)
    if not profile:
        raise HTTPException(status_code=401, detail="Your demo session has ended. Sign in again.")
    return {"profile": profile, "session_type": "demo", "expires_in_seconds": SESSION_MAX_AGE}


@app.delete("/api/session")
async def delete_demo_session(response: Response) -> dict[str, str]:
    response.delete_cookie(key=SESSION_COOKIE, httponly=True, secure=bool(os.getenv("VERCEL") or os.getenv("VERCEL_ENV") or os.getenv("ENVIRONMENT", "").lower() == "production"), samesite="lax", path="/")
    return {"status": "signed_out"}


@app.post("/api/debt/plan")
async def debt_plan(payload: DebtPlanPayload, _profile: dict[str, str] = Depends(require_demo_session)) -> dict[str, Any]:
    try:
        return compare_plans(payload.debts, payload.monthly_budget, payload.selected_strategy)
    except PlanValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/coach")
async def coach(payload: CoachPayload, _profile: dict[str, str] = Depends(require_demo_session)) -> dict[str, Any]:
    try:
        result = await get_coach_response(payload.question, payload.context, payload.tone, payload.mode)
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/integrations/status")
async def integration_status(_profile: dict[str, str] = Depends(require_demo_session)) -> dict[str, Any]:
    return {
        "gemini": bool(os.getenv("GEMINI_API_KEY", "").strip()),
        "gemini_model": os.getenv("GEMINI_MODEL", "gemini-3.8-flash"),
        "paypal_sandbox": bool(os.getenv("PAYPAL_CLIENT_ID", "").strip() and os.getenv("PAYPAL_CLIENT_SECRET", "").strip()) and os.getenv("PAYPAL_ENV", "sandbox").lower() == "sandbox",
        "qloo": bool(os.getenv("QLOO_API_KEY", "").strip()),
        "financial_data_storage": "browser IndexedDB",
        "identity": "signed HTTP-only demo session cookie; not production authentication",
        "server_financial_storage": False,
    }


@app.post("/api/rewards/recommendations")
async def reward_recommendations(payload: RewardIdeasPayload, _profile: dict[str, str] = Depends(require_demo_session)) -> dict[str, Any]:
    unsupported = [tag for tag in payload.interest_tags if tag not in SUPPORTED_REWARD_INTEREST_TAGS]
    if unsupported:
        raise HTTPException(status_code=422, detail="Choose one of the supported Glim reward interests.")
    try:
        return await get_reward_ideas(payload.interest_tags)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/products/compare")
async def product_compare(payload: ProductComparePayload, _profile: dict[str, str] = Depends(require_demo_session)) -> dict[str, Any]:
    try:
        return compare_product_terms(payload.category, payload.balance, [item.model_dump() for item in payload.products])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/rewards/claim")
async def claim_reward(payload: RewardClaimPayload, _profile: dict[str, str] = Depends(require_demo_session)) -> dict[str, Any]:
    """Submit a test payout only after validating an explicit sandbox milestone claim.

    The evidence is entered in the browser and is not independently audited; this endpoint
    deliberately only permits Sandbox credentials and must not be treated as production fraud control.
    """
    evidence = payload.evidence or {}
    if payload.milestone_key == "savings_goal_reached":
        target = _safe_amount(evidence.get("target"))
        current = _safe_amount(evidence.get("current"))
        if target <= 0 or current < target:
            raise HTTPException(status_code=409, detail="The entered savings goal has not reached its target.")
    elif payload.milestone_key == "debt_reduction_10":
        baseline = _safe_amount(evidence.get("baseline_balance"))
        current = _safe_amount(evidence.get("current_balance"))
        if baseline <= 0 or current > baseline * 0.9:
            raise HTTPException(status_code=409, detail="The entered debt balance has not decreased by at least 10% from its starting value.")
    else:
        raise HTTPException(status_code=422, detail="Unsupported milestone. Eligible demo milestones are a completed savings goal or a 10% reduction in tracked debt.")
    try:
        result = await create_sandbox_payout(payload.recipient_email.strip(), "1.00", payload.client_claim_id)
    except PayPalConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    result["milestone_key"] = payload.milestone_key
    result["evidence_review"] = "Client-entered demo data; not independently verified"
    return result


@app.get("/api/rewards/status/{payout_batch_id}")
async def reward_payout_status(payout_batch_id: str, _profile: dict[str, str] = Depends(require_demo_session)) -> dict[str, Any]:
    try:
        return await get_sandbox_payout_status(payout_batch_id)
    except PayPalConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def _safe_amount(value: Any) -> float:
    try:
        amount = float(value)
        return amount if 0 <= amount <= 10_000_000 else -1
    except (TypeError, ValueError):
        return -1


@app.get("/", include_in_schema=False)
async def landing() -> FileResponse:
    return FileResponse(PUBLIC / "index.html")


@app.get("/signin.html", include_in_schema=False)
async def signin_page() -> FileResponse:
    return FileResponse(PUBLIC / "signin.html")


@app.get("/app.html", include_in_schema=False)
async def app_page() -> FileResponse:
    return FileResponse(PUBLIC / "app.html")


app.mount("/css", StaticFiles(directory=PUBLIC / "css"), name="css")
app.mount("/js", StaticFiles(directory=PUBLIC / "js"), name="js")
