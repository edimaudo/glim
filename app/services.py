from __future__ import annotations

import json
import math
import os
import random
import re
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import httpx

PRODUCT = "Glim"


class DB:
    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.init()

    def connect(self):
        conn = __import__("sqlite3").connect(self.path)
        conn.row_factory = __import__("sqlite3").Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def init(self):
        with self.connect() as c:
            c.executescript(
                """
                CREATE TABLE IF NOT EXISTS app_state (
                  id INTEGER PRIMARY KEY CHECK (id = 1), profile_json TEXT NOT NULL,
                  paypal_json TEXT NOT NULL, stash_json TEXT NOT NULL, game_json TEXT NOT NULL,
                  plan_json TEXT NOT NULL, paused INTEGER NOT NULL DEFAULT 0,
                  notifications_json TEXT NOT NULL DEFAULT '{}',
                  pending_redirect_json TEXT NOT NULL DEFAULT 'null'
                );
                CREATE TABLE IF NOT EXISTS debts (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, type TEXT, balance REAL,
                  apr REAL, minimum REAL, due_day INTEGER, status TEXT
                );
                CREATE TABLE IF NOT EXISTS ledger_entries (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, kind TEXT, amount REAL,
                  stash_share REAL, debt_share REAL, debt_id INTEGER, status TEXT, settlement_id TEXT
                );
                CREATE TABLE IF NOT EXISTS agent_actions (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, agent TEXT, input_ref TEXT,
                  proposal TEXT, rationale TEXT, approval TEXT, result TEXT
                );
                CREATE TABLE IF NOT EXISTS webhook_events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, event_id TEXT UNIQUE,
                  event_type TEXT, payload TEXT, signature_ok INTEGER, processed_at TEXT
                );
                CREATE TABLE IF NOT EXISTS nudges (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, arm_key TEXT, message TEXT,
                  response TEXT, reward REAL
                );
                CREATE TABLE IF NOT EXISTS nudge_arm_stats (
                  arm_key TEXT PRIMARY KEY, alpha REAL, beta REAL
                );
                CREATE TABLE IF NOT EXISTS points_events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, reason TEXT, points INTEGER, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS users (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL,
                  name TEXT, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS magic_links (
                  token TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL,
                  expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS sessions (
                  token TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL,
                  expires_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS squads (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
                  invite_code TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS squad_members (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, squad_id INTEGER NOT NULL,
                  email TEXT NOT NULL, display_name TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0,
                  streak INTEGER NOT NULL DEFAULT 0, goal_pct REAL NOT NULL DEFAULT 0,
                  level INTEGER NOT NULL DEFAULT 1, UNIQUE(squad_id,email),
                  FOREIGN KEY(squad_id) REFERENCES squads(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS cheers (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, squad_id INTEGER NOT NULL,
                  to_member_id INTEGER NOT NULL, cheer TEXT NOT NULL, created_at TEXT NOT NULL,
                  FOREIGN KEY(squad_id) REFERENCES squads(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS lessons (
                  id INTEGER PRIMARY KEY, slug TEXT UNIQUE, title TEXT, description TEXT,
                  points INTEGER, prompt TEXT, answer_hint TEXT
                );
                CREATE TABLE IF NOT EXISTS lesson_progress (
                  lesson_id INTEGER PRIMARY KEY, completed INTEGER NOT NULL DEFAULT 0,
                  completed_at TEXT
                );
                CREATE TABLE IF NOT EXISTS cosmetics (
                  id INTEGER PRIMARY KEY, name TEXT, description TEXT, cost INTEGER,
                  icon TEXT
                );
                CREATE TABLE IF NOT EXISTS user_cosmetics (
                  cosmetic_id INTEGER PRIMARY KEY, purchased_at TEXT
                );
                CREATE TABLE IF NOT EXISTS push_subscriptions (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, endpoint TEXT UNIQUE NOT NULL,
                  subscription_json TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS stash_goals (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, target_amount REAL NOT NULL,
                  saved_amount REAL NOT NULL DEFAULT 0, monthly_target REAL NOT NULL DEFAULT 0,
                  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, completed_at TEXT
                );
                CREATE TABLE IF NOT EXISTS monthly_auto_deposit (
                  id INTEGER PRIMARY KEY CHECK (id=1), enabled INTEGER NOT NULL DEFAULT 0,
                  amount REAL NOT NULL DEFAULT 0, due_day INTEGER NOT NULL DEFAULT 1, consent_at TEXT,
                  last_attempt_month TEXT, last_run_month TEXT, status TEXT NOT NULL DEFAULT 'disabled',
                  last_error TEXT, last_run_at TEXT, order_id TEXT, payout_batch_id TEXT
                );
                CREATE TABLE IF NOT EXISTS squad_goals (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, squad_id INTEGER NOT NULL, title TEXT NOT NULL,
                  target_count INTEGER NOT NULL, progress_count INTEGER NOT NULL DEFAULT 0,
                  reward_cosmetic_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active',
                  created_at TEXT NOT NULL, completed_at TEXT,
                  FOREIGN KEY(squad_id) REFERENCES squads(id) ON DELETE CASCADE,
                  FOREIGN KEY(reward_cosmetic_id) REFERENCES cosmetics(id)
                );
                CREATE TABLE IF NOT EXISTS squad_goal_events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, squad_goal_id INTEGER NOT NULL,
                  email TEXT NOT NULL, event_date TEXT NOT NULL, created_at TEXT NOT NULL,
                  UNIQUE(squad_goal_id,email,event_date),
                  FOREIGN KEY(squad_goal_id) REFERENCES squad_goals(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS squad_cosmetics (
                  squad_id INTEGER NOT NULL, cosmetic_id INTEGER NOT NULL, unlocked_at TEXT NOT NULL,
                  PRIMARY KEY(squad_id,cosmetic_id),
                  FOREIGN KEY(squad_id) REFERENCES squads(id) ON DELETE CASCADE,
                  FOREIGN KEY(cosmetic_id) REFERENCES cosmetics(id)
                );
                """
            )
            c.execute("INSERT OR IGNORE INTO monthly_auto_deposit(id,enabled,amount,due_day,status) VALUES(1,0,0,1,'disabled')")
            cur = c.execute("PRAGMA table_info(app_state)")
            cols = {row[1] for row in cur.fetchall()}
            if "notifications_json" not in cols:
                c.execute("ALTER TABLE app_state ADD COLUMN notifications_json TEXT NOT NULL DEFAULT '{}'")
            if "pending_redirect_json" not in cols:
                c.execute("ALTER TABLE app_state ADD COLUMN pending_redirect_json TEXT NOT NULL DEFAULT 'null'")
            for table, column, ddl in [
                ("ledger_entries", "settlement_id", "ALTER TABLE ledger_entries ADD COLUMN settlement_id TEXT"),
                ("webhook_events", "event_id", "ALTER TABLE webhook_events ADD COLUMN event_id TEXT"),
            ]:
                cur2 = c.execute(f"PRAGMA table_info({table})")
                existing = {row[1] for row in cur2.fetchall()}
                if column not in existing:
                    c.execute(ddl)
            self._seed_catalog(c)

    def _seed_catalog(self, c):
        lessons = [
            (1, "shield-basics", "Build the Shield", "Why a buffer matters before aggressive payoff.", 40, "Your Shield is one month of minimum payments. What is the minimum payment shown in your dashboard?", "Use the active Boss minimum."),
            (2, "apr", "Meet the Interest Ogre", "How APR makes a balance regrow.", 40, "What is the active Boss APR?", "Use the APR shown on the Boss card."),
            (3, "subscriptions", "Spot a Leak", "Turn recurring charges into a behavior win.", 50, "How much do the Scout's top two recurring charges total each month?", "Add the first two monthly amounts from Scout."),
            (4, "snowball", "Choose Your Attack", "Compare avalanche, snowball, and hybrid trade-offs.", 50, "Which strategy targets the smallest balance first?", "It is the strategy named for a growing snowball."),
        ]
        c.executemany("INSERT OR IGNORE INTO lessons(id,slug,title,description,points,prompt,answer_hint) VALUES(?,?,?,?,?,?,?)", lessons)
        cosmetics = [
            (1, "Leaf trail", "A calm trail effect for your forest path.", 80, "🍃"),
            (2, "Acorn crown", "A tiny crown for a consistent week.", 120, "🌰"),
            (3, "Moonlit grove", "A night look for the forest.", 180, "🌙"),
        ]
        c.executemany("INSERT OR IGNORE INTO cosmetics(id,name,description,cost,icon) VALUES(?,?,?,?,?)", cosmetics)

    def reset(self):
        with self.connect() as c:
            for table in ["app_state", "debts", "ledger_entries", "agent_actions", "webhook_events", "nudges", "nudge_arm_stats", "points_events", "squads", "squad_members", "cheers", "lesson_progress", "user_cosmetics", "push_subscriptions", "stash_goals", "squad_goals", "squad_goal_events", "squad_cosmetics"]:
                c.execute(f"DELETE FROM {table}")
            c.execute("UPDATE monthly_auto_deposit SET enabled=0,amount=0,due_day=1,consent_at=NULL,last_attempt_month=NULL,last_run_month=NULL,status='disabled',last_error=NULL,last_run_at=NULL,order_id=NULL,payout_batch_id=NULL WHERE id=1")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class PayPalAPIError(RuntimeError):
    def __init__(self, message: str, status_code: int | None = None, payload: Any = None):
        super().__init__(message); self.status_code = status_code; self.payload = payload


