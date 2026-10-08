# Chipper: Product Requirements Document

*PayPal AI Hackathon, Idea 1 · Draft v1 · October 7, 2026*

## 1. Summary

Chipper is a mobile-first web app that turns paying down debt and building savings into one game. A chipmunk named Chipper stashes acorns (savings) and chips away at the Interest Ogre (a credit card or loan that regrows at its APR). A squad of AI agents reads the user's PayPal activity, builds a plan, and moves small, approved amounts through PayPal every day. The goal of the whole game is to evolve Chipper from a **Revolver** (carries a balance) into a **Transactor** (pays in full, with a buffer).

**Positioning:** Saving and debt payoff are one economy with one currency, one streak, and one level, not two features in two tabs.

## 2. Problem and opportunity

- Most credit card users are revolvers (43.8%) rather than transactors (30.4%). Figures come from the team's rationale and need a cited source before publishing.
- Debt repayment is framed as dry number-crunching, which creates avoidance. Card issuers' reminders are passive, so people drift into negligence.
- Saving needs delayed gratification. Without a buffer, a surprise expense lands on the card and undoes progress.
- Existing tools treat debt and savings separately, and their notifications are static, so users tune them out.
- **Opportunity:** Fi-style automatic daily saving plus a social, points-based incentive system that costs nothing to run, combined with agents that adapt to each person.

## 3. Goals and non-goals

**Goals**

- G1. Make the first week feel like a win (a discovery, a first drip, a visible hit on the Ogre).
- G2. Move real (sandbox) money through PayPal end to end, with user approval.
- G3. Build a notification system that measurably adapts to each user.
- G4. Make every agent action explainable and every number verifiable.
- G5. Reward consistency, not wealth, so the game is fair at any income.

**Non-goals (this release)**

- Real card-issuer integration or card-number lookup (not offered by card networks and a PCI risk).
- Real-money cosmetics, marketplaces, or pay-to-win mechanics.
- Credit score integration, financial advice, or regulated lending features.
- Native mobile apps (a responsive web app or PWA is enough).

## 4. Hackathon alignment

| Requirement | How Chipper meets it |
| --- | --- |
| Meaningful PayPal use | Vault and Orders collect the drip, Payouts disburse it, Transaction Search powers the Scout, Webhooks drive every state change |
| Meaningful AI use | Five agents with distinct tools, a learning notification engine, a what-if coach, and explainability cards |
| Working prototype | Full loop: connect, scan, plan, approve, drip, confirm, celebrate |
| Documented | This PRD, an architecture diagram naming each API and model, a README, and an agent action log |

| Judging criterion | Where it is addressed |
| --- | --- |
| Technological implementation | Multi-agent orchestration, idempotent PayPal flows, bandit-based notification learning |
| Design | One coherent game world; mascot-led UI; consistent tone guide |
| Potential impact | Targets revolver behavior with a specific audience and measurable behaviors (streaks, interest avoided) |
| Innovation | Unified savings and debt economy; shame-free adaptive nudging; behavior-based social ranking |
| Presentation | Clear problem, audience, and story arc (Revolver to Transactor) |

## 5. Users

**Primary: Revolving Riley (25 to 38).** Carries a balance on one to three cards, has irregular savings, feels dread opening statements, responds to friendly tone and quick wins.

**Secondary: Fresh-start Sam (21 to 28).** Recent graduate with a loan and a first credit card, building habits for the first time.

**Social: Invited Friend.** Joins through a squad invite, mainly motivated by friendly competition.

**Out of scope:** Users in severe financial distress. Chipper detects stress signals and shows a plain-language pointer to credit counselling resources instead of pushing a game.

## 6. Product principles

1. **One economy.** Saving and debt share currency, streak, and level.
2. **Behavior over balances.** Points reward consistency, never dollar amounts.
3. **Agents propose, code calculates, users approve.** The LLM never produces a financial figure.
4. **Never shame.** No guilt, no scolding, and nudges back off when ignored.
5. **Explain everything.** Every action has a Why card.
6. **Honest simulation.** The lender and savings pot are sandbox accounts, and the product says so.

## 7. Core concepts

