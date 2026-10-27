# Glim architecture

## Principles

- Plain HTML, CSS, and vanilla JavaScript; FastAPI serves the frontend assets without a frontend build step.
- Inter is the application font, with accessible light/dark themes and global text scaling.
- Repayment and product calculations are deterministic Python code, separate from Gemini's natural-language explanations.
- Financial records stay in browser IndexedDB for the prototype. Users can export a local JSON backup and explicitly reset the current browser profile. No SQLite database, `/api/state` endpoint, or server-side financial profile storage exists.
- A signed, HTTP-only, eight-hour cookie identifies the current demo profile. It does not authenticate or verify the person's identity.
- Third-party API credentials remain on the backend. PayPal calls are limited to Sandbox.

## Data flow

On sign-in, the browser POSTs the chosen demo name/email to `/api/session`. FastAPI signs the payload into an HTTP-only cookie. JavaScript then opens that email's IndexedDB profile in the browser. When the app loads, `/api/session` confirms the signed session; financial state is read from IndexedDB and written back to IndexedDB after changes. No financial state endpoint is exposed by FastAPI.

The frontend sends the minimum working context for individual requests to `/api/debt/plan` and `/api/coach`. The debt planner calls `backend/financial_calculator.py`; `financial_safety.py` builds shared coaching guidance; `gemini_coach.py` calls the Gemini Interactions API or returns a labelled local fallback. These request-scoped inputs are used to respond to that request and are not persisted server-side by Glim.

`financial_products.py` compares user-entered product terms without inventing live offers. `qloo_personalization.py` suggests non-financial rewards. `paypal_rewards.py` submits Sandbox payouts and checks batch status. A payout batch ID and status are saved in the user's browser profile for the demo history.

## Security boundaries

- All app API endpoints other than `/api/health` and the session-creation route require the signed demo cookie.
- Cookie signing prevents payload tampering, but the payload is not encrypted and the sign-in flow allows arbitrary demo identities. This is not production authentication.
- Browser IndexedDB is not encrypted by Glim. Anyone with access to the same browser profile/origin could inspect or remove data; only demo/non-sensitive data should be entered.
- Client-entered balances and reward evidence are not independently verified. A sandbox milestone is not production fraud control.
- No card numbers or bank credentials are requested or needed.

## Financial calculation assumptions

Repayment estimates apply monthly APR/12 interest and entered minimum payments, with extra budget allocated according to avalanche or snowball priority. Real issuers may calculate interest, minimum payments, fees, and promotional rates differently. Product comparisons use the balance, annual fees, monthly fees, rate, and promotional terms supplied by the user. Both outputs are estimates and display their assumptions.

## Reminders

The app determines a suggested next action from entered due dates, savings goals, and recent coaching activity. Frequency is adjusted based on stated settings, whether reminders were dismissed, and whether the user acts on a prompt. Browser notifications and rechecks operate while the app is open; no server-side scheduled delivery exists.

## Vercel deployment

Vercel's custom entrypoint is `backend.main:app`, configured in `pyproject.toml`. `vercel.json` includes `public/**` assets with the Python function. There is no root-level entrypoint shim and no API documentation rewrite. Vercel supplies the deployment URL. A production environment must set a randomly generated `GLIM_SESSION_SECRET` plus any provider credentials used.

## Known limits

- Sign-in is demo-only, with no verified identity, password, recovery, or user-management system.
- Financial records are browser-local and can be lost if browser data is cleared or the user changes browsers/devices.
- Bank/card connections and live product discovery are not implemented.
- External Gemini, Qloo, and PayPal operations are not considered live-verified until tested with actual credentials.
- No push/email/SMS reminder delivery is scheduled in the background.
- Reward evidence is user-entered and not independently authenticated.
- WCAG 2.1 AA is the target; a full audit is still required.