class PayPalSandbox:
    base_url = "https://api-m.sandbox.paypal.com"
    country = "CA"
    currency = "CAD"
    scopes = [
        "https://uri.paypal.com/services/vault/payment-tokens/read",
        "https://uri.paypal.com/services/vault/payment-tokens/readwrite",
        "https://uri.paypal.com/services/reporting/search/read",
    ]

    def __init__(self, db: DB):
        self.db = db
        self.client_id = os.getenv("PAYPAL_CLIENT_ID", "").strip()
        self.client_secret = os.getenv("PAYPAL_CLIENT_SECRET", "").strip()
        self.webhook_id = os.getenv("PAYPAL_WEBHOOK_ID", "").strip()
        self.lender_email = os.getenv("PAYPAL_LENDER_EMAIL", "").strip()
        self.stash_email = os.getenv("PAYPAL_STASH_EMAIL", "").strip()
        self.app_url = os.getenv("APP_PUBLIC_URL", "http://127.0.0.1:8000").rstrip("/")
        self.recurring_usage = os.getenv("PAYPAL_RECURRING_USAGE_PATTERN", "UNSCHEDULED_PREPAID")

    @property
    def configured(self):
        return bool(self.client_id and self.client_secret)

    def _require_config(self):
        if not self.configured:
            raise PayPalAPIError("PayPal Sandbox is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.")

    def _token(self):
        self._require_config()
        try:
            with httpx.Client(timeout=20) as client:
                r = client.post(f"{self.base_url}/v1/oauth2/token", auth=(self.client_id, self.client_secret), data={"grant_type": "client_credentials"}, headers={"Accept": "application/json", "Accept-Language": "en_CA"})
        except httpx.HTTPError as e:
            raise PayPalAPIError(f"Could not reach PayPal Sandbox: {e}") from e
        if r.status_code >= 400: raise self._api_error(r, "PayPal OAuth authentication failed")
        return r.json()["access_token"]

    def _api_error(self, r, prefix):
        try: payload = r.json()
        except Exception: payload = r.text
        detail = payload.get("message") if isinstance(payload, dict) else None
        return PayPalAPIError(f"{prefix}: {detail or r.text or r.status_code}", r.status_code, payload)

    def _request(self, method, path, *, json_body=None, params=None, headers=None):
        token = self._token()
        merged = {"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"}
        if headers: merged.update(headers)
        try:
            with httpx.Client(timeout=30) as client:
                r = client.request(method, f"{self.base_url}{path}", json=json_body, params=params, headers=merged)
        except httpx.HTTPError as e:
            raise PayPalAPIError(f"PayPal Sandbox request failed: {e}") from e
        if r.status_code >= 400: raise self._api_error(r, f"PayPal {method} {path} failed")
        return r

    def health(self):
        if not self.configured:
            return {"configured": False, "environment": "sandbox", "country": self.country, "currency": self.currency, "base_url": self.base_url}
        tok = self._token()
        return {"configured": True, "authenticated": bool(tok), "environment": "sandbox", "country": self.country, "currency": self.currency, "base_url": self.base_url}

    def connect(self):
        callback = f"{self.app_url}/api/paypal/callback"
        body = {"customer": {"merchant_customer_id": "glim-demo-customer"}, "payment_source": {"paypal": {"description": "Glim sandbox funding source", "experience_context": {"brand_name": PRODUCT, "locale": "en-CA", "return_url": callback, "cancel_url": f"{callback}?cancelled=1"}}}}
        r = self._request("POST", "/v3/vault/setup-tokens", json_body=body, headers={"PayPal-Request-Id": f"glim-setup-{uuid.uuid4().hex}"})
        p = r.json(); approve = next((x["href"] for x in p.get("links", []) if x.get("rel") == "approve"), None)
        if not approve: raise PayPalAPIError("PayPal Sandbox did not return an approval URL.", r.status_code, p)
        s = get_state(self.db); s["paypal"] = {"status":"awaiting_approval","mode":"sandbox","country":"CA","currency":"CAD","scopes":self.scopes,"setup_token":p.get("id"),"customer_id":(p.get("customer") or {}).get("id"),"approval_url":approve}; write_state(self.db,s)
        log_action(self.db,"Banker","paypal_setup_token",{"country":"CA","currency":"CAD"},"Create a real PayPal Sandbox setup token and require payer approval","PayPal-hosted approval required",p)
        return {"status":"awaiting_approval","approval_url":approve,"setup_token":p.get("id"),"country":"CA","currency":"CAD"}

    def complete_connection(self, setup_token):
        r = self._request("POST","/v3/vault/payment-tokens",json_body={"payment_source":{"token":{"id":setup_token,"type":"SETUP_TOKEN"}}},headers={"PayPal-Request-Id":f"glim-token-{uuid.uuid4().hex}"})
        p=r.json(); token=p.get("id")
        if not token: raise PayPalAPIError("PayPal Sandbox did not return a payment token.", r.status_code, p)
        s=get_state(self.db); s["paypal"]={"status":"connected","mode":"sandbox","country":"CA","currency":"CAD","scopes":self.scopes,"vault_id":token,"customer_id":(p.get("customer") or {}).get("id"),"funding_ref":token[-8:]}; write_state(self.db,s)
        log_action(self.db,"Banker","paypal_payment_token",{"setup_token":setup_token},"Exchange an approved setup token for a real PayPal payment token","Payer approved in PayPal Sandbox",p)
        return s["paypal"]

    def disconnect(self):
        s=get_state(self.db); vid=s.get("paypal",{}).get("vault_id")
        if vid and self.configured:
            self._request("DELETE",f"/v3/vault/payment-tokens/{vid}")
        s["paypal"]={"status":"disconnected","mode":"sandbox","country":"CA","currency":"CAD","scopes":[]}; write_state(self.db,s); return s["paypal"]

    def search_transactions(self, start, end):
        r=self._request("GET","/v1/reporting/transactions",params={"start_date":start,"end_date":end,"fields":"all","page_size":100},headers={"PayPal-Enforce-ISO8601-Format":"true"})
        return r.json()

    def create_order_from_vault(self, amount, reference, request_id=None):
        s=get_state(self.db); vault=s.get("paypal",{}).get("vault_id")
        if not vault: raise PayPalAPIError("No PayPal vaulted payment token is connected.")
        body={"intent":"CAPTURE","purchase_units":[{"reference_id":reference,"amount":{"currency_code":"CAD","value":f"{amount:.2f}"}}],"payment_source":{"paypal":{"vault_id":vault,"stored_credential":{"payment_initiator":"MERCHANT","usage":"SUBSEQUENT","usage_pattern":self.recurring_usage}}}}
        return self._request("POST","/v2/checkout/orders",json_body=body,headers={"PayPal-Request-Id":request_id or f"glim-order-{uuid.uuid4().hex}"}).json()

    def create_order_for_approval(self, amount, reference):
        callback=f"{self.app_url}/api/paypal/callback"; body={"intent":"CAPTURE","purchase_units":[{"reference_id":reference,"amount":{"currency_code":"CAD","value":f"{amount:.2f}"}}],"payment_source":{"paypal":{"experience_context":{"brand_name":PRODUCT,"locale":"en-CA","user_action":"PAY_NOW","return_url":callback,"cancel_url":f"{callback}?cancelled=1"}}}}
        return self._request("POST","/v2/checkout/orders",json_body=body,headers={"PayPal-Request-Id":f"glim-approved-order-{uuid.uuid4().hex}"}).json()

    def capture_order(self, order_id):
        return self._request("POST",f"/v2/checkout/orders/{order_id}/capture",headers={"PayPal-Request-Id":f"glim-capture-{order_id}-{uuid.uuid4().hex}"}).json()

    def create_payout(self, debt_amount, stash_amount, reference, request_id=None):
        if debt_amount>0 and not self.lender_email: raise PayPalAPIError("Set PAYPAL_LENDER_EMAIL for the Sandbox debt Payouts step.")
        if stash_amount>0 and not self.stash_email: raise PayPalAPIError("Set PAYPAL_STASH_EMAIL for the Sandbox savings Payouts step.")
        items=[]
        if debt_amount>0: items.append({"recipient_type":"EMAIL","amount":{"value":f"{debt_amount:.2f}","currency":"CAD"},"receiver":self.lender_email,"note":"Glim debt settlement (sandbox)"})
        if stash_amount>0: items.append({"recipient_type":"EMAIL","amount":{"value":f"{stash_amount:.2f}","currency":"CAD"},"receiver":self.stash_email,"note":"Glim savings stash settlement (sandbox)"})
        batch_id = re.sub(r"[^A-Za-z0-9_-]", "-", f"glim-{reference}")[:60]
        body={"sender_batch_header":{"sender_batch_id":batch_id,"email_subject":"Glim sandbox settlement","email_message":"Sandbox payout generated by Glim."},"items":items}
        return self._request("POST","/v1/payments/payouts",json_body=body,headers={"PayPal-Request-Id":request_id or f"glim-payout-{uuid.uuid4().hex}"}).json()

    def verify_webhook(self, headers, raw_body):
        if not self.webhook_id: raise PayPalAPIError("PAYPAL_WEBHOOK_ID is required for webhook signature verification.")
        verify={"auth_algo":headers.get("paypal-auth-algo",""),"cert_url":headers.get("paypal-cert-url",""),"transmission_id":headers.get("paypal-transmission-id",""),"transmission_sig":headers.get("paypal-transmission-sig",""),"transmission_time":headers.get("paypal-transmission-time",""),"webhook_id":self.webhook_id,"webhook_event":json.loads(raw_body)}
        return self._request("POST","/v1/notifications/verify-webhook-signature",json_body=verify).json().get("verification_status")=="SUCCESS"


def default_state():
    return {"profile":{},"paypal":{"status":"disconnected","mode":"sandbox","country":"CA","currency":"CAD","scopes":[]},"stash":{"balance":0.0,"shield_threshold":1000.0,"goals":[]},"game":{"streak":0,"freezes":1,"points":0,"level":1,"evolution_stage":"Revolver"},"plan":{},"paused":False,"notifications":{"quiet_start":"22:00","quiet_end":"08:00","daily_cap":3,"channel":"in_app","consecutive_ignores":0},"pending_redirect":None}


def get_state(db):
    with db.connect() as c: row=c.execute("SELECT * FROM app_state WHERE id=1").fetchone()
    if not row: return default_state()
    return {"profile":json.loads(row["profile_json"]),"paypal":json.loads(row["paypal_json"]),"stash":json.loads(row["stash_json"]),"game":json.loads(row["game_json"]),"plan":json.loads(row["plan_json"]),"paused":bool(row["paused"]),"notifications":json.loads(row["notifications_json"] or "{}"),"pending_redirect":json.loads(row["pending_redirect_json"] or "null")}