| Term | Meaning | In-game form |
| --- | --- | --- |
| Drip | Small daily amount set aside | Acorns drop into the stash and a hit lands on the Ogre |
| Stash | Savings buffer | Tree hollow that fills up |
| Boss | One specific debt | Ogre with a health bar that regrows at the APR |
| Shield | Buffer covering one month of minimum payments (user adjustable) | Barrier around Chipper |
| Streak | Consecutive days a drip occurred | Flame on Chipper's tail |
| Points | Behavior reward, never convertible to cash | Spent on cosmetics |
| Squad | 3 to 6 invited friends | Shared forest and goals |
| Revolver / Transactor | Carries balance vs pays in full | Chipper's start and end state |

## 8. User journey

1. **Meet Chipper.** Conversational onboarding: goals, a debt (name, balance, APR, minimum), a savings goal as a percent of income.
2. **Connect PayPal.** One-time consent and vaulting of the funding source.
3. **First sweep.** Scout reports income pattern, forgotten subscriptions, and a safe-to-move amount.
4. **The Plan.** Tactician proposes the stash/Boss split, attack order, and milestone dates. The user adjusts and sees projections change.
5. **Daily life.** Drips accrue, Chipper checks in, the user glances at progress.
6. **Shield moment.** The first buffer is reached and Chipper evolves.
7. **Boss defeated.** Celebration, then a decision on where the freed-up payment goes (next Boss or stash).
8. **Transactor.** First full-balance payoff cycle with a funded shield.

## 9. Functional requirements

Priority: **P0** must exist for the hackathon, **P1** should, **P2** if time allows.

### E1. Onboarding and profile

| ID | Requirement | Pri |
| --- | --- | --- |
| E1.1 | Conversational onboarding capturing goals, income range, savings percent, approval mode | P0 |
| E1.2 | Account creation and sign-in (email or magic link) | P0 |
| E1.3 | Persona seed option to load dummy data (Riley, Sam) for demos and testing | P0 |
| E1.4 | Notification preference setup (quiet hours, daily cap, channels) | P1 |

### E2. PayPal connection

| ID | Requirement | Pri |
| --- | --- | --- |
| E2.1 | Connect a sandbox PayPal account and vault the funding source with explicit consent | P0 |
| E2.2 | Show connection status, scopes used, and a disconnect control | P0 |
| E2.3 | Pull transaction history for the Scout (seeded 6 months of sandbox activity) | P0 |

### E3. Bosses (debts)

| ID | Requirement | Pri |
| --- | --- | --- |
| E3.1 | Add a debt in under 30 seconds: name, type, balance, APR, minimum, due date | P0 |
| E3.2 | Debt types: credit card and loan at launch; other obligations as roadmap | P0 |
| E3.3 | Scout suggests debts it spots in activity, for the user to confirm | P1 |
| E3.4 | Boss health bar, daily interest regrowth, and balance-over-time chart | P0 |
| E3.5 | Boss defeat event and freed-payment redirect decision | P0 |

### E4. Stash (savings)

| ID | Requirement | Pri |
| --- | --- | --- |
| E4.1 | Savings goal as percent of income, converted to a daily amount | P0 |
| E4.2 | Shield threshold with progress indicator and evolution trigger | P0 |
| E4.3 | Named stash goals beyond the shield (trip, laptop) | P1 |
| E4.4 | Optional monthly auto-deposit to a savings account | P2 |

### E5. Daily Drip engine

| ID | Requirement | Pri |
| --- | --- | --- |
| E5.1 | Daily drip calculated by deterministic code from income, goal percent, safe-to-move amount, and the floor balance | P0 |
| E5.2 | Split between Stash and Boss using the user's ratio (default stash-first until the first shield, then debt-heavy) | P0 |
| E5.3 | Drips accrue daily in an in-app ledger and **settle through PayPal weekly** or at a threshold (see Section 12 for the rationale) | P0 |
| E5.4 | Approval modes: approve each move, approve within a weekly cap, or standing rule with cap | P0 |
| E5.5 | Pause-all control and a safety floor that is never breached | P0 |
| E5.6 | Failure handling: insufficient funds, declined payment, and webhook timeout pause the drip and notify kindly | P0 |

### E6. Plan and what-if

| ID | Requirement | Pri |
| --- | --- | --- |
| E6.1 | Payoff strategies: avalanche, snowball, hybrid, with a one-sentence trade-off explanation | P0 |
| E6.2 | Projected debt-free date and interest paid, recalculated live on any change | P0 |
| E6.3 | What-if questions in natural language ('skip takeout twice a week') converted into parameters and run by the calculator | P0 |
| E6.4 | Scenario comparison view (current plan vs what-if) | P1 |

