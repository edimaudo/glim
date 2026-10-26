# Glim architecture notes

## Principles

- Use plain HTML/CSS/vanilla JavaScript for the web UI; FastAPI serves the files directly.
- Keep calculations deterministic and separate from natural-language generation.
- Keep third-party credentials on the server.
- Treat all user-entered financial values as unverified inputs.
- Make the demo fallback behavior explicit when external keys are absent.
- Keep all reward payment calls pinned to PayPal Sandbox.

## State flow

The browser loads state from `/api/state`. The prototype stores a single demo state JSON document in SQLite. Financial planning requests are sent to `/api/debt/plan`, which uses `backend/financial_calculator.py`. The shared coach request sends user-entered debt/savings context and preferences to `/api/coach`; `financial_safety.py` constructs common coaching guidance and `gemini_coach.py` either calls Gemini or returns a clearly labelled fallback. Qloo's recommendation adapter is isolated in `qloo_personalization.py`. PayPal payout submission is isolated in `paypal_rewards.py`.

## Data and safety boundaries

The debt calculator uses the formula `monthly interest = current balance × APR / 12` as an estimate. It pays entered minimums first and allocates any additional budget by the chosen strategy. The UI explains that actual issuer calculations can differ. The AI receives the plan summary as context but does not own the repayment calculations.

The PayPal Sandbox endpoint requires a calculated plan to exist in shared demo state. This is a hackathon demonstration rule, not a trusted production measure of progress. A real reward flow would need user-level authorization, an auditable event trail, abuse controls, and a credible funding model.

## Current non-production assumptions

- Sign-in is demo-only; no password or identity verification exists.
- One shared local demo state is used; no user isolation exists.
- There is no bank/card issuer connection.
- Reminder preferences are saved, but delivery isn't scheduled.
- Provider integrations cannot be considered live-tested until credentials are supplied and Sandbox/API calls are verified.
