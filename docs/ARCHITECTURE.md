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

## Static assets

On Vercel, no `StaticFiles` mount is registered. Files under the project-level `public/` directory are served by the Vercel CDN. For local Uvicorn development, `run.sh` explicitly sets `GLIM_LOCAL_STATIC=1`; only then does the app mount `/css` and `/js`, and only when each directory exists. The app does not rely on Vercel-specific environment variables to decide whether to mount, so a missing runtime marker cannot accidentally activate a mount in a serverless function.

## Deployment

`app.py` exports a FastAPI instance named `app` at the project root. Vercel serves files under `public/` directly through its CDN and bundles `templates/**` for server-side rendering. FastAPI mounts `/css` and `/js` only during local development and only when each directory exists. On Vercel the app does not try to mount these directories, because they are not guaranteed to be present in the function bundle. No URL rewrite is defined. The deployed root URL serves `templates/index.html`, not API documentation. The config has no OpenAPI schema reference and no route to documentation.

## Limitations

The prototype is not production authentication. Browser-local data is not encrypted by Glim and does not sync across devices. Production login, secure data synchronization, connected financial accounts, provider-verified offers, scheduled reminders, independently verified reward eligibility, and formal security/accessibility reviews remain future work.


## PayPal's role across Glim

PayPal is used in the Debt Management and Savings user journeys, with a shared guardrail before any Sandbox payout. The Debt section checks the recorded 10% debt-reduction milestone; Savings checks whether a tracked goal reached its target; Overview reconciles payout status from PayPal. The backend fixes the prototype payout amount to CAD $1.00. User-entered milestone data is not independently verified, so this is a hackathon demonstration rather than production fraud control.

PayPal is not described as paying arbitrary credit-card bills or retrieving external card balances. Its standard Orders API is merchant checkout and its Payouts API sends funds to recipients. Glim's payment planner calculates a plan and users still confirm bill payments through their creditor's own payment channel unless the creditor provides a supported PayPal checkout.
