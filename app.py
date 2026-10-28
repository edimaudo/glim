"""Glim web application.

A single FastAPI entrypoint serves the HTML pages and handles the small set of
server-side actions that need trusted calculations or provider credentials.
Financial profile data stays in browser IndexedDB.
"""
from __future__ import annotations

import math
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from services.financial_calculator import PlanValidationError, compare_plans
from services.financial_products import compare_product_terms
from services.gemini_coach import get_coach_response
from services.paypal_rewards import (
    PayPalConfigurationError,
    create_sandbox_payout,
    get_sandbox_payout_status,
)
from services.qloo_personalization import get_reward_ideas

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
TEMPLATES = Jinja2Templates(directory=str(ROOT / "templates"))
load_dotenv(ROOT / ".env")

# No generated OpenAPI/docs endpoints. The deployment URL serves Glim at /.
app = FastAPI(
    title="Glim",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

SESSION_COOKIE = "glim_demo_session"
SESSION_MAX_AGE = 60 * 60 * 8
_SESSION_SECRET = os.getenv("GLIM_SESSION_SECRET", "").strip()
if not _SESSION_SECRET:
    # Local-only convenience. Production deployments must set this environment variable.
    if not (os.getenv("VERCEL") or os.getenv("VERCEL_ENV") or os.getenv("ENVIRONMENT", "").lower() == "production"):
        _SESSION_SECRET = "glim-local-development-session-secret-change-before-deploying"

SUPPORTED_REWARD_INTEREST_TAGS = {
    "urn:tag:genre:media:nonfiction",
    "urn:tag:genre:media:action",
}
SUPPORTED_COACH_TONES = {"gentle", "balanced", "direct"}
SUPPORTED_COACH_MODES = {"coach", "educator", "planner"}
SUPPORTED_STRATEGIES = {"avalanche", "snowball"}


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
        raise HTTPException(status_code=401, detail="Sign in to your Glim demo session to use this feature.")
    return profile


async def _json_object(request: Request) -> dict[str, Any]:
    try:
        value = await request.json()
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Request body must be valid JSON.") from exc
    if not isinstance(value, dict):
        raise HTTPException(status_code=422, detail="Request body must be a JSON object.")
    return value


def _text(payload: dict[str, Any], key: str, *, minimum: int = 0, maximum: int = 1200, required: bool = True, default: str = "") -> str:
    value = payload.get(key, default)
    if value is None and not required:
        return ""
    if not isinstance(value, str):
        raise HTTPException(status_code=422, detail=f"'{key}' must be text.")
    value = value.strip()
    if required and len(value) < minimum:
        raise HTTPException(status_code=422, detail=f"'{key}' must contain at least {minimum} characters.")
    if len(value) > maximum:
        raise HTTPException(status_code=422, detail=f"'{key}' must not exceed {maximum} characters.")
    return value


def _number(payload: dict[str, Any], key: str, *, minimum: float = 0, maximum: float = 10_000_000, default: float | None = None) -> float:
    value = payload.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise HTTPException(status_code=422, detail=f"'{key}' must be a finite number.")
    value = float(value)
    if value < minimum or value > maximum:
        raise HTTPException(status_code=422, detail=f"'{key}' must be between {minimum} and {maximum}.")
    return value


def _safe_amount(value: Any) -> float:
    try:
        amount = float(value)
        return amount if math.isfinite(amount) and 0 <= amount <= 10_000_000 else -1
    except (TypeError, ValueError):
        return -1


def _check_product_options(products: Any) -> list[dict[str, Any]]:
    if not isinstance(products, list) or not 2 <= len(products) <= 10:
        raise HTTPException(status_code=422, detail="Add between 2 and 10 products to compare.")
    checked: list[dict[str, Any]] = []
    for index, product in enumerate(products, start=1):
        if not isinstance(product, dict):
            raise HTTPException(status_code=422, detail=f"Product {index} must be an object.")
        name = _text(product, "name", minimum=1, maximum=100)
        provider = _text(product, "provider", maximum=100, required=False)
        clean: dict[str, Any] = {
            "name": name,
            "provider": provider,
            "annual_rate": _number(product, "annual_rate", minimum=0, maximum=100, default=0),
            "annual_fee": _number(product, "annual_fee", minimum=0, maximum=10_000, default=0),
            "monthly_fee": _number(product, "monthly_fee", minimum=0, maximum=1_000, default=0),
            "promo_months": int(_number(product, "promo_months", minimum=0, maximum=12, default=0)),
        }
        for key in ("promo_rate", "post_promo_rate"):
            if product.get(key) not in (None, ""):
                clean[key] = _number(product, key, minimum=0, maximum=100)
            else:
                clean[key] = None
        product_url = product.get("product_url")
        if product_url not in (None, "") and not isinstance(product_url, str):
            raise HTTPException(status_code=422, detail=f"Product {index} URL must be text.")
        clean["product_url"] = product_url
        checked.append(clean)
    return checked


# Browser page routes. These URLs return HTML, not JSON.
@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def landing(request: Request):
    return TEMPLATES.TemplateResponse(request=request, name="index.html", context={})


@app.get("/signin", response_class=HTMLResponse, include_in_schema=False)
async def signin_page(request: Request):
    return TEMPLATES.TemplateResponse(request=request, name="signin.html", context={})


@app.get("/app", response_class=HTMLResponse, include_in_schema=False)
async def app_page(request: Request):
    return TEMPLATES.TemplateResponse(request=request, name="app.html", context={})


# Application actions. These routes use descriptive paths; there is no /api prefix.
@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "service": "glim", "mode": "prototype"}


