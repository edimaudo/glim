# Glim

Glim is a FastAPI personal-finance app for coordinating debt repayment, savings goals, and monthly cash flow. Financial estimates use entered or imported data and are presented as projections, not lender quotes.

## Main navigation

The app has six destinations: **Overview**, **Debt plan**, **Savings**, **Insights**, **Settings**, and **Help**.

- **Overview** summarizes active debt, savings balance, the selected repayment strategy, and the payment streak.
- **Debt plan** groups debt entry, repayment strategies, and payment progress into tabs. Smart Strategy is part of debt and savings planning, not a standalone section.
- **Savings** groups goals, the savings plan, contributions, and giving into tabs. Giving appears only after at least one savings goal is complete. The otter pup is a decorative progress companion; there is no points currency, accessory shop, or reward system. Payment and savings streaks remain.
- **Insights** has five tabs: **Cash flow**, **What-if planner**, **Calendar**, **Reports**, and **Import & reconcile**. It supports manual income/expense entries, CSV import with duplicate detection, scenario comparisons for income/expense changes, extra or lump-sum payments, unexpected costs and APR changes, debt/savings calendar reminders, six-month reports, optional bank transaction syncing, and lender-statement reconciliation.
- **Settings** manages reminders and preferences. **Help** includes a six-step app walkthrough.

## Canada defaults

Glim defaults to Canada (`CA`), Canadian dollars (`CAD`), and `America/Toronto`. Amounts throughout the interface are formatted in CAD.

## Storage, sign-in, and account isolation

The default `GLIM_STORAGE_MODE=indexedDB` stores browser-local financial state and UI preferences in IndexedDB. A one-time compatibility migration reads prior app data from IndexedDB and moves it into IndexedDB; the old stored keys are then removed. In IndexedDB mode, email entry is a local profile selector, not verified authentication, and server payment/bank APIs are unavailable.

Use `GLIM_STORAGE_MODE=database` to enable verified email-link sign-in, isolated per-user SQLite data, PayPal Sandbox, and optional direct bank connections. Configure SMTP for verified sign-in and use durable writable storage for the SQLite database and tenant files. Do not use an ephemeral or read-only serverless filesystem for this mode. A managed Postgres adapter is not included.

## PayPal Sandbox: Canada / CAD

The existing PayPal integration uses PayPal's Sandbox API and is configured for country `CA` and currency `CAD`. It includes consent/token exchange, supported payment operations, callback-state verification, webhook signature verification, reconciliation, idempotency, and safeguards for unresolved transfers. A tracked balance is not updated merely because a transfer was requested; the confirmed provider outcome is required.

To exercise it, use `GLIM_STORAGE_MODE=database`, set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_STASH_EMAIL`, `PAYPAL_LENDER_EMAIL`, and an externally reachable HTTPS `APP_PUBLIC_URL`, then configure the matching webhook in the PayPal Developer Dashboard. Use Sandbox business and personal accounts. Credentials and a provider round trip are required for a true end-to-end test; automated tests only verify request construction and safety rules.

PayPal's developer documentation lists Canada as eligible for payouts and payment-method vaulting, with local-currency support for payouts. Certain payment capabilities still depend on account eligibility and the relevant Sandbox app features being enabled. Verify Vault/save-payment-method capability in the Developer Dashboard before exercising that path: [PayPal supported payout features](https://developer.paypal.com/payouts/supported-features/) · [PayPal save payment methods](https://developer.paypal.com/docs/checkout/save-payment-methods/).

## Canadian bank connections and lender reconciliation

CSV transaction import and statement reconciliation are available without a bank connection. Optional direct bank syncing uses Plaid Link with Canada selected as the country and requests transaction data. It requires `GLIM_STORAGE_MODE=database`, `PLAID_CLIENT_ID`, `PLAID_SECRET`, and a valid `PLAID_TOKEN_ENCRYPTION_KEY` (a Fernet key); tokens are encrypted before being stored. Set `PLAID_ENV=sandbox` for integration testing. Production institution and product coverage must be checked with the provider; not every institution supports every data product, and liability coverage in Canada is limited. No bank password is collected by Glim.

For lenders, the user can compare a statement balance with the tracked debt and explicitly choose whether to apply statement values. Bank transaction sync does not itself prove a lender balance or automatically reduce a debt. CSV imports and recorded payment activity are labelled by source; reports do not infer missing history.

Canadian consumer-driven banking (open banking) is still moving through its federal framework implementation. This optional Plaid integration uses Plaid's supported connections; it should not be described as a connection to a generally available, universal Canadian open-banking API. See the [Government of Canada's consumer-driven banking overview](https://www.canada.ca/en/financial-consumer-agency/services/banking/open-banking.html) and [Plaid's Canada product coverage](https://support.plaid.com/hc/en-us/articles/27895826947735-What-Plaid-products-are-supported-in-each-country-and-region).

## Financial calculations and data quality

The What-if planner calculates payoff estimates against current debt entries and the entered income/expense baseline. It can model:

- extra recurring monthly debt payments;
- monthly income and expense changes;
- a one-time unexpected expense, including the portion that exceeds the recorded savings buffer;
- a one-time lump-sum debt payment; and
- changes in APR percentage.

The calendar combines entered debt due days, scheduled savings, goal contribution targets, and a monthly budget-review reminder. Reports show recorded income, expenses, debt payments, savings contributions, current balances, and estimated interest avoided where the current repayment projection provides that value. Historical balances are not invented when older snapshots are unavailable.

Imported transactions are deduplicated using date, amount, and description. Reconciliation records show the tracked balance, statement balance, variance, statement date, and whether the user applied the updated value.

## Preferences, accessibility, and appearance

The 90%, 100%, and 112% font control scales the page's text and interface elements together. Light/dark mode and walkthrough-completion preferences are stored in IndexedDB. Action buttons use shared sizing, corner radius, type, and focus-visible treatment. The interface is responsive and includes keyboard-focus styling.

## Run locally

```bash
python -m pip install -r requirements.txt
uvicorn app.main:app --reload
```

To test server integrations, configure `.env` from `.env.example`, switch `GLIM_STORAGE_MODE=database`, set a durable `DATABASE_PATH` and `GLIM_USER_DATA_DIR`, and configure Sandbox/provider credentials. Do not switch live financial traffic to production credentials without validating the relevant account eligibility, webhook round trip, and reconciliation behavior.

## Tests

```bash
python -m pytest -q
node --check app/static/app.js
node --check app/static/storage.js
node --check app/static/preferences.js
node --check app/static/signin.js
node tests/test_local_storage.cjs
```