### E7. Chipper coach and notifications

| ID | Requirement | Pri |
| --- | --- | --- |
| E7.1 | Chat with Chipper, who delegates to other agents and replies in character | P0 |
| E7.2 | Notification engine selects tone, timing, length, and numbers-or-not per user (Section 11) | P0 |
| E7.3 | Daily cap, quiet hours, and back-off after repeated ignores | P0 |
| E7.4 | 'Why did I get this?' on every nudge, and direct preference controls | P0 |
| E7.5 | Stress-signal detection (missed drips, low balance) shifts to supportive tone | P1 |
| E7.6 | In-app inbox plus one external channel (email or web push) | P1 |

### E8. Game layer

| ID | Requirement | Pri |
| --- | --- | --- |
| E8.1 | Points from drips, streaks, lessons, and milestones, never from dollar amounts | P0 |
| E8.2 | Streak with a forgiveness mechanic (one freeze per month) | P0 |
| E8.3 | Levels tied to real milestones and five Chipper evolution stages | P0 |
| E8.4 | Cosmetic shop (points only) | P1 |
| E8.5 | Forest that grows with the stash | P1 |

### E9. Squads

| ID | Requirement | Pri |
| --- | --- | --- |
| E9.1 | Create or join a squad by invite (3 to 6 members) | P1 |
| E9.2 | Leaderboard ranked by consistency and percent of goal, never balances | P1 |
| E9.3 | Shared squad goals that unlock group cosmetics | P2 |
| E9.4 | Pre-written, positive-only cheers between members | P1 |
| E9.5 | Privacy default: friends see streak, level, and goal percent only | P1 |

### E10. Sage (learning)

| ID | Requirement | Pri |
| --- | --- | --- |
| E10.1 | Bite-size quests chosen from the user's actual situation | P1 |
| E10.2 | Each quest ends with an applied challenge using the user's own numbers (calculated by code) | P1 |
| E10.3 | Quest completion earns points and feeds the lesson history | P1 |

### E11. Trust and controls

| ID | Requirement | Pri |
| --- | --- | --- |
| E11.1 | Why card for every agent action: inputs, rule, result | P0 |
| E11.2 | Readable audit log of proposals, approvals, PayPal calls, and outcomes | P0 |
| E11.3 | Clear disclosure of the simulated lender and 'not financial advice' positioning | P0 |
| E11.4 | Data export and account deletion | P1 |

### E12. Dashboard and visualization

| ID | Requirement | Pri |
| --- | --- | --- |
| E12.1 | Home: Chipper, Ogre health, stash level, streak, today's drip | P0 |
| E12.2 | Debt-over-time chart with interest saved overlay | P0 |
| E12.3 | Subscription findings view from the Scout | P0 |
| E12.4 | Infographic summary (monthly recap) | P2 |

## 10. Agent specifications

Shared rule: agents have a fixed tool allowlist, produce structured outputs, and cannot create financial figures. Only the Banker can touch money movement, and only on approved plans.

| Agent | Purpose | Inputs | Tools | Outputs | Guardrails |
| --- | --- | --- | --- | --- | --- |
| **Scout** | Understand the user's cash flow | PayPal transactions, user profile | Transaction Search, categorize, safe-to-move calculator | Income events, subscription list, safe-to-move amount, suggested debts | Read-only; never suggests amounts below the safety floor |
| **Tactician** | Plan and what-ifs | Debts, stash, safe-to-move, preferences | Payoff calculator, scenario runner | Strategy, projections, rebalanced split, plain-language explanation | Math from code only; flags when data is incomplete |
| **Chipper** | Coach and notification owner | Events, nudge history, mood signals | Notification scheduler, agent delegate calls | Messages, timing decisions, comfort or celebration | Daily cap, no shame tones, back-off rule |
| **Banker** | Execute and verify | Approved drip batch | PayPal Orders, Payouts, Webhook reconcile | Payment confirmations, failure reports | Idempotency keys, approval check, cap check, pause check |
| **Sage** | Teach | User situation, lesson history | Lesson library, calculator | Quest, applied challenge | Examples use code-calculated numbers |

