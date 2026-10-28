# Glim

Glim is a Canadian financial coach for debt repayment, savings habits, and financial literacy. 

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


| URL | Purpose |
|---|---|
| `/health` | Health check |
| `/session` | Create, inspect, or clear the signed demo session |
| `/debt/plan` | Calculate debt repayment scenarios |
| `/coach` | Gemini coach or labelled local fallback |
| `/products/compare` | Compare user-entered financial-product terms |
| `/rewards/recommendations` | Qloo recommendations or labelled fallback |
| `/rewards/claim` | Submit a CAD $1.00 PayPal Sandbox payout request |
| `/rewards/status/{payout_batch_id}` | Refresh a Sandbox payout status |
| `/integrations/status` | Report which provider credentials are configured |

These action routes are needed because API secrets must stay on the server. The browser should not call Gemini or PayPal directly with private credentials. They return JSON but are not the application's page URLs. Public OpenAPI documentation is disabled, including `/docs`, `/redoc`, and `/openapi.json`.


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

For local demo sessions, a development signing-key fallback is used if `GLIM_SESSION_SECRET` is absent. Set a strong, random `GLIM_SESSION_SECRET` in Vercel before deploying. Never use the local fallback in production.

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