@app.post("/session")
async def create_demo_session(request: Request, response: Response) -> dict[str, Any]:
    """Create a temporary signed demo session; this is not production authentication."""
    payload = await _json_object(request)
    name = _text(payload, "name", minimum=1, maximum=80)
    email = _text(payload, "email", minimum=3, maximum=254).lower()
    if "@" not in email or email.startswith("@") or email.endswith("@") or " " in email:
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
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


@app.get("/session")
async def current_demo_session(request: Request) -> dict[str, Any]:
    profile = _read_demo_session(request)
    if not profile:
        raise HTTPException(status_code=401, detail="Your demo session has ended. Sign in again.")
    return {"profile": profile, "session_type": "demo", "expires_in_seconds": SESSION_MAX_AGE}


@app.delete("/session")
async def delete_demo_session(response: Response) -> dict[str, str]:
    production = bool(os.getenv("VERCEL") or os.getenv("VERCEL_ENV") or os.getenv("ENVIRONMENT", "").lower() == "production")
    response.delete_cookie(key=SESSION_COOKIE, httponly=True, secure=production, samesite="lax", path="/")
    return {"status": "signed_out"}


@app.post("/debt/plan")
async def debt_plan(request: Request, _profile: dict[str, str] = Depends(require_demo_session)) -> dict[str, Any]:
    payload = await _json_object(request)
    debts = payload.get("debts", [])
    if not isinstance(debts, list) or len(debts) > 100 or any(not isinstance(item, dict) for item in debts):
        raise HTTPException(status_code=422, detail="Debts must be a list of up to 100 debt records.")
    monthly_budget = _number(payload, "monthly_budget", minimum=0.01)
    strategy = _text(payload, "selected_strategy", minimum=1, maximum=20, required=False, default="avalanche").lower() or "avalanche"
    if strategy not in SUPPORTED_STRATEGIES:
        raise HTTPException(status_code=422, detail="Choose the avalanche or snowball strategy.")
    try:
        return compare_plans(debts, monthly_budget, strategy)
    except PlanValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/coach")
async def coach(request: Request, _profile: dict[str, str] = Depends(require_demo_session)) -> dict[str, Any]:
    payload = await _json_object(request)
    question = _text(payload, "question", minimum=2, maximum=1200)
    context = payload.get("context", {})
    if not isinstance(context, dict):
        raise HTTPException(status_code=422, detail="'context' must be an object.")
    tone = _text(payload, "tone", maximum=20, required=False, default="balanced") or "balanced"
    mode = _text(payload, "mode", maximum=20, required=False, default="coach") or "coach"
    if tone not in SUPPORTED_COACH_TONES or mode not in SUPPORTED_COACH_MODES:
        raise HTTPException(status_code=422, detail="Choose a supported coaching tone and mode.")
    try:
        return await get_coach_response(question, context, tone, mode)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/integrations/status")
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