**Orchestration:** An event (payday detected, webhook received, daily tick, user message) enters an orchestrator that routes to agents as tools. Every step writes to the agent action log.

## 11. Notification learning specification

**Decision unit:** one candidate nudge per trigger, with arms defined by tone (playful, calm, celebratory, gentle, urgent-but-kind), time slot, length (short or detailed), and numbers (included or not).

**Algorithm:** Per-user Thompson sampling with Beta posteriors, initialized from a population prior so new users get sensible defaults. Exploration is capped at 20 percent of sends.

**Reward signal:**

| Response | Reward |
| --- | --- |
| Tapped through and took an action | +1.0 |
| Opened within 2 hours | +0.3 |
| Snoozed | -0.2 |
| Dismissed | -0.5 |
| Asked to check in less or muted | -1.0 |

**Guardrails:** Default cap of 3 per day. After 3 consecutive ignores Chipper backs off and asks 'Want me to check in less?'. Shaming and guilt tones are excluded from the arm set. A tone linter checks every LLM-generated message before it is sent.

**Content generation:** The LLM writes copy within the selected arm's tone. Numbers in the copy are injected by code as template variables.

**Metrics:** open rate, action rate, mute rate, and the user-visible tone shift after repeated snoozes.

## 12. PayPal integration specification

| Capability | Use | Notes |
| --- | --- | --- |
| Vault / payment tokens | One-time consent so the app can collect drips | Confirm sandbox support for merchant-initiated charges on a vaulted PayPal wallet |
| Orders v2 | Collect the settled drip from the user's vaulted funding source into the app's business account | Idempotency key per settlement |
| Payouts | Disburse the debt share to the sandbox lender account and the savings share to the sandbox stash account | Batch with per-item status |
| Transaction Search | Scout's data source | Has date-range limits per request and reporting delay; seed history on day one |
| Webhooks | Order captured, payout batch and item success or failure, vault events | Verify signatures; store raw events; handle retries and out-of-order delivery |

**Money flow:** The user's vaulted PayPal funding is charged for the week's accrued drips (collect), then the app disburses the two shares with Payouts (disburse). Payouts send from the app's balance, which is why the collect step is required.

**Settlement decision (needs sign-off):** Drips accrue daily in the in-app ledger so the habit and visuals are daily, while PayPal settlement runs weekly or at a threshold. This avoids per-transaction fee drag and still honors the daily habit.

**Reliability:** Idempotency keys on every call, a reconciliation job comparing ledger to PayPal records, and a dead-letter queue for failed webhooks.

**Sandbox topology:** Personal sandbox account (user), business account (app), business account (simulated lender), business account (simulated stash).

## 13. AI specification

- **Model use:** Gemini 3.5 Flash with function calling and structured JSON output handles agent reasoning, in-character language, and what-if parsing. The model name lives in one config value behind a thin adapter, so it can be swapped. Confirm the exact model ID, rate limits, and structured-output behavior in the current Gemini API docs before building.
- **Deterministic core:** Payoff schedules, interest, safe-to-move, streak, and points are pure code with unit tests.
- **Structured outputs:** Agents return JSON schemas (proposal, rationale, confidence, evidence references) validated before use.
- **Grounding rule:** Every number in an LLM message must come from a tool result. A validator rejects messages containing figures that do not match tool outputs.
- **Evaluations:** Number-grounding pass rate, tone-linter pass rate, what-if parse accuracy on a test set, and notification arm convergence in simulated users.
- **Failure behavior:** If the LLM is unavailable, templates and deterministic results still render.

## 14. Data model

| Table | Key fields |
| --- | --- |
| profiles | id, goals, income\_range, savings\_pct, approval\_mode, weekly\_cap, floor\_balance |
| paypal\_connections | user\_id, vault\_token\_ref, status, scopes |
| debts | id, user\_id, type, name, balance, apr, minimum, due\_day, status |
| stash | user\_id, balance, shield\_threshold, goals |
| ledger\_entries | id, user\_id, date, kind (drip, interest, settlement), amount, split, debt\_id, status |
| settlements | id, user\_id, paypal\_order\_id, payout\_batch\_id, amount, status, idempotency\_key |
| plans | id, user\_id, strategy, split, projections\_json, version |
| game\_state | user\_id, streak, freezes, points, level, evolution\_stage |
| points\_events | id, user\_id, reason, points, date |
| cosmetics, user\_cosmetics | catalog and ownership |
| squads, squad\_members | membership and shared goals |
| nudges | id, user\_id, arm\_json, message, sent\_at, response, reward |
| nudge\_arm\_stats | user\_id, arm\_key, alpha, beta |
| lessons, lesson\_progress | catalog and per-user state |
| agent\_actions | id, agent, input\_ref, proposal, rationale, approval, result, timestamp |
| webhook\_events | id, type, payload, signature\_ok, processed\_at |

