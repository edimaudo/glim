# Glim

Glim is a Canadian financial-coaching prototype for debt repayment, savings habits, and financial literacy. The frontend uses plain HTML, CSS, and vanilla JavaScript with Inter. FastAPI serves the page templates and handles the small set of server-side actions that need financial calculations or external provider credentials.

## Project structure

```text
glim/
├── app.py                    # Single FastAPI entrypoint, page routes, action handlers
├── templates/
│   ├── base.html             # Shared HTML shell, Inter, and stylesheet reference
│   ├── index.html            # Landing page
│   ├── signin.html           # Demo sign-in page
│   └── app.html              # Main application
├── public/
│   ├── css/styles.css        # Responsive styles, themes, accessible interface
│   └── js/
│       ├── client.js         # Browser-to-server request helper
│       ├── storage.js        # IndexedDB state storage
│       ├── main.js           # App navigation and orchestration
│       ├── debt.js           # Debt entry and repayment-plan UI
│       ├── savings.js        # Savings goals
│       ├── literacy.js       # Learning and quiz progress
│       ├── product-compare.js
│       ├── settings.js
│       └── signin.js
├── services/                 # Small function-based financial/provider operations
├── tests/
├── requirements.txt
├── vercel.json
└── .env.example
```

There is no `backend/` directory, no separate `api.py`, no ORM, no application-domain class hierarchy, and no request-model class hierarchy. `app.py` is the single backend entrypoint. The HTML pages are Jinja templates so they can share `base.html`; the browser-side interaction remains vanilla JavaScript.

## Page URLs and server actions

Page navigation returns HTML:

| URL | Purpose |
|---|---|
| `/` | Landing page |
| `/signin` | Demo sign-in |
| `/app` | Main application |
| `/{unknown-page}` | Branded 404 template with HTTP 404 status |

JavaScript calls the following same-origin server action routes when a trusted backend operation is required. These paths deliberately do **not** use an `/api` prefix:

| URL | Purpose |
|---|---|
| `/health` | Health check |
| `/session` | Create, inspect, or clear the signed demo session |
| `/session/status` | Check whether demo sessions are configured |
| `/debt/plan` | Calculate debt repayment scenarios |
| `/coach` | Gemini coach or labelled local fallback |
| `/products/compare` | Compare user-entered financial-product terms |
| `/rewards/recommendations` | Qloo recommendations or labelled fallback |
| `/rewards/claim` | Submit a CAD $1.00 PayPal Sandbox payout request |
| `/rewards/status/{payout_batch_id}` | Refresh a Sandbox payout status |
| `/integrations/status` | Report which provider credentials are configured |

These action routes are needed because API secrets must stay on the server. The browser should not call Gemini or PayPal directly with private credentials. They return JSON but are not the application's page URLs. Public OpenAPI documentation is disabled, including `/docs`, `/redoc`, and `/openapi.json`.

## Data and session boundaries

- Financial records live in browser IndexedDB, scoped by demo email. Glim does not use SQLite or persist financial records on the server.
- Demo sign-in creates a signed, HTTP-only, eight-hour cookie. It identifies a demo profile but is not production authentication or identity verification.
- IndexedDB is not encrypted by Glim and does not sync between browsers/devices. Use test information only. Never enter passwords, full card numbers, PINs, bank credentials, or security answers.
- Users can export a local JSON backup and reset the current browser profile.
- The browser submits only the context needed for each calculation or coach response. The backend does not save the user's financial profile.

## Design pass

The interface uses Inter throughout with a restrained neutral surface palette and a consistent green accent. Redundant all-caps eyebrow labels and decorative number/icon treatments were removed, hero dashboard decoration was simplified, gradients and shadows were reduced, and secondary text was raised for readability. The mobile overview places two headline metrics side by side and the monthly budget on its own row to avoid cramped labels. Light remains the default; dark mode uses charcoal-neutral surfaces rather than a green-tinted page.

## Main features

