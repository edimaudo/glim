from __future__ import annotations

import asyncio
import hashlib
import json
from contextlib import asynccontextmanager
import os
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import FastAPI, HTTPException, Request, Response, Depends
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# Vercel can import this file as top-level ``main`` when the project root is
# configured to ``app``. Keep package-relative imports for normal deployments,
# and support flat-module imports without duplicating the application code.
if __package__:
    from .models import (
        ApprovalRequest, AuthRequest, ChatRequest, CheerRequest, DebtCreate,
        LessonCompleteRequest, NudgeResponseRequest, PlanRequest, Profile,
        RedirectRequest, SquadCreateRequest, SquadJoinRequest, WhatIfRequest,
        StashGoalCreate, MonthlyDepositSettings, SquadGoalCreate, ScoutDebtConfirm,
        DebtPaymentCreate, SavingsBalanceRequest, SavingsContributionCreate, SavingsDonationCreate,
    )
    from .services import *  # noqa: F401,F403
else:  # pragma: no cover - used by Vercel's flat module loader
    from models import (
        ApprovalRequest, AuthRequest, ChatRequest, CheerRequest, DebtCreate,
        LessonCompleteRequest, NudgeResponseRequest, PlanRequest, Profile,
        RedirectRequest, SquadCreateRequest, SquadJoinRequest, WhatIfRequest,
        StashGoalCreate, MonthlyDepositSettings, SquadGoalCreate, ScoutDebtConfirm,
        DebtPaymentCreate, SavingsBalanceRequest, SavingsContributionCreate, SavingsDonationCreate,
    )
    from services import *  # noqa: F401,F403

BASE = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE / "templates"))
# Default: the frontend's IndexedDB adapter owns browser-local state.
# Do not instantiate SQLite in this mode; this is important for Vercel's read-only runtime.
STORAGE_MODE = os.getenv("GLIM_STORAGE_MODE", "indexedDB").strip().lower()
DATABASE_ENABLED = STORAGE_MODE in {"database", "sqlite"}
DB_PATH = os.getenv("DATABASE_PATH", str(BASE.parent / "glim.db"))
_db_path = Path(DB_PATH)
if not _db_path.is_absolute():
    _db_path = (Path.cwd() / _db_path).resolve()
USER_DATA_DIR = Path(os.getenv("GLIM_USER_DATA_DIR", str(_db_path.with_name(_db_path.stem + "_users")))).resolve()
db = DB(str(_db_path)) if DATABASE_ENABLED else None
_user_db_cache = {}
_monthly_worker = None


def _migrate_single_legacy_user_data(user_db, email):
    """Move pre-tenancy data only when the auth database proves there was one account."""
    if not DATABASE_ENABLED or db is None or user_db is db:
        return
    with db.connect() as master:
        user_rows = master.execute("SELECT email FROM users ORDER BY email").fetchall()
        legacy = master.execute("SELECT * FROM app_state WHERE id=1").fetchone()
    if len(user_rows) != 1 or user_rows[0]["email"].lower() != email.lower() or not legacy:
        return
    try:
        profile = json.loads(legacy["profile_json"] or "{}")
    except (TypeError, ValueError):
        profile = {}
    if not profile.get("setup_completed") or profile.get("persona") in {"riley", "sam"} or profile.get("sample_selected"):
        return
    with user_db.connect() as tenant:
        state_row = tenant.execute("SELECT * FROM app_state WHERE id=1").fetchone()
        if state_row and json.loads(state_row["profile_json"] or "{}"):
            return
    tables = [
        "app_state", "debts", "ledger_entries", "payment_settlements", "scout_suggestions",
        "agent_actions", "webhook_events", "nudges", "nudge_arm_stats", "points_events",
        "lesson_progress", "user_cosmetics", "push_subscriptions", "stash_goals", "monthly_auto_deposit",
        "cash_transactions", "saved_financial_scenarios", "debt_reconciliations", "bank_connections", "bank_liabilities",
    ]
    with db.connect() as master, user_db.connect() as tenant:
        for table in tables:
            rows = master.execute(f"SELECT * FROM {table}").fetchall()
            for row in rows:
                record = dict(row)
                if not record:
                    continue
                columns = list(record)
                placeholders = ",".join("?" for _ in columns)
                updates = ",".join(f"{column}=excluded.{column}" for column in columns if column != "id")
                action = "INSERT OR IGNORE"
                if table in {"app_state", "monthly_auto_deposit"}:
                    action = "INSERT OR REPLACE"
                tenant.execute(
                    f"{action} INTO {table}({','.join(columns)}) VALUES({placeholders})",
                    [record[column] for column in columns],
                )
        tenant.execute("INSERT OR REPLACE INTO migration_metadata(key,value) VALUES('legacy_single_user_migrated',?)", (email.lower(),))


def user_data_db(user):
    if not DATABASE_ENABLED or db is None:
        raise HTTPException(409, "This action requires Glim server mode.")
    email = str(user.get("email", "")).strip().lower()
    if not email:
        raise HTTPException(401, "Please sign in to Glim.")
    key = hashlib.sha256(email.encode("utf-8")).hexdigest()
    path = USER_DATA_DIR / f"{key}.sqlite3"
    cache_key = str(path)
    if cache_key not in _user_db_cache:
        USER_DATA_DIR.mkdir(parents=True, exist_ok=True)
        tenant = DB(str(path))
        tenant.owner_email = email
        tenant.master_db = db
        _migrate_single_legacy_user_data(tenant, email)
        _user_db_cache[cache_key] = tenant
    return _user_db_cache[cache_key]


async def _monthly_deposit_worker():
    while True:
        try:
            with db.connect() as c:
                users = [dict(row) for row in c.execute("SELECT email FROM users ORDER BY email").fetchall()]
            for user in users:
                try:
                    tenant = user_data_db(user)
                    auto_drip_tick(tenant, email=user["email"], shared_db=db)
                    scheduled_nudge_tick(tenant)
                    process_monthly_auto_deposit_if_due(tenant)
                    weekly_settlement_tick(tenant)
                    reconcile_stale_settlements(tenant)
                except Exception:
                    # One account's payment problem must not stop other accounts' scheduled jobs.
                    continue
        except Exception:
            pass
        await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(application):
    global _monthly_worker
    if DATABASE_ENABLED and (_monthly_worker is None or _monthly_worker.done()):
        _monthly_worker = asyncio.create_task(_monthly_deposit_worker())
    try:
        yield
    finally:
        if _monthly_worker is not None:
            _monthly_worker.cancel()
            try:
                await _monthly_worker
            except asyncio.CancelledError:
                pass
            _monthly_worker = None


app = FastAPI(title="Glim", version="0.4.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")


@app.middleware("http")
async def block_state_api_in_local_storage_mode(request: Request, call_next):
    # All prototype application state is handled in the browser. Block accidental API writes
    # so browser mode cannot silently fall back to server-side SQLite or ephemeral memory.
    if not DATABASE_ENABLED and (request.url.path.startswith("/api/") or request.url.path == "/webhooks/paypal"):
        return JSONResponse(
            status_code=409,
            content={"detail": "Glim is running in browser IndexedDB mode. This route requires the database API adapter."},
        )
    return await call_next(request)


@app.get("/storage-config.js", include_in_schema=False)
def storage_config():
    mode = "database" if DATABASE_ENABLED else "indexedDB"
    # Tiny runtime config keeps the frontend adapter in sync with the server setting.
    return Response(
        content=f"window.GLIM_CONFIG = Object.freeze({{ storageMode: '{mode}' }});",
        media_type="application/javascript",
        headers={"Cache-Control": "no-store"},
    )