## 15. Architecture and stack (assumption)

- **Frontend:** React, TypeScript, Vite, Tailwind with design tokens, charts via Recharts, mobile-first responsive.
- **Backend:** Supabase (Postgres with Row-Level Security, Auth, Realtime, Edge Functions, scheduled jobs).
- **Agent runtime:** Edge Functions hosting the orchestrator and agents, with PayPal secrets and the Gemini API key kept server-side.
- **Integrations:** PayPal REST APIs and webhooks, plus the Gemini API for the LLM. No other external APIs are required.
- **Reuse:** This stack matches the MaplePro build so shared components (auth, audit log, approval UI) can be reused if both ideas progress.

## 16. Non-functional requirements

- **Security:** No card numbers stored. PayPal tokens and secrets server-side only. RLS on every user table. Webhook signature verification.
- **Privacy:** Minimum data collection, squad data limited to streak, level, and goal percent, export and deletion supported.
- **Accessibility:** WCAG AA contrast, reduced-motion option for animations, screen-reader labels on the Ogre and Stash states.
- **Performance:** Home screen interactive in under 2 seconds on a typical mobile connection with the demo dataset.
- **Auditability:** Every money-related action is traceable from proposal to PayPal reference.

## 17. Success metrics

| Metric | Target (hackathon prototype) |
| --- | --- |
| Onboarding to first Scout finding | Under 3 minutes |
| Full loop works (approve, collect, disburse, confirm) | 100% on seeded personas |
| Number-grounding validator pass rate | 100% on test set |
| Notification tone shift after 3 snoozes | Visible and logged |

Production-intent metrics for the pitch: 7-day streak retention, percent of users reducing revolving balance, interest avoided, and notification mute rate.

## 18. Milestones (3 weeks)

| Week | Focus | Done when |
| --- | --- | --- |
| 1 | Foundations | Schema, auth, PayPal sandbox accounts, one collect-and-disburse cycle with a confirmed webhook |
| 2 | Agents and game | Scout, Tactician, Banker, Chipper notifications, points, streaks, Boss and Stash UI |
| 3 | Polish and submission | Squads, Sage, explainability, architecture diagram, README, video |

## 19. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Transaction Search is designed for the account holder's own business or merchant data and may not give a consumer-style view | Use the connected sandbox account's activity for the prototype, be explicit in the pitch, and document a production path (account aggregator or open-banking provider) |
| Holding or moving user funds can trigger money-transmission regulation | Prototype is sandbox only; production would use a licensed partner or direct payment to the lender |
| Vault and merchant-initiated charge behavior in the sandbox | Spike in week 1 with a fallback to user-approved Orders per settlement |
| Gamification feels patronizing | Voice guide, tone linter, and user testing of copy |
| Scope too wide | P0 only until week 3; squads and Sage are cut first |
| Sparse sandbox data | Seed six months of realistic activity on day one |

## 20. Assumptions and open questions

**Assumptions**

- The lender and savings pot are simulated sandbox accounts.
- Dummy personas with six months of fabricated activity are acceptable.
- A team of two to four people and three weeks.

**Open questions**

1. Weekly settlement vs daily settlement: is a daily ledger with weekly PayPal movement acceptable to the team?
2. Default split: stash-first until the first shield, then debt-heavy (recommended). Confirm.
3. Does the team want a native-feeling PWA, or is desktop plus mobile web enough?
4. Which external channel for nudges (email or web push) is realistic in the time available?
5. Should the mascot art be commissioned, generated, or simple vector?

## 21. Out of scope and roadmap

Card issuer integration, credit score integration, real-money rewards, regional savings recommendations, avatar marketplace depth, other debt types, native apps, and multi-currency support.