def write_state(db,state):
    with db.connect() as c:
        c.execute("INSERT INTO app_state(id,profile_json,paypal_json,stash_json,game_json,plan_json,paused,notifications_json,pending_redirect_json) VALUES(1,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET profile_json=excluded.profile_json,paypal_json=excluded.paypal_json,stash_json=excluded.stash_json,game_json=excluded.game_json,plan_json=excluded.plan_json,paused=excluded.paused,notifications_json=excluded.notifications_json,pending_redirect_json=excluded.pending_redirect_json",(json.dumps(state.get("profile",{})),json.dumps(state.get("paypal",{})),json.dumps(state.get("stash",{})),json.dumps(state.get("game",{})),json.dumps(state.get("plan",{})),int(state.get("paused",False)),json.dumps(state.get("notifications",{})),json.dumps(state.get("pending_redirect"))))


def seed_persona(db, persona, average_expenses):
    db.reset(); state=default_state(); state["profile"]={"name":persona["name"],"persona":persona["key"],"income_range":persona["income_range"],"monthly_income":persona["monthly_income"],"savings_pct":persona["savings_pct"],"approval_mode":"each","weekly_cap":60.0,"floor_balance":persona["floor_balance"],"average_monthly_expenses":average_expenses,"quiet_start":"22:00","quiet_end":"08:00","notification_cap":3,"notification_channel":"in_app"}; state["stash"]={"balance":260.0 if persona["key"]=="riley" else 145.0,"shield_threshold":persona["debt"]["minimum"],"goals":[]}; state["game"]={"streak":6 if persona["key"]=="riley" else 3,"freezes":1,"points":180 if persona["key"]=="riley" else 90,"level":3 if persona["key"]=="riley" else 2,"evolution_stage":"Sprout"}; state["notifications"]={"quiet_start":"22:00","quiet_end":"08:00","daily_cap":3,"channel":"in_app","consecutive_ignores":0}; write_state(db,state)
    with db.connect() as c:
        d=persona["debt"]; c.execute("INSERT INTO debts(name,type,balance,apr,minimum,due_day,status) VALUES(?,?,?,?,?,?,?)",(d["name"],d["type"],d["balance"],d["apr"],d["minimum"],d["due_day"],"active"))
        for tx in persona["paypal_transactions"]: c.execute("INSERT INTO ledger_entries(created_at,kind,amount,stash_share,debt_share,debt_id,status,settlement_id) VALUES(?,?,?,?,?,?,?,?)",(tx["date"],"source_transaction",abs(tx["amount"]),0,0,None,tx["category"],None))
    log_action(db,"Scout","persona_seed",{"transactions":len(persona["paypal_transactions"])},"Load seeded demo activity","Local demo data; live Scout uses PayPal Sandbox Transaction Search when configured",f"{persona['name']} loaded")



def add_points(db, points, reason):
    state=get_state(db); state["game"]["points"]+=int(points); write_state(db,state)
    with db.connect() as c: c.execute("INSERT INTO points_events(reason,points,created_at) VALUES(?,?,?)",(reason,int(points),now_iso()))
    return state["game"]


def update_evolution(state, db):
    debts=get_debts(db); active=[d for d in debts if d["status"]=="active"]
    if not active and state["stash"]["balance"]>=state["stash"]["shield_threshold"]:
        state["game"]["evolution_stage"]="Transactor"; state["game"]["level"]=max(state["game"]["level"],5)
    elif any(d["status"]=="defeated" for d in debts):
        state["game"]["evolution_stage"]="Boss Slayer"; state["game"]["level"]=max(state["game"]["level"],4)
    elif state["stash"]["balance"]>=state["stash"]["shield_threshold"]:
        state["game"]["evolution_stage"]="Shielded"; state["game"]["level"]=max(state["game"]["level"],4)
    elif state["game"]["streak"]>0:
        state["game"]["evolution_stage"]="Sprout"; state["game"]["level"]=max(state["game"]["level"],2)
    else:
        state["game"]["evolution_stage"]="Revolver"
    return state

def get_debts(db):
    with db.connect() as c: rows=c.execute("SELECT * FROM debts ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END,id").fetchall()
    return [dict(r) for r in rows]


def compute_safe_to_move(profile):
    free=max(0.0,profile["monthly_income"]-profile.get("average_monthly_expenses",profile["monthly_income"]*0.75)-profile.get("floor_balance",0))
    return round(free/30,2)


def compute_daily_drip(profile):
    if not profile: return 0.0
    target=profile["monthly_income"]*(profile.get("savings_pct",0)/100)/30
    return round(max(0,min(target,compute_safe_to_move(profile))),2)


def choose_split(state):
    return (65.0,35.0) if state["stash"]["balance"]<state["stash"]["shield_threshold"] else (25.0,75.0)


def payoff_projection(debt, monthly_extra):
    balance=float(debt["balance"]); apr=float(debt["apr"])/100; minimum=float(debt["minimum"]); months=0; interest=0.0; payment=max(minimum+monthly_extra,minimum)
    while balance>0.01 and months<360:
        i=balance*apr/12; p=min(balance+i,payment); balance=balance+i-p; interest+=i; months+=1
        if p <= i and balance>0.01: return {"months":360,"interest_paid":round(interest,2),"interest_saved":0.0,"monthly_payment":round(payment,2)}
    mb=float(debt["balance"]); mi=0.0; m=0
    while mb>0.01 and m<360:
        i=mb*apr/12; p=min(mb+i,minimum); mb=mb+i-p; mi+=i; m+=1
        if p<=i and mb>0.01: break
    return {"months":months,"interest_paid":round(interest,2),"interest_saved":round(max(0,mi-interest),2),"monthly_payment":round(payment,2)}


def ordered_debts(debts,strategy):
    if strategy=="snowball": return sorted(debts,key=lambda d:(d["balance"],d["apr"]))
    if strategy=="hybrid": return sorted(debts,key=lambda d:(-(d["apr"]*0.6)+d["balance"]*0.0004))
    return sorted(debts,key=lambda d:(-d["apr"],d["balance"]))


def multi_debt_projection(debts,monthly_extra,strategy):
    ds=[dict(d) for d in ordered_debts(debts,strategy)]; total_interest=0.0; months=0; freed=0.0
    while any(d["balance"]>0.01 for d in ds) and months<360:
        months+=1; available_extra=monthly_extra+freed
        for d in ds:
            if d["balance"]<=0.01: continue
            interest=d["balance"]*float(d["apr"])/100/12; total_interest+=interest
            payment=min(d["balance"]+interest,float(d["minimum"]))
            if d is ds[0]: payment=min(d["balance"]+interest,payment+available_extra)
            d["balance"]=max(0,d["balance"]+interest-payment)
            if d["balance"]<=0.01: freed+=float(d["minimum"])
        # Once the first is done, route the entire payment stack to the next target.
    return {"months":months,"interest_paid":round(total_interest,2)}


def build_plan(db,strategy="avalanche",stash_pct=65.0):
    state=get_state(db); debts=[d for d in get_debts(db) if d["status"]=="active"]
    if not debts: raise ValueError("Add a debt before building the plan.")
    daily=compute_daily_drip(state["profile"]); monthly_extra=daily*30*(1-stash_pct/100)
    reason={"snowball":"Smallest balance first for faster visible wins.","hybrid":"Balances interest reduction with milestone wins.","avalanche":"Highest APR first to reduce interest fastest."}[strategy]
    proj=multi_debt_projection(debts,monthly_extra,strategy)
    min_interest=sum(payoff_projection(d,0)["interest_paid"] for d in debts)
    projection={"months":proj["months"],"interest_paid":proj["interest_paid"],"interest_saved":round(max(0,min_interest-proj["interest_paid"]),2)}
    plan={"strategy":strategy,"stash_pct":round(stash_pct,1),"boss_pct":round(100-stash_pct,1),"daily_drip":daily,"reason":reason,"projection":projection,"safe_to_move_daily":compute_safe_to_move(state["profile"]),"attack_order":[d["name"] for d in ordered_debts(debts,strategy)]}
    state["plan"]=plan; write_state(db,state); log_action(db,"Tactician","build_plan",plan,reason,"Figures calculated by code only",plan); return plan


def parse_what_if(text):
    money=re.search(r"\$(\d+(?:\.\d+)?)",text); weekly=0.0; label="No quantified change"
    if money: weekly=float(money.group(1)); label=f"Adds ${weekly:.0f}/week of capacity"
    elif re.search(r"twice|two times|2x",text,re.I) and re.search(r"takeout|dining|restaurant",text,re.I): weekly=20; label="Assumes $20/week reclaimed from two fewer takeout occasions"
    elif re.search(r"once|one time|1x",text,re.I) and re.search(r"takeout|dining|restaurant",text,re.I): weekly=10; label="Assumes $10/week reclaimed from one fewer takeout occasion"
    return weekly,label


def what_if(db,text):
    state=get_state(db); plan=state.get("plan") or build_plan(db); weekly,label=parse_what_if(text); changed=round(float(plan["daily_drip"])+weekly/7,2); debts=[d for d in get_debts(db) if d["status"]=="active"]
    if not debts:return {"parsed":{"input":text,"weekly_extra":weekly,"label":label},"baseline":plan.get("projection"),"what_if":None}
    proj=multi_debt_projection(debts,changed*30*(1-plan["stash_pct"]/100),plan["strategy"]); baseline=plan["projection"]
    result={"parsed":{"input":text,"weekly_extra":weekly,"label":label},"baseline":baseline,"what_if":{"months":proj["months"],"interest_paid":proj["interest_paid"]},"daily_drip":changed}
    log_action(db,"Tactician","what_if",result["parsed"],"Translate the phrase to parameters, then run the deterministic calculator","No LLM-generated financial figures",result); return result


def log_action(db,agent,input_ref,proposal,rationale,approval,result):
    with db.connect() as c:c.execute("INSERT INTO agent_actions(created_at,agent,input_ref,proposal,rationale,approval,result) VALUES(?,?,?,?,?,?,?)",(now_iso(),agent,input_ref,json.dumps(proposal),rationale,approval,json.dumps(result)))