def current_user(request: Request) -> dict:
    sid = request.cookies.get("glim_session")
    user = get_session_user(db, sid)
    if not user:
        raise HTTPException(401, "Please sign in to Glim.")
    return user


@app.get("/", include_in_schema=False)
def index(request: Request):
    return templates.TemplateResponse(request=request, name="landing.html", context={"app_shell": False})


@app.get("/signin", include_in_schema=False)
def signin(request: Request):
    return templates.TemplateResponse(request=request, name="signin.html", context={"app_shell": False})


@app.get("/setup", include_in_schema=False)
def setup_page():
    return RedirectResponse(url="/app/overview", status_code=302)


@app.get("/app", include_in_schema=False)
def app_home():
    return RedirectResponse(url="/app/overview", status_code=302)


@app.get("/app/{active_section}", include_in_schema=False)
def app_section(request: Request, active_section: str):
    if active_section in {"coach", "game", "squad", "learn"}:
        return RedirectResponse(url="/app/overview", status_code=302)
    allowed = {"overview", "plan", "savings", "insights", "settings", "help"}
    if active_section not in allowed:
        raise HTTPException(404, "Glim section not found.")
    if DATABASE_ENABLED and not get_session_user(db, request.cookies.get("glim_session")):
        return RedirectResponse(url="/signin", status_code=303)
    return templates.TemplateResponse(request=request, name="app.html", context={"app_shell": True, "active_section": active_section})


@app.get("/sw.js", include_in_schema=False)
def sw():
    return FileResponse(BASE / "static" / "sw.js", media_type="application/javascript")


@app.post("/api/auth/request")
def auth_request(req: AuthRequest):
    try:
        return request_magic_link(db, req.email)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(503, str(e))


@app.get("/api/auth/magic")
def auth_magic(request: Request, token: str):
    sid = verify_magic_link(db, token)
    if not sid:
        raise HTTPException(400, "That magic link has expired or is no longer valid.")
    response = RedirectResponse(url="/app/overview")
    response.set_cookie(
        "glim_session", sid, httponly=True, samesite="lax", max_age=60 * 60 * 24 * 14,
        secure=(request.url.scheme == "https" or os.getenv("APP_ENV", "development").strip().lower() in {"production", "prod"}), path="/",
    )
    return response


@app.post("/api/auth/logout")
def logout(request: Request, response: Response, user=Depends(current_user)):
    sid = request.cookies.get("glim_session")
    revoke_session(db, sid)
    response.delete_cookie("glim_session")
    return {"status": "signed_out"}


@app.get("/api/auth/me")
def auth_me(request: Request):
    return {"authenticated": bool(get_session_user(db, request.cookies.get("glim_session")))}


@app.get("/api/state")
def state(user=Depends(current_user)):
    data_db = user_data_db(user)
    s = get_state(data_db)
    debt_rows = get_debts(data_db)
    safe_paypal = public_paypal_state(s.get("paypal", {}))
    readiness = payment_readiness(data_db)
    public_state = {**s, "paypal": safe_paypal}
    return {
        **public_state,
        "user": user,
        "debts": debt_rows,
        "daily_drip": compute_daily_drip(s["profile"]) if s["profile"] else 0.0,
        "paypal_configured": PayPalSandbox(data_db).configured,
        "payment_readiness": readiness["ready"],
        "payment_blockers": readiness["blockers"],
        "weekly_approved": weekly_approved_total(data_db),
        "standing_rule_today": can_auto_approve(data_db, compute_daily_drip(s["profile"]) if s["profile"] else 0.0),
        "stress_mode": detect_stress(s),
        "storage_mode": "database",
        "connections": {"paypal": safe_paypal, "gemini_configured": bool(os.getenv("GEMINI_API_KEY", "").strip())},
        "settlements": list_open_settlements(data_db),
    }


@app.post("/api/personas/{key}")
def persona(key: str, user=Depends(current_user)):
    raise HTTPException(410, "Example identities have been removed. Enter your own profile and debt details.")


@app.post("/api/profile")
def update_profile(profile: Profile, user=Depends(current_user)):
    data_db = user_data_db(user)
    try:
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
        ZoneInfo(profile.timezone)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        raise HTTPException(400, "Choose a valid IANA time zone.")
    config = push_config()
    if profile.notification_channel == "email" and not config.get("email_enabled"):
        raise HTTPException(400, "Email reminders are not configured. Set SMTP_HOST and SMTP_FROM before selecting email delivery.")
    if profile.notification_channel == "web_push" and not config.get("enabled"):
        raise HTTPException(400, "Web push is not configured. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT before selecting browser notifications.")
    s = get_state(data_db)
    s["profile"] = profile.model_dump()
    s["profile"]["setup_completed"] = True
    if s["profile"].get("average_monthly_expenses") is None:
        s["profile"]["average_monthly_expenses"] = s["profile"].get("monthly_income", 0) * 0.75
    active = [d for d in get_debts(data_db) if d["status"] == "active"]
    s["stash"]["shield_threshold"] = active[0]["minimum"] if active else 1000.0
    s["notifications"] = {
        "quiet_start": profile.quiet_start, "quiet_end": profile.quiet_end,
        "daily_cap": profile.notification_cap, "channel": profile.notification_channel,
        "consecutive_ignores": 0, "debt_reminder_tone": profile.debt_reminder_tone,
    }
    write_state(data_db, s)
    set_user_name(db, user["email"], profile.name)
    return state(user)


@app.post("/api/paypal/connect")
def paypal_connect(user=Depends(current_user)):
    try:
        return PayPalSandbox(user_data_db(user)).connect()
    except PayPalAPIError as e:
        raise HTTPException(400, str(e))


@app.post("/api/paypal/disconnect")
def paypal_disconnect(user=Depends(current_user)):
    try:
        return PayPalSandbox(user_data_db(user)).disconnect()
    except PayPalAPIError as e:
        raise HTTPException(400, str(e))


@app.get("/api/paypal/health")
def paypal_health(user=Depends(current_user)):
    data_db = user_data_db(user)
    connected = get_state(data_db).get("paypal", {})
    try:
        result = PayPalSandbox(data_db).health()
    except PayPalAPIError as e:
        result = {"configured": PayPalSandbox(data_db).configured, "environment": "sandbox", "country": "CA", "currency": "CAD", "authenticated": False, "error": str(e)}
    readiness = payment_readiness(data_db)
    result.update({"status": connected.get("status", "disconnected"), "scopes": connected.get("scopes", []), "has_vault_token": bool(connected.get("vault_id")), "approval_url": connected.get("approval_url"), "settlement_ready": readiness["ready"], "settlement_blockers": readiness["blockers"]})
    return result


