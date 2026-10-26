# Glim

Glim is a Canadian financial-literacy and financial-planning prototype focused on a complete debt-to-savings journey. It uses plain HTML, CSS, and vanilla JavaScript in the browser, with a Python/FastAPI backend. Inter is the application font.

> **Prototype notice:** This is a hackathon starter build, not a production financial service. Sign-in is demo-only, the SQLite state is shared by the local demo, and no financial institutions or real accounts are connected. Do not enter passwords, full card numbers, banking credentials, or other sensitive information. Financial projections are estimates. PayPal requests are hard-coded to Sandbox and must be configured before use.

## Included in this build

- Landing page, demo sign-in, and authenticated-in-the-UI app shell.
- Debt tracking for credit cards, lines of credit, loans, and other obligations.
- Deterministic repayment estimates using avalanche and snowball strategies, with comparison metrics and a debt trajectory chart.
- Savings goals, progress tracking, and contribution estimates.
- Financial Literacy lessons, glossary-style content, a quick quiz, and an assessment flow inspired by the educational structure in [FinWise](https://github.com/edimaudo/finWise).
- One shared coach interface across Glim sections. If Gemini credentials are absent, the backend uses an explicitly labelled local fallback; with credentials it calls the Gemini Interactions API.
- Optional Qloo-based book suggestions; without Qloo credentials the app shows clearly labelled low-cost starter ideas.
- Optional PayPal Payouts API flow limited to the PayPal Sandbox. The claim endpoint requires that a debt plan was calculated in the demo state.
- Persisted user-interface settings, light/dark modes, global text-size scaling, and responsive layouts.

## Quick start

Requirements: Python 3.10+ (3.11+ recommended).

```bash
cd glim
python -m venv .venv

# macOS / Linux
source .venv/bin/activate

# Windows PowerShell
# .venv\Scripts\Activate.ps1

pip install -r requirements.txt
cp .env.example .env
uvicorn backend.main:app --reload
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). The server serves the HTML and static files directly; there is no frontend build step.

To sign in, use any test name and email address. It is a demo-only flow and does not validate identity. Example data is preloaded so the repayment planner can be demonstrated immediately.

## Environment configuration

Copy `.env.example` to `.env`. Keep `.env` private and out of version control.

### Gemini

Set `GEMINI_API_KEY` from your Google AI Studio / Gemini API configuration. `GEMINI_MODEL` defaults to `gemini-3.8-flash`; change it to a model available to your account if necessary. The key is used only by FastAPI and is never sent to the browser. The app uses the Gemini Interactions API by default at `https://generativelanguage.googleapis.com/v1beta/interactions`.

### PayPal Sandbox

1. Create a REST app in the PayPal Developer Dashboard and use its Sandbox client ID and secret.
2. Confirm the app has access to the Payouts API.
3. Set `PAYPAL_ENV=sandbox`, `PAYPAL_CLIENT_ID`, and `PAYPAL_CLIENT_SECRET` in `.env`.
4. Use an eligible Sandbox recipient account email.
5. Calculate a debt plan in Glim, then use **Test reward payout** to submit a fixed CAD $1.00 Sandbox payout request.
6. Check the returned payout batch ID/status in the PayPal Developer Dashboard.

The integration calls the Sandbox OAuth endpoint and `/v1/payments/payouts`. The app deliberately refuses to run a live payout. PayPal may require additional account approval or configuration before Payouts is enabled. A request being accepted is not the same as an individual item being completed.

### Qloo

Set `QLOO_API_KEY` to enable the Qloo Insights request, and set `QLOO_API_BASE_URL` if your issued credentials use a different documented API host. The prototype requests book recommendations using an example nonfiction interest tag. Availability and accepted entity/tag IDs depend on the Qloo API account and current API schema. Results are discovery ideas, not financial-product recommendations. The interface tells users to check library availability before buying.

## Project structure

```text
glim/
├── index.html
├── signin.html
├── app.html
├── css/styles.css
├── js/
│   ├── api.js
│   ├── main.js
│   ├── signin.js
│   ├── debt.js
│   ├── savings.js
│   ├── literacy.js
│   └── settings.js
├── backend/
│   ├── main.py
│   ├── financial_calculator.py
│   ├── financial_safety.py
│   ├── gemini_coach.py
│   ├── paypal_rewards.py
│   └── qloo_personalization.py
├── tests/
├── docs/
├── data/              # local SQLite file; ignored by git
├── .env.example
├── requirements.txt
└── README.md
```

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Backend health check |
| GET / PUT | `/api/state` | Read/save shared demo state |
| POST | `/api/debt/plan` | Calculate and compare repayment plans |
| POST | `/api/coach` | Generate a shared financial-coach response |
| GET | `/api/integrations/status` | Report whether providers are configured |
| POST | `/api/rewards/recommendations` | Ask Qloo for book ideas or return labelled starter ideas |
| POST | `/api/rewards/claim` | Request a CAD $1.00 PayPal Sandbox milestone payout |
| POST | `/api/reset-demo` | Reset the stored sample state |

FastAPI interactive API documentation is available at `/docs` while the server is running.

## Tests

```bash
pytest -q
```

The calculation tests cover repayment outcomes, strategy output, invalid budgets, and minimum-payment validation. Provider calls require credentials and should be validated in the respective provider Sandbox/developer account.

## Important limitations and production work

1. **Authentication and user isolation:** The current sign-in is intentionally a UI demo. The app stores one shared demo-state record. Before deployment, implement real authentication, per-user authorization, secure session management, rate limiting, and access controls for every user-specific endpoint.
2. **Data protection:** This prototype stores user-entered data in a local SQLite database. A production version needs an appropriate privacy/security review, retention controls, encryption and access policies. Never accept card numbers or banking credentials for the current workflow.
3. **Financial data:** Accounts are added manually. Institution connections are not implemented. Any future data connection must use a provider's supported authorization and consent flow.
4. **Financial correctness:** The engine uses monthly APR/12 interest and entered minimum payments to create an estimate. Real issuers may calculate interest differently, and minimum payments may change. Add independent review and more edge-case testing before any consumer use.
5. **Notifications:** Settings capture reminder preferences but there is no email, SMS, push, or scheduled reminder delivery yet.
6. **Product comparisons:** Current account/credit-product offers are not implemented. Add verified, date-stamped provider terms before making comparisons.
7. **PayPal milestones:** The prototype verifies that a plan was calculated, not that an actual debt balance decreased. The demo milestone is not a production eligibility rule. Production rewards require a trusted, auditable eligibility process and a defined funding source.
8. **Qloo:** Book discovery is optional personalization. It does not select financial products or determine financial suitability.
9. **Accessibility:** The implementation includes semantic headings, labels, keyboard focus states, reduced-motion handling, colour themes, global text scaling, and chart text descriptions. Run a full manual and automated WCAG 2.1 AA audit before release.

## External references

- [Gemini API documentation](https://ai.google.dev/gemini-api/docs)
- [Gemini models](https://ai.google.dev/gemini-api/docs/models)
- [PayPal REST API authentication](https://developer.paypal.com/api/rest/authentication/)
- [PayPal Payouts overview](https://developer.paypal.com/payouts/overview/)
- [PayPal Create Payout Request](https://developer.paypal.com/api/payments.payouts-batch/v1/definitions/create_payout_request/)
- [Qloo public API documentation](https://github.com/qloo/docs-public)
- [FinWise reference repository](https://github.com/edimaudo/finWise)
