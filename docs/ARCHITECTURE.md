# Glim architecture

## Guiding structure

Glim uses HTML, CSS, and vanilla JavaScript. FastAPI serves Jinja templates and handles server-side actions. The design is deliberately small:

- `app.py` is the single backend entrypoint. It contains the page handlers, session handling, small input-validation helpers, and feature-action routes.
- `templates/` contains the three pages and shared `base.html` shell.
- `public/css/` and `public/js/` contain static browser assets.
- `public/js/client.js` sends same-origin requests to the action routes.
- `services/` contains small functions for repayment calculations, product comparisons, Gemini, PayPal, and Qloo.
- Browser financial data remains in IndexedDB; the server does not persist it.

No `backend/` directory, separate `api.py`, ORM, or application-domain class hierarchy is used. Incoming JSON is validated by small functions in `app.py`; the implementation does not define a set of Pydantic request classes.

## URLs

HTML pages:

- `/` renders `templates/index.html`.
- `/signin` renders `templates/signin.html`.
- `/app` renders `templates/app.html`.

Server actions use descriptive same-origin paths with no `/api` prefix:

- `/session`
- `/debt/plan`
- `/coach`
- `/products/compare`
- `/rewards/recommendations`
- `/rewards/claim`
- `/rewards/status/{payout_batch_id}`
- `/integrations/status`
- `/health`

These paths return JSON for browser JavaScript operations. They are not the site's landing-page or deployment URLs. The public OpenAPI documentation and schema routes are disabled; `/docs`, `/redoc`, and `/openapi.json` are not served. The deployed root `/` renders Glim's landing page.

## Data flow

1. The user enters a display name and email on `/signin`.
2. The browser posts to `/session`, which sets a signed HTTP-only eight-hour demo cookie. This is only a demo identifier, not real authentication.
3. The browser stores debt, savings, preferences, reminders, learning progress, and payout history in IndexedDB under that profile's email.
4. Repayment requests send only current debt inputs and a monthly budget to `/debt/plan`; the deterministic calculator returns estimates and does not save the records.
5. Coach requests send the current question and relevant user context to `/coach`. Gemini explains and coaches around the provided facts or a clearly labelled local fallback responds when the model is not configured.
6. PayPal credentials remain server-side; the integration only permits Sandbox payout operations. Reward evidence is client-entered for the demo and is not independently verified.

## Deployment

`app.py` exports a FastAPI instance named `app` at the project root. Vercel serves `public/` static assets and bundles `templates/**` for server-side rendering. No URL rewrite is defined. The deployed root URL serves `templates/index.html`, not API documentation. The config has no OpenAPI schema reference and no route to documentation.

## Limitations

The prototype is not production authentication. Browser-local data is not encrypted by Glim and does not sync across devices. Production login, secure data synchronization, connected financial accounts, provider-verified offers, scheduled reminders, independently verified reward eligibility, and formal security/accessibility reviews remain future work.
