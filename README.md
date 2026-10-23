# Glim

Glim is a FastAPI app for planning debt repayment alongside a savings buffer. The main experience is a single financial plan with plain-language estimates and user-controlled transfer settings.

## Architecture

- `app/main.py` defines FastAPI routes and the local-storage/database API boundary.
- `app/templates/` contains Jinja2 pages and reusable feature partials.
- `app/static/` contains browser assets; it is not the application-template directory.
- `app/static/storage.js` implements the browser localStorage adapter used by the default prototype mode.
- `app/services.py` contains deterministic financial calculations, the PayPal Sandbox client, Gemini adapter and service functions used by the agent roles.

## First-run flow and navigation

Sign-in now takes users directly into the app. If there is no saved plan, the first-run form appears inside the app shell instead of opening a separate example-profile picker. It collects monthly take-home income, typical monthly expenses, a savings target and a minimum balance. A first debt can be entered in the same form or added later from Debt plan.

The main navigation has five destinations: `/app/overview`, `/app/plan`, `/app/savings`, `/app/settings` and `/app/help`. Overview combines the debt and savings balances with the user's payment streak. Debt plan is organized into tabs for debt entry, repayment planning and payment progress; Smart Strategy is one of the repayment options rather than a standalone destination. Savings has tabs for goals, the percentage-based savings plan, contributions, and giving. Giving only becomes available after a savings goal is complete. Smart savings uses the same financial context to balance the savings target and debt costs. Settings contains reminders and account controls; Help includes the walkthrough and common questions.

## Integration status and deployment gates

### Storage, sign-in and account isolation

`GLIM_STORAGE_MODE=localStorage` remains the default. In this mode profile data stays in the current browser, email entry is only a local profile selector, and server/payment API routes are disabled. Use `GLIM_STORAGE_MODE=database` to enable the API: it sends one-time sign-in links through SMTP, stores magic-link/session secrets as SHA-256 digests, and keeps each account's financial state in a separate SQLite tenant file. The master database stores authentication, PayPal callback correlations and shared squad membership.

SQLite must live on durable writable storage. Do not run this mode on an ephemeral serverless filesystem, or across several app instances without a shared database/migration strategy. A production managed Postgres adapter is not included in this codebase, so select a host with a persistent volume for the current SQLite implementation. In production, `APP_ENV=production` requires HTTPS in `APP_PUBLIC_URL` and an SMTP connection for verified email sign-in.

### PayPal Sandbox and financial ledger

The server-side flow includes Vault setup-token consent and exchange, Orders, capture, Payouts, callback-state verification, webhook signature verification, reconciliation and idempotent request references. A daily approval creates an accrued ledger item; **it does not change savings or debt balances**. Balances update only after PayPal confirms the payout batch. Uncertain outcomes pause new transfers until the existing settlement is reconciled; a second batch cannot start while a prior settlement is unresolved. The app validates payout recipients before capture, checks that debt payments do not exceed a debt's remaining balance, and keeps provider token identifiers out of API state and data exports.

Configure `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_STASH_EMAIL`, `PAYPAL_LENDER_EMAIL`, and an externally reachable HTTPS `APP_PUBLIC_URL`. Register the webhook with PayPal Sandbox and configure its matching ID. Automated tests exercise request construction, token handling and settlement safeguards, but they do not substitute for an end-to-end run with your own PayPal Sandbox business/personal accounts and webhook configuration.

Scout only analyzes activity returned by the connected PayPal reporting API. It does not invent missing recurring payments or imply that PayPal reporting represents every bank or credit-card transaction. Debt suggestions remain pending until the user confirms the balance, rate and payment details.

### Gemini and deterministic specialist tools

`GeminiAdapter` supports bounded Gemini function calling using allow-listed, read-only tools for the financial snapshot, deterministic payoff comparisons, what-if calculations, Scout activity, Sage lessons, habit progress, Chipper check-in preferences and Banker settlement status. The model cannot initiate, approve, capture or retry a payment; those operations remain behind explicit app controls. When Gemini is unconfigured or its response fails validation, Glim uses deterministic Python guidance. Tool calls and financial actions are recorded in the per-user audit log, with provider token values redacted from the browser-facing audit and export.

Set `GEMINI_API_KEY` and, when necessary, `GEMINI_MODEL`. The example environment defaults to `gemini-3.8-flash`; verify that the model is available to your API key before enabling it ([Google Gemini API model catalogue](https://ai.google.dev/gemini-api/docs/models)). The specialist roles share deterministic service functions rather than running as five independent autonomous agents.

### Debt payments, savings scheduling and reminders

Debt entries include the type, balance, APR, minimum payment, and due day. Users can record a payment; this reduces the tracked balance and is identified as user-reported rather than lender-verified. The debt progress view compares recorded payments with the entered minimum and due day, builds an on-time streak, and unlocks otter accessories with non-cash in-app currency. The debt chart projects combined debt under the selected repayment strategy against minimum payments only.

Savings goals can include a monthly contribution target. A recorded contribution updates the tracked savings balance and goal status, and the savings streak counts months that meet the selected target. Percentage-of-income schedules have a fixed duration and may be disabled at any time. Charity giving stays hidden and the service rejects donation requests until at least one goal is complete; any configured connected payment flow remains subject to payment-provider authorization and payout status.

### P1 notifications, progression, squads and data controls

In database mode, the hourly worker applies the standing-rule daily allocation and finite monthly savings schedules, schedules at most one check-in per user-local calendar day during the 09:00–19:59 delivery window, runs weekly settlement checks, and reconciles stale outcomes. Scheduled check-ins respect the configured time zone, quiet hours, daily cap, and ignore backoff. Email requires `SMTP_HOST` plus a sender address; web push requires `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and a browser subscription. These external channels are only enabled when configured.

The app includes debt payoff projections and freed-payment decisions, streak freezes and evolution/points, per-user check-in learning, user-confirmed Scout debt proposals, situation-aware Sage lessons, six-member squads with invites/positive cheers/privacy-safe progress, account export and account deletion, and responsive/reduced-motion/focus treatments. Squad features are shared only when server mode is enabled; the browser-only version does not fabricate shared members.

## Run locally

```bash
python -m pip install -r requirements.txt
uvicorn app.main:app --reload
```

To exercise verified authentication and server integrations locally, configure `.env` from `.env.example`, use a durable `DATABASE_PATH` and `GLIM_USER_DATA_DIR`, set `GLIM_STORAGE_MODE=database`, and configure SMTP/PayPal/Gemini or VAPID credentials as needed. Do not switch production traffic to server mode until the real-account flow and webhook round trip have been verified in PayPal Sandbox.


## Tests

```bash
python -m pytest -q
node --check app/static/app.js
node --check app/static/storage.js
node --check app/static/preferences.js
node --check app/static/signin.js
node tests/test_local_storage.cjs
```