@app.get("/api/paypal/callback")
def paypal_callback(
    state: str | None = None, setup_token: str | None = None, token: str | None = None,
    order_id: str | None = None, cancelled: str | None = None,
):
    if not state:
        raise HTTPException(400, "Missing or invalid PayPal state. Start the connection from Glim again.")
    now = now_iso()
    state_digest = hashlib.sha256(str(state).encode("utf-8")).hexdigest()
    with db.connect() as c:
        state_row = c.execute(
            "SELECT * FROM integration_states WHERE token IN (?,?) AND used=0 ORDER BY CASE WHEN token=? THEN 0 ELSE 1 END LIMIT 1",
            (state_digest, state, state_digest),
        ).fetchone()
        if not state_row:
            raise HTTPException(400, "That PayPal return link has expired or was already used.")
        stored_state = state_row["token"]
        if state_row["expires_at"] < now:
            c.execute("UPDATE integration_states SET used=1 WHERE token=?", (stored_state,))
            c.commit()
            raise HTTPException(400, "That PayPal return link has expired. Start again from Glim.")
        c.execute("UPDATE integration_states SET used=1 WHERE token=? AND used=0", (stored_state,))
        email, purpose = state_row["email"], state_row["purpose"]
    with db.connect() as c:
        known_user = c.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone()
    if not known_user:
        raise HTTPException(400, "This Glim account no longer exists. Sign in again to reconnect PayPal.")
    owner = {"email": email}
    data_db = user_data_db(owner)
    if cancelled:
        if purpose == "settlement_approval":
            with data_db.connect() as c:
                pending = c.execute("SELECT reference FROM payment_settlements WHERE order_id=? AND status='awaiting_approval'", (order_id or token,)).fetchone()
            if pending:
                _set_settlement(data_db, pending["reference"], status="approval_cancelled", error="Payer cancelled the PayPal approval; no capture was requested.")
                with data_db.connect() as c:
                    c.execute("UPDATE ledger_entries SET status='accrued',settlement_id=NULL WHERE settlement_id=? AND status='settlement_pending'", (pending["reference"],))
                tenant_state = get_state(data_db)
                tenant_state["paypal"].pop("pending_settlement_reference", None)
                tenant_state["paypal"].pop("pending_order_id", None)
                tenant_state["paypal"].pop("pending_settlement", None)
                tenant_state["paypal"].pop("pending_settlement_approval_url", None)
                write_state(data_db, tenant_state)
            return RedirectResponse("/app/settings?settlement=cancelled", status_code=303)
        return RedirectResponse("/app/settings?paypal=cancelled", status_code=303)
    if purpose == "settlement_approval":
        target_order = order_id or token
        if not target_order:
            return RedirectResponse("/app/settings?settlement=missing_order", status_code=303)
        try:
            complete_pending_settlement(data_db, target_order)
        except (PayPalAPIError, ValueError) as exc:
            tenant_state = get_state(data_db)
            tenant_state.setdefault("paypal", {})["settlement_error"] = str(exc)[:500]
            tenant_state["paused"] = True
            write_state(data_db, tenant_state)
            return RedirectResponse("/app/settings?settlement=error", status_code=303)
        tenant_state = get_state(data_db)
        tenant_state.setdefault("paypal", {}).pop("pending_settlement_approval_url", None)
        write_state(data_db, tenant_state)
        return RedirectResponse("/app/settings?settlement=pending_confirmation", status_code=303)
    setup = setup_token or token or get_state(data_db).get("paypal", {}).get("setup_token")
    if setup:
        try:
            PayPalSandbox(data_db).complete_connection(setup)
        except PayPalAPIError as exc:
            tenant_state = get_state(data_db)
            tenant_state.setdefault("paypal", {})["status"] = "error"
            tenant_state["paypal"]["error"] = str(exc)[:500]
            write_state(data_db, tenant_state)
            return RedirectResponse("/app/settings?paypal=error", status_code=303)
    return RedirectResponse("/app/settings?paypal=connected", status_code=303)


@app.post("/webhooks/paypal")
async def paypal_webhook(request: Request):
    raw = (await request.body()).decode("utf-8")
    headers = {k.lower(): v for k, v in request.headers.items()}
    paypal = PayPalSandbox(db)
    try:
        verified = paypal.verify_webhook(headers, raw)
    except PayPalAPIError as exc:
        raise HTTPException(400, str(exc))
    if not verified:
        raise HTTPException(400, "PayPal webhook signature verification failed.")
    try:
        payload = json.loads(raw or "{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid webhook JSON.")
    event_id = str(payload.get("id", ""))
    if not event_id:
        raise HTTPException(400, "PayPal webhook event ID is missing.")
    with db.connect() as c:
        existing = c.execute("SELECT processed_at,signature_ok FROM webhook_events WHERE event_id=?", (event_id,)).fetchone()
        if existing and existing["processed_at"] and existing["signature_ok"]:
            return {"status": "duplicate_ignored", "event_id": event_id}
        c.execute(
            "INSERT INTO webhook_events(created_at,event_id,event_type,payload,signature_ok,processed_at) VALUES(?,?,?,?,1,NULL) "
            "ON CONFLICT(event_id) DO UPDATE SET payload=excluded.payload,event_type=excluded.event_type,signature_ok=1",
            (now_iso(), event_id, payload.get("event_type", "UNKNOWN"), raw),
        )
    resource = payload.get("resource") or {}
    ids = [
        resource.get("id"), resource.get("payout_batch_id"), resource.get("batch_id"),
        (resource.get("batch_header") or {}).get("payout_batch_id"),
        (resource.get("payout_item") or {}).get("payout_batch_id"),
        (((resource.get("supplementary_data") or {}).get("related_ids") or {}).get("order_id")),
    ]
    for unit in resource.get("purchase_units") or []:
        for capture in ((unit.get("payments") or {}).get("captures") or []):
            ids.append(capture.get("id"))
    owner_email = None
    with db.connect() as c:
        for provider_id in filter(None, map(str, ids)):
            found = c.execute("SELECT email FROM paypal_correlations WHERE provider_id=?", (provider_id,)).fetchone()
            if found:
                owner_email = found["email"]
                break
    processed = False
    if owner_email:
        data_db = user_data_db({"email": owner_email})
        processed = process_paypal_event(data_db, payload)
        with data_db.connect() as c:
            c.execute(
                "INSERT INTO webhook_events(created_at,event_id,event_type,payload,signature_ok,processed_at) VALUES(?,?,?,?,1,?) "
                "ON CONFLICT(event_id) DO UPDATE SET signature_ok=1,processed_at=excluded.processed_at,payload=excluded.payload",
                (now_iso(), event_id, payload.get("event_type", "UNKNOWN"), raw, now_iso()),
            )
    if owner_email:
        with db.connect() as c:
            c.execute("UPDATE webhook_events SET processed_at=? WHERE event_id=? AND signature_ok=1", (now_iso(), event_id))
    # Keep an unmatched but signature-verified event retryable; PayPal may deliver it before
    # the local correlation row has been committed after an interrupted API response.
    return {"status": "accepted" if owner_email else "accepted_unmatched", "processed": processed, "event_id": event_id}


@app.get("/api/debt-progress")
def debt_progress(user=Depends(current_user)):
    return get_debt_progress(user_data_db(user))


@app.get("/api/otter")
def otter_state(user=Depends(current_user)):
    return get_debt_progress(user_data_db(user))


@app.post("/api/debts/{debt_id}/payments")
def debt_payment_record(debt_id: int, req: DebtPaymentCreate, user=Depends(current_user)):
    try:
        return record_debt_payment(user_data_db(user), debt_id, req.amount, req.payment_date)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/debts")
def add_debt(req: DebtCreate, user=Depends(current_user)):
    data_db = user_data_db(user)
    with data_db.connect() as c:
        c.execute("INSERT INTO debts(name,type,balance,apr,minimum,due_day,status) VALUES(?,?,?,?,?,?,?)", (req.name, req.type, req.balance, req.apr, req.minimum, req.due_day, "active"))
    s = get_state(data_db)
    if not s["stash"].get("shield_threshold"):
        s["stash"]["shield_threshold"] = req.minimum
    s["plan"] = {}
    write_state(data_db, s)
    return state(user)


@app.post("/api/scout")
def scout(user=Depends(current_user)):
    return run_scout(user_data_db(user))

