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

The main navigation has six destinations: Overview, Debt plan, Savings, Smart Strategy, Settings, and Help. Overview combines current debt and savings balances with a suggested allocation. Debt plan contains debt entry, Smart Strategy, alternative repayment approaches, payoff estimates, and the payment visualization. Savings manages the current savings balance and named goals. Smart Strategy exposes the repayment explanation, plan-guidance assistant, and connected payment-activity review. Settings contains budget, connection, reminder, and data controls. Help includes an app walkthrough and answers to common questions.

## Integration status and deployment gates

### Storage, sign-in and account isolation

`GLIM_STORAGE_MODE=localStorage` remains the default. In this mode profile data stays in the current browser, email entry is only a local profile selector, and server/payment API routes are disabled. Use `GLIM_STORAGE_MODE=database` to enable the API: it sends one-time sign-in links through SMTP, stores magic-link/session secrets as SHA-256 digests, and keeps each account's financial state in a separate SQLite tenant file. The master database stores authentication, PayPal callback correlations and shared squad membership.

SQLite must live on durable writable storage. Do not run this mode on an ephemeral serverless filesystem, or across several app instances without a shared database/migration strategy. A production managed Postgres adapter is not included in this codebase, so select a host with a persistent volume for the current SQLite implementation. In production, `APP_ENV=production` requires HTTPS in `APP_PUBLIC_URL` and an SMTP connection for verified email sign-in.

### PayPal Sandbox and financial ledger

The server-side flow includes Vault setup-token consent and exchange, Orders, capture, Payouts, callback-state verification, webhook signature verification, reconciliation and idempotent request references. A daily approval creates an accrued ledger item; **it does not change savings or debt balances**. Balances update only after PayPal confirms the payout batch. Uncertain outcomes pause new transfers until the existing settlement is reconciled; a second batch cannot start while a prior settlement is unresolved. The app validates payout recipients before capture, checks that debt payments do not exceed a debt's remaining balance, and keeps provider token identifiers out of API state and data exports.

Configure `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_STASH_EMAIL`, `PAYPAL_LENDER_EMAIL`, and an externally reachable HTTPS `APP_PUBLIC_URL`. Register the webhook with PayPal Sandbox and configure its matching ID. Automated tests exercise request construction, token handling and settlement safeguards, but they do not substitute for an end-to-end run with your own PayPal Sandbox business/personal accounts and webhook configuration.

Scout only analyzes activity returned by the connected PayPal reporting API. It does not invent missing recurring payments or imply that PayPal reporting represents every bank or credit-card transaction. Debt suggestions remain pending until the user confirms the balance, rate and payment details.

### Debt reminders, payment tracking, and savings goals

- Debt records support credit cards, lines of credit, personal/student/auto loans, mortgages, buy-now-pay-later, medical bills, tax debt, payday loans and other obligations. Balances, APRs, minimum payments and due days are entered from the user's latest statement. Glim intentionally does not ask for a full card number: PayPal APIs handle payment processing and PayPal-account transaction history, not the issuer's credit-card statement balance, APR or minimum due based on a card number. Importing those issuer details would require a separately authorized issuer/open-finance connection.
- Debt reminders have Zen, Direct and Adaptive modes. Direct messages show estimated interest based on entered balances and APRs; Zen messages refer to the next entered due date. Adaptive wording responds to reminder feedback. Daily caps, quiet hours and ignore backoff are enforced. Actual notification delivery beyond in-app mode remains dependent on configured delivery channels.
- Users can record a debt payment, reduce Glim's tracked balance, and track whether entered minimums were met by the entered due day. Payment entries are user-reported and not independently confirmed by the lender, so statement balances should be refreshed when interest or fees post. The otter grows with recorded on-time streaks; shells earned through consistency can be used for otter accessories.
- The payment visualization projects total entered debt over 24 months using the selected repayment strategy and compares it with minimum payments only. It is an estimate based on entered balances, APRs, minimums and the current plan, not a live lender balance chart.
- Savings includes percentage-of-income monthly scheduling for a defined duration, named goals, recorded contributions and a monthly goal streak. Browser-only mode stores the schedule as a reminder. Server-backed execution can only be tested with an explicitly authorized sandbox funding source and configured payout recipient; it moves no real money.
- The charity form is a test flow only. In server-backed sandbox mode it demonstrates test funding and a recipient payout; it does not make a real donation, and the displayed savings balance is only Glim's planning figure. The existing basic Payouts integration does not support eGift cards; PayPal documents eGift cards as an Enterprise Payouts capability, so the gift-card reward has not been built.

### Guidance assistant and deterministic specialist tools

The Smart Strategy page exposes repayment recommendations, plain-language plan guidance, and payment-activity review. `GeminiAdapter` supports bounded function calling with allow-listed tools for the financial snapshot, deterministic payoff comparisons, what-if calculations, Scout activity, Sage lessons, habit progress, check-in preferences and settlement status. The model cannot initiate, approve, capture or retry a payment; those operations remain behind explicit app controls. When the guidance service is unconfigured or its response fails validation, Glim uses deterministic Python guidance. Tool calls and financial actions are recorded in the per-user audit log, with provider token values redacted from the browser-facing audit and export.

The default browser-only mode does not call the server assistant or retrieve external payment activity. It uses local repayment calculations and built-in rule-based answers. Connected transaction review requires database/server mode plus configured account credentials. The currently implemented payment connector uses a test environment and does not read a user's live payment account history or move real money.

Set `GEMINI_API_KEY` and, when necessary, `GEMINI_MODEL`. The example environment defaults to `gemini-3.8-flash`; verify that the model is available to your API key before enabling it ([Google Gemini API model catalogue](https://ai.google.dev/gemini-api/docs/models)). The specialist roles share deterministic service functions rather than running as five independent autonomous agents.

### P1 notifications, progression, squads and data controls

In database mode, the hourly worker applies the standing-rule daily allocation, schedules at most one check-in per user-local calendar day during the 09:00–19:59 delivery window, runs weekly settlement checks, and reconciles stale PayPal outcomes. Scheduled check-ins respect the configured time zone, quiet hours, daily cap, and ignore backoff. Email requires `SMTP_HOST` plus a sender address; web push requires `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and a browser subscription. These external channels are only enabled when configured.

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