@app.post("/rewards/recommendations")
async def reward_recommendations(request: Request, _profile: dict[str, str] = Depends(require_demo_session)) -> dict[str, Any]:
    payload = await _json_object(request)
    interest_tags = payload.get("interest_tags", [])
    if not isinstance(interest_tags, list) or len(interest_tags) > 8 or any(not isinstance(tag, str) for tag in interest_tags):
        raise HTTPException(status_code=422, detail="Provide up to eight supported reward interests.")
    unsupported = [tag for tag in interest_tags if tag not in SUPPORTED_REWARD_INTEREST_TAGS]
    if unsupported:
        raise HTTPException(status_code=422, detail="Choose one of the supported Glim reward interests.")
    try:
        return await get_reward_ideas(interest_tags)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/products/compare")
async def product_compare(request: Request, _profile: dict[str, str] = Depends(require_demo_session)) -> dict[str, Any]:
    payload = await _json_object(request)
    category = _text(payload, "category", minimum=1, maximum=40)
    balance = _number(payload, "balance", minimum=0)
    products = _check_product_options(payload.get("products"))
    try:
        return compare_product_terms(category, balance, products)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/rewards/claim")
async def claim_reward(request: Request, _profile: dict[str, str] = Depends(require_demo_session)) -> dict[str, Any]:
    """Request a Sandbox payout after validating an explicit demo milestone claim.

    Evidence comes from the browser and is not independently audited; it is not
    adequate fraud control for a production rewards programme.
    """
    payload = await _json_object(request)
    milestone_key = _text(payload, "milestone_key", minimum=1, maximum=80)
    recipient_email = _text(payload, "recipient_email", minimum=3, maximum=254)
    client_claim_id = _text(payload, "client_claim_id", minimum=8, maximum=120)
    evidence = payload.get("evidence", {})
    if not isinstance(evidence, dict):
        raise HTTPException(status_code=422, detail="'evidence' must be an object.")
    if "@" not in recipient_email or " " in recipient_email:
        raise HTTPException(status_code=422, detail="Enter a valid Sandbox recipient email.")

    if milestone_key == "savings_goal_reached":
        target = _safe_amount(evidence.get("target"))
        current = _safe_amount(evidence.get("current"))
        if target <= 0 or current < target:
            raise HTTPException(status_code=409, detail="The entered savings goal has not reached its target.")
    elif milestone_key == "debt_reduction_10":
        baseline = _safe_amount(evidence.get("baseline_balance"))
        current = _safe_amount(evidence.get("current_balance"))
        if baseline <= 0 or current > baseline * 0.9:
            raise HTTPException(status_code=409, detail="The entered debt balance has not decreased by at least 10% from its starting value.")
    else:
        raise HTTPException(status_code=422, detail="Supported demo milestones are a completed savings goal or a 10% reduction in tracked debt.")

    try:
        result = await create_sandbox_payout(recipient_email.strip(), "1.00", client_claim_id)
    except PayPalConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    result["milestone_key"] = milestone_key
    result["evidence_review"] = "Client-entered demo data; not independently verified"
    return result


@app.get("/rewards/status/{payout_batch_id}")
async def reward_payout_status(payout_batch_id: str, _profile: dict[str, str] = Depends(require_demo_session)) -> dict[str, Any]:
    try:
        return await get_sandbox_payout_status(payout_batch_id)
    except PayPalConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


# Vercel serves files in the project-level public/ directory from its CDN.
# Never mount public/ automatically: Vercel's function bundle may omit these
# folders, which would make Starlette raise at import time. For local uvicorn
# development, run.sh opts into these mounts explicitly with GLIM_LOCAL_STATIC=1.
IS_VERCEL = bool(os.getenv("VERCEL") or os.getenv("VERCEL_ENV"))
if os.getenv("GLIM_LOCAL_STATIC") == "1" and not IS_VERCEL:
    css_dir = PUBLIC / "css"
    js_dir = PUBLIC / "js"
    if css_dir.is_dir():
        app.mount("/css", StaticFiles(directory=str(css_dir)), name="css")
    if js_dir.is_dir():
        app.mount("/js", StaticFiles(directory=str(js_dir)), name="js")