@app.get("/api/scout/suggestions")
def scout_suggestions(user=Depends(current_user)):
    return list_scout_suggestions(user_data_db(user))


@app.post("/api/scout/suggestions/{suggestion_id}/confirm")
def scout_suggestion_confirm(suggestion_id: int, req: ScoutDebtConfirm, user=Depends(current_user)):
    try:
        debt = confirm_scout_debt(
            user_data_db(user), suggestion_id, debt_type=req.type, balance=req.balance,
            apr=req.apr, minimum=req.minimum, due_day=req.due_day,
        )
        return {"status": "accepted", "debt": debt, **state(user)}
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/scout/suggestions/{suggestion_id}/dismiss")
def scout_suggestion_dismiss(suggestion_id: int, user=Depends(current_user)):
    try:
        return dismiss_scout_debt(user_data_db(user), suggestion_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/plan")
def plan(req: PlanRequest, user=Depends(current_user)):
    try:
        return build_plan(user_data_db(user), req.strategy, req.stash_pct)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/what-if")
def whatif(req: WhatIfRequest, user=Depends(current_user)):
    try:
        return what_if(user_data_db(user), req.text)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/drip/approve")
def drip(req: ApprovalRequest, user=Depends(current_user)):
    try:
        return approve_drip(user_data_db(user), req.approve, email=user["email"], shared_db=db)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/drip/tick")
def drip_tick(user=Depends(current_user)):
    try:
        return auto_drip_tick(user_data_db(user), email=user["email"], shared_db=db)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/drip/settle")
def settle(user=Depends(current_user)):
    try:
        return settle_week(user_data_db(user))
    except (ValueError, PayPalAPIError) as e:
        raise HTTPException(400, str(e))

@app.post("/api/drip/reconcile")
def settlement_reconcile(user=Depends(current_user)):
    data_db = user_data_db(user)
    try:
        result = reconcile_stale_settlements(data_db, force=True)
        return {**result, "settlements": list_open_settlements(data_db), "paused": get_state(data_db)["paused"]}
    except (ValueError, PayPalAPIError) as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/drip/settlements/{reference}/retry")
def settlement_retry(reference: str, user=Depends(current_user)):
    try:
        return retry_settlement(user_data_db(user), reference)
    except (ValueError, PayPalAPIError) as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/debt/redirect")
def debt_redirect(req: RedirectRequest, user=Depends(current_user)):
    try:
        return redirect_freed_payment(user_data_db(user), req.destination)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/pause")
def pause(user=Depends(current_user)):
    data_db = user_data_db(user)
    s = get_state(data_db); s["paused"] = True; write_state(data_db, s)
    log_action(data_db, "Banker", "pause", {}, "Pause all future drip approvals and settlement initiation", "User control", {"paused": True})
    return {"paused": True}


@app.post("/api/resume")
def resume(user=Depends(current_user)):
    data_db = user_data_db(user)
    blockers = list_open_settlements(data_db)
    unresolved = [row for row in blockers if row.get("status") in {"creating_order", "capturing", "capture_unknown", "capture_pending", "creating_payout", "payout_error", "payout_failed", "payout_pending", "awaiting_approval"}]
    if unresolved:
        raise HTTPException(409, "Glim remains paused while a PayPal settlement is unresolved. Refresh settlement status or complete the recovery step first.")
    s = get_state(data_db); s["paused"] = False; s.setdefault("paypal", {}).pop("settlement_error", None); write_state(data_db, s)
    log_action(data_db, "Banker", "resume", {}, "Resume drip approvals only after payment reconciliation is safe", "User control", {"paused": False})
    return {"paused": False}


@app.post("/api/chat")
def chat_endpoint(req: ChatRequest, user=Depends(current_user)):
    return chat(user_data_db(user), req.message)


@app.get("/api/nudge")
def nudge(user=Depends(current_user)):
    return next_nudge(user_data_db(user))


@app.post("/api/nudge/response")
def nudge_response(req: NudgeResponseRequest, user=Depends(current_user)):
    return respond_nudge(user_data_db(user), req.response)


@app.get("/api/push/config")
def push_config_endpoint(user=Depends(current_user)):
    return push_config()


@app.post("/api/push/subscribe")
def push_subscribe(subscription: dict, user=Depends(current_user)):
    try:
        return save_push_subscription(user_data_db(user), subscription)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/notifications")
def notifications(user=Depends(current_user)):
    return get_notification_center(user_data_db(user))


@app.get("/api/stash/goals")
def stash_goals(user=Depends(current_user)):
    return get_stash_goals(user_data_db(user))


@app.post("/api/stash/balance")
def stash_balance_update(req: SavingsBalanceRequest, user=Depends(current_user)):
    data_db = user_data_db(user)
    state = get_state(data_db)
    state.setdefault("stash", {})["balance"] = round(float(req.balance), 2)
    write_state(data_db, state)
    log_action(data_db, "Glim", "savings_balance_updated", {"balance": state["stash"]["balance"]},
               "Update the savings balance used in the plan.", "User-entered balance", {"balance": state["stash"]["balance"]})
    return get_stash_goals(data_db)


@app.get("/api/savings/progress")
def savings_progress(user=Depends(current_user)):
    return get_savings_progress(user_data_db(user))


@app.get("/api/savings/recommendation")
def savings_recommendation(user=Depends(current_user)):
    return smart_savings_recommendation(user_data_db(user))


@app.post("/api/savings/contributions")
def savings_contribution(req: SavingsContributionCreate, user=Depends(current_user)):
    try:
        return record_savings_contribution(user_data_db(user), req.amount, req.contribution_date, req.goal_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.get("/api/savings/donations")
def savings_donations_list(user=Depends(current_user)):
    return refresh_savings_donations(user_data_db(user))


@app.post("/api/savings/donations")
def savings_donation(req: SavingsDonationCreate, user=Depends(current_user)):
    try:
        return submit_savings_donation(user_data_db(user), req.charity_name, req.recipient_email, req.amount)
    except (ValueError, PayPalAPIError) as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/stash/goals")
def stash_goal_create(req: StashGoalCreate, user=Depends(current_user)):
    try:
        return add_stash_goal(user_data_db(user), req.name, req.target_amount, req.monthly_target)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/stash/auto-deposit")
def stash_auto_deposit_get(user=Depends(current_user)):
    return monthly_auto_deposit_settings(user_data_db(user))


@app.put("/api/stash/auto-deposit")
def stash_auto_deposit_save(req: MonthlyDepositSettings, user=Depends(current_user)):
    try:
        return save_monthly_auto_deposit(user_data_db(user), req.enabled, req.amount, req.due_day, req.consent,
                                         income_pct=req.income_pct, duration_months=req.duration_months, goal_id=req.goal_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/stash/auto-deposit/run")
def stash_auto_deposit_run(user=Depends(current_user)):
    try:
        return run_monthly_auto_deposit(user_data_db(user), force=True)
    except (ValueError, PayPalAPIError) as e:
        raise HTTPException(400, str(e))


@app.get("/api/monthly-recap")
def recap(month: str | None = None, user=Depends(current_user)):
    try:
        return monthly_recap(user_data_db(user), month)
    except ValueError as e:
        raise HTTPException(400, str(e))



# Cash-flow, Canadian bank-import, scenario, calendar, and reporting endpoints.
def _normalize_financial_transaction(raw: dict, source_default: str = "manual") -> dict:
    txn_date = str(raw.get("date") or raw.get("txn_date") or raw.get("transaction_date") or "")[:10]
    try:
        date.fromisoformat(txn_date)
    except ValueError:
        raise HTTPException(400, "Each transaction needs a valid date in YYYY-MM-DD format.")
    try:
        amount = round(abs(float(raw.get("amount"))), 2)
    except (TypeError, ValueError):
        amount = 0
    txn_type = str(raw.get("type") or raw.get("txn_type") or "expense").lower()
    if txn_type not in {"income", "expense", "transfer"}:
        raise HTTPException(400, "Transaction type must be income, expense, or transfer.")
    description = str(raw.get("description") or raw.get("merchant") or raw.get("name") or "").strip()[:160]
    if not description or amount <= 0:
        raise HTTPException(400, "Each transaction needs a description and a positive amount.")
    category = str(raw.get("category") or ("Income" if txn_type == "income" else "Transfer" if txn_type == "transfer" else "Uncategorized")).strip()[:60]
    return {"id": str(raw.get("id") or uuid.uuid4().hex), "date": txn_date, "description": description, "category": category,
            "type": txn_type, "amount": amount, "source": str(raw.get("source") or source_default)[:40],
            "source_reference": str(raw.get("source_reference") or "")[:160] or None,
            "created_at": str(raw.get("created_at") or datetime.now().astimezone().isoformat())}


def _finance_debt_projection(debts: list[dict], extra: float, apr_delta: float = 0.0) -> dict:
    rows = [{**d, "balance": max(0.0, float(d.get("balance") or 0)), "minimum": max(0.0, float(d.get("minimum") or 0)),
             "apr": max(0.0, float(d.get("apr") or 0) + apr_delta)} for d in debts if float(d.get("balance") or 0) > .01]
    rows.sort(key=lambda d: (-d["apr"], d["balance"]))
    interest = 0.0; months = 0; freed = 0.0
    while any(d["balance"] > .01 for d in rows) and months < 600:
        months += 1; extra_left = max(0.0, extra) + freed; freed = 0.0
        for debt in rows:
            if debt["balance"] <= .01: continue
            charge = debt["balance"] * debt["apr"] / 1200
            interest += charge
            minimum_payment = min(debt["balance"] + charge, debt["minimum"])
            extra_payment = min(max(0.0, debt["balance"] + charge - minimum_payment), extra_left)
            extra_left -= extra_payment
            debt["balance"] = max(0.0, debt["balance"] + charge - minimum_payment - extra_payment)
            if debt["balance"] <= .01: freed += debt["minimum"]
        if all(d["balance"] > .01 and d["minimum"] <= d["balance"] * d["apr"] / 1200 for d in rows):
            return {"months": 600, "interest_paid": round(interest, 2), "stalled": True}
    return {"months": months, "interest_paid": round(interest, 2), "stalled": months >= 600}


def _calculate_finance_scenario(state: dict, debts: list[dict], body: dict) -> dict:
    active = [dict(d) for d in debts if d.get("status") == "active"]
    if not active: raise HTTPException(400, "Add an active debt before modeling repayment scenarios.")
    try:
        extra = float(body.get("extra_monthly_payment") or 0); income_delta = float(body.get("income_delta") or 0)
        expense_delta = float(body.get("expense_delta") or 0); surprise = max(0.0, float(body.get("unexpected_expense") or 0))
        lump = max(0.0, float(body.get("lump_sum_payment") or 0)); apr_delta = float(body.get("apr_delta") or 0)
        if any(not __import__("math").isfinite(v) for v in (extra, income_delta, expense_delta, surprise, lump, apr_delta)): raise ValueError()
        if extra < 0 or abs(apr_delta) > 100: raise ValueError()
    except (TypeError, ValueError):
        raise HTTPException(400, "Enter valid amounts in all scenario fields.")
    profile = state.get("profile") or {}; income = float(profile.get("monthly_income") or 0); expenses = float(profile.get("average_monthly_expenses") or 0)
    minimums = sum(float(d.get("minimum") or 0) for d in active)
    base_extra = max(0.0, income - expenses - minimums)
    baseline = _finance_debt_projection(active, base_extra)
    changed = sorted((dict(d) for d in active), key=lambda d: -float(d.get("apr") or 0))
    remaining_lump = lump
    for d in changed:
        applied = min(float(d.get("balance") or 0), remaining_lump)
        d["balance"] = round(float(d.get("balance") or 0) - applied, 2); remaining_lump -= applied
    savings = float((state.get("stash") or {}).get("balance") or 0)
    uncovered = max(0.0, surprise - savings)
    if uncovered > 0 and changed: changed[0]["balance"] = round(float(changed[0].get("balance") or 0) + uncovered, 2)
    changed_extra = max(0.0, income + income_delta - (expenses + expense_delta) - minimums) + max(0.0, extra)
    projection = _finance_debt_projection(changed, changed_extra, apr_delta)
    return {"name": str(body.get("name") or "Scenario")[:80], "inputs": {"extra_monthly_payment": extra, "income_delta": income_delta,
            "expense_delta": expense_delta, "unexpected_expense": surprise, "lump_sum_payment": lump, "apr_delta": apr_delta},
            "baseline": baseline, "projection": projection, "months_saved": baseline["months"] - projection["months"],
            "interest_saved": round(baseline["interest_paid"] - projection["interest_paid"], 2),
            "available_monthly_surplus": round(income + income_delta - expenses - expense_delta, 2),
            "baseline_monthly_surplus": round(income - expenses, 2),
            "savings_balance_after_unexpected_expense": round(max(0.0, savings - surprise), 2),
            "unexpected_expense_from_debt": round(uncovered, 2), "minimums_monthly": round(minimums, 2),
            "created_at": datetime.now().astimezone().isoformat()}


@app.get("/api/finance/transactions")
def finance_transactions(user=Depends(current_user)):
    with user_data_db(user).connect() as c:
        rows = c.execute("SELECT id,txn_date AS date,description,category,txn_type AS type,amount,source,created_at FROM cash_transactions ORDER BY txn_date DESC,created_at DESC LIMIT 5000").fetchall()
    return [dict(row) for row in rows]


@app.post("/api/finance/transactions")
def finance_transaction(req: dict, user=Depends(current_user)):
    row = _normalize_financial_transaction(req)
    data_db = user_data_db(user)
    try:
        with data_db.connect() as c:
            c.execute("INSERT INTO cash_transactions(id,txn_date,description,category,txn_type,amount,source,source_reference,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                      (row["id"], row["date"], row["description"], row["category"], row["type"], row["amount"], row["source"], row["source_reference"], row["created_at"]))
    except Exception as exc:
        if "UNIQUE" in str(exc): raise HTTPException(409, "This transaction was already imported.")
        raise
    return row


@app.post("/api/finance/import")
def finance_import(req: dict, user=Depends(current_user)):
    rows = req.get("rows") or []
    if not isinstance(rows, list) or not rows: raise HTTPException(400, "Choose a CSV file with transaction rows first.")
    if len(rows) > 5000: raise HTTPException(400, "Import up to 5,000 rows at a time.")
    data_db = user_data_db(user); imported = 0; skipped = 0
    with data_db.connect() as c:
        for raw in rows:
            try: row = _normalize_financial_transaction({**raw, "source": raw.get("source") or "CSV import"}, "CSV import")
            except HTTPException: skipped += 1; continue
            duplicate = c.execute("SELECT 1 FROM cash_transactions WHERE txn_date=? AND ABS(amount-?)<0.005 AND lower(description)=lower(?) LIMIT 1", (row["date"], row["amount"], row["description"])).fetchone()
            if duplicate: skipped += 1; continue
            try:
                c.execute("INSERT INTO cash_transactions(id,txn_date,description,category,txn_type,amount,source,source_reference,created_at) VALUES(?,?,?,?,?,?,?,?,?)", (row["id"],row["date"],row["description"],row["category"],row["type"],row["amount"],row["source"],row["source_reference"],row["created_at"]))
                imported += 1
            except Exception: skipped += 1
    if not imported: raise HTTPException(400, "No new valid rows were imported. Check the date, amount, description, and type columns.")
    return {"imported": imported, "skipped": skipped}


@app.get("/api/finance/calendar")
def finance_calendar(month: str | None = None, user=Depends(current_user)):
    month = month or date.today().strftime("%Y-%m")
    try: year, mon = [int(part) for part in month.split("-")]; last_day = (date(year + (mon == 12), 1 if mon == 12 else mon + 1, 1) - timedelta(days=1)).day
    except Exception: raise HTTPException(400, "Choose a month in YYYY-MM format.")
    if not 1 <= mon <= 12: raise HTTPException(400, "Choose a month in YYYY-MM format.")
    data_db = user_data_db(user); state = get_state(data_db); events=[]
    with data_db.connect() as c:
        payments=[dict(r) for r in c.execute("SELECT debt_id,payment_date,amount FROM debt_payment_events WHERE substr(payment_date,1,7)=?",(month,)).fetchall()]
    for debt in get_debts(data_db):
        if debt.get("status")!="active": continue
        day=min(last_day,max(1,int(debt.get("due_day") or 15))); paid=sum(float(e["amount"] or 0) for e in payments if int(e["debt_id"])==int(debt["id"]) and int(str(e["payment_date"])[8:10])<=day)>=float(debt.get("minimum") or 0)-.001
        events.append({"date":f"{month}-{day:02d}","kind":"debt","title":f"{debt['name']} minimum payment","amount":float(debt.get("minimum") or 0),"status":"recorded" if paid else "upcoming","detail":"Minimum recorded before the due day" if paid else "Check the due date and record the payment once made"})
    schedule=monthly_auto_deposit_settings(data_db)
    if schedule.get("enabled") and float(schedule.get("amount") or 0)>0:
        day=min(last_day,max(1,int(schedule.get("due_day") or 1)));events.append({"date":f"{month}-{day:02d}","kind":"savings","title":"Scheduled savings contribution","amount":float(schedule["amount"]),"status":"scheduled","detail":"Review your balance and authorization before transferring"})
    for goal in get_stash_goals(data_db).get("goals",[]):
        if goal.get("status")=="active" and float(goal.get("monthly_target") or 0)>0:
            day=min(28,last_day);events.append({"date":f"{month}-{day:02d}","kind":"savings","title":f"{goal['name']} monthly target","amount":float(goal["monthly_target"]),"status":"target","detail":"Savings contribution target"})
    events.append({"date":f"{month}-01","kind":"review","title":"Monthly budget review","amount":0,"status":"reminder","detail":"Review income, spending, upcoming bills, and savings allocation"})
    return sorted(events,key=lambda row:(row["date"],row["kind"]))


@app.get("/api/finance/report")
def finance_report(month: str | None = None, user=Depends(current_user)):
    month=month or date.today().strftime("%Y-%m")
    try: date.fromisoformat(month+"-01")
    except ValueError: raise HTTPException(400,"Choose a month in YYYY-MM format.")
    data_db=user_data_db(user);state=get_state(data_db)
    with data_db.connect() as c:
        txns=[dict(r) for r in c.execute("SELECT txn_date AS date,txn_type AS type,amount,category FROM cash_transactions").fetchall()]
        debt_events=[dict(r) for r in c.execute("SELECT payment_date,amount FROM debt_payment_events").fetchall()]
        saving_events=[dict(r) for r in c.execute("SELECT contribution_date,amount FROM savings_goal_events").fetchall()]
    def txn_sum(rows,txn_type=None):return round(sum(float(r["amount"] or 0) for r in rows if not txn_type or r.get("type")==txn_type),2)
    selected=[r for r in txns if str(r["date"])[:7]==month]
    categories={}
    for row in selected:
        if row["type"]=="expense": categories[row.get("category") or "Uncategorized"]=categories.get(row.get("category") or "Uncategorized",0)+float(row["amount"] or 0)
    y,mon=map(int,month.split("-"));trends=[]
    for offset in range(5,-1,-1):
        d0=(datetime(y,mon,1)-timedelta(days=1)).replace(day=1) if offset else datetime(y,mon,1)
        total_month=y*12+mon-1-offset; yy,mm=total_month//12,total_month%12+1;key=f"{yy:04d}-{mm:02d}"
        tx=[r for r in txns if str(r["date"])[:7]==key];dp=[r for r in debt_events if str(r["payment_date"])[:7]==key];sp=[r for r in saving_events if str(r["contribution_date"])[:7]==key]
        trends.append({"month":key,"income":txn_sum(tx,"income"),"expenses":txn_sum(tx,"expense"),"debt_payments":round(sum(float(r["amount"] or 0) for r in dp),2),"savings_contributions":round(sum(float(r["amount"] or 0) for r in sp),2)})
    debt_total=round(sum(float(e["amount"] or 0) for e in debt_events if str(e["payment_date"])[:7]==month),2)
    savings_total=round(sum(float(e["amount"] or 0) for e in saving_events if str(e["contribution_date"])[:7]==month),2)
    current_debt=round(sum(float(d.get("balance") or 0) for d in get_debts(data_db) if d.get("status")=="active"),2)
    interest_saved=float((state.get("plan") or {}).get("projection",{}).get("interest_saved") or 0)
    return {"month":month,"currency":"CAD","income":txn_sum(selected,"income"),"expenses":txn_sum(selected,"expense"),"net_cash_flow":round(txn_sum(selected,"income")-txn_sum(selected,"expense"),2),"debt_payments":debt_total,"savings_contributions":savings_total,"active_debt_balance":current_debt,"savings_balance":round(float((state.get("stash") or {}).get("balance") or 0),2),"modeled_interest_avoided":round(interest_saved,2),"categories":[{"category":k,"amount":round(v,2)} for k,v in sorted(categories.items(),key=lambda item:-item[1])],"months":trends}


@app.get("/api/finance/scenarios")
def finance_scenarios(user=Depends(current_user)):
    with user_data_db(user).connect() as c: rows=c.execute("SELECT scenario_json FROM saved_financial_scenarios ORDER BY created_at DESC LIMIT 20").fetchall()
    return [json.loads(row["scenario_json"]) for row in rows]


@app.post("/api/finance/scenarios")
def finance_scenario(req: dict, user=Depends(current_user)):
    data_db=user_data_db(user); scenario=_calculate_finance_scenario(get_state(data_db),get_debts(data_db),req); scenario["id"]=uuid.uuid4().hex
    if req.get("save") is not False:
        with data_db.connect() as c:c.execute("INSERT INTO saved_financial_scenarios(id,name,scenario_json,created_at) VALUES(?,?,?,?)",(scenario["id"],scenario["name"],json.dumps(scenario),scenario["created_at"]))
    return scenario


@app.post("/api/finance/reconcile-debts")
def finance_reconcile(req: dict, user=Depends(current_user)):
    rows=req.get("rows") or [];apply_changes=bool(req.get("apply_changes"));data_db=user_data_db(user);debts={int(d["id"]):d for d in get_debts(data_db)};results=[]
    if not rows: raise HTTPException(400,"Enter at least one statement balance to reconcile.")
    with data_db.connect() as c:
        for row in rows:
            try: debt=debts.get(int(row.get("debt_id")))
            except (TypeError,ValueError): debt=None
            if not debt: continue
            try: statement=round(float(row.get("statement_balance")),2);date.fromisoformat(str(row.get("statement_date") or ""))
            except (TypeError,ValueError): raise HTTPException(400,f"Enter a valid statement balance and date for {debt['name']}.")
            if statement<0: raise HTTPException(400,f"Enter a non-negative statement balance for {debt['name']}.")
            variance=round(statement-float(debt.get("balance") or 0),2);item={"id":uuid.uuid4().hex,"debt_id":int(debt["id"]),"name":debt["name"],"tracked_balance":round(float(debt.get("balance") or 0),2),"statement_balance":statement,"variance":variance,"statement_date":str(row["statement_date"]),"applied":apply_changes,"created_at":datetime.now().astimezone().isoformat()}
            if apply_changes:
                updates={"balance":statement,"status":"defeated" if statement<=.01 else "active"};
                for field,col,lo,hi in [("apr","apr",0,100),("minimum_payment","minimum",.01,None),("due_day","due_day",1,31)]:
                    value=row.get(field)
                    if value not in (None,""):
                        try: num=float(value)
                        except ValueError: continue
                        if num>=lo and (hi is None or num<=hi):updates[col]=int(num) if col=="due_day" else num
                c.execute("UPDATE debts SET "+", ".join(f"{col}=?" for col in updates)+" WHERE id=?",(*updates.values(),int(debt["id"])))
            c.execute("INSERT INTO debt_reconciliations(id,debt_id,details_json,created_at) VALUES(?,?,?,?)",(item["id"],int(debt["id"]),json.dumps(item),item["created_at"]))
            results.append(item)
    if not results: raise HTTPException(400,"Select at least one debt for reconciliation.")
    log_action(data_db,"Glim","debt_statement_reconciliation",{"count":len(results),"applied":apply_changes},"Compare lender statement balances and apply only after explicit user confirmation.","User confirmed statement update" if apply_changes else "Review only",{"count":len(results)})
    return {"results":results,"applied":apply_changes}


def _plaid_settings():
    return {"client_id":os.getenv("PLAID_CLIENT_ID",""),"secret":os.getenv("PLAID_SECRET",""),"env":os.getenv("PLAID_ENV","sandbox").lower(),"encryption_key":os.getenv("PLAID_TOKEN_ENCRYPTION_KEY",""),"webhook_url":os.getenv("PLAID_WEBHOOK_URL","")}

def _plaid_url(config):
    return {"sandbox":"https://sandbox.plaid.com","development":"https://development.plaid.com","production":"https://production.plaid.com"}.get(config["env"],"https://sandbox.plaid.com")

def _plaid_ready(config): return bool(config["client_id"] and config["secret"] and config["encryption_key"] and config["env"] in {"sandbox","development","production"})

def _plaid_request(config,endpoint,payload):
    body={"client_id":config["client_id"],"secret":config["secret"],**payload}
    try:
        response=httpx.post(_plaid_url(config)+endpoint,json=body,timeout=25)
        data=response.json()
    except Exception: raise HTTPException(502,"The bank connection service could not be reached.")
    if response.status_code>=400: raise HTTPException(400,"The bank connection could not complete. Check the account selection and try again.")
    return data

def _fernet(config):
    try:return Fernet(config["encryption_key"].encode())
    except Exception:raise HTTPException(503,"The bank connection is not enabled for secure token storage.")

@app.get("/api/bank/status")
def bank_status(user=Depends(current_user)):
    config=_plaid_settings();ready=_plaid_ready(config)
    with user_data_db(user).connect() as c: rows=c.execute("SELECT item_id,institution_name,created_at FROM bank_connections ORDER BY created_at DESC").fetchall()
    return {"provider":"Plaid","country":"CA","configured":ready,"connected":bool(rows),"institutions":[{"name":row["institution_name"],"connected_at":row["created_at"]} for row in rows]}

@app.post("/api/bank/link-token")
def bank_link_token(req: dict, user=Depends(current_user)):
    config=_plaid_settings()
    if not _plaid_ready(config):raise HTTPException(409,"Direct bank connection is not enabled for this account. Import a statement CSV instead.")
    body={"client_name":"Glim","user":{"client_user_id":hashlib.sha256(user["email"].lower().encode()).hexdigest()[:32]},"products":["transactions"],"additional_consented_products":["liabilities"],"country_codes":["CA"],"language":"en"}
    if config["webhook_url"]:body["webhook"]=config["webhook_url"]
    response=_plaid_request(config,"/link/token/create",body)
    if not response.get("link_token"):raise HTTPException(502,"The bank connection did not return a link token.")
    return {"link_token":response["link_token"],"expiration":response.get("expiration"),"request_id":response.get("request_id")}

@app.post("/api/bank/exchange")
def bank_exchange(req: dict,user=Depends(current_user)):
    config=_plaid_settings()
    if not _plaid_ready(config):raise HTTPException(409,"Direct bank connection is not enabled for this account.")
    public_token=str(req.get("public_token") or "")
    if not public_token:raise HTTPException(400,"The bank connection returned no public token.")
    response=_plaid_request(config,"/item/public_token/exchange",{"public_token":public_token})
    access=response.get("access_token");item_id=response.get("item_id")
    if not access or not item_id:raise HTTPException(502,"The bank connection could not be completed.")
    encrypted=_fernet(config).encrypt(access.encode()).decode();name=str(req.get("institution_name") or "Canadian bank")[:120]
    with user_data_db(user).connect() as c:c.execute("INSERT OR REPLACE INTO bank_connections(item_id,institution_name,access_token_enc,sync_cursor,created_at) VALUES(?,?,?,?,?)",(item_id,name,encrypted,None,datetime.now().astimezone().isoformat()))
    return {"status":"connected","institution_name":name}

@app.post("/api/bank/sync")
def bank_sync(req: dict,user=Depends(current_user)):
    config=_plaid_settings()
    if not _plaid_ready(config):raise HTTPException(409,"Direct bank connection is not enabled for this account.")
    data_db=user_data_db(user);cipher=_fernet(config);today=date.today();start=(today-timedelta(days=90)).isoformat();end=today.isoformat();imported=0;updated=0
    with data_db.connect() as c:connections=[dict(r) for r in c.execute("SELECT item_id,institution_name,access_token_enc FROM bank_connections").fetchall()]
    for conn in connections:
        try:access=cipher.decrypt(conn["access_token_enc"].encode()).decode()
        except (InvalidToken,ValueError):raise HTTPException(500,"A saved bank connection could not be unlocked. Disconnect and reconnect the account.")
        offset=0
        while True:
            response=_plaid_request(config,"/transactions/get",{"access_token":access,"start_date":start,"end_date":end,"options":{"count":500,"offset":offset}})
            txns=response.get("transactions") or []
            with data_db.connect() as c:
                for t in txns:
                    ref=str(t.get("transaction_id") or "")
                    if not ref:continue
                    raw_amount=float(t.get("amount") or 0);txn_type="income" if raw_amount<0 else "expense";description=str(t.get("name") or t.get("merchant_name") or "Bank transaction")[:160]
                    category=((t.get("personal_finance_category") or {}).get("primary") or ((t.get("category") or ["Uncategorized"])[0]) or "Uncategorized")
                    prev=c.execute("SELECT id FROM cash_transactions WHERE source='Plaid' AND source_reference=?",(ref,)).fetchone()
                    if prev:
                        c.execute("UPDATE cash_transactions SET txn_date=?,description=?,category=?,txn_type=?,amount=? WHERE id=?",(str(t.get("date") or end),description,str(category)[:60],txn_type,abs(raw_amount),prev["id"]));updated+=1
                    else:
                        c.execute("INSERT INTO cash_transactions(id,txn_date,description,category,txn_type,amount,source,source_reference,created_at) VALUES(?,?,?,?,?,?,?,?,?)",(uuid.uuid4().hex,str(t.get("date") or end),description,str(category)[:60],txn_type,abs(raw_amount),"Plaid",ref,datetime.now().astimezone().isoformat()));imported+=1
            total=int(response.get("total_transactions") or 0);offset+=len(txns)
            if not txns or offset>=total:break
        # Canadian lender-liability coverage is limited and institution-dependent. Store only
        # values actually returned by the optional Liability product; never infer missing values.
        try:
            liability_response=_plaid_request(config,"/liabilities/get",{"access_token":access})
            institution=str(conn.get("institution_name") or "Canadian bank")
            for account in liability_response.get("accounts") or []:
                account_id=str(account.get("account_id") or "")
                if not account_id:continue
                all_liabilities=liability_response.get("liabilities") or {}; detail={}
                for group in ("credit","mortgage","student","auto","loan","line_of_credit"):
                    match=next((item for item in (all_liabilities.get(group) or []) if str(item.get("account_id") or "")==account_id),None)
                    if match:detail=match;break
                current_balance=(account.get("balances") or {}).get("current")
                if current_balance is None:current_balance=(detail.get("last_statement_balance") if detail else None)
                aprs=detail.get("aprs") or []
                apr=next((float(x.get("apr_percentage")) for x in aprs if x.get("apr_percentage") is not None and str(x.get("apr_type","" )).lower() in {"purchase_apr","standard_apr","regular_apr"}),None)
                if apr is None:apr=next((float(x.get("apr_percentage")) for x in aprs if x.get("apr_percentage") is not None),None)
                minimum=detail.get("minimum_payment_amount") or detail.get("minimum_payment")
                next_due=detail.get("next_payment_due_date") or detail.get("next_payment_due_date")
                ident=f"{conn['item_id']}:{account_id}"
                with data_db.connect() as c:
                    c.execute("INSERT INTO bank_liabilities(id,item_id,account_id,institution_name,account_name,account_type,reported_balance,reported_apr,reported_minimum,next_due_date,raw_json,observed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(item_id,account_id) DO UPDATE SET institution_name=excluded.institution_name,account_name=excluded.account_name,account_type=excluded.account_type,reported_balance=excluded.reported_balance,reported_apr=excluded.reported_apr,reported_minimum=excluded.reported_minimum,next_due_date=excluded.next_due_date,raw_json=excluded.raw_json,observed_at=excluded.observed_at",
                        (ident,conn["item_id"],account_id,institution,str(account.get("name") or account.get("official_name") or "Linked account")[:120],str(account.get("subtype") or account.get("type") or "")[:40],float(current_balance) if current_balance is not None else None,apr,float(minimum) if minimum is not None else None,str(next_due or "")[:10] or None,json.dumps(detail),datetime.now().astimezone().isoformat()))
        except HTTPException:
            pass
    with data_db.connect() as c:liability_count=int(c.execute("SELECT COUNT(*) FROM bank_liabilities").fetchone()[0])
    return {"imported":imported,"updated":updated,"liability_accounts_available":liability_count,"window_days":90}

@app.get("/api/bank/liabilities")
def bank_liabilities(user=Depends(current_user)):
    with user_data_db(user).connect() as c:
        rows=c.execute("SELECT id,item_id,account_id,institution_name,account_name,account_type,reported_balance,reported_apr,reported_minimum,next_due_date,observed_at FROM bank_liabilities ORDER BY observed_at DESC,account_name").fetchall()
    return [dict(row) for row in rows]

@app.post("/api/bank/disconnect")
def bank_disconnect(user=Depends(current_user)):
    with user_data_db(user).connect() as c:
        c.execute("DELETE FROM bank_connections")
        c.execute("DELETE FROM bank_liabilities")
    return {"status":"disconnected"}


@app.get("/api/audit")
def audit(user=Depends(current_user)):
    data_db = user_data_db(user)
    with data_db.connect() as c:
        rows = c.execute("SELECT * FROM agent_actions ORDER BY id DESC LIMIT 40").fetchall()
    out = []
    for r in rows:
        item = dict(r)
        sensitive_provider_action = item.get("agent") == "Banker" and "paypal_" in str(item.get("input_ref", ""))
        for key in ("proposal", "result"):
            try:
                item[key] = json.loads(item[key])
            except Exception:
                pass
        if sensitive_provider_action:
            item["input_ref"] = "[redacted provider reference]"
            item["result"] = "[redacted provider response; credentials and token identifiers are not exposed in the UI]"
        out.append(item)
    return out


@app.get("/api/debt-chart")
def debt_chart(user=Depends(current_user)):
    return debt_chart_data(user_data_db(user))


@app.get("/api/ledger")
def ledger(user=Depends(current_user)):
    data_db = user_data_db(user)
    with data_db.connect() as c:
        rows = c.execute("SELECT * FROM ledger_entries WHERE kind='drip' ORDER BY id DESC LIMIT 60").fetchall()
    return [dict(r) for r in rows]


@app.get("/api/data/export")
def export_data(user=Depends(current_user)):
    return JSONResponse(export_user_data(user_data_db(user)))


@app.delete("/api/account")
def delete_account(request: Request, response: Response, user=Depends(current_user)):
    tenant = user_data_db(user)
    tenant_path = Path(tenant.path)
    delete_user_data(tenant)
    with db.connect() as c:
        # Remove membership and associated cheers from the shared community store before
        # deleting identity; do not leave display names, invite membership or activity behind.
        memberships = c.execute("SELECT squad_id,id FROM squad_members WHERE email=?", (user["email"],)).fetchall()
        for membership in memberships:
            c.execute("DELETE FROM cheers WHERE squad_id=? AND to_member_id=?", (membership["squad_id"], membership["id"]))
            c.execute("DELETE FROM squad_members WHERE id=?", (membership["id"],))
            remaining = c.execute("SELECT COUNT(*) FROM squad_members WHERE squad_id=?", (membership["squad_id"],)).fetchone()[0]
            if remaining == 0:
                c.execute("DELETE FROM squads WHERE id=?", (membership["squad_id"],))
        c.execute("DELETE FROM sessions WHERE email=?", (user["email"],))
        c.execute("DELETE FROM magic_links WHERE email=?", (user["email"],))
        c.execute("DELETE FROM integration_states WHERE email=?", (user["email"],))
        c.execute("DELETE FROM paypal_correlations WHERE email=?", (user["email"],))
        c.execute("DELETE FROM users WHERE email=?", (user["email"],))
    _user_db_cache.pop(str(tenant_path), None)
    try:
        tenant_path.unlink(missing_ok=True)
    except OSError:
        # Data has been cleared in the tenant database even if the file cannot be removed.
        pass
    sid = request.cookies.get("glim_session")
    revoke_session(db, sid)
    response.delete_cookie("glim_session", path="/")
    return {"status": "deleted"}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "product": "Glim",
        "storage_mode": "database" if DATABASE_ENABLED else "indexedDB",
        "database_initialized": bool(DATABASE_ENABLED),
        "persistent_data_location": "configured SQLite path plus per-user data files" if DATABASE_ENABLED else "browser IndexedDB",
        "user_data_isolation": "separate per-user database files" if DATABASE_ENABLED else "per-email browser namespaces; not verified authentication",
    }
