# Glim

Glim is a Canadian financial-coaching and literacy prototype focused on debt repayment, savings goals, and informed financial decisions. The frontend is plain HTML, CSS, and vanilla JavaScript using Inter. FastAPI serves the pages and provides stateless calculations and server-side integration calls. There is no frontend build step.

> **Prototype boundary:** Demo sign-in does not verify a person's identity. The signed session cookie only identifies the demo profile for up to eight hours; it is not production authentication. Financial records are stored in the browser using IndexedDB, not in SQLite or another server-side database. Browser storage is not encrypted by Glim and must only contain test or non-sensitive data. Do not enter full card numbers, banking credentials, passwords, PINs, or security answers. Projections are estimates, not issuer calculations or individualized professional financial advice.

## Included

- Landing page, demo sign-in, and responsive authenticated-in-the-UI application.
- Inter typography, light/dark themes, and globally scaled small/medium/large text settings.
- Browser IndexedDB profile state for debts, manual balance history, savings goals, preferences, coaching context, learning progress, product comparisons, and reward history.
- Local JSON data export and a confirmation-protected reset for the current browser profile.
- A signed, HTTP-only, eight-hour demo session cookie. All app API endpoints other than health and session creation require the cookie. This is a prototype boundary, not identity verification.
- Debt entry, current-balance updates, CSV import, avalanche/snowball comparisons, deterministic payoff estimates, and accessible chart descriptions.
- Savings goals and progress tracking.
- Financial Literacy lessons, completion tracking, quiz progress, and a learning-focus assessment inspired by [FinWise](https://github.com/edimaudo/finWise).
- One Gemini coach interface with shared cross-section context and a clear local fallback when Gemini is not configured.
- Product comparison calculations based on terms entered by the user from official provider sources. Glim does not scrape providers or fabricate live product offers.
- Optional Qloo-based non-financial reward ideas.
- PayPal Sandbox payout submission and a batch-status refresh flow. Claims are based on client-entered demo evidence and are not independently audited.
- Smart follow-ups based on entered due dates, savings progress, reminder preferences, snoozes, dismissals, coaching tone, and whether the user acts on a prompt.

## Local setup

Requirements: Python 3.11+ recommended.

```bash
python -m venv .venv

# macOS / Linux
source .venv/bin/activate

# Windows PowerShell
# .venv\\Scripts\\Activate.ps1

pip install -r requirements.txt
cp .env.example .env
uvicorn backend.main:app --reload
```

Open `http://127.0.0.1:8000`. Enter any test name and email on the sign-in page. This is a demo identity flow only; it does not check passwords or verify that the email belongs to the person signing in.

Local development uses a known, non-production session signing key only when `GLIM_SESSION_SECRET` is absent. Generate a local secret if you want to test with a custom value:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Put that value in `.env` as `GLIM_SESSION_SECRET=...`. Never commit `.env` or put provider keys in frontend JavaScript.

## Vercel

The FastAPI app is defined in `backend/main.py`. `pyproject.toml` specifies the custom Vercel entrypoint as `backend.main:app`, so the project does not need a separate root-level `main.py` shim. `vercel.json` only specifies that `public/**` assets must be included with the Python function; it does not set the project URL or introduce a rewrite to API documentation. Vercel assigns the deployment URL. See [Vercel's FastAPI deployment guide](https://vercel.com/docs/frameworks/backend/fastapi).

Before deploying, configure `GLIM_SESSION_SECRET` as a Vercel environment variable using a newly generated random value. Do not use the local fallback in production. Add provider secrets in Vercel Project Settings → Environment Variables. The app has no SQLite usage and does not write user state to the server filesystem.

## Storage and session behavior

- **Financial data:** Stored per entered email profile in browser IndexedDB (`glim-finance`). It stays in that browser origin's storage and is not uploaded for persistence. Clearing browser data or changing browsers can remove or isolate it.
- **Demo session:** An eight-hour, signed, HTTP-only cookie carries the name/email used to select the IndexedDB profile. The cookie is not encrypted, and signing only detects tampering; it does not establish identity. HTTPS deployments set the cookie's `Secure` attribute.
- **Production gap:** A production release needs a real identity provider, verified account ownership, appropriate authorization and recovery, a privacy review, and protection/encryption appropriate to actual financial data.

## Integrations

### Gemini Flash

Set `GEMINI_API_KEY`. `GEMINI_MODEL` defaults to `gemini-3.8-flash`; set another model ID if needed. `GEMINI_API_URL` defaults to the Gemini Interactions API endpoint. The API key stays on the FastAPI server. Without a key, Glim returns an explicitly labelled demo fallback. The calculation engine remains authoritative for numeric repayment outcomes.

### PayPal Sandbox

Set `PAYPAL_ENV=sandbox`, `PAYPAL_CLIENT_ID`, and `PAYPAL_CLIENT_SECRET` using a PayPal Developer Sandbox REST app with Payouts enabled. Glim submits a fixed CAD $1.00 test payout after the user enters a milestone-eligible state in the browser. It stores the returned batch ID in IndexedDB and can request the current batch status from PayPal Sandbox. Live payouts are deliberately disabled. A submitted batch does not prove that the recipient received money, and the client-entered milestone is not an anti-fraud control.

### Qloo

Set `QLOO_API_KEY` for optional taste-based book suggestions. `QLOO_API_BASE_URL` defaults to `https://api.qloo.com`. Users can select a supported learning/non-fiction or action media-interest signal. Qloo is used only for non-financial personalization, never to decide whether a credit card or loan is suitable. When Qloo is unconfigured, Glim labels its general low-cost starter ideas as fallbacks.

### Financial product comparison

Users enter rates, fees, and promotional periods from product providers' official sources. The backend compares an estimated year-one value/cost from those entered terms. This is not a live offer search, and the result does not consider every feature, issuer rule, eligibility criterion, or reward. The app tells users to verify the terms with providers.

## CSV debt import

Import a CSV with these required headers: `name,balance,apr,minimum_payment`. Optional headers are `type,due_date`, with dates in `YYYY-MM-DD`. The file is read locally in the browser, limited to 2 MB and the first 100 data rows, then stored in IndexedDB. Seeded sample debts are removed on import; existing user-entered debts are retained and the imported rows are appended. If this is the first set of real debts, the tracked starting baseline is reset to the resulting portfolio so progress estimates are meaningful. Review each imported value against statements.

## API routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Public service health check |
| POST | `/api/session` | Issue a signed demo session cookie |
| GET | `/api/session` | Read current demo session |
| DELETE | `/api/session` | Sign out and clear the cookie |
| POST | `/api/debt/plan` | Calculate repayment plan comparisons |
| POST | `/api/coach` | Shared Gemini coach or labelled fallback |
| GET | `/api/integrations/status` | Report configured integration keys (not a live health test) |
| POST | `/api/rewards/recommendations` | Qloo suggestions or labelled fallback ideas |
| POST | `/api/products/compare` | Compare user-entered financial product terms |
| POST | `/api/rewards/claim` | Submit an eligible CAD $1.00 PayPal Sandbox payout request |
| GET | `/api/rewards/status/{payout_batch_id}` | Refresh PayPal Sandbox batch status |

The app does not expose `/api/state` or store financial state on the server. FastAPI's interactive API documentation is available at `/docs` in local development; this is API documentation, not the Glim deployment homepage.

## Tests

```bash
pytest -q
for f in public/js/*.js; do node --check "$f"; done
```

The automated suite covers repayment calculations, product-comparison math/validation, page/static-asset serving, signed demo-session behavior, API session requirements, and selected endpoint flows. It does not call real Gemini, Qloo, or PayPal services. Those integrations require credentials and live provider-side verification.

## Remaining production work

1. Replace demo sign-in with production authentication and account recovery; demo cookie signing is not authentication.
2. Move sensitive persistent financial data to a secured hosted database only if/when production requirements warrant it, with user isolation and retention rules. IndexedDB here is for this test prototype.
3. For real account connections, integrate an appropriate Canadian financial-data provider using a supported consent/authorization flow. Credit-card numbers are not an account connection method.
4. For reminders while the user is away from Glim, add an explicitly consented delivery mechanism (push, email, or SMS) and the necessary scheduling infrastructure. Current browser notifications and periodic rechecks operate only while Glim is open.
5. For product discovery, add verified, date-stamped provider sources before showing live financial offers. Current comparisons use user-entered terms only.
6. Add server-side verified milestone evidence, payout reconciliation, abuse controls, and an established funding source before treating rewards as a real incentive program.
7. Complete a formal WCAG 2.1 AA review and security/privacy assessment before any production financial use.

## References

- [Gemini API models](https://ai.google.dev/gemini-api/docs/models)
- [Gemini Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview)
- [PayPal REST authentication](https://developer.paypal.com/api/rest/authentication/)
- [PayPal Payouts overview](https://developer.paypal.com/payouts/overview/)
- [Qloo API documentation](https://github.com/qloo/docs-public)
- [Vercel FastAPI guide](https://vercel.com/docs/frameworks/backend/fastapi)
- [FinWise source](https://github.com/edimaudo/finWise)
