# Glim

Glim is a Canadian financial-coaching prototype for debt repayment, savings habits, and financial literacy. The frontend is plain HTML, CSS, and vanilla JavaScript using Inter. FastAPI serves the pages and provides JSON endpoints for calculations and integrations. No frontend build system or database is used.

## Project structure

```text
glim/
├── app.py                    # Root FastAPI app and page routes; Vercel entrypoint
├── api.py                    # JSON API endpoints and request validation
├── templates/
│   ├── base.html             # Shared HTML shell, Inter font, and stylesheet
│   ├── index.html            # Landing page
│   ├── signin.html           # Demo sign-in page
│   └── app.html              # Main Glim application
├── public/
│   ├── css/styles.css        # Styles, themes, responsive and accessible UI
│   └── js/                   # Vanilla JS features and browser storage
├── services/
│   ├── financial_calculator.py
│   ├── financial_products.py
│   ├── financial_safety.py
│   ├── gemini_coach.py
│   ├── paypal_rewards.py
│   └── qloo_personalization.py
├── tests/
├── requirements.txt
├── vercel.json
└── .env.example
```

There are no domain-object classes or ORM models. The few Pydantic classes in `api.py` define request shapes so FastAPI can validate API input. Service modules use functions for calculations and provider calls.

## How routing works

| URL | What it returns | Purpose |
|---|---|---|
| `/` | HTML template | Landing page |
| `/signin` | HTML template | Demo sign-in |
| `/app` | HTML template | Main application |
| `/api/health` | JSON | Health check |
| `/api/session` | JSON + session cookie | Create, inspect, or clear the demo session |
| `/api/debt/plan` | JSON | Calculate repayment projections |
| `/api/coach` | JSON | Gemini coach or labelled local fallback |
| `/api/products/compare` | JSON | Compare user-entered product terms |
| `/api/rewards/recommendations` | JSON | Qloo recommendations or labelled fallback |
| `/api/rewards/claim` | JSON | Request a CAD $1.00 PayPal Sandbox payout |
| `/api/rewards/status/{payout_batch_id}` | JSON | Refresh Sandbox payout status |
| `/api/integrations/status` | JSON | Report whether credentials are configured |
| `/api/docs` | HTML | Interactive API documentation, not the product homepage |
| `/api/openapi.json` | JSON | OpenAPI schema used by the API documentation |

The `/api/` prefix separates JavaScript-to-backend JSON requests from browser page navigation. It is not a separate frontend or a Vercel deployment URL. The root `/` route always renders the Glim landing page; no rewrite sends it to API documentation.

## Data and session boundaries

- Financial records live in browser IndexedDB, scoped by demo email. Glim does not use SQLite or persist financial records on the server.
- Demo sign-in creates a signed, HTTP-only, eight-hour cookie. This identifies a demo profile but is not production authentication or identity verification.
- IndexedDB is not encrypted by Glim and does not sync between browsers/devices. Enter test data only; never enter passwords, full card numbers, PINs, bank credentials, or security answers.
- Users can export a local JSON backup and reset the current browser profile.
- The browser submits only the context needed for each calculation or coach response. The backend does not save the user's financial profile.

## Main features

- Debt entry, CSV import, manual balance updates, balance history, and avalanche/snowball repayment estimates.
- Savings goals, contribution tracking, learning and quiz progress.
- One financial coach interface shared by the Debt, Savings, and Financial Literacy sections.
- Comparisons calculated from financial-product terms entered by the user. Glim does not fabricate live rates or offers.
- Optional Qloo-based non-financial reward ideas.
- PayPal Sandbox payout request and status refresh. Reward evidence is client-entered for demonstration and is not independently verified.
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

Open `http://127.0.0.1:8000`. The first page is Glim's landing page. The interactive API docs live at `http://127.0.0.1:8000/api/docs`.

For local demo sessions, the app uses a documented development signing-key fallback if `GLIM_SESSION_SECRET` is absent. For Vercel, set a randomly generated `GLIM_SESSION_SECRET` environment variable. Never use the local fallback in production.

## Vercel deployment

- Vercel detects the FastAPI instance named `app` in the root-level `app.py`; no `main.py` shim or `pyproject.toml` entrypoint is needed.
- Vercel automatically serves files under `public/` as static assets. During local development, FastAPI mounts the same CSS and JavaScript paths.
- `vercel.json` includes `templates/**` in the Python function because Jinja2 loads those HTML files at runtime.
- No rewrite points the deployment URL to `/api/docs` or `/api/openapi.json`. Vercel's deployment URL opens `/` and therefore the landing page.
- Set secrets in Vercel Project Settings → Environment Variables. Do not commit `.env` or put API keys in JavaScript.

## External integrations

Configure only the providers that you will test:

- `GEMINI_API_KEY` and optional `GEMINI_MODEL` for the coach.
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_ENV=sandbox` for Sandbox payout requests.
- `QLOO_API_KEY` for optional reward personalization.

No provider integration is considered live-tested until it has been called successfully with valid credentials. The PayPal module deliberately blocks live payouts.

## Tests

```bash
pytest -q
for f in public/js/*.js; do node --check "$f"; done
```

The test suite covers repayment calculations, product-comparison math, page/template rendering, static-asset serving, signed demo-session behavior, API authorization, and selected integration fallbacks. Tests do not call the real Gemini, PayPal, or Qloo services.

## Remaining production work

1. Replace demo sign-in with verified authentication and account recovery.
2. Provide secure multi-device data storage only if product requirements require it, with user isolation and retention controls.
3. Add a consent-based Canadian financial-data provider before implementing automatic account connections.
4. Add a consented notification channel and scheduling infrastructure for reminders while the app is closed.
5. Add verified provider sources before offering live financial-product discovery.
6. Verify reward milestones on the server and add payout reconciliation before treating rewards as a real incentive program.
7. Complete security, privacy, and WCAG 2.1 AA audits before production use.

## References

- [FinWise design and learning reference](https://github.com/edimaudo/finWise)
- [FastAPI templates](https://fastapi.tiangolo.com/advanced/templates/)
- [Vercel FastAPI deployment](https://vercel.com/docs/frameworks/backend/fastapi)
- [Gemini API models](https://ai.google.dev/gemini-api/docs/models)
- [PayPal REST authentication](https://developer.paypal.com/api/rest/authentication/)
- [PayPal Payouts](https://developer.paypal.com/payouts/overview/)
- [Qloo API documentation](https://github.com/qloo/docs-public)
