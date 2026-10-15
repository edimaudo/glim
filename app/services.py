from __future__ import annotations

import json
import math
import os
import random
import re
import secrets
import uuid
import hashlib
from urllib.parse import urlparse
import smtplib
import ssl
from email.message import EmailMessage
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import httpx

PRODUCT = "Glim"


class DB:
    def __init__(self, path: str):
        self.path = path
        self.owner_email = None
        self.master_db = self
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
                CREATE TABLE IF NOT EXISTS payment_settlements (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, reference TEXT NOT NULL UNIQUE,
                  order_id TEXT, payout_batch_id TEXT, amount REAL NOT NULL,
                  stash_amount REAL NOT NULL, debt_amount REAL NOT NULL, status TEXT NOT NULL,
                  attempt_count INTEGER NOT NULL DEFAULT 0, last_error TEXT,
                  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
                );
                CREATE TABLE IF NOT EXISTS scout_suggestions (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, name TEXT NOT NULL,
                  evidence_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
                  created_at TEXT NOT NULL, reviewed_at TEXT
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
                CREATE TABLE IF NOT EXISTS integration_states (
                  token TEXT PRIMARY KEY, email TEXT NOT NULL, purpose TEXT NOT NULL,
                  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS paypal_correlations (
                  provider_id TEXT PRIMARY KEY, email TEXT NOT NULL, kind TEXT NOT NULL,
                  created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS migration_metadata (
                  key TEXT PRIMARY KEY, value TEXT NOT NULL
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
            cheer_columns = {row[1] for row in c.execute("PRAGMA table_info(cheers)").fetchall()}
            if "from_email" not in cheer_columns:
                c.execute("ALTER TABLE cheers ADD COLUMN from_email TEXT")
            for table, column, ddl in [
                ("ledger_entries", "settlement_id", "ALTER TABLE ledger_entries ADD COLUMN settlement_id TEXT"),
                ("ledger_entries", "idempotency_key", "ALTER TABLE ledger_entries ADD COLUMN idempotency_key TEXT"),
                ("webhook_events", "event_id", "ALTER TABLE webhook_events ADD COLUMN event_id TEXT"),
            ]:
                cur2 = c.execute(f"PRAGMA table_info({table})")
                existing = {row[1] for row in cur2.fetchall()}
                if column not in existing:
                    c.execute(ddl)
            c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_idempotency_key ON ledger_entries(idempotency_key) WHERE idempotency_key IS NOT NULL")
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
            (1, "Leaf detail", "A subtle leaf accent for your progress screen.", 80, "🍃"),
            (2, "Milestone badge", "A small badge for a consistent week.", 120, "🌰"),
            (3, "Night palette", "A darker colour palette for your progress screen.", 180, "🌙"),
        ]
        c.executemany("INSERT OR IGNORE INTO cosmetics(id,name,description,cost,icon) VALUES(?,?,?,?,?)", cosmetics)

    def reset(self):
        with self.connect() as c:
            for table in ["app_state", "debts", "ledger_entries", "payment_settlements", "scout_suggestions", "agent_actions", "webhook_events", "nudges", "nudge_arm_stats", "points_events", "squads", "squad_members", "cheers", "lesson_progress", "user_cosmetics", "push_subscriptions", "stash_goals", "squad_goals", "squad_goal_events", "squad_cosmetics"]:
                c.execute(f"DELETE FROM {table}")
            c.execute("UPDATE monthly_auto_deposit SET enabled=0,amount=0,due_day=1,consent_at=NULL,last_attempt_month=NULL,last_run_month=NULL,status='disabled',last_error=NULL,last_run_at=NULL,order_id=NULL,payout_batch_id=NULL WHERE id=1")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_trusted_paypal_approval_url(value):
    try:
        parsed = urlparse(str(value or ""))
        host = (parsed.hostname or "").lower().rstrip(".")
        port = parsed.port
    except ValueError:
        return False
    return (
        parsed.scheme == "https"
        and (host == "paypal.com" or host.endswith(".paypal.com"))
        and parsed.username is None
        and parsed.password is None
        and port in (None, 443)
    )


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
        self.master_db = getattr(db, "master_db", db)
        self.owner_email = getattr(db, "owner_email", None)
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

    def _register_correlation(self, provider_id, kind):
        if not provider_id or not self.owner_email:
            return
        with self.master_db.connect() as c:
            c.execute(
                "INSERT INTO paypal_correlations(provider_id,email,kind,created_at) VALUES(?,?,?,?) "
                "ON CONFLICT(provider_id) DO UPDATE SET email=excluded.email,kind=excluded.kind",
                (str(provider_id), self.owner_email, kind, now_iso()),
            )

    def _callback_url(self, purpose):
        if os.getenv("APP_ENV", "development").strip().lower() in {"production", "prod"} and urlparse(self.app_url).scheme != "https":
            raise PayPalAPIError("APP_PUBLIC_URL must be an HTTPS URL in production before connecting PayPal.")
        base = f"{self.app_url}/api/paypal/callback"
        if not self.owner_email:
            return base, None
        token = secrets.token_urlsafe(32)
        created = datetime.now(timezone.utc)
        with self.master_db.connect() as c:
            c.execute(
                "INSERT INTO integration_states(token,email,purpose,created_at,expires_at,used) VALUES(?,?,?,?,?,0)",
                (_secret_digest(token), self.owner_email, purpose, created.isoformat(), (created + timedelta(minutes=30)).isoformat()),
            )
        return f"{base}?state={token}", token

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
        callback, state_token = self._callback_url("paypal_connect")
        cancel_url = callback + ("&cancelled=1" if "?" in callback else "?cancelled=1")
        customer_ref = "glim-" + hashlib.sha256((self.owner_email or "single-user").encode()).hexdigest()[:20]
        body = {
            "customer": {"merchant_customer_id": customer_ref},
            "payment_source": {
                "paypal": {
                    "description": "Glim sandbox funding source",
                    "usage_pattern": self.recurring_usage,
                    "country_code": "CA",
                    "experience_context": {
                        "brand_name": PRODUCT, "locale": "en-CA", "user_action": "SETUP_NOW",
                        "return_url": callback, "cancel_url": cancel_url,
                    },
                }
            },
        }
        r = self._request("POST", "/v3/vault/setup-tokens", json_body=body, headers={"PayPal-Request-Id": f"glim-setup-{uuid.uuid4().hex}"})
        p = r.json(); approve = next((x["href"] for x in p.get("links", []) if x.get("rel") == "approve"), None)
        if not is_trusted_paypal_approval_url(approve):
            raise PayPalAPIError("PayPal Sandbox did not return a trusted HTTPS approval URL.", r.status_code, {"id": p.get("id"), "status": p.get("status")})
        self._register_correlation(p.get("id"), "setup_token")
        s = get_state(self.db); s["paypal"] = {"status":"awaiting_approval","mode":"sandbox","country":"CA","currency":"CAD","scopes":self.scopes,"setup_token":p.get("id"),"customer_id":(p.get("customer") or {}).get("id"),"approval_url":approve}; write_state(self.db,s)
        log_action(self.db,"Banker","paypal_setup_token",{"country":"CA","currency":"CAD"},"Create a real PayPal Sandbox setup token and require payer approval","PayPal-hosted approval required",p)
        return {"status":"awaiting_approval","approval_url":approve,"country":"CA","currency":"CAD"}

    def complete_connection(self, setup_token):
        r = self._request("POST","/v3/vault/payment-tokens",json_body={"payment_source":{"token":{"id":setup_token,"type":"SETUP_TOKEN"}}},headers={"PayPal-Request-Id":f"glim-token-{uuid.uuid4().hex}"})
        p=r.json(); token=p.get("id")
        if not token: raise PayPalAPIError("PayPal Sandbox did not return a payment token.", r.status_code, p)
        self._register_correlation(token, "vault_token")
        s=get_state(self.db); s["paypal"]={"status":"connected","mode":"sandbox","country":"CA","currency":"CAD","scopes":self.scopes,"vault_id":token,"customer_id":(p.get("customer") or {}).get("id"),"funding_ref":token[-8:]}; write_state(self.db,s)
        log_action(self.db,"Banker","paypal_payment_token",{"setup_token":setup_token},"Exchange an approved setup token for a real PayPal payment token","Payer approved in PayPal Sandbox",p)
        return s["paypal"]

    def disconnect(self):
        with self.db.connect() as c:
            unresolved = c.execute(
                "SELECT reference,status FROM payment_settlements WHERE status NOT IN ('completed','capture_failed','approval_cancelled') ORDER BY id LIMIT 1"
            ).fetchone()
        if unresolved:
            raise PayPalAPIError(
                f"Resolve settlement {unresolved['reference']} ({unresolved['status']}) before disconnecting PayPal."
            )
        s=get_state(self.db); vid=s.get("paypal",{}).get("vault_id")
        if vid:
            if not self.configured:
                raise PayPalAPIError("PayPal credentials are not configured. Glim retained the connection state because it could not revoke the vaulted token.")
            self._request("DELETE", f"/v3/vault/payment-tokens/{vid}")
        s["paypal"]={"status":"disconnected","mode":"sandbox","country":"CA","currency":"CAD","scopes":[]}; write_state(self.db,s); return s["paypal"]

    def search_transactions(self, start, end):
        r=self._request("GET","/v1/reporting/transactions",params={"start_date":start,"end_date":end,"fields":"all","page_size":500},headers={"PayPal-Enforce-ISO8601-Format":"true"})
        return r.json()

    def create_order_from_vault(self, amount, reference, request_id=None):
        s=get_state(self.db); vault=s.get("paypal",{}).get("vault_id")
        if not vault: raise PayPalAPIError("No PayPal vaulted payment token is connected.")
        body={"intent":"CAPTURE","purchase_units":[{"reference_id":reference,"amount":{"currency_code":"CAD","value":f"{amount:.2f}"}}],"payment_source":{"paypal":{"vault_id":vault,"stored_credential":{"payment_initiator":"MERCHANT","usage":"SUBSEQUENT","usage_pattern":self.recurring_usage}}}}
        stable = "glim-order-" + hashlib.sha256(str(reference).encode()).hexdigest()[:24]
        payload = self._request("POST","/v2/checkout/orders",json_body=body,headers={"PayPal-Request-Id":request_id or stable}).json()
        self._register_correlation(payload.get("id"), "order")
        return payload

    def create_order_for_approval(self, amount, reference):
        callback, _ = self._callback_url("settlement_approval")
        cancel_url = callback + ("&cancelled=1" if "?" in callback else "?cancelled=1")
        body={"intent":"CAPTURE","purchase_units":[{"reference_id":reference,"amount":{"currency_code":"CAD","value":f"{amount:.2f}"}}],"payment_source":{"paypal":{"experience_context":{"brand_name":PRODUCT,"locale":"en-CA","user_action":"PAY_NOW","return_url":callback,"cancel_url":cancel_url}}}}
        stable = "glim-approve-" + hashlib.sha256(str(reference).encode()).hexdigest()[:24]
        payload = self._request("POST","/v2/checkout/orders",json_body=body,headers={"PayPal-Request-Id":stable}).json()
        approval_url = next((link.get("href") for link in payload.get("links", []) if link.get("rel") == "approve"), None)
        if not payload.get("id") or not is_trusted_paypal_approval_url(approval_url):
            raise PayPalAPIError("PayPal did not return a trusted HTTPS approval URL.", payload=payload)
        self._register_correlation(payload.get("id"), "order")
        return payload

    def capture_order(self, order_id):
        stable = "glim-capture-" + hashlib.sha256(str(order_id).encode()).hexdigest()[:24]
        payload = self._request("POST",f"/v2/checkout/orders/{order_id}/capture",headers={"PayPal-Request-Id":stable}).json()
        self._register_correlation(payload.get("id"), "order")
        for unit in payload.get("purchase_units", []):
            for capture in ((unit.get("payments") or {}).get("captures") or []):
                self._register_correlation(capture.get("id"), "capture")
        return payload

    def get_order(self, order_id):
        payload = self._request("GET", f"/v2/checkout/orders/{order_id}").json()
        self._register_correlation(payload.get("id"), "order")
        for unit in payload.get("purchase_units", []):
            for capture in ((unit.get("payments") or {}).get("captures") or []):
                self._register_correlation(capture.get("id"), "capture")
        return payload

    def get_payout_batch(self, batch_id):
        return self._request("GET", f"/v1/payments/payouts/{batch_id}").json()

    def create_payout(self, debt_amount, stash_amount, reference, request_id=None):
        if debt_amount>0 and not self.lender_email: raise PayPalAPIError("Set PAYPAL_LENDER_EMAIL for the Sandbox debt Payouts step.")
        if stash_amount>0 and not self.stash_email: raise PayPalAPIError("Set PAYPAL_STASH_EMAIL for the Sandbox savings Payouts step.")
        items=[]
        if debt_amount>0: items.append({"recipient_type":"EMAIL","amount":{"value":f"{debt_amount:.2f}","currency":"CAD"},"receiver":self.lender_email,"note":"Glim debt settlement (sandbox)"})
        if stash_amount>0: items.append({"recipient_type":"EMAIL","amount":{"value":f"{stash_amount:.2f}","currency":"CAD"},"receiver":self.stash_email,"note":"Glim savings stash settlement (sandbox)"})
        suffix = hashlib.sha256(str(reference).encode()).hexdigest()[:20]
        batch_id = re.sub(r"[^A-Za-z0-9_-]", "-", f"glim-{suffix}")[:60]
        body={"sender_batch_header":{"sender_batch_id":batch_id,"email_subject":"Glim sandbox settlement","email_message":"Sandbox payout generated by Glim."},"items":items}
        stable = "glim-payout-" + suffix
        payload = self._request("POST","/v1/payments/payouts",json_body=body,headers={"PayPal-Request-Id":request_id or stable}).json()
        self._register_correlation((payload.get("batch_header") or {}).get("payout_batch_id"), "payout_batch")
        return payload

    def verify_webhook(self, headers, raw_body):
        if not self.webhook_id: raise PayPalAPIError("PAYPAL_WEBHOOK_ID is required for webhook signature verification.")
        verify={"auth_algo":headers.get("paypal-auth-algo",""),"cert_url":headers.get("paypal-cert-url",""),"transmission_id":headers.get("paypal-transmission-id",""),"transmission_sig":headers.get("paypal-transmission-sig",""),"transmission_time":headers.get("paypal-transmission-time",""),"webhook_id":self.webhook_id,"webhook_event":json.loads(raw_body)}
        return self._request("POST","/v1/notifications/verify-webhook-signature",json_body=verify).json().get("verification_status")=="SUCCESS"


def default_state():
    return {"profile":{},"paypal":{"status":"disconnected","mode":"sandbox","country":"CA","currency":"CAD","scopes":[]},"stash":{"balance":0.0,"shield_threshold":1000.0,"goals":[]},"game":{"streak":0,"freezes":1,"points":0,"level":1,"evolution_stage":"Revolver"},"plan":{},"paused":False,"notifications":{"quiet_start":"22:00","quiet_end":"08:00","daily_cap":3,"channel":"in_app","consecutive_ignores":0},"pending_redirect":None}


def public_paypal_state(paypal_state):
    """Return connection UI status without exposing provider token identifiers."""
    allowed = {"status", "mode", "country", "currency", "scopes", "approval_url", "pending_settlement_approval_url", "error", "settlement_error"}
    return {key: value for key, value in dict(paypal_state or {}).items() if key in allowed}


def get_state(db):
    with db.connect() as c:
        row = c.execute("SELECT * FROM app_state WHERE id=1").fetchone()
    if not row:
        state = default_state()
    else:
        state = {"profile":json.loads(row["profile_json"]), "paypal":json.loads(row["paypal_json"]), "stash":json.loads(row["stash_json"]), "game":json.loads(row["game_json"]), "plan":json.loads(row["plan_json"]), "paused":bool(row["paused"]), "notifications":json.loads(row["notifications_json"] or "{}"), "pending_redirect":json.loads(row["pending_redirect_json"] or "null")}
    state.setdefault("game", {})
    state["game"].setdefault("last_drip_date", None)
    state["game"].setdefault("freeze_used_month", None)
    state["game"].setdefault("freeze_applied_date", None)
    # A freeze is replenished at the start of each user-local calendar month, but it
    # cannot be stockpiled. The persisted marker prevents repeated use within a month.
    zone = _profile_zone(state)
    current_month = datetime.now(zone).strftime("%Y-%m")
    state["game"]["freezes"] = 0 if state["game"].get("freeze_used_month") == current_month else 1
    return state


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


def parse_what_if(text, profile=None):
    """Parse supported budget changes and return every assumption for the UI to disclose."""
    raw = str(text or "").strip()
    lower = raw.casefold()
    profile = profile or {}
    assumptions = []
    weekly = 0.0
    label = "I could not determine a quantified change from that sentence."
    needs_clarification = False
    cadence_match = re.search(r"\b(twice|two times|2x|once|one time|1x|three times|thrice|3x)\b", lower)
    cadence_count = 1
    if cadence_match:
        cadence_count = 2 if cadence_match.group(1) in {"twice", "two times", "2x"} else (3 if cadence_match.group(1) in {"three times", "thrice", "3x"} else 1)

    amount_match = re.search(r"(?:\$\s*)?([0-9]+(?:\.[0-9]{1,2})?)\s*(?:cad\s*)?(?:per\s+)?(week|weekly|month|monthly|day|daily|occasion|visit|meal)?\b", lower)
    # Prefer currency-qualified amounts; otherwise only consume an amount when a period is explicit.
    if amount_match:
        amount = float(amount_match.group(1))
        unit = amount_match.group(2) or ""
        has_currency = "$" in raw[max(0, amount_match.start()-2):amount_match.start()+1]
        if amount > 0 and unit:
            if unit in {"week", "weekly"}:
                weekly = amount
            elif unit in {"month", "monthly"}:
                weekly = amount * 12 / 52
            elif unit in {"day", "daily"}:
                weekly = amount * 7
            else:
                weekly = amount * cadence_count
                assumptions.append(f"Treating {cadence_count} avoided occasion(s) per week as ${amount:.2f} each.")
            label = f"Models an additional ${weekly:.2f} per week based on the amount and period you entered."
        elif has_currency and amount > 0 and re.search(r"takeout|dining|restaurant|coffee|lunch|delivery", lower):
            if cadence_match:
                weekly = amount * cadence_count
                assumptions.append(f"Treating ${amount:.2f} as the spend per avoided occasion, {cadence_count} occasion(s) per week.")
                label = f"Models ${weekly:.2f}/week reclaimed from fewer occasions."
            else:
                needs_clarification = True
                label = "I need to know whether that amount is per week, month or occasion."
        elif has_currency and amount > 0:
            needs_clarification = True
            label = "I need a time period (per week, month or day) before calculating that amount."

    # The PRD example omits actual spending information. Use an explicit, visible placeholder;
    # never present it as observed user spending.
    if not weekly and not needs_clarification and re.search(r"\b(skip|cut|avoid|drop|reduce)\b", lower) and re.search(r"takeout|dining|restaurant|delivery", lower):
        count = cadence_count
        weekly = 10.0 * count
        assumptions.append(f"Planning placeholder: ${10.00:.2f} per avoided occasion because actual takeout spend is not recorded.")
        label = f"Uses a disclosed ${10:.2f}-per-occasion placeholder for {count} fewer takeout occasion(s) each week."

    if not weekly and not needs_clarification:
        percent_match = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*%", lower)
        if percent_match and re.search(r"expense|spend|budget|cost|spending", lower):
            pct = float(percent_match.group(1))
            monthly_expenses = float(profile.get("average_monthly_expenses") or 0)
            if pct > 0 and monthly_expenses > 0:
                weekly = monthly_expenses * pct / 100 * 12 / 52
                assumptions.append(f"Applies {pct:g}% to the full entered monthly-expense total because no category-level actuals are connected.")
                label = f"Models a {pct:g}% reduction in entered monthly expenses, or about ${weekly:.2f}/week."
            else:
                needs_clarification = True
                label = "Enter typical monthly expenses before estimating a percentage-based reduction."

    if not weekly and not needs_clarification and label.startswith("I could not"):
        needs_clarification = True
        label = "Add an amount and period (for example, ‘save $25 per week’) so I do not assume a figure."
    return round(max(0.0, weekly), 2), label, assumptions, needs_clarification


def what_if(db, text):
    state = get_state(db)
    debts = [debt for debt in get_debts(db) if debt["status"] == "active"]
    weekly, label, assumptions, needs_clarification = parse_what_if(text, state.get("profile", {}))
    if not debts:
        return {"parsed": {"input": text, "weekly_extra": weekly, "label": label, "assumptions": assumptions, "needs_clarification": needs_clarification}, "baseline": None, "what_if": None, "message": "Add an active debt before comparing payoff scenarios."}
    plan = state.get("plan")
    if not plan or not plan.get("projection"):
        plan = build_plan(db)
    baseline = plan.get("projection") or {}
    changed_daily = round(float(plan.get("daily_drip", compute_daily_drip(state.get("profile", {})))) + weekly / 7, 2)
    monthly_extra = changed_daily * 30 * (1 - float(plan.get("stash_pct", 65)) / 100)
    projected = multi_debt_projection(debts, monthly_extra, plan.get("strategy", "avalanche"))
    result = {
        "parsed": {"input": text, "weekly_extra": weekly, "label": label, "assumptions": assumptions, "needs_clarification": needs_clarification},
        "baseline": baseline,
        "what_if": None if needs_clarification else {
            "months": projected["months"], "interest_paid": projected["interest_paid"],
            "interest_saved_vs_baseline": round(float(baseline.get("interest_paid", 0)) - float(projected["interest_paid"]), 2),
            "months_saved_vs_baseline": int(baseline.get("months", projected["months"]) - projected["months"]),
        },
        "daily_drip": changed_daily,
    }
    log_action(db, "Tactician", "what_if", result["parsed"], "Parse an explicit amount/period or disclose a named placeholder, then use deterministic payoff math", "No LLM-generated financial figures", result)
    return result

def log_action(db,agent,input_ref,proposal,rationale,approval,result):
    with db.connect() as c:c.execute("INSERT INTO agent_actions(created_at,agent,input_ref,proposal,rationale,approval,result) VALUES(?,?,?,?,?,?,?)",(now_iso(),agent,input_ref,json.dumps(proposal),rationale,approval,json.dumps(result)))


def run_scout(db):
    """Read available PayPal transaction history; never manufacture recurring activity."""
    state = get_state(db)
    profile = state.get("profile", {})
    subscriptions = []
    debt_suggestions = []
    live = False
    paypal = PayPalSandbox(db)
    if paypal.configured and state.get("paypal", {}).get("status") == "connected":
        try:
            end = datetime.now(timezone.utc)
            start = end - timedelta(days=180)
            payload = paypal.search_transactions(
                start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            )
            grouped = {}
            for tx in payload.get("transaction_details", []):
                info = tx.get("transaction_info") or {}
                status = str(info.get("transaction_status", "")).lower()
                if status and status not in {"s", "success", "completed", "pending"}:
                    continue
                merchant = str(
                    info.get("transaction_subject")
                    or info.get("paypal_reference_id")
                    or ""
                ).strip()
                amount_obj = info.get("transaction_amount") or {}
                try:
                    amount = abs(float(amount_obj.get("value", 0)))
                except (TypeError, ValueError):
                    continue
                raw_date = (
                    info.get("transaction_initiation_date")
                    or info.get("transaction_updated_date")
                    or info.get("transaction_date")
                )
                if not merchant or amount <= 0 or not raw_date:
                    continue
                try:
                    parsed_date = datetime.fromisoformat(str(raw_date).replace("Z", "+00:00"))
                    if parsed_date.tzinfo is None:
                        parsed_date = parsed_date.replace(tzinfo=timezone.utc)
                    parsed_date = parsed_date.astimezone(timezone.utc)
                except ValueError:
                    continue
                key = re.sub(r"\s+", " ", merchant).strip().casefold()
                grouped.setdefault(key, {"merchant": merchant, "rows": []})["rows"].append((parsed_date, amount))

            for group in grouped.values():
                rows = sorted(group["rows"], key=lambda x: x[0])
                # A single purchase or irregular series is not a subscription signal.
                if len(rows) < 2:
                    continue
                day_gaps = [max(1, (rows[i][0].date() - rows[i - 1][0].date()).days) for i in range(1, len(rows))]
                median_gap = sorted(day_gaps)[len(day_gaps) // 2]
                if 25 <= median_gap <= 38:
                    cadence = "monthly"
                    monthly_amount = sorted(v for _, v in rows)[len(rows) // 2]
                elif 5 <= median_gap <= 9:
                    cadence = "weekly"
                    monthly_amount = sorted(v for _, v in rows)[len(rows) // 2] * 52 / 12
                else:
                    continue
                median_amount = sorted(v for _, v in rows)[len(rows) // 2]
                if any(abs(v - median_amount) > max(2.00, median_amount * 0.20) for _, v in rows):
                    continue
                evidence = {
                    "transactions_observed": len(rows),
                    "cadence": cadence,
                    "median_interval_days": median_gap,
                    "last_observed_at": rows[-1][0].isoformat(),
                }
                subscriptions.append({
                    "merchant": group["merchant"],
                    "monthly": round(monthly_amount, 2),
                    "signal": f"Observed {len(rows)} similar PayPal transactions about {median_gap} days apart",
                    "evidence": evidence,
                })
                if re.search(r"\b(visa|mastercard|credit\s*card|loan|line\s+of\s+credit|student\s+loan|auto\s+loan|car\s+loan|mortgage)\b", group["merchant"], re.I):
                    debt_suggestions.append({
                        "name": group["merchant"],
                        "evidence": evidence,
                        "note": "Recurring payment activity may relate to debt. Confirm the account and enter the actual balance, APR and minimum before adding it.",
                    })
            subscriptions.sort(key=lambda item: item["monthly"], reverse=True)
            live = bool(grouped)
        except (PayPalAPIError, KeyError, TypeError, ValueError):
            # Connectivity or payload format issues must not turn into synthetic findings.
            subscriptions = []
            debt_suggestions = []
            live = False
    if debt_suggestions:
        with db.connect() as c:
            for suggestion in debt_suggestions:
                existing = c.execute(
                    "SELECT id FROM scout_suggestions WHERE kind='debt' AND lower(name)=lower(?) AND status='pending'",
                    (suggestion["name"],),
                ).fetchone()
                if not existing:
                    c.execute(
                        "INSERT INTO scout_suggestions(kind,name,evidence_json,status,created_at) VALUES('debt',?,?, 'pending',?)",
                        (suggestion["name"], json.dumps(suggestion["evidence"]), now_iso()),
                    )
    pending = list_scout_suggestions(db).get("debt_suggestions", [])
    result = {
        "income_pattern": f"About ${profile['monthly_income']:,.0f}/month across the current profile" if profile.get("monthly_income") else None,
        "safe_to_move_daily": compute_safe_to_move(profile),
        "subscriptions": subscriptions,
        "debt_suggestions": pending,
        "source": "Connected account activity" if live else ("No connected account activity" if state.get("paypal", {}).get("status") != "connected" or not paypal.configured else "No verified recurring activity in the connected account"),
    }
    log_action(db, "Scout", "transaction_search", {"range": "180 days", "source": result["source"]}, "Read available PayPal activity; classify recurrence only when transaction dates and amounts support it", "Read-only; no sample transactions added", result)
    return result


def list_scout_suggestions(db):
    with db.connect() as c:
        rows = c.execute(
            "SELECT * FROM scout_suggestions WHERE kind='debt' AND status='pending' ORDER BY id DESC"
        ).fetchall()
    return {"debt_suggestions": [
        {"id": row["id"], "kind": row["kind"], "name": row["name"],
         "evidence": json.loads(row["evidence_json"] or "{}"), "status": row["status"]}
        for row in rows
    ]}


def confirm_scout_debt(db, suggestion_id, *, debt_type, balance, apr, minimum, due_day=15):
    if float(balance) <= 0 or float(apr) < 0 or float(minimum) <= 0 or int(due_day) not in range(1, 32):
        raise ValueError("Enter a positive balance and minimum payment, a valid APR, and a due day from 1 to 31.")
    with db.connect() as c:
        suggestion = c.execute(
            "SELECT * FROM scout_suggestions WHERE id=? AND kind='debt' AND status='pending'",
            (int(suggestion_id),),
        ).fetchone()
        if not suggestion:
            raise ValueError("That Scout suggestion is no longer pending.")
        cursor = c.execute(
            "INSERT INTO debts(name,type,balance,apr,minimum,due_day,status) VALUES(?,?,?,?,?,?, 'active')",
            (suggestion["name"], debt_type, round(float(balance), 2), round(float(apr), 4), round(float(minimum), 2), int(due_day)),
        )
        c.execute("UPDATE scout_suggestions SET status='accepted',reviewed_at=? WHERE id=?", (now_iso(), int(suggestion_id)))
        debt = {"id": cursor.lastrowid, "name": suggestion["name"], "type": debt_type,
                "balance": round(float(balance), 2), "apr": round(float(apr), 4),
                "minimum": round(float(minimum), 2), "due_day": int(due_day), "status": "active"}
    state = get_state(db)
    state["plan"] = {}
    if not state["stash"].get("shield_threshold"):
        state["stash"]["shield_threshold"] = float(minimum)
    write_state(db, state)
    log_action(db, "Scout", "debt_suggestion_accepted", {"suggestion_id": suggestion_id, "evidence": json.loads(suggestion["evidence_json"] or "{}")}, "A possible debt-related payment was identified; the user supplied the actual balance, APR and minimum", "User confirmed and entered the debt details", debt)
    return debt


def dismiss_scout_debt(db, suggestion_id):
    with db.connect() as c:
        changed = c.execute(
            "UPDATE scout_suggestions SET status='dismissed',reviewed_at=? WHERE id=? AND kind='debt' AND status='pending'",
            (now_iso(), int(suggestion_id)),
        ).rowcount
    if not changed:
        raise ValueError("That Scout suggestion is no longer pending.")
    log_action(db, "Scout", "debt_suggestion_dismissed", {"suggestion_id": suggestion_id}, "User reviewed a possible debt-related payment", "User dismissed suggestion", {"status": "dismissed"})
    return {"status": "dismissed", "suggestion_id": int(suggestion_id)}

def weekly_approved_total(db):
    state = get_state(db)
    since_local = datetime.now(_profile_zone(state)) - timedelta(days=6)
    since_utc = since_local.astimezone(timezone.utc).isoformat()
    with db.connect() as c:
        row = c.execute(
            "SELECT COALESCE(SUM(amount),0) total FROM ledger_entries "
            "WHERE kind='drip' AND status IN ('accrued','settlement_pending','settled') "
            "AND created_at>=?", (since_utc,)
        ).fetchone()
    return round(float(row["total"]), 2)


def can_auto_approve(db, amount):
    state = get_state(db)
    mode = state["profile"].get("approval_mode", "each") if state["profile"] else "each"
    cap = float(state["profile"].get("weekly_cap", 0)) if state.get("profile") else 0
    return mode == "standing_rule" and amount > 0 and weekly_approved_total(db) + amount <= cap


def selected_debt(db, strategy):
    active = [d for d in get_debts(db) if d["status"] == "active"]
    return ordered_debts(active, strategy)[0] if active else None


def payment_readiness(db):
    """Explain what is still required before a confirmed payout can be completed."""
    state = get_state(db)
    paypal = PayPalSandbox(db)
    blockers = []
    if not paypal.configured:
        blockers.append("PayPal Sandbox API credentials are missing.")
    if state.get("paypal", {}).get("status") != "connected" or not state.get("paypal", {}).get("vault_id"):
        blockers.append("Connect and approve a PayPal Sandbox funding source.")
    debts = [debt for debt in get_debts(db) if debt.get("status") == "active"]
    amount = compute_daily_drip(state.get("profile", {}))
    stash_pct, _ = choose_split(state)
    stash_amount = round(amount * float(stash_pct) / 100, 2)
    debt_amount = round(max(0, amount - stash_amount), 2) if debts else 0.0
    if not debts:
        stash_amount = amount
    email_pattern = r"[^\s@]+@[^\s@]+\.[^\s@]+"
    if stash_amount > 0 and not re.fullmatch(email_pattern, paypal.stash_email):
        blockers.append("Set a valid PAYPAL_STASH_EMAIL payout recipient.")
    if debt_amount > 0 and not re.fullmatch(email_pattern, paypal.lender_email):
        blockers.append("Set a valid PAYPAL_LENDER_EMAIL payout recipient.")
    return {"ready": not blockers, "blockers": blockers}


def approve_drip(db, approved, email=None, shared_db=None):
    """Record one planned daily contribution. Cash/debt balances move only after payout success."""
    state = get_state(db)
    if not approved:
        return {"status": "skipped", "amount": 0}
    if state["paused"]:
        raise ValueError("Drips are paused. Review the payment status before resuming.")
    if state["paypal"]["status"] != "connected":
        raise ValueError("Connect PayPal Sandbox before approving a drip.")
    profile = state.get("profile") or {}
    amount = compute_daily_drip(profile)
    if amount <= 0:
        raise ValueError("Your current income, expense and safety-floor inputs leave no daily amount to allocate.")
    today = datetime.now(_profile_zone(state)).date().isoformat()
    idempotency_key = f"drip:{today}"
    mode = profile.get("approval_mode", "each")
    cap = float(profile.get("weekly_cap", 0))

    strategy = state.get("plan", {}).get("strategy", "avalanche")
    debt = selected_debt(db, strategy)
    stash_pct, _ = choose_split(state)
    stash_share = round(amount * stash_pct / 100, 2)
    debt_share = round(amount - stash_share, 2)
    if debt_share and not debt:
        stash_share, debt_share = amount, 0.0

    # Lock around the date-key check, weekly-cap check and insertion. The database unique
    # index is the final protection when two approval requests arrive at the same time.
    with db.connect() as c:
        c.execute("BEGIN IMMEDIATE")
        existing = c.execute("SELECT * FROM ledger_entries WHERE idempotency_key=?", (idempotency_key,)).fetchone()
        if existing:
            c.commit()
            return {
                "status": "already_recorded", "amount": float(existing["amount"]),
                "stash_share": float(existing["stash_share"]), "debt_share": float(existing["debt_share"]),
                "ledger_id": int(existing["id"]), "date": today,
            }
        since_utc = (datetime.now(_profile_zone(state)) - timedelta(days=6)).astimezone(timezone.utc).isoformat()
        total_row = c.execute(
            "SELECT COALESCE(SUM(amount),0) total FROM ledger_entries WHERE kind='drip' "
            "AND status IN ('accrued','settlement_pending','settled') AND created_at>=?", (since_utc,)
        ).fetchone()
        if mode in ("weekly_cap", "standing_rule") and round(float(total_row["total"]), 2) + amount > cap:
            c.rollback()
            raise ValueError(f"Weekly cap of ${cap:.2f} would be exceeded.")
        created = now_iso()
        try:
            cur = c.execute(
                "INSERT INTO ledger_entries(created_at,kind,amount,stash_share,debt_share,debt_id,status,settlement_id,idempotency_key) "
                "VALUES(?,?,?,?,?,?, 'accrued',NULL,?)",
                (created, "drip", amount, stash_share, debt_share, debt["id"] if debt else None, idempotency_key),
            )
        except __import__("sqlite3").IntegrityError:
            c.rollback()
            with db.connect() as check:
                existing = check.execute("SELECT * FROM ledger_entries WHERE idempotency_key=?", (idempotency_key,)).fetchone()
            if existing:
                return {"status": "already_recorded", "amount": float(existing["amount"]), "ledger_id": int(existing["id"]), "date": today}
            raise
        ledger_id = cur.lastrowid

    # Habit points reward an approved daily step. A streak only grows on consecutive
    # local-calendar days, or when the user explicitly spent this month's freeze to cover
    # exactly one missed day. Gaps larger than one day restart the streak honestly.
    state = get_state(db)
    game = state["game"]
    previous = game.get("last_drip_date")
    day_gap = None
    if previous:
        try:
            day_gap = (datetime.fromisoformat(today).date() - datetime.fromisoformat(previous).date()).days
        except ValueError:
            day_gap = None
    if not previous:
        game["streak"] = 1
    elif day_gap == 1:
        game["streak"] = int(game.get("streak", 0)) + 1
    elif day_gap == 2 and game.get("freeze_applied_date") == today:
        game["streak"] = int(game.get("streak", 0)) + 1
        game["freeze_applied_date"] = None
    else:
        game["streak"] = 1
    game["last_drip_date"] = today
    game["points"] = int(game.get("points", 0)) + 20
    update_evolution(state, db)
    write_state(db, state)
    with db.connect() as c:
        c.execute("INSERT INTO points_events(reason,points,created_at) VALUES(?,?,?)", ("daily drip", 20, now_iso()))
    if email:
        record_squad_goal_event(db, email, shared_db=shared_db)
    result = {
        "status": "approved", "amount": amount, "stash_share": stash_share,
        "debt_share": debt_share, "ledger_id": ledger_id, "date": today,
        "streak": state["game"]["streak"], "points": state["game"]["points"],
        "debt_defeated": None, "settlement_status": "accrued_not_yet_settled",
    }
    log_action(
        db, "Banker", "drip_approval", result,
        "Record an idempotent daily allocation; balances update only after PayPal payout confirmation",
        "User approved" if mode == "each" else f"{mode} within weekly cap ${cap:.2f}", result,
    )
    return result


def auto_drip_tick(db, email=None, shared_db=None):
    state = get_state(db)
    amount = compute_daily_drip(state.get("profile", {}))
    if state.get("profile", {}).get("approval_mode") != "standing_rule":
        return {"status": "manual_required"}
    today = datetime.now(_profile_zone(state)).date().isoformat()
    with db.connect() as c:
        existing = c.execute("SELECT id,amount FROM ledger_entries WHERE idempotency_key=?", (f"drip:{today}",)).fetchone()
    if existing:
        return {"status": "already_recorded", "ledger_id": existing["id"], "amount": float(existing["amount"])}
    if not can_auto_approve(db, amount):
        return {"status": "cap_reached"}
    return approve_drip(db, True, email=email, shared_db=shared_db)


def _set_settlement(db, reference, *, status=None, order_id=None, payout_batch_id=None, error=None, attempt_increment=0):
    with db.connect() as c:
        assignments = ["updated_at=?"]
        values = [now_iso()]
        if status is not None:
            assignments.append("status=?"); values.append(status)
        if order_id is not None:
            assignments.append("order_id=?"); values.append(order_id)
        if payout_batch_id is not None:
            assignments.append("payout_batch_id=?"); values.append(payout_batch_id)
        if error is not None:
            assignments.append("last_error=?"); values.append(str(error)[:800])
        if attempt_increment:
            assignments.append("attempt_count=attempt_count+?"); values.append(attempt_increment)
        values.append(reference)
        c.execute(f"UPDATE payment_settlements SET {','.join(assignments)} WHERE reference=?", values)
        row = c.execute("SELECT * FROM payment_settlements WHERE reference=?", (reference,)).fetchone()
    return dict(row) if row else None


def _pause_for_settlement_error(db, message):
    state = get_state(db)
    state["paused"] = True
    state.setdefault("paypal", {})["settlement_error"] = str(message)[:500]
    write_state(db, state)


def _start_payout_for_settlement(db, reference, order_id, capture_result=None):
    """Create or idempotently re-create a payout for already captured funds."""
    with db.connect() as c:
        settlement_row = c.execute("SELECT * FROM payment_settlements WHERE reference=?", (reference,)).fetchone()
    if not settlement_row:
        raise ValueError("Settlement record was not found.")
    settlement = dict(settlement_row)
    if settlement["status"] == "completed":
        return {"status": "confirmed", "reference": reference, "amount": settlement["amount"]}
    if settlement["payout_batch_id"] and settlement["status"] in {"payout_pending", "completed"}:
        return {"status": settlement["status"], "reference": reference, "amount": settlement["amount"], "payout_batch_id": settlement["payout_batch_id"]}

    _set_settlement(db, reference, status="creating_payout", order_id=order_id, attempt_increment=1, error="")
    paypal = PayPalSandbox(db)
    try:
        payout = paypal.create_payout(
            float(settlement["debt_amount"]), float(settlement["stash_amount"]), reference
        )
        batch_id = (payout.get("batch_header") or {}).get("payout_batch_id")
        if not batch_id:
            raise PayPalAPIError("PayPal accepted no identifiable payout batch; settlement remains unresolved.", payload=payout)
        batch_status = str((payout.get("batch_header") or {}).get("batch_status", "")).upper()
        _set_settlement(db, reference, status="payout_pending", order_id=order_id, payout_batch_id=batch_id, error="")
        state = get_state(db)
        state["paypal"]["pending_settlement_reference"] = reference
        state["paypal"]["pending_order_id"] = order_id
        state["paypal"]["pending_payout_batch_id"] = batch_id
        write_state(db, state)
        if batch_status in {"SUCCESS", "SUCCEEDED"}:
            _finalize_settlement_success(db, reference, source="PayPal Payouts response")
        log_action(
            db, "Banker", "payout_created", {"reference": reference, "order_id": order_id, "batch_id": batch_id},
            "Disburse only the already captured total; wait for the final Payouts result before updating balances",
            "PayPal Payouts response received", {"batch_status": batch_status or "PENDING", "payout_batch_id": batch_id},
        )
        return {"status": "confirmed" if batch_status in {"SUCCESS", "SUCCEEDED"} else "payout_pending", "reference": reference, "amount": settlement["amount"], "order_id": order_id, "payout_batch_id": batch_id}
    except Exception as exc:
        _set_settlement(db, reference, status="payout_error", order_id=order_id, error=exc)
        _pause_for_settlement_error(db, f"Funds were captured but the payout needs recovery: {exc}")
        raise


def _finalize_settlement_success(db, reference, source="PayPal webhook"):
    """Exactly-once application of confirmed payout to ledger, debt and stash."""
    completed_debts = []
    with db.connect() as c:
        c.execute("BEGIN IMMEDIATE")
        settlement_row = c.execute("SELECT * FROM payment_settlements WHERE reference=?", (reference,)).fetchone()
        if not settlement_row:
            c.rollback()
            return False
        settlement = dict(settlement_row)
        if settlement["status"] == "completed":
            c.commit()
            return False
        rows = c.execute(
            "SELECT * FROM ledger_entries WHERE settlement_id=? AND kind='drip' AND status='settlement_pending' ORDER BY id",
            (reference,),
        ).fetchall()
        state_row = c.execute("SELECT * FROM app_state WHERE id=1").fetchone()
        if not state_row:
            c.rollback()
            raise ValueError("Glim state is missing; payout cannot be reconciled safely.")
        state = {
            "profile": json.loads(state_row["profile_json"] or "{}"),
            "paypal": json.loads(state_row["paypal_json"] or "{}"),
            "stash": json.loads(state_row["stash_json"] or "{}"),
            "game": json.loads(state_row["game_json"] or "{}"),
            "plan": json.loads(state_row["plan_json"] or "{}"),
            "paused": bool(state_row["paused"]),
            "notifications": json.loads(state_row["notifications_json"] or "{}"),
            "pending_redirect": json.loads(state_row["pending_redirect_json"] or "null"),
        }
        stash_increment = round(sum(float(row["stash_share"] or 0) for row in rows), 2)
        state["stash"]["balance"] = round(float(state["stash"].get("balance", 0)) + stash_increment, 2)
        for row in rows:
            share = round(float(row["debt_share"] or 0), 2)
            debt_id = row["debt_id"]
            if share <= 0 or debt_id is None:
                continue
            debt = c.execute("SELECT * FROM debts WHERE id=?", (debt_id,)).fetchone()
            if not debt or debt["status"] != "active":
                continue
            new_balance = round(max(0.0, float(debt["balance"]) - share), 2)
            status = "defeated" if new_balance <= 0.01 else "active"
            c.execute("UPDATE debts SET balance=?,status=? WHERE id=?", (new_balance, status, debt_id))
            if status == "defeated":
                completed_debts.append({"debt_id": debt_id, "debt_name": debt["name"], "freed_payment": float(debt["minimum"])})
                state["pending_redirect"] = completed_debts[-1]
        if completed_debts:
            state["game"]["evolution_stage"] = "Boss Slayer"
        active_count = int(c.execute("SELECT COUNT(*) FROM debts WHERE status='active'").fetchone()[0])
        if active_count == 0 and float(state["stash"].get("balance", 0)) >= float(state["stash"].get("shield_threshold", 0)):
            state["game"]["evolution_stage"] = "Transactor"
            state["game"]["level"] = max(int(state["game"].get("level", 1)), 5)
        elif completed_debts:
            state["game"]["evolution_stage"] = "Boss Slayer"
            state["game"]["level"] = max(int(state["game"].get("level", 1)), 4)
        elif float(state["stash"].get("balance", 0)) >= float(state["stash"].get("shield_threshold", 0)):
            state["game"]["evolution_stage"] = "Shielded"
            state["game"]["level"] = max(int(state["game"].get("level", 1)), 4)
        elif int(state["game"].get("streak", 0)) > 0:
            state["game"]["evolution_stage"] = "Sprout"
            state["game"]["level"] = max(int(state["game"].get("level", 1)), 2)
        # Only confirmed stash money may be earmarked into user goals.
        left = stash_increment
        goals = c.execute("SELECT * FROM stash_goals WHERE status='active' ORDER BY id").fetchall()
        for goal in goals:
            if left <= 0:
                break
            need = max(0, round(float(goal["target_amount"]) - float(goal["saved_amount"]), 2))
            take = round(min(left, need), 2)
            if take <= 0:
                continue
            saved = round(float(goal["saved_amount"]) + take, 2)
            status = "completed" if saved + 0.001 >= float(goal["target_amount"]) else "active"
            c.execute("UPDATE stash_goals SET saved_amount=?,status=?,completed_at=? WHERE id=?", (saved, status, now_iso() if status == "completed" else None, goal["id"]))
            left = round(left - take, 2)
        c.execute("UPDATE ledger_entries SET status='settled' WHERE settlement_id=? AND kind='drip' AND status='settlement_pending'", (reference,))
        c.execute(
            "UPDATE payment_settlements SET status='completed',last_error=NULL,updated_at=?,completed_at=? WHERE reference=? AND status!='completed'",
            (now_iso(), now_iso(), reference),
        )
        state["paypal"].pop("pending_settlement_reference", None)
        state["paypal"].pop("pending_order_id", None)
        state["paypal"].pop("pending_payout_batch_id", None)
        state["paypal"].pop("pending_settlement", None)
        state["paypal"].pop("pending_settlement_approval_url", None)
        state["plan"] = {}
        c.execute(
            "UPDATE app_state SET profile_json=?,paypal_json=?,stash_json=?,game_json=?,plan_json=?,paused=?,notifications_json=?,pending_redirect_json=? WHERE id=1",
            (json.dumps(state["profile"]), json.dumps(state["paypal"]), json.dumps(state["stash"]), json.dumps(state["game"]), json.dumps(state["plan"]), int(state["paused"]), json.dumps(state["notifications"]), json.dumps(state["pending_redirect"])),
        )
        c.commit()
    result = {"reference": reference, "stash_confirmed": stash_increment, "debts_defeated": completed_debts, "status": "completed"}
    log_action(db, "Banker", "settlement_completed", {"reference": reference}, "Apply the payout exactly once after PayPal confirms success", source, result)
    return True


def _mark_settlement_failed(db, reference, error, *, payout_failure=False):
    target_status = "payout_failed" if payout_failure else "capture_failed"
    _set_settlement(db, reference, status=target_status, error=error)
    state = get_state(db)
    state["paused"] = True
    state.setdefault("paypal", {})["settlement_error"] = str(error)[:500]
    write_state(db, state)
    if not payout_failure:
        # A declined/failed capture did not settle the user's allocation. Requeue the same
        # ledger entries for a deliberately initiated later attempt; the daily key remains unique.
        with db.connect() as c:
            c.execute("UPDATE ledger_entries SET status='accrued',settlement_id=NULL WHERE settlement_id=? AND status='settlement_pending'", (reference,))
    log_action(db, "Banker", "settlement_failed", {"reference": reference, "payout_failure": payout_failure}, "Pause future steps after a payment failure; preserve the ledger for explicit recovery", "PayPal failure outcome", {"status": target_status, "error": str(error)[:500]})


def settle_week(db):
    """Collect a unique batch of accrued steps and wait for confirmed payout webhooks."""
    state = get_state(db)
    if state["paused"]:
        raise ValueError("Contributions are paused. Resolve the existing payment status before settlement.")
    if state.get("paypal", {}).get("status") != "connected" or not state.get("paypal", {}).get("vault_id"):
        raise ValueError("Connect and approve a PayPal Sandbox funding source before submitting accrued contributions.")
    if not PayPalSandbox(db).configured:
        raise ValueError("PayPal Sandbox credentials are not configured. Accrued contributions remain unsettled; no payment was attempted.")
    with db.connect() as c:
        c.execute("BEGIN IMMEDIATE")
        rows = c.execute("SELECT * FROM ledger_entries WHERE kind='drip' AND status='accrued' ORDER BY id").fetchall()
        if not rows:
            c.rollback()
            return {"status": "nothing_to_settle", "amount": 0}
        unresolved = c.execute(
            "SELECT reference,status FROM payment_settlements WHERE status NOT IN ('completed','capture_failed','approval_cancelled') ORDER BY id LIMIT 1"
        ).fetchone()
        if unresolved:
            c.rollback()
            raise ValueError(f"Resolve settlement {unresolved['reference']} ({unresolved['status']}) before starting another batch.")
        ids = [int(r["id"]) for r in rows]
        reference = "drip-" + hashlib.sha256(",".join(map(str, ids)).encode()).hexdigest()[:26]
        existing = c.execute("SELECT * FROM payment_settlements WHERE reference=?", (reference,)).fetchone()

        # Debt balances can change while daily allocations accrue. Never pay a creditor
        # more than the currently outstanding balance: excess debt share is redirected
        # to the savings recipient. The ledger keeps the exact split that will be paid.
        debt_remaining = {}
        for row in rows:
            debt_id = row["debt_id"]
            original_debt = round(float(row["debt_share"] or 0), 2)
            allowed_debt = 0.0
            if debt_id is not None and original_debt > 0:
                key = int(debt_id)
                if key not in debt_remaining:
                    debt_row = c.execute("SELECT balance,status FROM debts WHERE id=?", (key,)).fetchone()
                    debt_remaining[key] = max(0.0, float(debt_row["balance"] or 0)) if debt_row and debt_row["status"] == "active" else 0.0
                allowed_debt = round(min(original_debt, debt_remaining[key]), 2)
                debt_remaining[key] = round(max(0.0, debt_remaining[key] - allowed_debt), 2)
            amount = round(float(row["amount"] or 0), 2)
            safe_stash = round(amount - allowed_debt, 2)
            c.execute("UPDATE ledger_entries SET stash_share=?,debt_share=? WHERE id=?", (safe_stash, allowed_debt, int(row["id"])))
        rows = c.execute(f"SELECT * FROM ledger_entries WHERE id IN ({','.join('?' for _ in ids)}) ORDER BY id", ids).fetchall()
        total = round(sum(float(r["amount"] or 0) for r in rows), 2)
        stash_amount = round(sum(float(r["stash_share"] or 0) for r in rows), 2)
        debt_amount = round(sum(float(r["debt_share"] or 0) for r in rows), 2)
        paypal = PayPalSandbox(db)
        # These configuration checks must happen before capturing any funds, otherwise
        # an order could be charged while there is no valid payout destination.
        email_pattern = r"[^\s@]+@[^\s@]+\.[^\s@]+"
        if stash_amount > 0 and not re.fullmatch(email_pattern, paypal.stash_email):
            c.rollback()
            raise ValueError("Set a valid PayPal recipient in PAYPAL_STASH_EMAIL before settlement. No capture or payout was attempted.")
        if debt_amount > 0 and not re.fullmatch(email_pattern, paypal.lender_email):
            c.rollback()
            raise ValueError("Set a valid PayPal recipient in PAYPAL_LENDER_EMAIL before settlement. No capture or payout was attempted.")
        if total <= 0:
            c.rollback()
            return {"status": "nothing_to_settle", "amount": 0}
        if existing:
            status = existing["status"]
            if status == "completed":
                c.rollback()
                return {"status": "confirmed", "amount": float(existing["amount"]), "reference": reference}
            if status not in {"capture_failed", "approval_cancelled"}:
                c.rollback()
                return {"status": status, "amount": float(existing["amount"]), "reference": reference, "order_id": existing["order_id"], "payout_batch_id": existing["payout_batch_id"], "error": existing["last_error"]}
            # Explicitly cancelled/declined attempts did not capture money. Reuse the same
            # settlement reference and daily ledger rows, preserving idempotency.
            c.execute(
                "UPDATE payment_settlements SET amount=?,stash_amount=?,debt_amount=?,status='creating_order',order_id=NULL,payout_batch_id=NULL,last_error=NULL,updated_at=?,attempt_count=attempt_count+1 WHERE reference=?",
                (total, stash_amount, debt_amount, now_iso(), reference),
            )
        else:
            c.execute(
                "INSERT INTO payment_settlements(reference,amount,stash_amount,debt_amount,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                (reference, total, stash_amount, debt_amount, "creating_order", now_iso(), now_iso()),
            )
        c.execute(
            f"UPDATE ledger_entries SET status='settlement_pending',settlement_id=? WHERE id IN ({','.join('?' for _ in ids)}) AND status IN ('accrued','settlement_pending')",
            [reference, *ids],
        )
        c.commit()

    try:
        try:
            order = paypal.create_order_from_vault(total, reference)
        except PayPalAPIError as exc:
            # Manual payer approval is a fallback only for a deterministic API rejection;
            # network/5xx ambiguity must not create a second checkout attempt.
            if exc.status_code not in {400, 422}:
                _set_settlement(db, reference, status="creating_order", error=exc, attempt_increment=1)
                _pause_for_settlement_error(db, f"PayPal order outcome is unresolved. No retry has been issued: {exc}")
                raise
            order = paypal.create_order_for_approval(total, reference)
            order_id = order.get("id")
            approval = next((link.get("href") for link in order.get("links", []) if link.get("rel") == "approve"), None)
            if not order_id or not approval:
                _set_settlement(db, reference, status="creating_order", error="PayPal did not provide a verifiable approval URL.")
                _pause_for_settlement_error(db, "PayPal did not provide an approval URL. Review the settlement before retrying.")
                raise PayPalAPIError("PayPal did not provide a verifiable approval URL.", payload=order)
            _set_settlement(db, reference, status="awaiting_approval", order_id=order_id, attempt_increment=1, error="")
            state = get_state(db)
            state["paypal"]["pending_settlement_reference"] = reference
            state["paypal"]["pending_order_id"] = order_id
            state["paypal"]["pending_settlement"] = {"amount": total, "stash": stash_amount, "debt": debt_amount, "reference": reference}
            state["paypal"]["pending_settlement_approval_url"] = approval
            write_state(db, state)
            return {"status": "approval_required", "amount": total, "reference": reference, "order_id": order_id, "approval_url": approval}

        order_id = order.get("id")
        if not order_id:
            raise PayPalAPIError("PayPal returned an order without an ID; settlement remains unresolved.", payload=order)
        _set_settlement(db, reference, status="capturing", order_id=order_id, attempt_increment=1, error="")
        capture = order if str(order.get("status", "")).upper() == "COMPLETED" else paypal.capture_order(order_id)
        if str(capture.get("status", "")).upper() != "COMPLETED":
            _set_settlement(db, reference, status="capture_pending", order_id=order_id, error=f"Capture status: {capture.get('status', 'unknown')}")
            state = get_state(db)
            state["paypal"]["pending_settlement_reference"] = reference
            state["paypal"]["pending_order_id"] = order_id
            write_state(db, state)
            return {"status": "capture_pending", "amount": total, "reference": reference, "order_id": order_id, "capture_status": capture.get("status")}
        return _start_payout_for_settlement(db, reference, order_id, capture)
    except Exception as exc:
        with db.connect() as c:
            c.execute("UPDATE payment_settlements SET updated_at=?,last_error=? WHERE reference=? AND status NOT IN ('completed','payout_pending','awaiting_approval','capture_pending')", (now_iso(), str(exc)[:800], reference))
        raise


def weekly_settlement_tick(db):
    """Submit accrued daily allocations once each local Sunday after 03:00."""
    state = get_state(db)
    zone = _profile_zone(state)
    local_now = datetime.now(zone)
    if local_now.weekday() != 6 or local_now.hour < 3 or state.get("paused"):
        return {"status": "not_due"}
    week_key = local_now.date().isoformat()
    with db.connect() as c:
        marker = c.execute("SELECT value FROM migration_metadata WHERE key='last_weekly_settlement_attempt'").fetchone()
        accrued = int(c.execute("SELECT COUNT(*) FROM ledger_entries WHERE kind='drip' AND status='accrued'").fetchone()[0])
        if not accrued:
            return {"status": "nothing_to_settle", "amount": 0}
        if marker and marker["value"] == week_key:
            return {"status": "already_attempted", "week": week_key}
        c.execute("INSERT INTO migration_metadata(key,value) VALUES('last_weekly_settlement_attempt',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (week_key,))
    try:
        result = settle_week(db)
        result["week"] = week_key
        return result
    except Exception as exc:
        _pause_for_settlement_error(db, f"Weekly settlement needs review; no duplicate charge was retried: {exc}")
        log_action(db, "Banker", "weekly_settlement_error", {"week": week_key}, "Attempt the weekly batch once and preserve idempotency on errors", "Server weekly scheduler", {"error": str(exc)[:500]})
        return {"status": "error", "week": week_key, "message": str(exc)[:500]}


def complete_pending_settlement(db, order_id):
    state = get_state(db)
    reference = state.get("paypal", {}).get("pending_settlement_reference")
    if not reference:
        with db.connect() as c:
            row = c.execute("SELECT reference FROM payment_settlements WHERE order_id=? AND status='awaiting_approval'", (order_id,)).fetchone()
        reference = row["reference"] if row else None
    if not reference:
        return {"status": "no_pending_settlement"}
    with db.connect() as c:
        row = c.execute("SELECT * FROM payment_settlements WHERE reference=? AND order_id=?", (reference, order_id)).fetchone()
    if not row:
        return {"status": "no_pending_settlement"}
    settlement = dict(row)
    if settlement["status"] == "completed":
        return {"status": "confirmed", "amount": settlement["amount"], "reference": reference}
    paypal = PayPalSandbox(db)
    try:
        _set_settlement(db, reference, status="capturing", attempt_increment=1, error="")
        order = paypal.capture_order(order_id)
        if str(order.get("status", "")).upper() != "COMPLETED":
            _set_settlement(db, reference, status="capture_pending", error=f"Capture status: {order.get('status', 'unknown')}")
            return {"status": "capture_pending", "reference": reference, "order_id": order_id, "capture_status": order.get("status")}
        return _start_payout_for_settlement(db, reference, order_id, order)
    except PayPalAPIError as exc:
        if exc.status_code in {400, 401, 403, 422}:
            _mark_settlement_failed(db, reference, exc, payout_failure=False)
        else:
            _set_settlement(db, reference, status="capture_unknown", error=exc, attempt_increment=1)
            _pause_for_settlement_error(db, f"PayPal capture status is unknown. Glim paused further steps to prevent duplicates: {exc}")
        raise


def retry_settlement(db, reference):
    """Recover without creating another charge after a payout/capture result is uncertain."""
    with db.connect() as c:
        row = c.execute("SELECT * FROM payment_settlements WHERE reference=?", (reference,)).fetchone()
    if not row:
        raise ValueError("Settlement reference not found.")
    settlement = dict(row)
    if settlement["status"] == "completed":
        return {"status": "confirmed", "reference": reference, "amount": settlement["amount"]}
    paypal = PayPalSandbox(db)
    if settlement["status"] == "creating_order":
        # The earlier request may have reached PayPal even if the response was lost. The
        # deterministic reference supplies the same PayPal-Request-Id, so this retry cannot
        # create a second captured charge.
        try:
            if settlement.get("order_id"):
                order_id = settlement["order_id"]
            else:
                order = paypal.create_order_from_vault(float(settlement["amount"]), reference)
                order_id = order.get("id")
                if not order_id:
                    raise PayPalAPIError("PayPal returned no order ID during recovery.", payload=order)
                _set_settlement(db, reference, status="capturing", order_id=order_id, attempt_increment=1, error="")
            order = paypal.get_order(order_id)
            if str(order.get("status", "")).upper() != "COMPLETED":
                order = paypal.capture_order(order_id)
            if str(order.get("status", "")).upper() == "COMPLETED":
                return _start_payout_for_settlement(db, reference, order_id, order)
            _set_settlement(db, reference, status="capture_pending", order_id=order_id, error=f"Capture status: {order.get('status', 'unknown')}")
            return {"status": "capture_pending", "reference": reference, "order_id": order_id, "capture_status": order.get("status")}
        except PayPalAPIError as exc:
            _set_settlement(db, reference, status="creating_order", error=exc, attempt_increment=1)
            _pause_for_settlement_error(db, f"Order recovery was not conclusive. Glim did not issue a second charge: {exc}")
            raise
    if settlement["status"] in {"payout_error", "payout_failed", "creating_payout"}:
        if not settlement.get("order_id"):
            raise ValueError("Captured order ID is missing; manual review is required before retrying.")
        # Never call Orders capture again once a payout exists or captured funds are known.
        state = get_state(db)
        state["paused"] = True
        try:
            if settlement["status"] == "payout_failed" and settlement.get("payout_batch_id"):
                attempt = int(settlement.get("attempt_count") or 0) + 1
                retry_ref = f"{reference}-retry-{attempt}"
                payout = paypal.create_payout(float(settlement["debt_amount"]), float(settlement["stash_amount"]), retry_ref)
                batch_id = (payout.get("batch_header") or {}).get("payout_batch_id")
                if not batch_id:
                    raise PayPalAPIError("Retry produced no Payouts batch ID.", payload=payout)
                _set_settlement(db, reference, status="payout_pending", payout_batch_id=batch_id, error="")
                state["paypal"]["pending_settlement_reference"] = reference
                state["paypal"]["pending_payout_batch_id"] = batch_id
                write_state(db, state)
                return {"status": "payout_pending", "reference": reference, "payout_batch_id": batch_id}
            return _start_payout_for_settlement(db, reference, settlement["order_id"])
        except Exception as exc:
            _set_settlement(db, reference, status="payout_error", error=exc, attempt_increment=1)
            _pause_for_settlement_error(db, f"Payout recovery failed; no new charge was attempted: {exc}")
            raise
    if settlement["status"] in {"capture_pending", "capture_unknown", "capturing"}:
        if not settlement.get("order_id"):
            raise ValueError("The order ID is missing. Glim will not re-charge this allocation automatically.")
        try:
            order = paypal.capture_order(settlement["order_id"])
            if str(order.get("status", "")).upper() == "COMPLETED":
                return _start_payout_for_settlement(db, reference, settlement["order_id"], order)
            _set_settlement(db, reference, status="capture_pending", error=f"Capture status: {order.get('status', 'unknown')}", attempt_increment=1)
            return {"status": "capture_pending", "reference": reference, "capture_status": order.get("status")}
        except PayPalAPIError as exc:
            _set_settlement(db, reference, status="capture_unknown", error=exc, attempt_increment=1)
            _pause_for_settlement_error(db, f"Capture recovery is unresolved; review before another attempt: {exc}")
            raise
    if settlement["status"] == "capture_failed":
        # A payer-declined capture did not pay out. Requeue the same approved daily entries;
        # their unique daily idempotency keys continue to reject a second contribution.
        with db.connect() as c:
            c.execute("UPDATE ledger_entries SET status='accrued',settlement_id=NULL WHERE settlement_id=? AND status='settlement_pending'", (reference,))
        state = get_state(db)
        state["paused"] = False
        state.setdefault("paypal", {}).pop("settlement_error", None)
        write_state(db, state)
        return settle_week(db)
    raise ValueError(f"Settlement state '{settlement['status']}' is not eligible for automatic retry. Review its PayPal status first.")


def reconcile_stale_settlements(db, force=False):
    """Poll uncertain PayPal outcomes using read-only status endpoints, never new charges.

    Manual reconciliation may poll immediately; the hourly worker only polls rows older than
    five minutes so it does not race an in-flight PayPal request.
    """
    if not PayPalSandbox(db).configured:
        return {"reconciled": 0, "reason": "PayPal Sandbox is not configured."}
    cutoff = (datetime.now(timezone.utc) if force else datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    with db.connect() as c:
        rows = c.execute(
            "SELECT * FROM payment_settlements WHERE updated_at<? AND status IN ('capture_pending','capture_unknown','payout_pending') ORDER BY id LIMIT 20",
            (cutoff,),
        ).fetchall()
    paypal = PayPalSandbox(db)
    reconciled = 0
    for row in rows:
        settlement = dict(row)
        try:
            if settlement["status"] in {"capture_pending", "capture_unknown"} and settlement.get("order_id"):
                order = paypal.get_order(settlement["order_id"])
                if str(order.get("status", "")).upper() == "COMPLETED":
                    _start_payout_for_settlement(db, settlement["reference"], settlement["order_id"], order)
                    reconciled += 1
            elif settlement["status"] == "payout_pending" and settlement.get("payout_batch_id"):
                payout = paypal.get_payout_batch(settlement["payout_batch_id"])
                status = str((payout.get("batch_header") or {}).get("batch_status", "")).upper()
                if status in {"SUCCESS", "SUCCEEDED"}:
                    _finalize_settlement_success(db, settlement["reference"], source="PayPal Payouts status reconciliation")
                    reconciled += 1
                elif status in {"DENIED", "FAILED", "CANCELED"}:
                    _mark_settlement_failed(db, settlement["reference"], f"PayPal payout status: {status}", payout_failure=True)
                    reconciled += 1
                else:
                    _set_settlement(db, settlement["reference"], error=f"Last verified PayPal payout status: {status or 'pending'}")
        except Exception as exc:
            _set_settlement(db, settlement["reference"], error=f"Reconciliation check failed: {exc}")
    return {"reconciled": reconciled}

def list_open_settlements(db):
    with db.connect() as c:
        rows = c.execute(
            "SELECT reference,amount,stash_amount,debt_amount,status,order_id,payout_batch_id,last_error,created_at,updated_at,attempt_count "
            "FROM payment_settlements WHERE status!='completed' ORDER BY id DESC LIMIT 10"
        ).fetchall()
    return [dict(row) for row in rows]


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
        related_order_id = (resource.get("supplementary_data") or {}).get("related_ids", {}).get("order_id")
        candidate_order = related_order_id or order_id
        with db.connect() as c:
            settlement_row = c.execute(
                "SELECT reference,status,order_id FROM payment_settlements WHERE order_id=? AND status IN ('capturing','capture_pending','capture_unknown') ORDER BY id DESC LIMIT 1",
                (str(candidate_order),),
            ).fetchone() if candidate_order else None
        pending = state.get("paypal", {}).get("pending_order_id")
        if pending and candidate_order and pending == candidate_order:
            changed = True
        if settlement_row:
            try:
                order = PayPalSandbox(db).get_order(settlement_row["order_id"])
                if str(order.get("status", "")).upper() == "COMPLETED":
                    _start_payout_for_settlement(db, settlement_row["reference"], settlement_row["order_id"], order)
                    changed = True
            except Exception as exc:
                _set_settlement(db, settlement_row["reference"], status="capture_unknown", error=f"Webhook reconciliation: {exc}")
                _pause_for_settlement_error(db, f"Payment capture needs verification before any further action: {exc}")
                changed = True

    if "PAYMENT.CAPTURE.DENIED" in et or "PAYMENT.CAPTURE.DECLINED" in et:
        related_order_id = (resource.get("supplementary_data") or {}).get("related_ids", {}).get("order_id")
        candidate_order = related_order_id or order_id
        with db.connect() as c:
            settlement_row = c.execute(
                "SELECT reference FROM payment_settlements WHERE order_id=? AND status IN ('capturing','capture_pending','capture_unknown') ORDER BY id DESC LIMIT 1",
                (str(candidate_order),),
            ).fetchone() if candidate_order else None
        if settlement_row:
            _mark_settlement_failed(db, settlement_row["reference"], f"PayPal declined the capture ({et}).", payout_failure=False)
        else:
            state["paused"] = True
            state["paypal"]["settlement_error"] = "PayPal declined a capture. Contributions are paused pending review."
            write_state(db, state)
        changed = True

    # Payout item events do not prove that every item in the batch settled. Only a
    # terminal batch event can finalize or fail the combined ledger allocation.
    normalized_event = et.upper()
    is_payout_success = normalized_event in {"PAYMENT.PAYOUTSBATCH.SUCCESS", "PAYMENT.PAYOUTS.BATCH.SUCCESS"}
    is_payout_failure = normalized_event in {"PAYMENT.PAYOUTSBATCH.DENIED", "PAYMENT.PAYOUTSBATCH.FAILED", "PAYMENT.PAYOUTS.BATCH.DENIED", "PAYMENT.PAYOUTS.BATCH.FAILED"}
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
                drip_settlement = c.execute(
                    "SELECT reference,status FROM payment_settlements WHERE payout_batch_id=? ORDER BY id DESC LIMIT 1",
                    (str(batch_id),),
                ).fetchone()
            if drip_settlement:
                if is_payout_success:
                    _finalize_settlement_success(db, drip_settlement["reference"], source=f"Verified PayPal webhook {et}")
                    changed = True
                else:
                    _mark_settlement_failed(db, drip_settlement["reference"], f"PayPal reported payout failure ({et}).", payout_failure=True)
                    changed = True
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


def _profile_zone(state):
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
    zone = str((state.get("profile") or {}).get("timezone") or "America/Toronto")
    try:
        return ZoneInfo(zone)
    except (ZoneInfoNotFoundError, ValueError):
        return timezone.utc


def in_quiet_hours(state, now=None):
    zone = _profile_zone(state)
    current = now or datetime.now(zone)
    if current.tzinfo is None:
        current = current.replace(tzinfo=zone)
    local_now = current.astimezone(zone).strftime("%H:%M")
    ns = state.get("notifications", {})
    start = str(ns.get("quiet_start", "22:00"))
    end = str(ns.get("quiet_end", "08:00"))
    if start < end:
        return start <= local_now < end
    return local_now >= start or local_now < end


def _send_email_nudge(db, message):
    email = str(getattr(db, "owner_email", "") or "").strip()
    host = os.getenv("SMTP_HOST", "").strip()
    if not email or not host:
        return False
    msg = EmailMessage()
    msg["Subject"] = "A Glim check-in"
    msg["From"] = os.getenv("SMTP_FROM", "").strip() or os.getenv("AUTH_EMAIL_FROM", "").strip() or os.getenv("SMTP_USER", "").strip() or "no-reply@glim.local"
    msg["To"] = email
    msg.set_content(f"{message}\n\nYou can adjust your check-in preferences in Glim settings.")
    try:
        port = int(os.getenv("SMTP_PORT", "587"))
        user = os.getenv("SMTP_USER", "").strip()
        password = os.getenv("SMTP_PASSWORD", "")
        if os.getenv("SMTP_SSL", "false").strip().lower() in {"1", "true", "yes"}:
            with smtplib.SMTP_SSL(host, port, timeout=12, context=ssl.create_default_context()) as server:
                if user:
                    server.login(user, password)
                server.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=12) as server:
                server.ehlo()
                if os.getenv("SMTP_STARTTLS", "true").strip().lower() not in {"0", "false", "no"}:
                    server.starttls(context=ssl.create_default_context())
                    server.ehlo()
                if user:
                    server.login(user, password)
                server.send_message(msg)
        return True
    except Exception:
        return False


def next_nudge(db, now=None):
    state = get_state(db)
    cap = int(state.get("notifications", {}).get("daily_cap", 3))
    zone = _profile_zone(state)
    current = now or datetime.now(zone)
    if current.tzinfo is None:
        current = current.replace(tzinfo=zone)
    now_local = current.astimezone(zone)
    start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    start_utc = start_local.astimezone(timezone.utc).isoformat()
    with db.connect() as c:
        today = c.execute("SELECT COUNT(*) FROM nudges WHERE created_at>=?", (start_utc,)).fetchone()[0]
        recent = c.execute("SELECT response FROM nudges WHERE response IS NOT NULL ORDER BY id DESC LIMIT 3").fetchall()
        for key, _ in ARMS:
            c.execute("INSERT OR IGNORE INTO nudge_arm_stats(arm_key,alpha,beta) VALUES(?,?,?)", (key, 1.0, 1.0))
        rows = c.execute("SELECT arm_key,alpha,beta FROM nudge_arm_stats").fetchall()
    consecutive_ignores = 0
    for item in recent:
        if item["response"] in ("snoozed", "dismissed"):
            consecutive_ignores += 1
        else:
            break
    if cap == 0:
        return {"status": "muted", "message": "Check-ins are muted. Turn the daily reminder limit back on in settings when you want them."}
    if in_quiet_hours(state, now=now_local):
        return {"status": "quiet_hours", "message": "Glim is within your quiet hours. No check-in was sent."}
    if int(today) >= cap:
        return {"status": "capped", "message": "Your daily check-in limit has been reached. Glim will be quiet until tomorrow."}
    if max(consecutive_ignores, int(state.get("notifications", {}).get("consecutive_ignores", 0))) >= 3:
        return {"status": "backoff", "message": "Glim has reduced check-ins after repeated snoozes. Change your preferences to resume them.", "why": "Back-off rule: the last three recorded responses were snoozes or dismissals."}
    if not rows:
        return {"status": "unavailable", "message": "No notification variants are configured."}
    key = max((random.betavariate(float(row["alpha"]), float(row["beta"])), row["arm_key"]) for row in rows)[1]
    message = dict(ARMS)[key]
    if not tone_linter(message):
        message = ARMS[-1][1]
    with db.connect() as c:
        c.execute("INSERT INTO nudges(created_at,arm_key,message) VALUES(?,?,?)", (now_iso(), key, message))
    channel = state.get("notifications", {}).get("channel", "in_app")
    external_sent = False
    if channel == "web_push":
        external_sent = send_web_push(db, message)
    elif channel == "email":
        external_sent = _send_email_nudge(db, message)
    why = f"Thompson sampling chose {key}; this variant will be updated from your response."
    if channel in {"web_push", "email"} and not external_sent:
        why += " External delivery was not confirmed; the check-in remains available in Glim."
    return {"status": "ready", "arm_key": key, "message": message, "why": why, "external_channel_sent": external_sent, "channel": channel}


def scheduled_nudge_tick(db, now=None):
    """Generate at most one scheduled check-in per local day, without duplicate deliveries.

    The worker calls this hourly. Delivery is attempted only during 09:00–19:59 in the
    user's timezone; custom quiet hours, daily caps and ignore backoff remain enforced by
    next_nudge(). A provisional date marker prevents concurrent workers double-sending.
    """
    state = get_state(db)
    if not (state.get("profile") or {}).get("setup_completed"):
        return {"status": "not_ready"}
    zone = _profile_zone(state)
    utc_now = now or datetime.now(timezone.utc)
    if utc_now.tzinfo is None:
        utc_now = utc_now.replace(tzinfo=timezone.utc)
    local_now = utc_now.astimezone(zone)
    if not 9 <= local_now.hour < 20:
        return {"status": "outside_delivery_window"}
    local_day = local_now.date().isoformat()
    day_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()
    with db.connect() as c:
        c.execute("BEGIN IMMEDIATE")
        marker = c.execute("SELECT value FROM migration_metadata WHERE key='last_scheduled_nudge_date'").fetchone()
        if marker and marker["value"] == local_day:
            c.commit()
            return {"status": "already_scheduled", "date": local_day}
        # If a person requested a check-in themselves, count it as today's check-in.
        existing = c.execute("SELECT id FROM nudges WHERE created_at>=? ORDER BY id DESC LIMIT 1", (day_start,)).fetchone()
        if existing:
            c.execute("INSERT INTO migration_metadata(key,value) VALUES('last_scheduled_nudge_date',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (local_day,))
            c.commit()
            return {"status": "already_requested", "date": local_day}
        c.execute("INSERT INTO migration_metadata(key,value) VALUES('last_scheduled_nudge_date',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (local_day,))
        c.commit()
    result = next_nudge(db, now=local_now)
    if result.get("status") == "quiet_hours":
        # Try again at the next hourly scheduler pass after the user's quiet hours end.
        with db.connect() as c:
            c.execute("DELETE FROM migration_metadata WHERE key='last_scheduled_nudge_date' AND value=?", (local_day,))
        return result
    return {**result, "scheduled": result.get("status") == "ready", "date": local_day}


def respond_nudge(db, response):
    rewards = {"acted": 1.0, "opened": 0.3, "snoozed": -0.2, "dismissed": -0.5, "muted": -1.0}
    reward = rewards[response]
    state = get_state(db)
    with db.connect() as c:
        row = c.execute("SELECT id,arm_key FROM nudges WHERE response IS NULL ORDER BY id DESC LIMIT 1").fetchone()
        if not row:
            return {"status": "no_pending_nudge"}
        c.execute("UPDATE nudges SET response=?,reward=? WHERE id=? AND response IS NULL", (response, reward, row["id"]))
        if reward >= 0:
            c.execute("UPDATE nudge_arm_stats SET alpha=alpha+? WHERE arm_key=?", (reward, row["arm_key"]))
        else:
            c.execute("UPDATE nudge_arm_stats SET beta=beta+? WHERE arm_key=?", (-reward, row["arm_key"]))
    state["notifications"]["consecutive_ignores"] = state["notifications"].get("consecutive_ignores", 0) + 1 if response in ("snoozed", "dismissed") else 0
    if response == "muted":
        state["notifications"]["daily_cap"] = 0
    write_state(db, state)
    log_action(db, "Glim", "nudge_response", {"response": response, "arm_key": row["arm_key"]}, "Update per-user notification preference using the recorded response", "User feedback", {"reward": reward})
    return {"status": "recorded", "reward": reward, "arm_key": row["arm_key"]}

def detect_stress(state):
    ignores=state.get("notifications",{}).get("consecutive_ignores",0); paused=state.get("paused",False); return bool(paused or ignores>=2)



def use_freeze(db):
    state = get_state(db)
    game = state["game"]
    zone = _profile_zone(state)
    now_day = datetime.now(zone).date()
    month = now_day.strftime("%Y-%m")
    previous = game.get("last_drip_date")
    if game.get("freeze_used_month") == month:
        raise ValueError("This month's streak freeze has already been used. One freeze is available per calendar month.")
    if not previous:
        raise ValueError("Record a daily step first. A freeze can only protect an existing streak.")
    try:
        gap = (now_day - datetime.fromisoformat(previous).date()).days
    except ValueError:
        gap = None
    if gap != 2:
        raise ValueError("A streak freeze can only cover exactly one missed day. Use it before recording today's step.")
    game["freeze_used_month"] = month
    game["freeze_applied_date"] = now_day.isoformat()
    game["freezes"] = 0
    write_state(db, state)
    log_action(db, "Glim", "streak_freeze", {"date": now_day.isoformat(), "month": month}, "Use the month's single streak freeze to cover exactly one missed day", "User selected freeze", {"freezes_remaining": 0, "streak_preserved": int(game.get("streak", 0))})
    return game

# ---------- Lightweight LLM adapter ----------
class GeminiAdapter:
    """Gemini REST client with a bounded, allow-listed function-calling loop."""
    def __init__(self):
        self.key = os.getenv("GEMINI_API_KEY", "").strip()
        self.model = os.getenv("GEMINI_MODEL", "gemini-3.8-flash").strip()

    @property
    def configured(self):
        return bool(self.key and self.model)

    def ask(self, system, user, tool_handlers=None):
        if not self.configured:
            return None
        handlers = tool_handlers or {}
        declarations = [
            {"name": "get_financial_snapshot", "description": "Read the user-entered profile, active debt balances, current plan and savings balance.", "parameters": {"type": "OBJECT", "properties": {}, "required": []}},
            {"name": "compare_payoff_strategies", "description": "Calculate deterministic avalanche, snowball and hybrid payoff projections from the current debt entries.", "parameters": {"type": "OBJECT", "properties": {}, "required": []}},
            {"name": "evaluate_what_if", "description": "Parse a proposed budget change and calculate a side-by-side payoff comparison. Use when user asks what-if or mentions a spending change.", "parameters": {"type": "OBJECT", "properties": {"text": {"type": "STRING", "description": "The proposed budget change in the user's own words."}}, "required": ["text"]}},
            {"name": "inspect_scout_activity", "description": "Read available connected PayPal Sandbox transaction history and show only supported recurring-payment evidence.", "parameters": {"type": "OBJECT", "properties": {}, "required": []}},
            {"name": "get_sage_lesson", "description": "Get the next learning question contextualized to current user data.", "parameters": {"type": "OBJECT", "properties": {}, "required": []}},
            {"name": "get_habit_progress", "description": "Read the user's streak, points, stage and per-user check-in status.", "parameters": {"type": "OBJECT", "properties": {}, "required": []}},
            {"name": "get_chipper_checkin", "description": "Read the user's reminder schedule, quiet hours, delivery channel and recent check-in responses. This function must not send a notification.", "parameters": {"type": "OBJECT", "properties": {}, "required": []}},
            {"name": "get_banker_status", "description": "Read payment connection, pause and settlement statuses. This function cannot initiate a payment or approve a transfer.", "parameters": {"type": "OBJECT", "properties": {}, "required": []}},
        ]
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.key}"
        context = [
            {"role": "user", "parts": [{"text": f"{system}\n\nUser request: {user}\n\nOnly the supplied local functions may be called. Never initiate, approve, capture, retry or disburse a payment. Every financial number must come from tool output or the included state. Final response should be concise, supportive and JSON with keys delegate and message when possible."}]}
        ]
        executed = []
        for _ in range(3):
            body = {
                "systemInstruction": {"parts": [{"text": "You are the Glim agent coordinator. The deterministic Python calculator owns financial numbers. Never shame the user. Never claim external work succeeded unless tool output confirms it. Keep payment operations behind explicit user controls."}]},
                "contents": context,
                "tools": [{"functionDeclarations": declarations}],
                "generationConfig": {"temperature": 0.2},
            }
            try:
                with httpx.Client(timeout=25) as client:
                    response = client.post(url, json=body)
                if response.status_code >= 400:
                    return None
                candidate = response.json().get("candidates", [{}])[0].get("content", {})
                parts = candidate.get("parts", [])
                calls = [part["functionCall"] for part in parts if isinstance(part.get("functionCall"), dict)]
                if not calls:
                    text = "\n".join(part.get("text", "") for part in parts if part.get("text"))
                    if not text:
                        return None
                    try:
                        parsed = json.loads(text)
                    except json.JSONDecodeError:
                        parsed = {"delegate": executed[-1]["delegate"] if executed else "Glim", "message": text.strip()}
                    if not isinstance(parsed, dict):
                        parsed = {"delegate": "Glim", "message": text.strip()}
                    parsed["tool_results"] = [item["result"] for item in executed]
                    if executed:
                        parsed["delegate"] = executed[-1]["delegate"]
                    return parsed
                # Echo the model's function-call content, then provide results as a separate user turn.
                context.append({"role": "model", "parts": parts})
                responses = []
                for call in calls:
                    name = str(call.get("name", ""))
                    handler = handlers.get(name)
                    if not handler:
                        result = {"error": "This tool is not permitted."}
                        delegate = "Glim"
                    else:
                        try:
                            arguments = call.get("args") or {}
                            result = handler(**arguments) if arguments else handler()
                        except Exception as exc:
                            result = {"error": str(exc)[:300]}
                        delegate = {
                            "get_financial_snapshot": "Chipper",
                            "compare_payoff_strategies": "Tactician",
                            "evaluate_what_if": "Tactician",
                            "inspect_scout_activity": "Scout",
                            "get_sage_lesson": "Sage",
                            "get_habit_progress": "Glim",
                            "get_chipper_checkin": "Chipper",
                            "get_banker_status": "Banker",
                        }.get(name, "Glim")
                    executed.append({"name": name, "delegate": delegate, "result": result})
                    responses.append({"functionResponse": {"name": name, "response": {"result": result}}})
                context.append({"role": "user", "parts": responses})
            except Exception:
                return None
        return None


def grounded_message(message, state, db, extra_results=None):
    if not message:
        return False
    allowed = []
    def add_numbers(value):
        if isinstance(value, dict):
            for child in value.values():
                add_numbers(child)
        elif isinstance(value, (list, tuple)):
            for child in value:
                add_numbers(child)
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            allowed.extend([round(float(value), 2), round(float(value))])
    add_numbers(state.get("profile", {}))
    add_numbers(state.get("plan", {}))
    add_numbers(state.get("stash", {}))
    add_numbers(get_debts(db))
    add_numbers(extra_results or [])
    currencies = re.findall(r"\$\s*([0-9]+(?:\.[0-9]+)?)", message)
    percents = re.findall(r"([0-9]+(?:\.[0-9]+)?)%", message)
    for value in currencies:
        if round(float(value), 2) not in allowed:
            return False
    for value in percents:
        if round(float(value), 2) not in allowed:
            return False
    return True


def _agent_tool_handlers(db):
    def snapshot():
        state = get_state(db)
        return {"profile": {key: state.get("profile", {}).get(key) for key in ("monthly_income", "average_monthly_expenses", "savings_pct", "approval_mode", "weekly_cap", "floor_balance")}, "debts": [d for d in get_debts(db) if d["status"] == "active"], "plan": state.get("plan", {}), "stash_balance": state.get("stash", {}).get("balance", 0), "daily_drip_estimate": compute_daily_drip(state.get("profile", {}))}

    def compare():
        state = get_state(db)
        debts = [d for d in get_debts(db) if d["status"] == "active"]
        if not debts:
            return {"status": "no_active_debt", "message": "Add active debt details before comparing payoff strategies."}
        daily = compute_daily_drip(state.get("profile", {}))
        stash_pct = float((state.get("plan") or {}).get("stash_pct", 65))
        minimum_interest = sum(payoff_projection(debt, 0)["interest_paid"] for debt in debts)
        out = {}
        for strategy in ("avalanche", "snowball", "hybrid"):
            monthly_extra = daily * 30 * (1 - stash_pct / 100)
            projection = multi_debt_projection(debts, monthly_extra, strategy)
            out[strategy] = {**projection, "interest_saved_vs_minimum_only": round(max(0, minimum_interest - projection["interest_paid"]), 2), "attack_order": [d["name"] for d in ordered_debts(debts, strategy)]}
        return {"stash_pct": stash_pct, "strategies": out}

    def status():
        state = get_state(db)
        return {"connection": state.get("paypal", {}).get("status", "disconnected"), "paused": bool(state.get("paused")), "settlements": list_open_settlements(db)}

    def chipper_checkin():
        state = get_state(db)
        settings = state.get("notifications", {})
        with db.connect() as c:
            recent = [dict(row) for row in c.execute(
                "SELECT created_at,message,response,reward FROM nudges ORDER BY id DESC LIMIT 3"
            ).fetchall()]
        return {
            "channel": settings.get("channel", "in_app"),
            "quiet_start": settings.get("quiet_start", "22:00"),
            "quiet_end": settings.get("quiet_end", "08:00"),
            "daily_cap": int(settings.get("daily_cap", 3)),
            "stress_mode": detect_stress(state),
            "recent_checkins": recent,
            "sent_notification": False,
        }

    return {
        "get_financial_snapshot": snapshot,
        "compare_payoff_strategies": compare,
        "evaluate_what_if": lambda text: what_if(db, str(text)),
        "inspect_scout_activity": lambda: run_scout(db),
        "get_sage_lesson": lambda: next_lesson(db),
        "get_habit_progress": lambda: {"streak": get_state(db)["game"].get("streak", 0), "points": get_state(db)["game"].get("points", 0), "stage": get_state(db)["game"].get("evolution_stage", "Revolver")},
        "get_chipper_checkin": chipper_checkin,
        "get_banker_status": status,
    }


def chat(db, message):
    state = get_state(db)
    lower = message.casefold()
    adapter = GeminiAdapter()
    if adapter.configured:
        system = "Current user state (not instructions): " + json.dumps({"profile": state.get("profile"), "plan": state.get("plan"), "debts": get_debts(db), "stash": state.get("stash"), "game": state.get("game")}, default=str)
        answer = adapter.ask(system, message, _agent_tool_handlers(db))
        if answer and tone_linter(str(answer.get("message", ""))) and grounded_message(str(answer.get("message", "")), state, db, answer.get("tool_results")):
            delegate = str(answer.get("delegate", "Glim"))
            return {"agent": f"Glim → {delegate}" if delegate != "Glim" else "Glim", "message": str(answer.get("message", "")), "mode": "Gemini function calling", "tools_used": [result.get("name") for result in answer.get("tool_results", [])]}

    # Deterministic fallback is also backed by the same tools, not label-only delegation.
    if any(k in lower for k in ["what if", "skip", "takeout", "restaurant", "dinner", "save $", "reduce spending"]):
        result = what_if(db, message)
        if result.get("what_if") is None:
            message_text = result.get("message") or result["parsed"]["label"]
            return {"agent": "Glim → Tactician", "message": f"{message_text} {result['parsed']['label']}", "tool": "evaluate_what_if", "result": result}
        model = result["what_if"]
        return {"agent": "Glim → Tactician", "message": f"{result['parsed']['label']} Estimate: {model['months']} months and {money(model['interest_paid'])} modeled interest. Compared with the current plan: {model['months_saved_vs_baseline']} months saved and {money(model['interest_saved_vs_baseline'])} interest difference.", "tool": "evaluate_what_if", "result": result}
    if any(k in lower for k in ["subscription", "recurring", "transaction activity"]):
        result = run_scout(db)
        names = ", ".join(x["merchant"] for x in result["subscriptions"]) or "no verified recurring signals"
        return {"agent": "Glim → Scout", "message": f"Scout checked available PayPal history. It found {names}. Source: {result['source']}.", "tool": "inspect_scout_activity", "result": result}
    if any(k in lower for k in ["compare", "avalanche", "snowball", "hybrid", "strategy"]):
        result = _agent_tool_handlers(db)["compare_payoff_strategies"]()
        return {"agent": "Glim → Tactician", "message": "Calculated side-by-side payoff projections for all three strategies.", "tool": "compare_payoff_strategies", "result": result}
    if any(k in lower for k in ["lesson", "learn", "sage"]):
        result = next_lesson(db)
        return {"agent": "Glim → Sage", "message": result.get("prompt", result.get("message", "No lesson is currently available.")), "tool": "get_sage_lesson", "result": result}
    if any(k in lower for k in ["check-in", "check in", "reminder", "notification", "quiet hours", "chipper"]):
        result = _agent_tool_handlers(db)["get_chipper_checkin"]()
        return {"agent": "Glim → Chipper", "message": f"Your check-ins use {result['channel']} delivery, a daily limit of {result['daily_cap']}, and quiet hours from {result['quiet_start']} to {result['quiet_end']}. I only reviewed the settings; no reminder was sent.", "tool": "get_chipper_checkin", "result": result}
    if any(k in lower for k in ["payment", "paypal", "settlement", "banker"]):
        result = _agent_tool_handlers(db)["get_banker_status"]()
        return {"agent": "Glim → Banker", "message": f"PayPal connection is {result['connection']}; practice/payment pause is {'on' if result['paused'] else 'off'}. I did not initiate or change a payment.", "tool": "get_banker_status", "result": result}
    if any(k in lower for k in ["points", "streak", "progress", "stage"]):
        progress = _agent_tool_handlers(db)["get_habit_progress"]()
        return {"agent": "Glim", "message": f"You have {progress['points']} points, a {progress['streak']}-day streak and the {progress['stage']} stage. Consistency, not the money amount, earns points.", "tool": "get_habit_progress", "result": progress}
    plan = state.get("plan") or (build_plan(db) if get_debts(db) else {})
    return {"agent": "Glim → Chipper", "message": f"Your current plan is {plan.get('strategy', 'not set')}. I can explain your inputs, compare payoff strategies, inspect verified PayPal findings, or calculate a what-if. The payment controls remain separate from chat."}

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
def _secret_digest(value):
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()


def request_magic_link(db, email):
    email = str(email or "").strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise ValueError("Enter a valid email address.")
    created = datetime.now(timezone.utc)
    with db.connect() as c:
        recent = c.execute(
            "SELECT COUNT(*) FROM magic_links WHERE email=? AND created_at>=?",
            (email, (created - timedelta(minutes=10)).isoformat()),
        ).fetchone()[0]
        if int(recent) >= 3:
            raise ValueError("Too many sign-in links were requested. Try again in 10 minutes.")
    token = secrets.token_urlsafe(32)
    stored_token = _secret_digest(token)
    expires = created + timedelta(minutes=15)
    base = os.getenv("APP_PUBLIC_URL", "http://127.0.0.1:8000").rstrip("/")
    if os.getenv("APP_ENV", "development").strip().lower() in {"production", "prod"} and urlparse(base).scheme != "https":
        raise RuntimeError("APP_PUBLIC_URL must be an HTTPS URL in production before sending sign-in links.")
    link = f"{base}/api/auth/magic?token={token}"
    with db.connect() as c:
        # Do not infer a person's name from the local part of their email address.
        c.execute(
            "INSERT INTO users(email,name,created_at) VALUES(?,?,?) ON CONFLICT(email) DO NOTHING",
            (email, "", now_iso()),
        )
        c.execute(
            "INSERT INTO magic_links(token,email,created_at,expires_at) VALUES(?,?,?,?)",
            (stored_token, email, created.isoformat(), expires.isoformat()),
        )
    smtp_host = os.getenv("SMTP_HOST", "").strip()
    if smtp_host:
        msg = EmailMessage()
        msg["Subject"] = "Your Glim sign-in link"
        msg["From"] = os.getenv("SMTP_FROM", "").strip() or os.getenv("AUTH_EMAIL_FROM", "").strip() or os.getenv("SMTP_USER", "").strip() or "no-reply@glim.local"
        msg["To"] = email
        msg.set_content(
            "Use this one-time Glim sign-in link within 15 minutes.\n\n"
            f"{link}\n\nIf you did not request it, you can ignore this email."
        )
        try:
            port = int(os.getenv("SMTP_PORT", "587"))
            user = os.getenv("SMTP_USER", "").strip()
            password = os.getenv("SMTP_PASSWORD", "")
            if os.getenv("SMTP_SSL", "false").strip().lower() in {"1", "true", "yes"}:
                with smtplib.SMTP_SSL(smtp_host, port, timeout=15, context=ssl.create_default_context()) as server:
                    if user:
                        server.login(user, password)
                    server.send_message(msg)
            else:
                with smtplib.SMTP(smtp_host, port, timeout=15) as server:
                    server.ehlo()
                    if os.getenv("SMTP_STARTTLS", "true").strip().lower() not in {"0", "false", "no"}:
                        server.starttls(context=ssl.create_default_context())
                        server.ehlo()
                    if user:
                        server.login(user, password)
                    server.send_message(msg)
        except Exception as exc:
            with db.connect() as c:
                c.execute("DELETE FROM magic_links WHERE token=?", (stored_token,))
            raise RuntimeError("Glim could not send the sign-in email. Check SMTP settings and try again.") from exc
        return {"status": "sent", "message": "Check your email for a sign-in link. It expires in 15 minutes."}
    if os.getenv("APP_ENV", "development").strip().lower() in {"production", "prod"}:
        with db.connect() as c:
            c.execute("DELETE FROM magic_links WHERE token=?", (stored_token,))
        raise RuntimeError("Email delivery is not configured. Set SMTP_HOST and the SMTP settings before enabling production sign-in.")
    return {"status": "development_link_created", "email": email, "demo_magic_link": link, "expires_in_minutes": 15, "message": "Development-only sign-in link. Configure SMTP before production."}


def verify_magic_link(db, token):
    if not token or len(token) > 256:
        return None
    now = datetime.now(timezone.utc)
    digest = _secret_digest(token)
    with db.connect() as c:
        c.execute("BEGIN IMMEDIATE")
        # Match hashed tokens first, but accept pre-migration raw tokens so existing links are not broken.
        row = c.execute(
            "SELECT * FROM magic_links WHERE token IN (?,?) AND used=0 ORDER BY CASE WHEN token=? THEN 0 ELSE 1 END LIMIT 1",
            (digest, token, digest),
        ).fetchone()
        if not row:
            c.rollback()
            return None
        stored_token = row["token"]
        try:
            expires = datetime.fromisoformat(row["expires_at"])
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            c.execute("UPDATE magic_links SET used=1 WHERE token=?", (stored_token,))
            c.commit()
            return None
        if expires < now:
            c.execute("UPDATE magic_links SET used=1 WHERE token=?", (stored_token,))
            c.commit()
            return None
        updated = c.execute("UPDATE magic_links SET used=1 WHERE token=? AND used=0", (stored_token,)).rowcount
        if updated != 1:
            c.rollback()
            return None
        sid = secrets.token_urlsafe(32)
        exp = now + timedelta(days=14)
        c.execute(
            "INSERT INTO sessions(token,email,created_at,expires_at) VALUES(?,?,?,?)",
            (_secret_digest(sid), row["email"], now.isoformat(), exp.isoformat()),
        )
        c.commit()
        return sid


def get_session_user(db, sid):
    if not sid:
        return None
    digest = _secret_digest(sid)
    with db.connect() as c:
        row = c.execute("SELECT * FROM sessions WHERE token IN (?,?) ORDER BY CASE WHEN token=? THEN 0 ELSE 1 END LIMIT 1", (digest, sid, digest)).fetchone()
    if not row:
        return None
    expires = datetime.fromisoformat(row["expires_at"])
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        revoke_session(db, sid)
        return None
    with db.connect() as c:
        u = c.execute("SELECT * FROM users WHERE email=?", (row["email"],)).fetchone()
    return dict(u) if u else None


def revoke_session(db, sid):
    if sid:
        with db.connect() as c:
            c.execute("DELETE FROM sessions WHERE token IN (?,?)", (_secret_digest(sid), sid))

def set_user_name(db,email,name):
    with db.connect() as c:c.execute("UPDATE users SET name=? WHERE email=?",(name,email))

# ---------- Notifications / P1 ----------
def get_notification_center(db):
    state=get_state(db)
    with db.connect() as c: rows=c.execute("SELECT * FROM nudges ORDER BY id DESC LIMIT 12").fetchall()
    return {"settings":state["notifications"],"stress_mode":detect_stress(state),"items":[dict(r) for r in rows]}

# ---------- Squads / P1-P2 ----------
def consistency_percent(db):
    """A privacy-safe 7-day consistency metric; never expose savings percentages or balances."""
    with db.connect() as c:
        dates = c.execute(
            "SELECT DISTINCT date(created_at) AS day FROM ledger_entries "
            "WHERE kind='drip' AND status IN ('accrued','settlement_pending','settled') "
            "AND date(created_at)>=date('now','-6 day')"
        ).fetchall()
    return round(min(7, len(dates)) / 7 * 100, 1)


def _squad_display_name(state, email):
    name = str((state.get("profile") or {}).get("name") or "").strip()
    if name:
        return name[:48]
    return "Member " + hashlib.sha256(str(email).strip().lower().encode("utf-8")).hexdigest()[:4].upper()


def create_squad(db, name, email, shared_db=None):
    community = shared_db or db
    existing = get_squad(db, email, shared_db=community)
    if existing.get("squad"):
        return existing
    invite = secrets.token_hex(4).upper()
    state = get_state(db)
    display = _squad_display_name(state, email)
    with community.connect() as c:
        cur = c.execute("INSERT INTO squads(name,invite_code,created_at) VALUES(?,?,?)", (name.strip(), invite, now_iso()))
        squad_id = cur.lastrowid
        c.execute(
            "INSERT INTO squad_members(squad_id,email,display_name,is_demo,streak,goal_pct,level) VALUES(?,?,?,?,?,?,?)",
            (squad_id, email, display, 0, state["game"]["streak"], consistency_percent(db), state["game"]["level"]),
        )
    return get_squad(db, email, shared_db=community)


def join_squad(db, code, email, shared_db=None):
    community = shared_db or db
    with community.connect() as c:
        sq = c.execute("SELECT * FROM squads WHERE invite_code=?", (code.strip().upper(),)).fetchone()
        current = c.execute("SELECT s.name,s.invite_code FROM squads s JOIN squad_members m ON m.squad_id=s.id WHERE m.email=? LIMIT 1", (email,)).fetchone()
    if not sq:
        raise ValueError("Invite code not found.")
    if current and current["invite_code"] != sq["invite_code"]:
        raise ValueError("Leave your current squad before joining another one.")
    with community.connect() as c:
        existing = c.execute("SELECT 1 FROM squad_members WHERE squad_id=? AND email=?", (sq["id"], email)).fetchone()
        count = c.execute("SELECT COUNT(*) FROM squad_members WHERE squad_id=?", (sq["id"],)).fetchone()[0]
    if existing:
        return get_squad(db, email, shared_db=community)
    if count >= 6:
        raise ValueError("A squad can have at most 6 members.")
    state = get_state(db)
    display = _squad_display_name(state, email)
    with community.connect() as c:
        c.execute(
            "INSERT OR IGNORE INTO squad_members(squad_id,email,display_name,is_demo,streak,goal_pct,level) VALUES(?,?,?,?,?,?,?)",
            (sq["id"], email, display, 0, state["game"]["streak"], consistency_percent(db), state["game"]["level"]),
        )
    return get_squad(db, email, shared_db=community)


def get_squad(db, email=None, shared_db=None):
    community = shared_db or db
    with community.connect() as c:
        if email:
            sq = c.execute("SELECT s.* FROM squads s JOIN squad_members m ON m.squad_id=s.id WHERE m.email=? ORDER BY s.id DESC LIMIT 1", (email,)).fetchone()
        else:
            sq = c.execute("SELECT s.* FROM squads s JOIN squad_members m ON m.squad_id=s.id WHERE m.is_demo=0 ORDER BY s.id DESC LIMIT 1").fetchone()
        if not sq:
            return {"squad": None, "members": [], "cheers": [], "goals": [], "unlocked_cosmetics": []}
        member_rows = c.execute("SELECT * FROM squad_members WHERE squad_id=? ORDER BY streak DESC,goal_pct DESC,display_name COLLATE NOCASE", (sq["id"],)).fetchall()
        cheer_rows = c.execute(
            "SELECT ch.id,ch.to_member_id,ch.from_email,ch.cheer,ch.created_at, "
            "target.display_name AS target_name,sender.display_name AS sender_name "
            "FROM cheers ch JOIN squad_members target ON target.id=ch.to_member_id "
            "LEFT JOIN squad_members sender ON sender.squad_id=ch.squad_id AND sender.email=ch.from_email "
            "WHERE ch.squad_id=? ORDER BY ch.id DESC LIMIT 20", (sq["id"],)
        ).fetchall()
        goals = c.execute("SELECT g.*,c.name AS reward_name,c.icon AS reward_icon FROM squad_goals g JOIN cosmetics c ON c.id=g.reward_cosmetic_id WHERE g.squad_id=? ORDER BY g.id DESC", (sq["id"],)).fetchall()
        rewards = c.execute("SELECT sc.*,c.name,c.icon FROM squad_cosmetics sc JOIN cosmetics c ON c.id=sc.cosmetic_id WHERE sc.squad_id=? ORDER BY sc.unlocked_at DESC", (sq["id"],)).fetchall()
    safe_members = []
    for member in member_rows:
        safe_members.append({
            "id": member["id"], "display_name": member["display_name"],
            "streak": int(member["streak"]), "goal_pct": float(member["goal_pct"]),
            "level": int(member["level"]), "is_self": bool(email and member["email"].lower()==email.lower()),
            "joined_at": member["joined_at"] if "joined_at" in member.keys() else None,
        })
    safe_cheers = [{"id": r["id"], "to_member_id": r["to_member_id"], "to_member_name": r["target_name"],
                    "sender_name": r["sender_name"] or "Former member", "cheer": r["cheer"], "created_at": r["created_at"]}
                   for r in cheer_rows]
    safe_squad = {"id": sq["id"], "name": sq["name"], "invite_code": sq["invite_code"], "created_at": sq["created_at"]}
    return {"squad": safe_squad, "members": safe_members, "cheers": safe_cheers, "goals": [dict(g) for g in goals], "unlocked_cosmetics": [dict(r) for r in rewards]}


def leave_squad(db, email, shared_db=None):
    community = shared_db or db
    with community.connect() as c:
        member = c.execute("SELECT id,squad_id FROM squad_members WHERE email=?", (email,)).fetchone()
        if not member:
            return {"status": "not_in_squad", "squad": None, "members": [], "cheers": [], "goals": [], "unlocked_cosmetics": []}
        squad_id, member_id = int(member["squad_id"]), int(member["id"])
        c.execute("DELETE FROM cheers WHERE squad_id=? AND (to_member_id=? OR from_email=?)", (squad_id, member_id, email))
        remaining_count = int(c.execute("SELECT COUNT(*) FROM squad_members WHERE squad_id=? AND id!=?", (squad_id, member_id)).fetchone()[0])
        if remaining_count == 0:
            c.execute("DELETE FROM squads WHERE id=?", (squad_id,))
        else:
            earned = c.execute("SELECT squad_goal_id,COUNT(*) AS n FROM squad_goal_events WHERE email=? AND squad_goal_id IN (SELECT id FROM squad_goals WHERE squad_id=?) GROUP BY squad_goal_id", (email, squad_id)).fetchall()
            for goal_event in earned:
                c.execute("UPDATE squad_goals SET progress_count=MAX(0,progress_count-?) WHERE id=?", (int(goal_event["n"]), int(goal_event["squad_goal_id"])))
        c.execute("DELETE FROM squad_goal_events WHERE email=? AND squad_goal_id IN (SELECT id FROM squad_goals WHERE squad_id=?)", (email, squad_id))
        c.execute("DELETE FROM squad_members WHERE id=?", (member_id,))
    return {"status": "left", **get_squad(db, email, shared_db=community)}


def send_cheer(db, member_id, cheer, email=None, shared_db=None):
    community = shared_db or db
    sq = get_squad(db, email, shared_db=community)["squad"]
    if not sq:
        raise ValueError("Create or join a squad first.")
    if cheer not in {"Nice streak!", "Keep going!", "Tiny win, big habit.", "Your consistency is showing."}:
        raise ValueError("Choose one of the supported positive cheers.")
    with community.connect() as c:
        member = c.execute("SELECT id,email FROM squad_members WHERE id=? AND squad_id=?", (member_id, sq["id"])).fetchone()
        if not member:
            raise ValueError("That member is not in your squad.")
        if email and member["email"].lower() == email.lower():
            raise ValueError("Choose another squad member to send a cheer.")
        c.execute("INSERT INTO cheers(squad_id,to_member_id,from_email,cheer,created_at) VALUES(?,?,?,?,?)", (sq["id"], member_id, email, cheer, now_iso()))
    return get_squad(db, email, shared_db=community)


def create_squad_goal(db, title, target_count, reward_cosmetic_id, email, shared_db=None):
    community = shared_db or db
    squad=get_squad(db,email,shared_db=community)["squad"]
    if not squad: raise ValueError("Create or join a squad first.")
    with community.connect() as c:
        cosmetic=c.execute("SELECT id FROM cosmetics WHERE id=?",(reward_cosmetic_id,)).fetchone()
        if not cosmetic: raise ValueError("Choose a valid group cosmetic reward.")
        active=c.execute("SELECT COUNT(*) FROM squad_goals WHERE squad_id=? AND status='active'",(squad["id"],)).fetchone()[0]
        if active>=3: raise ValueError("A squad can have up to three active shared goals.")
        cur=c.execute("INSERT INTO squad_goals(squad_id,title,target_count,reward_cosmetic_id,status,created_at) VALUES(?,?,?,?,?,?)",(squad["id"],title,target_count,reward_cosmetic_id,"active",now_iso()))
        goal_id=cur.lastrowid
    log_action(db,"Glim","squad_goal_created",{"goal_id":goal_id,"target_member_days":target_count},"Create a consistency-based shared goal; progress is earned from drip-days, not dollar balances","Squad member action",{"reward_cosmetic_id":reward_cosmetic_id})
    return get_squad(db,email,shared_db=community)


def record_squad_goal_event(db,email,shared_db=None):
    community = shared_db or db
    """Count at most one behavior event per member per day toward squad goals."""
    squad=get_squad(db,email,shared_db=community).get("squad")
    if not squad: return
    state = get_state(db)
    today=datetime.now(_profile_zone(state)).date().isoformat()
    completed=[]
    with community.connect() as c:
        c.execute(
            "UPDATE squad_members SET streak=?,goal_pct=?,level=? WHERE squad_id=? AND email=?",
            (int(state.get("game", {}).get("streak", 0)), consistency_percent(db), int(state.get("game", {}).get("level", 1)), squad["id"], email),
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
    with db.connect() as c:
        row = c.execute("SELECT l.* FROM lessons l LEFT JOIN lesson_progress p ON p.lesson_id=l.id WHERE COALESCE(p.completed,0)=0 ORDER BY l.id LIMIT 1").fetchone()
    if not row:
        return {"status": "complete", "message": "You finished the current Sage path."}
    lesson = dict(row)
    debts = [d for d in get_debts(db) if d.get("status") == "active"]
    prompt = lesson["prompt"]
    if row["id"] == 1:
        prompt = f"What is the minimum payment on {debts[0]['name']}?" if debts else "Before aggressive payoff, what kind of expense should a cash buffer protect you from?"
    elif row["id"] == 2:
        prompt = f"What APR is shown on {debts[0]['name']}?" if debts else "Before comparing debts by APR, which number should you verify for each account?"
    elif row["id"] == 3:
        scout = run_scout(db)
        vals = scout.get("subscriptions", [])[:2]
        prompt = f"What is the monthly total of Scout's first two recurring charges?" if vals else "What evidence would make a payment pattern worth reviewing as recurring?"
    return {"lesson": lesson, "prompt": prompt, "points": lesson["points"], "context": "current_user_data"}


def complete_lesson(db, lesson_id, answer):
    with db.connect() as c:
        row = c.execute("SELECT * FROM lessons WHERE id=?", (lesson_id,)).fetchone()
        completed = c.execute("SELECT completed FROM lesson_progress WHERE lesson_id=?", (lesson_id,)).fetchone()
    if not row:
        raise ValueError("Lesson not found.")
    if completed and completed["completed"]:
        raise ValueError("This lesson is already complete.")
    answer_text = str(answer or "").strip().casefold()
    accepted = False
    debts = [d for d in get_debts(db) if d.get("status") == "active"]
    if lesson_id == 1:
        accepted = bool(debts and re.search(rf"{float(debts[0]['minimum']):.0f}", answer_text)) if debts else any(w in answer_text for w in ("emergency", "unexpected", "essential", "urgent", "bill", "job loss", "repair"))
    elif lesson_id == 2:
        accepted = bool(debts and re.search(rf"{float(debts[0]['apr']):.1f}", answer_text)) if debts else any(w in answer_text for w in ("apr", "interest rate", "annual percentage"))
    elif lesson_id == 3:
        vals = run_scout(db).get("subscriptions", [])[:2]
        if vals:
            total = sum(float(x["monthly"]) for x in vals)
            accepted = bool(re.search(rf"{total:.0f}", answer_text))
        else:
            accepted = any(w in answer_text for w in ("repeated", "repeat", "regular", "cadence", "pattern", "more than once", "similar amounts"))
    elif lesson_id == 4:
        accepted = answer_text in ("snowball", "snowball strategy") or "smallest balance" in answer_text
    if not accepted:
        raise ValueError("That answer does not match the current lesson. Use the hint to review the concept and try again.")
    with db.connect() as c:
        c.execute("INSERT INTO lesson_progress(lesson_id,completed,completed_at) VALUES(?,?,?) ON CONFLICT(lesson_id) DO UPDATE SET completed=1,completed_at=excluded.completed_at", (lesson_id, 1, now_iso()))
    state = get_state(db)
    state["game"]["points"] = int(state["game"].get("points", 0)) + int(row["points"])
    update_evolution(state, db)
    write_state(db, state)
    with db.connect() as c:
        c.execute("INSERT INTO points_events(reason,points,created_at) VALUES(?,?,?)", (f"lesson {lesson_id}", int(row["points"]), now_iso()))
    log_action(db, "Sage", "lesson_complete", {"lesson_id": lesson_id}, "Applied lesson challenge using current user numbers or a data-independent concept", "Answer matched deterministic rule", {"points": row["points"]})
    return {"status": "complete", "points": row["points"], "game": state["game"]}

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
    # The export includes user-owned financial records, never credentials, Vault
    # identifiers, authorization URLs, or raw provider responses containing tokens.
    safe_state = json.loads(json.dumps(state))
    paypal_state = safe_state.get("paypal", {})
    for key in ("vault_id", "vault_token_id", "setup_token", "customer_id", "approval_url", "funding_ref",
                "pending_order_id", "pending_payout_batch_id"):
        paypal_state.pop(key, None)
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    with db.connect() as c:
        actions = [dict(r) for r in c.execute("SELECT * FROM agent_actions ORDER BY id").fetchall()]
        safe_actions = []
        sensitive_action_names = {"paypal_setup_token", "paypal_payment_token"}
        for action in actions:
            if action.get("action") in sensitive_action_names or action.get("agent") == "Banker" and "paypal_" in str(action.get("input_ref", "")):
                # Keep an auditable record that an action occurred without copying the
                # raw PayPal response or setup-token values into a portable export.
                action["input_ref"] = "[redacted provider reference]"
                action["result"] = "[redacted provider response; available in server audit log]"
            safe_actions.append(action)
        data={
            "product": PRODUCT,
            "profile": safe_state["profile"],
            "state": safe_state,
            "debts": [dict(r) for r in c.execute("SELECT * FROM debts").fetchall()],
            "ledger": [dict(r) for r in c.execute("SELECT * FROM ledger_entries").fetchall()],
            "nudges": [dict(r) for r in c.execute("SELECT * FROM nudges").fetchall()],
            "agent_actions": safe_actions,
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
    public = os.getenv("VAPID_PUBLIC_KEY", "").strip()
    private = os.getenv("VAPID_PRIVATE_KEY", "").strip()
    subject = os.getenv("VAPID_SUBJECT", "").strip()
    smtp = bool(os.getenv("SMTP_HOST", "").strip() and (os.getenv("SMTP_FROM", "").strip() or os.getenv("AUTH_EMAIL_FROM", "").strip() or os.getenv("SMTP_USER", "").strip()))
    return {"enabled": bool(public and private and subject), "public_key": public, "email_enabled": smtp, "reason": None if (public and private and subject) else "Web push requires VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT."}


def send_web_push(db, message):
    public=os.getenv("VAPID_PUBLIC_KEY","").strip(); private=os.getenv("VAPID_PRIVATE_KEY","").strip(); subject=os.getenv("VAPID_SUBJECT","").strip()
    if not (public and private and subject): return False
    try:
        from pywebpush import webpush
        with db.connect() as c: rows=c.execute("SELECT id,subscription_json FROM push_subscriptions").fetchall()
        delivered = 0
        for row in rows:
            try:
                webpush(subscription_info=json.loads(row["subscription_json"]), data=json.dumps({"title": PRODUCT, "body": message}), vapid_private_key=private, vapid_claims={"sub": subject})
                delivered += 1
            except Exception as exc:
                status = getattr(getattr(exc, "response", None), "status_code", None)
                if status in {404, 410}:
                    with db.connect() as c: c.execute("DELETE FROM push_subscriptions WHERE id=?", (row["id"],))
        return delivered > 0
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
