from __future__ import annotations

import json
import os
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request, Response, Depends
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .data import PERSONAS
from .models import (
    ApprovalRequest, AuthRequest, ChatRequest, CheerRequest, DebtCreate,
    LessonCompleteRequest, NudgeResponseRequest, PlanRequest, Profile,
    RedirectRequest, SquadCreateRequest, SquadJoinRequest, WhatIfRequest,
)
from .services import *  # noqa: F401,F403

BASE = Path(__file__).resolve().parent
DB_PATH = os.getenv("DATABASE_PATH", str(BASE.parent / "glim.db"))
db = DB(DB_PATH)
app = FastAPI(title="Glim", version="0.2.0")
app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")


def current_user(request: Request) -> dict:
    sid = request.cookies.get("glim_session")
    user = get_session_user(db, sid)
    if not user:
        raise HTTPException(401, "Please sign in to Glim.")
    return user


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(BASE / "static" / "index.html")


@app.get("/sw.js", include_in_schema=False)
def sw():
    return FileResponse(BASE / "static" / "sw.js", media_type="application/javascript")


@app.post("/api/auth/request")
def auth_request(req: AuthRequest):
    return request_magic_link(db, req.email)


@app.get("/api/auth/magic")
def auth_magic(token: str):
    sid = verify_magic_link(db, token)
    if not sid:
        raise HTTPException(400, "That magic link has expired or is no longer valid.")
    response = RedirectResponse(url="/")
    response.set_cookie("glim_session", sid, httponly=True, samesite="lax", max_age=60 * 60 * 24 * 14)
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
    s = get_state(db)
    debt_rows = get_debts(db)
    return {
        **s,
        "user": user,
        "debts": debt_rows,
        "daily_drip": compute_daily_drip(s["profile"]) if s["profile"] else 0.0,
        "paypal_configured": PayPalSandbox(db).configured,
        "weekly_approved": weekly_approved_total(db),
        "standing_rule_today": can_auto_approve(db, compute_daily_drip(s["profile"]) if s["profile"] else 0.0),
        "stress_mode": detect_stress(s),
    }


@app.post("/api/personas/{key}")
def persona(key: str, user=Depends(current_user)):
    if key not in PERSONAS:
        raise HTTPException(404, "Unknown persona")
    p = PERSONAS[key]
    seed_persona(db, p.__dict__, p.average_monthly_expenses)
    set_user_name(db, user["email"], p.name)
    return state(user)


@app.post("/api/profile")
def update_profile(profile: Profile, user=Depends(current_user)):
    s = get_state(db)
    s["profile"] = profile.model_dump()
    s["profile"]["average_monthly_expenses"] = s["profile"].get("monthly_income", 0) * 0.75
    active = [d for d in get_debts(db) if d["status"] == "active"]
    s["stash"]["shield_threshold"] = active[0]["minimum"] if active else 1000.0
    s["notifications"] = {
        "quiet_start": profile.quiet_start, "quiet_end": profile.quiet_end,
        "daily_cap": profile.notification_cap, "channel": profile.notification_channel,
        "consecutive_ignores": 0,
    }
    write_state(db, s)
    set_user_name(db, user["email"], profile.name)
    return state(user)


@app.post("/api/paypal/connect")
def paypal_connect(user=Depends(current_user)):
    try:
        return PayPalSandbox(db).connect()
    except PayPalAPIError as e:
        raise HTTPException(400, str(e))


@app.post("/api/paypal/disconnect")
def paypal_disconnect(user=Depends(current_user)):
    try:
        return PayPalSandbox(db).disconnect()
    except PayPalAPIError as e:
        raise HTTPException(400, str(e))


@app.get("/api/paypal/health")
def paypal_health(user=Depends(current_user)):
    try:
        return PayPalSandbox(db).health()
    except PayPalAPIError as e:
        return {"configured": True, "environment": "sandbox", "country": "CA", "currency": "CAD", "authenticated": False, "error": str(e)}


@app.get("/api/paypal/callback")
def paypal_callback(setup_token: str | None = None, token: str | None = None, order_id: str | None = None, cancelled: str | None = None):
    if cancelled:
        return RedirectResponse("/")
    s = get_state(db)
    pending_order_id = s.get("paypal", {}).get("pending_order_id")
    if pending_order_id and (order_id or token):
        try:
            complete_pending_settlement(db, order_id or token)
        except PayPalAPIError as e:
            s["paypal"]["settlement_error"] = str(e); write_state(db, s)
        return RedirectResponse("/")
    setup = setup_token or token or s.get("paypal", {}).get("setup_token")
    if setup:
        try:
            PayPalSandbox(db).complete_connection(setup)
        except PayPalAPIError as e:
            s["paypal"]["status"] = "error"; s["paypal"]["error"] = str(e); write_state(db, s)
    return RedirectResponse("/")


@app.post("/webhooks/paypal")
async def paypal_webhook(request: Request):
    raw = (await request.body()).decode("utf-8")
    headers = {k.lower(): v for k, v in request.headers.items()}
    paypal = PayPalSandbox(db)
    verified = False
    try:
        verified = paypal.verify_webhook(headers, raw)
    except PayPalAPIError as e:
        raise HTTPException(400, str(e))
    payload = json.loads(raw or "{}")
    event_id = payload.get("id", "")
    with db.connect() as c:
        exists = c.execute("SELECT id FROM webhook_events WHERE event_id=?", (event_id,)).fetchone() if event_id else None
        if not exists:
            c.execute("INSERT INTO webhook_events(created_at,event_id,event_type,payload,signature_ok,processed_at) VALUES(?,?,?,?,?,?)", (now_iso(), event_id, payload.get("event_type", "UNKNOWN"), raw, int(verified), now_iso() if verified else None))
    if not verified:
        raise HTTPException(400, "PayPal webhook signature verification failed.")
    processed = process_paypal_event(db, payload)
    return {"status": "accepted", "processed": processed}