def run_scout(db):
    state=get_state(db); profile=state["profile"]; subs=[]; live=False; paypal=PayPalSandbox(db)
    if paypal.configured:
        try:
            end=datetime.now(timezone.utc); start=end-timedelta(days=180); payload=paypal.search_transactions(start.strftime("%Y-%m-%dT%H:%M:%SZ"),end.strftime("%Y-%m-%dT%H:%M:%SZ")); txs=payload.get("transaction_details",[]); counts={}
            for tx in txs:
                info=tx.get("transaction_info") or {}; merchant=(info.get("transaction_subject") or info.get("paypal_reference_id") or "PayPal merchant").strip(); amt=info.get("transaction_amount") or {}
                try: val=abs(float(amt.get("value",0)))
                except: val=0
                if merchant and val>0: counts[merchant]=counts.get(merchant,0)+val
            subs=[{"merchant":m,"monthly":round(v/6,2),"signal":"Observed in PayPal Sandbox Transaction Search"} for m,v in sorted(counts.items(),key=lambda kv:kv[1],reverse=True)[:5]]; live=bool(subs)
        except PayPalAPIError: live=False
    if not subs:
        subs=( [{"merchant":"Streamly","monthly":18.99,"signal":"Seeded recurring charge"},{"merchant":"Gym Club","monthly":54.99,"signal":"Seeded recurring charge"},{"merchant":"MusicBox","monthly":11.99,"signal":"Seeded recurring charge"}] if profile.get("persona")=="riley" else [{"merchant":"LearnHub","monthly":29,"signal":"Seeded recurring charge"},{"merchant":"MusicBox","monthly":11.99,"signal":"Seeded recurring charge"}] )
    result={"income_pattern":f"About ${profile['monthly_income']:,.0f}/month across the current profile","safe_to_move_daily":compute_safe_to_move(profile),"subscriptions":subs,"suggested_debts":get_debts(db),"source":"PayPal Sandbox Transaction Search" if live else "Seeded demo activity until live PayPal Search returns records"}
    log_action(db,"Scout","transaction_search",{"range":"180 days","source":result["source"]},"Read PayPal activity and summarize patterns using deterministic rules","Read-only; safety floor applied",result); return result


def weekly_approved_total(db):
    with db.connect() as c:
        row=c.execute("SELECT COALESCE(SUM(amount),0) t FROM ledger_entries WHERE kind='drip' AND status IN ('accrued','settled') AND date(created_at)>=date('now','-6 day')").fetchone()
    return round(float(row["t"]),2)


def can_auto_approve(db, amount):
    state=get_state(db); mode=state["profile"].get("approval_mode","each") if state["profile"] else "each"; cap=float(state["profile"].get("weekly_cap",0)) if state.get("profile") else 0
    return mode=="standing_rule" and amount>0 and weekly_approved_total(db)+amount<=cap


def selected_debt(db,strategy):
    active=[d for d in get_debts(db) if d["status"]=="active"]
    return (ordered_debts(active,strategy)[0] if active else None)


def approve_drip(db,approved,email=None):
    state=get_state(db)
    if not approved: return {"status":"skipped","amount":0}
    if state["paused"]: raise ValueError("Drips are paused.")
    if state["paypal"]["status"]!="connected": raise ValueError("Connect PayPal Sandbox before approving a drip.")
    amount=compute_daily_drip(state["profile"])
    mode=state["profile"].get("approval_mode","each"); cap=float(state["profile"].get("weekly_cap",0))
    if mode in ("weekly_cap","standing_rule") and weekly_approved_total(db)+amount>cap: raise ValueError(f"Weekly cap of ${cap:.2f} would be exceeded.")
    stash_pct,boss_pct=choose_split(state); stash_share=round(amount*stash_pct/100,2); debt_share=round(amount-stash_share,2); debt=selected_debt(db,state.get("plan",{}).get("strategy","avalanche"))
    if debt_share and not debt: stash_share=amount; debt_share=0
    with db.connect() as c:c.execute("INSERT INTO ledger_entries(created_at,kind,amount,stash_share,debt_share,debt_id,status,settlement_id) VALUES(?,?,?,?,?,?,?,?)",(now_iso(),"drip",amount,stash_share,debt_share,debt["id"] if debt else None,"accrued",None))
    state["stash"]["balance"]=round(state["stash"]["balance"]+stash_share,2)
    if stash_share > 0:
        allocate_stash_to_goals(db, stash_share)
    defeat=None
    if debt:
        new_balance=max(0,round(debt["balance"]-debt_share,2)); status="defeated" if new_balance<=0.01 else "active"
        with db.connect() as c:c.execute("UPDATE debts SET balance=?,status=? WHERE id=?",(new_balance,status,debt["id"]))
        if status=="defeated":
            defeat={"debt_id":debt["id"],"debt_name":debt["name"],"freed_payment":debt["minimum"]}; state["pending_redirect"]=defeat
            state["game"]["evolution_stage"]="Boss Slayer"
    state["game"]["streak"]+=1; state["game"]["points"]+=20
    with db.connect() as c: c.execute("INSERT INTO points_events(reason,points,created_at) VALUES(?,?,?)",("daily drip",20,now_iso()))
    update_evolution(state, db); write_state(db,state)
    if email:
        record_squad_goal_event(db, email)
    result={"status":"approved","amount":amount,"stash_share":stash_share,"debt_share":debt_share,"streak":state["game"]["streak"],"points":state["game"]["points"],"debt_defeated":defeat}
    log_action(db,"Banker","drip_approval",result,"Record approved drip in the daily ledger; settlement occurs through PayPal at weekly/threshold cadence","User approved" if mode=="each" else f"{mode} within cap ${cap:.2f}",result); return result


def auto_drip_tick(db,email=None):
    state=get_state(db); amount=compute_daily_drip(state.get("profile",{}))
    if state.get("profile",{}).get("approval_mode")!="standing_rule": return {"status":"manual_required"}
    if not can_auto_approve(db,amount): return {"status":"cap_reached"}
    return approve_drip(db,True,email=email)


def settle_week(db):
    state=get_state(db)
    if state["paused"]: raise ValueError("Drips are paused.")
    with db.connect() as c: row=c.execute("SELECT COALESCE(SUM(amount),0) total,COALESCE(SUM(stash_share),0) stash,COALESCE(SUM(debt_share),0) debt FROM ledger_entries WHERE kind='drip' AND status='accrued'").fetchone()
    total,stash,debt=round(float(row["total"]),2),round(float(row["stash"]),2),round(float(row["debt"]),2)
    if total<=0:return {"status":"nothing_to_settle","amount":0}
    paypal=PayPalSandbox(db); reference=f"weekly-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    try:
        order=paypal.create_order_from_vault(total,reference)
        if order.get("status")!="COMPLETED":
            state["paypal"]["pending_settlement"]={"amount":total,"stash":stash,"debt":debt}; state["paypal"]["pending_order_id"]=order.get("id"); write_state(db,state)
            log_action(db,"Banker","weekly_settlement","PayPal vault order","Await final PayPal capture/webhook state","Sandbox API response stored; webhook expected",order)
            return {"status":"awaiting_webhook","amount":total,"order_id":order.get("id")}
    except PayPalAPIError as vault_error:
        order=paypal.create_order_for_approval(total,reference); approval=next((l["href"] for l in order.get("links",[]) if l.get("rel")=="approve"),None)
        if not approval: raise vault_error
        state["paypal"]["pending_order_id"]=order.get("id"); state["paypal"]["pending_settlement"]={"amount":total,"stash":stash,"debt":debt}; write_state(db,state)
        log_action(db,"Banker","weekly_settlement_fallback",{"amount":total,"reason":str(vault_error)},"Use a real PayPal-hosted approval when vaulted merchant initiation is unavailable","Payer approval required in PayPal Sandbox",order)
        return {"status":"approval_required","amount":total,"order_id":order.get("id"),"approval_url":approval}
    payout=paypal.create_payout(debt,stash,order.get("id",reference))
    # Keep ledger authoritative only once PayPal has responded successfully; webhooks still get persisted and can reconcile.
    with db.connect() as c:
        c.execute("UPDATE ledger_entries SET status='settled',settlement_id=? WHERE kind='drip' AND status='accrued'",(order.get("id"),))
        c.execute("INSERT INTO webhook_events(created_at,event_id,event_type,payload,signature_ok,processed_at) VALUES(?,?,?,?,?,?)",(now_iso(),f"local-{uuid.uuid4().hex}","LOCAL_RECONCILE",json.dumps({"order":order,"payout":payout}),1,now_iso()))
    state["paypal"].pop("pending_order_id",None); state["paypal"].pop("pending_settlement",None); write_state(db,state)
    result={"status":"confirmed","amount":total,"order_id":order.get("id"),"payout_batch_id":(payout.get("batch_header") or {}).get("payout_batch_id"),"debt_share":debt,"stash_share":stash}
    log_action(db,"Banker","weekly_settlement",result,"Collect via PayPal Orders v2 and disburse via Payouts","PayPal response verified; webhooks retained for reconciliation",result); return result


def complete_pending_settlement(db,order_id):
    state=get_state(db); pending=state.get("paypal",{}).get("pending_settlement")
    if not pending or state.get("paypal",{}).get("pending_order_id")!=order_id:return {"status":"no_pending_settlement"}
    paypal=PayPalSandbox(db); order=paypal.capture_order(order_id)
    if order.get("status")!="COMPLETED":raise PayPalAPIError("PayPal Sandbox order was approved but not captured.",payload=order)
    payout=paypal.create_payout(float(pending["debt"]),float(pending["stash"]),order_id)
    with db.connect() as c:c.execute("UPDATE ledger_entries SET status='settled',settlement_id=? WHERE kind='drip' AND status='accrued'",(order_id,))
    state["paypal"].pop("pending_order_id",None); state["paypal"].pop("pending_settlement",None); write_state(db,state)
    result={"status":"confirmed","amount":pending["amount"],"order_id":order_id,"payout_batch_id":(payout.get("batch_header") or {}).get("payout_batch_id"),"debt_share":pending["debt"],"stash_share":pending["stash"]}; log_action(db,"Banker","approved_settlement_capture",result,"Capture the payer-approved PayPal Sandbox order, then disburse via Payouts","Payer approved PayPal-hosted order",result); return result


