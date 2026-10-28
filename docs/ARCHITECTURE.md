# Glim architecture

## Overview

Glim uses plain HTML, CSS, and vanilla JavaScript. FastAPI serves Jinja2 templates and handles JSON requests. There is one root application entrypoint (`app.py`), one API router (`api.py`), and small function-based service modules. No frontend framework, ORM, database, or domain class hierarchy is used.

## File responsibilities

- `app.py`: creates the FastAPI application, renders page templates, mounts CSS/JS locally, and includes the API router. Vercel detects this root-level entrypoint automatically.
- `api.py`: defines `/api/*` JSON endpoints, request validation schemas, and the signed demo session flow.
- `templates/base.html`: shared HTML document structure, Inter, and stylesheet reference.
- `templates/index.html`, `signin.html`, `app.html`: the landing page, sign-in page, and authenticated-in-the-UI application.
- `public/css` and `public/js`: static presentation and browser behavior. JavaScript uses IndexedDB for user financial data.
- `services/financial_calculator.py`: deterministic debt calculations.
- `services/financial_products.py`: comparison calculations for user-entered terms.
- `services/financial_safety.py`: shared coach principles and local fallback.
- `services/gemini_coach.py`: Gemini request adapter.
- `services/paypal_rewards.py`: PayPal Sandbox payout and status adapters.
- `services/qloo_personalization.py`: non-financial reward ideas.

The request schemas in `api.py` are Pydantic validation models, not application-domain classes. They define acceptable input shapes and limits for HTTP requests.

## Page URLs versus API URLs

The browser page URLs are `/`, `/signin`, and `/app`; each returns an HTML template. JavaScript calls `/api/*` endpoints when it needs server-side calculations or third-party integrations. Those endpoints return JSON and do not replace the pages. The interactive API documentation is at `/api/docs`, and its schema is at `/api/openapi.json`; neither is the application's root URL.

## Data flow

1. The sign-in page posts a name and email to `/api/session`.
2. The API signs the demo profile into an HTTP-only eight-hour cookie. This is a demo identifier, not production authentication.
3. The browser opens an IndexedDB profile scoped by the email and stores balances, goals, preferences, reminders, learning progress, and payout history locally.
4. When the user requests a repayment projection, JavaScript sends the minimum debt context to `/api/debt/plan`. The calculator validates it and returns estimates; it does not save the input.
5. Coach requests send the current question and context to `/api/coach`. Gemini explains validated context or a clearly labelled local fallback responds when not configured.
6. PayPal calls use Sandbox only. Reward eligibility evidence is browser-entered and is not independently verified in this prototype.

## Storage and security boundaries

- No SQLite database or server-side financial-profile storage exists.
- IndexedDB is browser-local, not encrypted by Glim, and doesn't sync to another device.
- Cookie signing detects tampering but doesn't verify a user's identity. The demo sign-in accepts user-supplied name/email.
- Provider credentials stay on the server; none are shipped in frontend JavaScript.
- Do not use full payment card numbers or banking credentials as input.

## Vercel

Vercel detects the root-level `app.py` and the exported `app` object. `vercel.json` ensures `templates/**` are included in the function bundle. CSS and JavaScript files live under `public/`. No custom rewrite is configured, so the deployment URL resolves to `/` and renders `templates/index.html`.

## Current limits

This is a hackathon prototype. Production login, multi-device user data persistence, connected financial accounts, provider-verified product offers, scheduled background reminders, independently verified payout eligibility, and a formal accessibility/security audit remain future work.
