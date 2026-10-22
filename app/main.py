from __future__ import annotations

import asyncio
import hashlib
import json
from contextlib import asynccontextmanager
import os
from pathlib import Path
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
        StashGoalCreate, MonthlyDepositSettings, SquadGoalCreate, ScoutDebtConfirm, SavingsBalanceRequest, DebtPaymentCreate, SavingsDonationCreate, SavingsContributionCreate,
    )
    from .services import *  # noqa: F401,F403
else:  # pragma: no cover - used by Vercel's flat module loader
    from models import (
        ApprovalRequest, AuthRequest, ChatRequest, CheerRequest, DebtCreate,
        LessonCompleteRequest, NudgeResponseRequest, PlanRequest, Profile,
        RedirectRequest, SquadCreateRequest, SquadJoinRequest, WhatIfRequest,
        StashGoalCreate, MonthlyDepositSettings, SquadGoalCreate, ScoutDebtConfirm, SavingsBalanceRequest, DebtPaymentCreate, SavingsDonationCreate, SavingsContributionCreate,
    )
    from services import *  # noqa: F401,F403

BASE = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE / "templates"))
# Default: the frontend's versioned browser localStorage adapter owns prototype state.
# Do not instantiate SQLite in this mode; this is important for Vercel's read-only runtime.
STORAGE_MODE = os.getenv("GLIM_STORAGE_MODE", "localStorage").strip().lower()
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


def run_tenant_scheduled_jobs(tenant, email, shared_db):
    """Run one hourly pass of due payments, reminders, savings and settlement checks."""
    auto_drip_tick(tenant, email=email, shared_db=shared_db)
    scheduled_nudge_tick(tenant)
    process_monthly_auto_deposit_if_due(tenant)
    weekly_settlement_tick(tenant)
    reconcile_stale_settlements(tenant)


async def _monthly_deposit_worker():
    while True:
        try:
            with db.connect() as c:
                users = [dict(row) for row in c.execute("SELECT email FROM users ORDER BY email").fetchall()]
            for user in users:
                try:
                    tenant = user_data_db(user)
                    run_tenant_scheduled_jobs(tenant, email=user["email"], shared_db=db)
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
    # so localStorage mode cannot silently fall back to server-side SQLite or ephemeral memory.
    if not DATABASE_ENABLED and (request.url.path.startswith("/api/") or request.url.path == "/webhooks/paypal"):
        return JSONResponse(
            status_code=409,
            content={"detail": "Glim is running in browser localStorage mode. This route requires the database API adapter."},
        )
    return await call_next(request)


@app.get("/storage-config.js", include_in_schema=False)
def storage_config():
    mode = "database" if DATABASE_ENABLED else "localStorage"
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


@app.post("/api/debts/{debt_id}/payments")
def debt_payment_record(debt_id: int, req: DebtPaymentCreate, user=Depends(current_user)):
    try:
        return record_debt_payment(user_data_db(user), debt_id, req.amount, req.payment_date)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.get("/api/otter")
def otter_state(user=Depends(current_user)):
    return get_debt_progress(user_data_db(user))


@app.post("/api/otter/items/{item_id}/buy")
def otter_item_buy(item_id: int, user=Depends(current_user)):
    try:
        return buy_otter_item(user_data_db(user), item_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/otter/items/{item_id}/equip")
def otter_item_equip(item_id: int, user=Depends(current_user)):
    try:
        return equip_otter_item(user_data_db(user), item_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/otter/items/none/equip")
def otter_item_unequip(user=Depends(current_user)):
    return equip_otter_item(user_data_db(user), None)


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


@app.post("/api/game/freeze")
def game_freeze(user=Depends(current_user)):
    try:
        return use_freeze(user_data_db(user))
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


@app.get("/api/squads")
def squads(user=Depends(current_user)):
    return get_squad(user_data_db(user), user["email"], shared_db=db)


@app.post("/api/squads")
def squad_create(req: SquadCreateRequest, user=Depends(current_user)):
    return create_squad(user_data_db(user), req.name, user["email"], shared_db=db)


@app.post("/api/squads/join")
def squad_join(req: SquadJoinRequest, user=Depends(current_user)):
    try:
        return join_squad(user_data_db(user), req.invite_code, user["email"], shared_db=db)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/squads/leave")
def squad_leave(user=Depends(current_user)):
    return leave_squad(user_data_db(user), user["email"], shared_db=db)


@app.post("/api/squads/cheer")
def squad_cheer(req: CheerRequest, user=Depends(current_user)):
    try:
        return send_cheer(user_data_db(user), req.member_id, req.cheer, user["email"], shared_db=db)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/squads/goals")
def squad_goal_create(req: SquadGoalCreate, user=Depends(current_user)):
    try:
        return create_squad_goal(user_data_db(user), req.title, req.target_count, req.reward_cosmetic_id, user["email"], shared_db=db)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/lessons/next")
def lessons_next(user=Depends(current_user)):
    return next_lesson(user_data_db(user))


@app.post("/api/lessons/complete")
def lesson_complete(req: LessonCompleteRequest, user=Depends(current_user)):
    try:
        return complete_lesson(user_data_db(user), req.lesson_id, req.answer)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/cosmetics")
def cosmetics(user=Depends(current_user)):
    return get_cosmetics(user_data_db(user))


@app.post("/api/cosmetics/{cosmetic_id}/buy")
def cosmetic_buy(cosmetic_id: int, user=Depends(current_user)):
    try:
        return buy_cosmetic(user_data_db(user), cosmetic_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/stash/goals")
def stash_goals(user=Depends(current_user)):
    return get_stash_goals(user_data_db(user))


@app.get("/api/savings/progress")
def savings_progress(user=Depends(current_user)):
    return get_savings_progress(user_data_db(user))


@app.post("/api/stash/balance")
def stash_balance_update(req: SavingsBalanceRequest, user=Depends(current_user)):
    data_db = user_data_db(user)
    state = get_state(data_db)
    state.setdefault("stash", {})["balance"] = round(float(req.balance), 2)
    write_state(data_db, state)
    log_action(data_db, "Glim", "savings_balance_updated", {"balance": state["stash"]["balance"]}, "Update the manually entered current savings balance.", "User-entered balance", {"balance": state["stash"]["balance"]})
    return get_stash_goals(data_db)


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


@app.get("/api/savings/donations")
def savings_donations_list(user=Depends(current_user)):
    return refresh_savings_donations(user_data_db(user))


@app.post("/api/savings/donations")
def savings_donation_submit(req: SavingsDonationCreate, user=Depends(current_user)):
    try:
        return submit_savings_donation(user_data_db(user), req.charity_name, req.recipient_email, req.amount)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except PayPalAPIError as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/savings/contributions")
def savings_contribution_record(req: SavingsContributionCreate, user=Depends(current_user)):
    try:
        return record_savings_contribution(user_data_db(user), req.amount, req.contribution_date, req.goal_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


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
        "storage_mode": "database" if DATABASE_ENABLED else "localStorage",
        "database_initialized": bool(DATABASE_ENABLED),
        "persistent_data_location": "configured SQLite path plus per-user data files" if DATABASE_ENABLED else "browser localStorage",
        "user_data_isolation": "separate per-user database files" if DATABASE_ENABLED else "per-email browser namespaces; not verified authentication",
    }