def process_paypal_event(db, payload):
    """Apply verified PayPal events; monthly deposits settle only on final payout success."""
    et = str(payload.get("event_type", ""))
    resource = payload.get("resource") or {}
    state = get_state(db)
    changed = False
    order_id = (
        resource.get("id")
        or (resource.get("supplementary_data") or {}).get("related_ids", {}).get("order_id")
    )

    if "CHECKOUT.ORDER.COMPLETED" in et or "PAYMENT.CAPTURE.COMPLETED" in et:
        pending = state.get("paypal", {}).get("pending_order_id")
        if pending and order_id and pending == order_id:
            changed = True

    if "PAYMENT.CAPTURE.DENIED" in et or "PAYMENT.CAPTURE.DECLINED" in et:
        state["paused"] = True
        state["paypal"]["settlement_error"] = "PayPal declined the settlement; drips paused kindly."
        write_state(db, state)
        changed = True

    is_payout_success = "PAYOUT" in et and ("SUCCESS" in et or "SUCCEEDED" in et)
    is_payout_failure = "PAYOUT" in et and ("FAILED" in et or "DENIED" in et)
    if is_payout_success or is_payout_failure:
        batch_header = resource.get("batch_header") or {}
        payout_item = resource.get("payout_item") or {}
        batch_id = (
            resource.get("payout_batch_id")
            or batch_header.get("payout_batch_id")
            or payout_item.get("payout_batch_id")
            or resource.get("batch_id")
        )
        if batch_id:
            with db.connect() as c:
                monthly = c.execute(
                    "SELECT * FROM monthly_auto_deposit WHERE id=1 AND payout_batch_id=?",
                    (batch_id,),
                ).fetchone()
            if monthly and monthly["status"] != "completed":
                if is_payout_success:
                    amount = round(float(monthly["amount"] or 0), 2)
                    current = get_state(db)
                    current_stash = dict(current.get("stash", {}))
                    new_balance = round(float(current_stash.get("balance", 0)) + amount, 2)
                    with db.connect() as c:
                        applied = c.execute(
                            "UPDATE monthly_auto_deposit SET status='completed',last_error=NULL,last_run_at=? WHERE id=1 AND status!='completed' AND payout_batch_id=?",
                            (now_iso(), batch_id),
                        ).rowcount > 0
                        if applied:
                            current_stash["balance"] = new_balance
                            c.execute("UPDATE app_state SET stash_json=? WHERE id=1", (json.dumps(current_stash),))
                            c.execute(
                                "INSERT INTO ledger_entries(created_at,kind,amount,stash_share,debt_share,status,settlement_id) VALUES(?,?,?,?,?,?,?)",
                                (now_iso(), "monthly_deposit", amount, amount, 0, "settled", batch_id),
                            )
                            # Earmark the newly confirmed amount in the same transaction as the ledger update.
                            left = amount
                            goals = c.execute("SELECT * FROM stash_goals WHERE status='active' ORDER BY id").fetchall()
                            for goal in goals:
                                if left <= 0:
                                    break
                                need = max(0, round(float(goal["target_amount"]) - float(goal["saved_amount"]), 2))
                                take = round(min(left, need), 2)
                                if take <= 0:
                                    continue
                                saved = round(float(goal["saved_amount"]) + take, 2)
                                goal_status = "completed" if saved + 0.001 >= float(goal["target_amount"]) else "active"
                                c.execute(
                                    "UPDATE stash_goals SET saved_amount=?,status=?,completed_at=? WHERE id=?",
                                    (saved, goal_status, now_iso() if goal_status == "completed" else None, goal["id"]),
                                )
                                left = round(left - take, 2)
                    if applied:
                        state["stash"] = current_stash
                        changed = True
                else:
                    with db.connect() as c:
                        applied = c.execute(
                            "UPDATE monthly_auto_deposit SET status='payout_failed',last_error=? WHERE id=1 AND status!='completed' AND payout_batch_id=?",
                            (f"PayPal reported payout failure ({et}).", batch_id),
                        ).rowcount > 0
                    if applied:
                        state = get_state(db)
                        state["paused"] = True
                        state["paypal"]["settlement_error"] = "PayPal payout failed; drips paused for review."
                        write_state(db, state)
                        changed = True


    if is_payout_failure and not changed:
        state["paused"] = True
        state["paypal"]["settlement_error"] = "PayPal payout failed; drips paused for review."
        write_state(db, state)
        changed = True

    if changed:
        log_action(
            db, "Banker", "paypal_webhook",
            {"event_type": et, "resource_id": order_id, "payout_batch_id": locals().get("batch_id")},
            "Apply verified PayPal webhook state to settlement or monthly-deposit ledger",
            "Signature verified", payload,
        )
    return changed


ARMS=[
    ("calm:morning:short:numbers","A small move is ready when you are."),
    ("playful:lunch:short:numbers","A tiny acorn is waiting. Ready for a quick win?"),
    ("celebratory:evening:detailed:numbers","Nice work. Your consistency is doing the heavy lifting."),
    ("gentle:afternoon:short:none","A small step today still counts. Want to check in?"),
]

def tone_linter(message):
    forbidden=["lazy","bad","shame","guilty","you failed","should have"]; low=message.lower(); return not any(x in low for x in forbidden)


def in_quiet_hours(state):
    ns=state.get("notifications",{}); now=datetime.now().strftime("%H:%M"); start=ns.get("quiet_start","22:00"); end=ns.get("quiet_end","08:00")
    if start<end:return start<=now<end
    return now>=start or now<end


def next_nudge(db):
    state=get_state(db); cap=int(state.get("notifications",{}).get("daily_cap",3));
    with db.connect() as c:
        today=c.execute("SELECT COUNT(*) FROM nudges WHERE date(created_at)=date('now')").fetchone()[0]
        ignores=c.execute("SELECT COUNT(*) FROM nudges WHERE response IN ('snoozed','dismissed') ORDER BY id DESC LIMIT 3").fetchone()[0]
    if cap==0 or in_quiet_hours(state):return {"status":"quiet_hours","message":"Glim is quiet right now. Your settings can change the hours."}
    if today>=cap:return {"status":"capped","message":"Glim is quiet for today. You can change the notification cap anytime."}
    if state.get("notifications",{}).get("consecutive_ignores",0)>=3 or ignores>=3:return {"status":"backoff","message":"Want Glim to check in less? You can change this in notifications.","why":"Repeated ignored or snoozed nudges triggered the back-off rule."}
    with db.connect() as c:
        for key,_ in ARMS:c.execute("INSERT OR IGNORE INTO nudge_arm_stats(arm_key,alpha,beta) VALUES(?,?,?)",(key,1.0,1.0))
        rows=c.execute("SELECT arm_key,alpha,beta FROM nudge_arm_stats").fetchall()
    key=max((random.betavariate(float(r["alpha"]),float(r["beta"])),r["arm_key"]) for r in rows)[1]; msg=dict(ARMS)[key]
    if not tone_linter(msg):msg=ARMS[-1][1]
    with db.connect() as c:c.execute("INSERT INTO nudges(created_at,arm_key,message) VALUES(?,?,?)",(now_iso(),key,msg))
    pushed = False
    if state.get("notifications",{}).get("channel") == "web_push":
        pushed = send_web_push(db, msg)
    return {"status":"ready","arm_key":key,"message":msg,"why":"Thompson sampling chose tone, time slot, length, and number treatment from recent responses.","external_channel_sent":pushed}


def respond_nudge(db,response):
    rewards={"acted":1.0,"opened":0.3,"snoozed":-0.2,"dismissed":-0.5,"muted":-1.0}; reward=rewards[response]; state=get_state(db)
    with db.connect() as c:
        row=c.execute("SELECT id,arm_key FROM nudges WHERE response IS NULL ORDER BY id DESC LIMIT 1").fetchone()
        if not row:return {"status":"no_pending_nudge"}
        c.execute("UPDATE nudges SET response=?,reward=? WHERE id=?",(response,reward,row["id"]))
        if reward>=0:c.execute("UPDATE nudge_arm_stats SET alpha=alpha+? WHERE arm_key=?",(reward,row["arm_key"]))
        else:c.execute("UPDATE nudge_arm_stats SET beta=beta+? WHERE arm_key=?",(-reward,row["arm_key"]))
    state["notifications"]["consecutive_ignores"]=state["notifications"].get("consecutive_ignores",0)+1 if response in ("snoozed","dismissed") else 0
    if response=="muted": state["notifications"]["daily_cap"]=0
    write_state(db,state); return {"status":"recorded","reward":reward}


def detect_stress(state):
    ignores=state.get("notifications",{}).get("consecutive_ignores",0); paused=state.get("paused",False); return bool(paused or ignores>=2)



def use_freeze(db):
    state=get_state(db)
    if state["game"].get("freezes",0)<=0: raise ValueError("No streak freezes are available this month.")
    state["game"]["freezes"]-=1; write_state(db,state)
    log_action(db,"Glim","streak_freeze",{},"Use one monthly forgiveness token to protect a streak","User selected freeze",{"freezes_remaining":state["game"]["freezes"]})
    return state["game"]

# ---------- Lightweight LLM adapter ----------
class GeminiAdapter:
    def __init__(self): self.key=os.getenv("GEMINI_API_KEY","").strip(); self.model=os.getenv("GEMINI_MODEL","gemini-3.5-flash").strip()
    @property
    def configured(self): return bool(self.key and self.model)
    def ask(self,system,user):
        if not self.configured:return None
        url=f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.key}"
        prompt = system + "\nReturn JSON only with keys: delegate (Glim|Scout|Tactician|Sage|Banker), message (string). Never invent numbers. " + user
        body={"contents":[{"role":"user","parts":[{"text":prompt}]}],"generationConfig":{"temperature":0.4,"responseMimeType":"application/json"}}
        try:
            with httpx.Client(timeout=25) as client:r=client.post(url,json=body)
            if r.status_code>=400:return None
            text=r.json()["candidates"][0]["content"]["parts"][0]["text"]
            data=json.loads(text)
            return data if isinstance(data,dict) else None
        except Exception:return None