@app.post("/api/debts")
def add_debt(req: DebtCreate, user=Depends(current_user)):
    with db.connect() as c:
        c.execute("INSERT INTO debts(name,type,balance,apr,minimum,due_day,status) VALUES(?,?,?,?,?,?,?)", (req.name, req.type, req.balance, req.apr, req.minimum, req.due_day, "active"))
    s = get_state(db)
    if not s["stash"].get("shield_threshold"):
        s["stash"]["shield_threshold"] = req.minimum
    s["plan"] = {}
    write_state(db, s)
    return state(user)


@app.post("/api/scout")
def scout(user=Depends(current_user)):
    return run_scout(db)


@app.post("/api/plan")
def plan(req: PlanRequest, user=Depends(current_user)):
    try:
        return build_plan(db, req.strategy, req.stash_pct)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/what-if")
def whatif(req: WhatIfRequest, user=Depends(current_user)):
    try:
        return what_if(db, req.text)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/drip/approve")
def drip(req: ApprovalRequest, user=Depends(current_user)):
    try:
        return approve_drip(db, req.approve)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/drip/tick")
def drip_tick(user=Depends(current_user)):
    try:
        return auto_drip_tick(db)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/drip/settle")
def settle(user=Depends(current_user)):
    try:
        return settle_week(db)
    except (ValueError, PayPalAPIError) as e:
        raise HTTPException(400, str(e))


@app.post("/api/debt/redirect")
def debt_redirect(req: RedirectRequest, user=Depends(current_user)):
    try:
        return redirect_freed_payment(db, req.destination)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/game/freeze")
def game_freeze(user=Depends(current_user)):
    try:
        return use_freeze(db)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/pause")
def pause(user=Depends(current_user)):
    s = get_state(db); s["paused"] = True; write_state(db, s)
    log_action(db, "Banker", "pause", {}, "Pause all future drip approvals and settlement initiation", "User control", {"paused": True})
    return {"paused": True}


@app.post("/api/resume")
def resume(user=Depends(current_user)):
    s = get_state(db); s["paused"] = False; write_state(db, s)
    log_action(db, "Banker", "resume", {}, "Resume drip approvals", "User control", {"paused": False})
    return {"paused": False}


@app.post("/api/chat")
def chat_endpoint(req: ChatRequest, user=Depends(current_user)):
    return chat(db, req.message)


@app.get("/api/nudge")
def nudge(user=Depends(current_user)):
    return next_nudge(db)


@app.post("/api/nudge/response")
def nudge_response(req: NudgeResponseRequest, user=Depends(current_user)):
    return respond_nudge(db, req.response)


@app.get("/api/push/config")
def push_config_endpoint(user=Depends(current_user)):
    return push_config()


@app.post("/api/push/subscribe")
def push_subscribe(subscription: dict, user=Depends(current_user)):
    try:
        return save_push_subscription(db, subscription)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/notifications")
def notifications(user=Depends(current_user)):
    return get_notification_center(db)


@app.get("/api/squads")
def squads(user=Depends(current_user)):
    return get_squad(db)


@app.post("/api/squads")
def squad_create(req: SquadCreateRequest, user=Depends(current_user)):
    return create_squad(db, req.name, user["email"])


@app.post("/api/squads/join")
def squad_join(req: SquadJoinRequest, user=Depends(current_user)):
    try:
        return join_squad(db, req.invite_code, user["email"])
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/squads/cheer")
def squad_cheer(req: CheerRequest, user=Depends(current_user)):
    return send_cheer(db, req.member_id, req.cheer)


@app.get("/api/lessons/next")
def lessons_next(user=Depends(current_user)):
    return next_lesson(db)


@app.post("/api/lessons/complete")
def lesson_complete(req: LessonCompleteRequest, user=Depends(current_user)):
    try:
        return complete_lesson(db, req.lesson_id, req.answer)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/cosmetics")
def cosmetics(user=Depends(current_user)):
    return get_cosmetics(db)


@app.post("/api/cosmetics/{cosmetic_id}/buy")
def cosmetic_buy(cosmetic_id: int, user=Depends(current_user)):
    try:
        return buy_cosmetic(db, cosmetic_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/audit")
def audit(user=Depends(current_user)):
    with db.connect() as c:
        rows = c.execute("SELECT * FROM agent_actions ORDER BY id DESC LIMIT 40").fetchall()
    out = []
    for r in rows:
        item = dict(r)
        for key in ("proposal", "result"):
            try: item[key] = json.loads(item[key])
            except Exception: pass
        out.append(item)
    return out


@app.get("/api/debt-chart")
def debt_chart(user=Depends(current_user)):
    return debt_chart_data(db)


@app.get("/api/ledger")
def ledger(user=Depends(current_user)):
    with db.connect() as c:
        rows = c.execute("SELECT * FROM ledger_entries WHERE kind='drip' ORDER BY id DESC LIMIT 60").fetchall()
    return [dict(r) for r in rows]


@app.get("/api/data/export")
def export_data(user=Depends(current_user)):
    return JSONResponse(export_user_data(db))


@app.delete("/api/account")
def delete_account(request: Request, response: Response, user=Depends(current_user)):
    delete_user_data(db)
    sid = request.cookies.get("glim_session")
    revoke_session(db, sid)
    response.delete_cookie("glim_session")
    return {"status": "deleted"}


@app.get("/health")
def health():
    return {"status": "ok", "product": "Glim"}