- Debt entry, CSV import, manual balance updates, balance history, and avalanche/snowball repayment estimates.
- Savings goals, contribution tracking, learning and quiz progress.
- One financial coach interface shared by Debt, Savings, and Financial Literacy.
- Comparisons calculated from financial-product terms entered by the user. Glim does not fabricate live rates or offers.
- Optional Qloo-based non-financial reward ideas.
- PayPal Sandbox payout request and status refresh. Reward evidence is entered in the browser and is not independently verified.
- Adaptive in-app follow-ups, light/dark themes, and small/medium/large global text scaling.

Repayment outputs are estimates based on submitted balances, APRs, minimum payments, and budget. They may differ from lender calculations. The app provides financial education, not regulated financial advice.

## Run locally

Python 3.11+ recommended.

```bash
python -m venv .venv

# macOS / Linux
source .venv/bin/activate

# Windows PowerShell
# .venv\\Scripts\\Activate.ps1

pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app:app --reload
```

Open `http://127.0.0.1:8000`. The landing page is `/`. There is no OpenAPI documentation route in this prototype.

For local demo sessions, a development signing-key fallback is used if `GLIM_SESSION_SECRET` is absent. On Vercel, sessions deliberately fail closed if this secret is missing; the application will not silently use a predictable key. To configure it, generate a secret locally with `python -c "import secrets; print(secrets.token_urlsafe(48))"`, add it as `GLIM_SESSION_SECRET` under Vercel Project Settings → Environment Variables for the Production environment (and Preview if needed), then redeploy. Do not commit the value or send it in source code. The sign-in page checks `/session/status` and displays a helpful configuration message instead of revealing a raw server error.

## Vercel deployment

- The root-level `app.py` exports the FastAPI instance named `app`.
- The deployment URL opens `/`, which renders the landing page. No rewrite directs it to docs or a JSON schema.
- Vercel detects the root `app.py` FastAPI app. The minimal `vercel.json` includes `templates/**` in the function bundle for Jinja rendering.
- Vercel serves files under `public/` from its CDN. `app.py` does not mount `public/` by default, even if Vercel-specific environment variables are absent. Only `run.sh` sets `GLIM_LOCAL_STATIC=1`, and mounts are added only for local development when each directory exists. Do not set `GLIM_LOCAL_STATIC` in Vercel.
- Set secrets in Vercel Project Settings → Environment Variables. Do not commit `.env` or put provider keys in JavaScript.

## External integrations

Configure only the providers that you intend to test:

- `GEMINI_API_KEY` and optional `GEMINI_MODEL` for the coach.
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_ENV=sandbox` for Sandbox payout requests.
- `QLOO_API_KEY` for optional reward personalization.

No provider integration is considered live-tested until it has been called successfully with valid credentials. The PayPal module deliberately blocks live payouts.

## Tests

```bash
pytest -q
for f in public/js/*.js; do node --check "$f"; done
```

The test suite covers repayment calculations, product-comparison math, page/template rendering, static assets, session behavior, route authorization, validation, and provider fallback behavior. Tests do not call the real Gemini, PayPal, or Qloo services.

## Remaining production work

1. Replace demo sign-in with verified authentication and account recovery.
2. Add secure multi-device storage only if required, with user isolation and retention controls.
3. Integrate a consent-based Canadian financial-data provider before implementing account connections.
4. Add a notification channel and scheduler for reminders while the app is closed.
5. Verify provider sources before offering live financial-product discovery.
6. Verify reward milestones on the server and add payout reconciliation before launching a real incentive programme.
7. Complete security, privacy, and WCAG 2.1 AA audits before production use.

## References

- [FinWise learning reference](https://github.com/edimaudo/finWise)
- [FastAPI templates](https://fastapi.tiangolo.com/advanced/templates/)
- [Vercel FastAPI deployment](https://vercel.com/docs/frameworks/backend/fastapi)
- [Gemini API models](https://ai.google.dev/gemini-api/docs/models)
- [PayPal REST authentication](https://developer.paypal.com/api/rest/authentication/)
- [PayPal Payouts](https://developer.paypal.com/payouts/overview/)
- [Qloo API documentation](https://github.com/qloo/docs-public)