def grounded_message(message,state,db):
    if not message:return False
    allowed=[]
    profile=state.get("profile",{}); plan=state.get("plan",{}); stash=state.get("stash",{}); debts=get_debts(db)
    for obj in [profile,plan.get("projection",{}),plan,stash]:
        if isinstance(obj,dict):
            for v in obj.values():
                if isinstance(v,(int,float)): allowed.append(round(float(v),2)); allowed.append(round(float(v)))
    for d in debts:
        for key in ("balance","apr","minimum","due_day"):
            v=d.get(key)
            if isinstance(v,(int,float)):
                allowed.append(round(float(v),2)); allowed.append(round(float(v)))
    currencies=re.findall(r"\$\s*([0-9]+(?:\.[0-9]+)?)",message)
    percents=re.findall(r"([0-9]+(?:\.[0-9]+)?)%",message)
    for v in currencies:
        x=round(float(v),2)
        if x not in allowed:return False
    for v in percents:
        x=round(float(v),2)
        if x not in allowed:return False
    return True


def chat(db,message):
    state=get_state(db); lower=message.lower(); adapter=GeminiAdapter()
    if adapter.configured:
        system=("You are Glim, a friendly debt-and-savings coach. Agents propose, code calculates, users approve. "
                "Never invent financial figures. Only quote numbers included in this context. Never shame the user. "
                f"Current calculated state: {json.dumps({'plan':state.get('plan'), 'debts':get_debts(db), 'stash':state.get('stash'), 'game':state.get('game')})}")
        answer=adapter.ask(system,message)
        if answer and tone_linter(answer.get("message", "")) and grounded_message(answer.get("message", ""),state,db):
            return {"agent":f"Glim → {answer.get('delegate','Glim')}","message":answer.get("message", ""),"mode":"Gemini"}
    if any(k in lower for k in ["what if","skip","takeout","restaurant","dinner"]):
        result=what_if(db,message); return {"agent":"Glim → Tactician","message":f"{result['parsed']['label']}. The calculator models {result['what_if']['months']} months and {money(result['what_if']['interest_paid'])} interest on the what-if path."}
    if "subscription" in lower:
        result=run_scout(db); names=", ".join(x["merchant"] for x in result["subscriptions"]); return {"agent":"Glim → Scout","message":f"Scout checked the available PayPal activity. The recurring signals are {names}."}
    if "points" in lower or "streak" in lower:
        return {"agent":"Glim","message":f"You have {state['game']['points']} points and a {state['game']['streak']}-day streak. Consistency, not wealth, earns points."}
    plan=state.get("plan") or (build_plan(db) if get_debts(db) else {})
    return {"agent":"Glim","message":f"Your current plan is {plan.get('strategy','not set')}. I can explain the plan, inspect PayPal findings, or model a what-if. The calculator owns the numbers."}


def money(v):return f"${float(v):,.2f}"


def redirect_freed_payment(db,destination):
    state=get_state(db); pending=state.get("pending_redirect")
    if not pending:raise ValueError("No freed payment is waiting for a redirect decision.")
    if destination=="stash":
        state["notifications"]["consecutive_ignores"]=0; state["stash"]["goals"].append({"name":"Freed payment","monthly":pending["freed_payment"]})
        state["game"]["points"]+=30
        with db.connect() as c: c.execute("INSERT INTO points_events(reason,points,created_at) VALUES(?,?,?)",("freed payment redirect",30,now_iso()))
    else:
        with db.connect() as c:
            d=c.execute("SELECT * FROM debts WHERE id=? AND status='active'",(destination,)).fetchone()
            if not d:raise ValueError("That active Boss was not found.")
        log_action(db,"Tactician","freed_payment_redirect",pending,"Route freed minimum payment to the next active Boss","User selected next debt",{"destination":destination,"amount":pending["freed_payment"]})
    state["pending_redirect"]=None; write_state(db,state); return {"status":"redirected","destination":destination,"amount":pending["freed_payment"]}


def debt_chart_data(db):
    debts=[d for d in get_debts(db) if d["status"]=="active"]; state=get_state(db); plan=state.get("plan") or (build_plan(db) if debts else None)
    if not debts:return {"labels":[],"balances":[],"minimum_only":[]}
    extra=(plan["daily_drip"]*30*(1-plan["stash_pct"]/100)) if plan else 0; d=ordered_debts(debts,plan.get("strategy","avalanche") if plan else "avalanche")[0]
    def series(ex):
        bal=float(d["balance"]); out=[]
        for _ in range(24):
            out.append(round(max(0,bal),2));
            if bal<=.01:continue
            i=bal*float(d["apr"])/100/12; p=min(bal+i,float(d["minimum"])+ex); bal=bal+i-p
        return out
    a,b=series(extra),series(0); return {"labels":[f"M{i+1}" for i in range(len(a))],"balances":a,"minimum_only":b}


# ---------- Auth ----------
def request_magic_link(db,email):
    email=email.strip().lower(); token=secrets.token_urlsafe(24); created=datetime.now(timezone.utc); expires=created+timedelta(minutes=15)
    with db.connect() as c:
        c.execute("INSERT INTO users(email,name,created_at) VALUES(?,?,?) ON CONFLICT(email) DO NOTHING",(email,email.split("@")[0].title(),now_iso()))
        c.execute("INSERT INTO magic_links(token,email,created_at,expires_at) VALUES(?,?,?,?)",(token,email,created.isoformat(),expires.isoformat()))
    base=os.getenv("APP_PUBLIC_URL","http://127.0.0.1:8000").rstrip("/"); return {"status":"sent","email":email,"demo_magic_link":f"{base}/api/auth/magic?token={token}","expires_in_minutes":15}


def verify_magic_link(db,token):
    with db.connect() as c: row=c.execute("SELECT * FROM magic_links WHERE token=? AND used=0",(token,)).fetchone()
    if not row:return None
    if datetime.fromisoformat(row["expires_at"])<datetime.now(timezone.utc):return None
    sid=secrets.token_urlsafe(32); exp=datetime.now(timezone.utc)+timedelta(days=14)
    with db.connect() as c:
        c.execute("UPDATE magic_links SET used=1 WHERE token=?",(token,)); c.execute("INSERT INTO sessions(token,email,created_at,expires_at) VALUES(?,?,?,?)",(sid,row["email"],now_iso(),exp.isoformat()))
    return sid


def get_session_user(db,sid):
    if not sid:return None
    with db.connect() as c: row=c.execute("SELECT * FROM sessions WHERE token=?",(sid,)).fetchone()
    if not row:return None
    if datetime.fromisoformat(row["expires_at"])<datetime.now(timezone.utc):return None
    with db.connect() as c: u=c.execute("SELECT * FROM users WHERE email=?",(row["email"],)).fetchone()
    return dict(u) if u else None


def revoke_session(db,sid):
    if sid:
        with db.connect() as c:c.execute("DELETE FROM sessions WHERE token=?",(sid,))


def set_user_name(db,email,name):
    with db.connect() as c:c.execute("UPDATE users SET name=? WHERE email=?",(name,email))

# ---------- Notifications / P1 ----------
def get_notification_center(db):
    state=get_state(db)
    with db.connect() as c: rows=c.execute("SELECT * FROM nudges ORDER BY id DESC LIMIT 12").fetchall()
    return {"settings":state["notifications"],"stress_mode":detect_stress(state),"items":[dict(r) for r in rows]}

# ---------- Squads / P1-P2 ----------
def create_squad(db,name,email):
    existing=get_squad(db,email)
    if existing.get("squad"):
        return existing
    invite=secrets.token_hex(3).upper()
    state=get_state(db); display=state["profile"].get("name") or email.split("@")[0].title()
    with db.connect() as c:
        cur=c.execute("INSERT INTO squads(name,invite_code,created_at) VALUES(?,?,?)",(name,invite,now_iso())); sid=cur.lastrowid
        c.execute("INSERT INTO squad_members(squad_id,email,display_name,is_demo,streak,goal_pct,level) VALUES(?,?,?,?,?,?,?)",(sid,email,display,0,state["game"]["streak"],state["profile"].get("savings_pct",0),state["game"]["level"]))
        for alias,streak,goal,level in [("Avery",9,88,4),("Jordan",6,72,3)]: c.execute("INSERT INTO squad_members(squad_id,email,display_name,is_demo,streak,goal_pct,level) VALUES(?,?,?,?,?,?,?)",(sid,f"{alias.lower()}@demo.glim",alias,1,streak,goal,level))
    return get_squad(db,email)


def join_squad(db,code,email):
    with db.connect() as c: sq=c.execute("SELECT * FROM squads WHERE invite_code=?",(code.upper(),)).fetchone()
    if not sq:raise ValueError("Invite code not found.")
    with db.connect() as c:
        count=c.execute("SELECT COUNT(*) FROM squad_members WHERE squad_id=?",(sq["id"],)).fetchone()[0]
    if count>=6: raise ValueError("A squad can have at most 6 members.")
    state=get_state(db); display=state["profile"].get("name") or email.split("@")[0].title()
    with db.connect() as c:c.execute("INSERT OR IGNORE INTO squad_members(squad_id,email,display_name,is_demo,streak,goal_pct,level) VALUES(?,?,?,?,?,?,?)",(sq["id"],email,display,0,state["game"]["streak"],state["profile"].get("savings_pct",0),state["game"]["level"]))
    return get_squad(db,email)


def get_squad(db,email=None):
    with db.connect() as c:
        if email:
            sq=c.execute("SELECT s.* FROM squads s JOIN squad_members m ON m.squad_id=s.id WHERE m.email=? ORDER BY s.id DESC LIMIT 1",(email,)).fetchone()
        else:
            sq=c.execute("SELECT s.* FROM squads s JOIN squad_members m ON m.squad_id=s.id WHERE m.is_demo=0 ORDER BY s.id DESC LIMIT 1").fetchone()
        if not sq:return {"squad":None,"members":[],"cheers":[],"goals":[],"unlocked_cosmetics":[]}
        members=c.execute("SELECT * FROM squad_members WHERE squad_id=? ORDER BY streak DESC, goal_pct DESC",(sq["id"],)).fetchall()
        cheers=c.execute("SELECT * FROM cheers WHERE squad_id=? ORDER BY id DESC LIMIT 10",(sq["id"],)).fetchall()
        goals=c.execute("SELECT g.*,c.name AS reward_name,c.icon AS reward_icon FROM squad_goals g JOIN cosmetics c ON c.id=g.reward_cosmetic_id WHERE g.squad_id=? ORDER BY g.id DESC",(sq["id"],)).fetchall()
        rewards=c.execute("SELECT sc.*,c.name,c.icon FROM squad_cosmetics sc JOIN cosmetics c ON c.id=sc.cosmetic_id WHERE sc.squad_id=? ORDER BY sc.unlocked_at DESC",(sq["id"],)).fetchall()
    return {"squad":dict(sq),"members":[dict(m) for m in members],"cheers":[dict(c) for c in cheers],"goals":[dict(g) for g in goals],"unlocked_cosmetics":[dict(r) for r in rewards]}


def send_cheer(db,member_id,cheer,email=None):
    sq=get_squad(db,email)["squad"]
    if not sq:raise ValueError("Create or join a squad first.")
    with db.connect() as c:
        member=c.execute("SELECT id FROM squad_members WHERE id=? AND squad_id=?",(member_id,sq["id"])).fetchone()
        if not member:raise ValueError("That member is not in your squad.")
        c.execute("INSERT INTO cheers(squad_id,to_member_id,cheer,created_at) VALUES(?,?,?,?)",(sq["id"],member_id,cheer,now_iso()))
    return get_squad(db,email)


def create_squad_goal(db, title, target_count, reward_cosmetic_id, email):
    squad=get_squad(db,email)["squad"]
    if not squad: raise ValueError("Create or join a squad first.")
    with db.connect() as c:
        cosmetic=c.execute("SELECT id FROM cosmetics WHERE id=?",(reward_cosmetic_id,)).fetchone()
        if not cosmetic: raise ValueError("Choose a valid group cosmetic reward.")
        active=c.execute("SELECT COUNT(*) FROM squad_goals WHERE squad_id=? AND status='active'",(squad["id"],)).fetchone()[0]
        if active>=3: raise ValueError("A squad can have up to three active shared goals.")
        cur=c.execute("INSERT INTO squad_goals(squad_id,title,target_count,reward_cosmetic_id,status,created_at) VALUES(?,?,?,?,?,?)",(squad["id"],title,target_count,reward_cosmetic_id,"active",now_iso()))
        goal_id=cur.lastrowid
    log_action(db,"Glim","squad_goal_created",{"goal_id":goal_id,"target_member_days":target_count},"Create a consistency-based shared goal; progress is earned from drip-days, not dollar balances","Squad member action",{"reward_cosmetic_id":reward_cosmetic_id})
    return get_squad(db,email)


def record_squad_goal_event(db,email):
    """Count at most one behavior event per member per day toward squad goals."""
    squad=get_squad(db,email).get("squad")
    if not squad: return
    today=datetime.now(timezone.utc).date().isoformat()
    state = get_state(db)
    completed=[]
    with db.connect() as c:
        c.execute(
            "UPDATE squad_members SET streak=?,goal_pct=?,level=? WHERE squad_id=? AND email=?",
            (int(state.get("game", {}).get("streak", 0)), float(state.get("profile", {}).get("savings_pct", 0)), int(state.get("game", {}).get("level", 1)), squad["id"], email),
        )
        goals=c.execute("SELECT * FROM squad_goals WHERE squad_id=? AND status='active'",(squad["id"],)).fetchall()
        for goal in goals:
            cur=c.execute("INSERT OR IGNORE INTO squad_goal_events(squad_goal_id,email,event_date,created_at) VALUES(?,?,?,?)",(goal["id"],email,today,now_iso()))
            if cur.rowcount == 0: continue
            c.execute("UPDATE squad_goals SET progress_count=progress_count+1 WHERE id=?",(goal["id"],))
            fresh=c.execute("SELECT * FROM squad_goals WHERE id=?",(goal["id"],)).fetchone()
            if fresh["progress_count"] >= fresh["target_count"]:
                c.execute("UPDATE squad_goals SET status='completed',completed_at=? WHERE id=?",(now_iso(),goal["id"]))
                c.execute("INSERT OR IGNORE INTO squad_cosmetics(squad_id,cosmetic_id,unlocked_at) VALUES(?,?,?)",(squad["id"],goal["reward_cosmetic_id"],now_iso()))
                completed.append(dict(fresh))
    if completed:
        for goal in completed:
            log_action(db,"Glim","squad_cosmetic_unlocked",{"goal_id":goal["id"],"title":goal["title"]},"Unlock a group cosmetic after a shared consistency target is met","Shared goal completed",{"cosmetic_id":goal["reward_cosmetic_id"]})


# ---------- Sage / P1 ----------
def next_lesson(db):
    state=get_state(db)
    with db.connect() as c:
        row=c.execute("SELECT l.* FROM lessons l LEFT JOIN lesson_progress p ON p.lesson_id=l.id WHERE COALESCE(p.completed,0)=0 ORDER BY l.id LIMIT 1").fetchone()
    if not row:return {"status":"complete","message":"You finished the current Sage path."}
    prompt=row["prompt"]
    if row["id"]==1 and get_debts(db): prompt=f"What is the minimum payment on {get_debts(db)[0]['name']}?"
    elif row["id"]==2 and get_debts(db): prompt=f"What APR is shown on {get_debts(db)[0]['name']}?"
    elif row["id"]==3:
        scout=run_scout(db); prompt=f"What is the monthly total of Scout's first two recurring charges?"
    return {"lesson":dict(row),"prompt":prompt,"points":row["points"]}


def complete_lesson(db,lesson_id,answer):
    with db.connect() as c: row=c.execute("SELECT * FROM lessons WHERE id=?",(lesson_id,)).fetchone()
    if not row:raise ValueError("Lesson not found.")
    accepted=False
    debts=get_debts(db)
    if lesson_id==1 and debts: accepted=bool(re.search(rf"{float(debts[0]['minimum']):.0f}",answer))
    elif lesson_id==2 and debts: accepted=bool(re.search(rf"{float(debts[0]['apr']):.1f}",answer))
    elif lesson_id==3:
        vals=run_scout(db)["subscriptions"][:2]; total=sum(x["monthly"] for x in vals); accepted=bool(re.search(rf"{total:.0f}",answer))
    elif lesson_id==4: accepted=answer.strip().lower() in ("snowball","snowball strategy")
    if not accepted: raise ValueError("That answer does not match the current calculated lesson data.")
    with db.connect() as c:c.execute("INSERT INTO lesson_progress(lesson_id,completed,completed_at) VALUES(?,?,?) ON CONFLICT(lesson_id) DO UPDATE SET completed=1,completed_at=excluded.completed_at",(lesson_id,1,now_iso()))
    state=get_state(db); state["game"]["points"]+=int(row["points"]); write_state(db,state)
    with db.connect() as c: c.execute("INSERT INTO points_events(reason,points,created_at) VALUES(?,?,?)",(f"lesson {lesson_id}",int(row["points"]),now_iso()))
    log_action(db,"Sage","lesson_complete",{"lesson_id":lesson_id},"Applied lesson challenge using current user numbers","Answer matched deterministic result",{"points":row["points"]}); return {"status":"complete","points":row["points"],"game":state["game"]}

# ---------- Cosmetics / P1 ----------
def get_cosmetics(db):
    with db.connect() as c:
        rows=c.execute("SELECT c.*,CASE WHEN u.cosmetic_id IS NULL THEN 0 ELSE 1 END owned FROM cosmetics c LEFT JOIN user_cosmetics u ON u.cosmetic_id=c.id ORDER BY c.id").fetchall()
    return {"points":get_state(db)["game"]["points"],"items":[dict(r) for r in rows]}


def buy_cosmetic(db,cosmetic_id):
    state=get_state(db)
    with db.connect() as c:
        item=c.execute("SELECT * FROM cosmetics WHERE id=?",(cosmetic_id,)).fetchone(); owned=c.execute("SELECT 1 FROM user_cosmetics WHERE cosmetic_id=?",(cosmetic_id,)).fetchone()
        if not item:raise ValueError("Cosmetic not found.")
        if owned:return get_cosmetics(db)
        if state["game"]["points"]<item["cost"]:raise ValueError("Not enough points. Points come from behavior, not dollar amounts.")
        state["game"]["points"]-=item["cost"]; write_state(db,state); c.execute("INSERT INTO user_cosmetics(cosmetic_id,purchased_at) VALUES(?,?)",(cosmetic_id,now_iso()))
    return get_cosmetics(db)


def export_user_data(db):
    state = get_state(db)
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    with db.connect() as c:
        data={
            "product": PRODUCT,
            "profile": state["profile"],
            "state": state,
            "debts": [dict(r) for r in c.execute("SELECT * FROM debts").fetchall()],
            "ledger": [dict(r) for r in c.execute("SELECT * FROM ledger_entries").fetchall()],
            "nudges": [dict(r) for r in c.execute("SELECT * FROM nudges").fetchall()],
            "agent_actions": [dict(r) for r in c.execute("SELECT * FROM agent_actions").fetchall()],
            "points_events": [dict(r) for r in c.execute("SELECT * FROM points_events ORDER BY created_at").fetchall()],
            "stash_goals": [dict(r) for r in c.execute("SELECT * FROM stash_goals ORDER BY id").fetchall()],
            "monthly_auto_deposit": monthly_auto_deposit_settings(db),
            "monthly_recap": monthly_recap(db, month),
            "cosmetics": get_cosmetics(db),
        }
    return data


def save_push_subscription(db, subscription):
    endpoint = subscription.get("endpoint")
    if not endpoint: raise ValueError("A valid web push endpoint is required.")
    with db.connect() as c: c.execute("INSERT INTO push_subscriptions(endpoint,subscription_json,created_at) VALUES(?,?,?) ON CONFLICT(endpoint) DO UPDATE SET subscription_json=excluded.subscription_json", (endpoint, json.dumps(subscription), now_iso()))
    return {"status":"saved"}


def push_config():
    return {"enabled": bool(os.getenv("VAPID_PUBLIC_KEY")), "public_key": os.getenv("VAPID_PUBLIC_KEY", "") }


def send_web_push(db, message):
    public=os.getenv("VAPID_PUBLIC_KEY","").strip(); private=os.getenv("VAPID_PRIVATE_KEY","").strip(); subject=os.getenv("VAPID_SUBJECT","").strip()
    if not (public and private and subject): return False
    try:
        from pywebpush import webpush
        with db.connect() as c: rows=c.execute("SELECT subscription_json FROM push_subscriptions").fetchall()
        for row in rows:
            try: webpush(subscription_info=json.loads(row[0]), data=json.dumps({"title": PRODUCT, "body": message}), vapid_private_key=private, vapid_claims={"sub": subject})
            except Exception: pass
        return bool(rows)
    except Exception:
        return False


def delete_user_data(db):
    db.reset()
    with db.connect() as c:
        c.execute("DELETE FROM sessions"); c.execute("DELETE FROM magic_links"); c.execute("DELETE FROM users")


# ---------- P2: named Stash goals, monthly auto-deposit, monthly recap ----------
def get_stash_goals(db):
    with db.connect() as c:
        rows=c.execute("SELECT * FROM stash_goals ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,id").fetchall()
    state=get_state(db)
    return {"stash_balance":state.get("stash",{}).get("balance",0),"goals":[dict(r) for r in rows]}


def add_stash_goal(db,name,target_amount,monthly_target=0):
    with db.connect() as c:
        active=c.execute("SELECT COUNT(*) FROM stash_goals WHERE status='active'").fetchone()[0]
        if active>=6: raise ValueError("You can keep up to six active Stash goals.")
        cur=c.execute("INSERT INTO stash_goals(name,target_amount,saved_amount,monthly_target,status,created_at) VALUES(?,?,0,?,'active',?)",(name.strip(),round(float(target_amount),2),round(float(monthly_target),2),now_iso()))
        goal_id=cur.lastrowid
    log_action(db,"Glim","stash_goal_created",{"goal_id":goal_id,"target":round(float(target_amount),2)},"Create a named savings goal; future Stash portions are earmarked without double-counting the Stash total","User created goal",{"monthly_target":round(float(monthly_target),2)})
    return get_stash_goals(db)


def allocate_stash_to_goals(db,amount):
    left=round(float(amount),2)
    if left<=0:return
    with db.connect() as c:
        rows=c.execute("SELECT * FROM stash_goals WHERE status='active' ORDER BY id").fetchall()
        for row in rows:
            if left<=0:break
            need=max(0,round(float(row["target_amount"])-float(row["saved_amount"]),2))
            take=round(min(left,need),2)
            if take<=0:continue
            saved=round(float(row["saved_amount"])+take,2); status="completed" if saved+0.001>=float(row["target_amount"]) else "active"
            c.execute("UPDATE stash_goals SET saved_amount=?,status=?,completed_at=? WHERE id=?",(saved,status,now_iso() if status=="completed" else None,row["id"]))
            left=round(left-take,2)


def monthly_auto_deposit_settings(db):
    with db.connect() as c:
        row=c.execute("SELECT * FROM monthly_auto_deposit WHERE id=1").fetchone()
    if not row:return {"enabled":False,"amount":0,"due_day":1,"status":"disabled"}
    out=dict(row);out["enabled"]=bool(out["enabled"]);out.pop("id",None)
    return out


def save_monthly_auto_deposit(db,enabled,amount,due_day,consent):
    amount=round(float(amount),2)
    if enabled and amount<=0:raise ValueError("Set a monthly deposit amount greater than $0.00 CAD.")
    if enabled and not consent:raise ValueError("Confirm the monthly Sandbox transfer authorization before enabling auto-deposit.")
    state=get_state(db)
    if enabled and state.get("paypal",{}).get("status")!="connected":raise ValueError("Connect and authorize a PayPal Sandbox funding source before enabling auto-deposit.")
    if enabled and not PayPalSandbox(db).stash_email:raise ValueError("Set PAYPAL_STASH_EMAIL to the Glim savings Sandbox account before enabling auto-deposit.")
    consent_at=now_iso() if enabled and consent else None
    status="scheduled" if enabled else "disabled"
    with db.connect() as c:
        c.execute("UPDATE monthly_auto_deposit SET enabled=?,amount=?,due_day=?,consent_at=COALESCE(?,consent_at),status=?,last_error=NULL WHERE id=1",(int(enabled),amount,int(due_day),consent_at,status))
    log_action(db,"Banker","monthly_auto_deposit_setting",{"enabled":enabled,"amount":amount,"due_day":due_day},"Persist explicit opt-in for a monthly CAD Sandbox collection and savings payout","User consented" if enabled else "User disabled",{"status":status})
    return monthly_auto_deposit_settings(db)


def run_monthly_auto_deposit(db,force=False):
    settings=monthly_auto_deposit_settings(db)
    if not settings.get("enabled"):return {"status":"disabled","message":"Monthly auto-deposit is disabled."}
    now=datetime.now(timezone.utc); month=now.strftime("%Y-%m")
    if not force and now.day < int(settings["due_day"]):return {"status":"not_due","due_day":settings["due_day"],"month":month}
    if settings.get("last_run_month")==month:return {"status":"already_run","month":month,"last_status":settings.get("status"),"order_id":settings.get("order_id"),"payout_batch_id":settings.get("payout_batch_id")}
    if settings.get("last_attempt_month")==month and not force:return {"status":"attempted_this_month","month":month,"last_error":settings.get("last_error")}
    state=get_state(db)
    if state.get("paused"):raise ValueError("Glim is paused. Resume before the monthly deposit can run.")
    if state.get("paypal",{}).get("status")!="connected":raise ValueError("Connect PayPal Sandbox before the monthly deposit runs.")
    with db.connect() as c:c.execute("UPDATE monthly_auto_deposit SET last_attempt_month=?,status='processing',last_error=NULL,last_run_at=? WHERE id=1",(month,now_iso()))
    reference=f"monthly-deposit-{month}"
    try:
        paypal=PayPalSandbox(db)
        order=paypal.create_order_from_vault(float(settings["amount"]),reference,request_id=f"glim-monthly-{month}")
        order_status=order.get("status")
        order_id=order.get("id")
        if order_status == "APPROVED" and order_id:
            order=paypal.capture_order(order_id); order_status=order.get("status")
        if order_status != "COMPLETED":
            raise PayPalAPIError(f"PayPal returned order status {order_status or 'unknown'}; no savings payout was sent.")
        payout=paypal.create_payout(0,float(settings["amount"]),reference,request_id=f"glim-monthly-payout-{month}")
        header=payout.get("batch_header") or {}; batch=header.get("payout_batch_id")
        with db.connect() as c:c.execute("UPDATE monthly_auto_deposit SET last_run_month=?,status='payout_submitted',last_error=NULL,order_id=?,payout_batch_id=? WHERE id=1",(month,order_id,batch))
        result={"status":"payout_submitted","month":month,"amount":float(settings["amount"]),"order_id":order_id,"payout_batch_id":batch,"message":"PayPal accepted the collection and the savings payout was submitted; final payout status comes from PayPal."}
        log_action(db,"Banker","monthly_auto_deposit",result,"Collect the user-approved monthly amount through the vaulted PayPal Sandbox source, then submit a Payout to the savings Sandbox account","Explicit monthly opt-in; API collection completed",result)
        return result
    except Exception as exc:
        with db.connect() as c:c.execute("UPDATE monthly_auto_deposit SET status='error',last_error=? WHERE id=1",(str(exc)[:700],))
        log_action(db,"Banker","monthly_auto_deposit_failed",{"month":month,"amount":settings["amount"]},"Stop without claiming success if PayPal collection or payout submission fails","PayPal/API error",{"error":str(exc)[:700]})
        raise


def process_monthly_auto_deposit_if_due(db):
    try:return run_monthly_auto_deposit(db,force=False)
    except Exception as exc:return {"status":"error","message":str(exc)}


def monthly_recap(db,month=None):
    if month is None: month=datetime.now(timezone.utc).strftime("%Y-%m")
    if not re.fullmatch(r"\d{4}-\d{2}",month):raise ValueError("Month must use YYYY-MM format.")
    year,mon=map(int,month.split("-"))
    if mon<1 or mon>12:raise ValueError("Month must use YYYY-MM format.")
    with db.connect() as c:
        rows=c.execute("SELECT created_at,amount,stash_share,debt_share,status FROM ledger_entries WHERE kind='drip' AND substr(created_at,1,7)=? ORDER BY created_at",(month,)).fetchall()
        points=c.execute("SELECT COALESCE(SUM(points),0) FROM points_events WHERE substr(created_at,1,7)=?",(month,)).fetchone()[0]
        finished=c.execute("SELECT COUNT(*) FROM stash_goals WHERE status='completed' AND substr(COALESCE(completed_at,''),1,7)=?",(month,)).fetchone()[0]
    active_days=len({str(r["created_at"])[:10] for r in rows})
    amount=sum(float(r["amount"] or 0) for r in rows); stash=sum(float(r["stash_share"] or 0) for r in rows); debt=sum(float(r["debt_share"] or 0) for r in rows)
    state=get_state(db); debts=get_debts(db)
    current_debt=sum(float(d["balance"]) for d in debts if d["status"]=="active")
    return {"month":month,"currency":"CAD","drip_count":len(rows),"active_days":active_days,"total_moved":round(amount,2),"stash_contribution":round(stash,2),"debt_contribution":round(debt,2),"points_earned":int(points),"goals_completed":int(finished),"current_stash_balance":round(float(state.get("stash",{}).get("balance",0)),2),"current_active_debt":round(current_debt,2),"streak":int(state.get("game",{}).get("streak",0)),"bars":{"stash_pct":round(stash/amount*100,1) if amount else 0,"debt_pct":round(debt/amount*100,1) if amount else 0},"note":"Flow totals count recorded drips in the selected month. Current balances and streak are as of now, not month-end snapshots."}
