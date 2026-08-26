# Partner Solutions Lab — Starter

Starter for the [Partner Solutions Lab](https://github.com/jillianchi/partner-solutions-lab): a Stripe Connect platform for restaurant/hotel merchants. The routes below are scaffolded but the actual Stripe calls are left as TODOs for you to implement — see the lab guide for step-by-step instructions per task.

## Setup

```bash
git clone https://github.com/jillianchi/partner-solutions-lab-starter.git
cd partner-solutions-lab-starter
npm install
cp .env.example .env
# Add your Stripe secret key to .env
npm start
```

Server runs on `http://localhost:3000`. Hit `/health` to confirm it's up.

Merchant data persists automatically in `lab.db` (SQLite, auto-created on first run).

No UI is included here — every task is testable with curl/Postman against the routes below. Building a frontend on top is a reasonable extension if your workshop calls for one, but it isn't required to complete the lab tasks.

## File map

| File | Lab task |
|------|----------|
| `server/routes/merchants.js` | Register a new merchant on the platform (no Stripe account yet) |
| `server/routes/accounts.js` | Task 2.1 — Connected account creation + onboarding + status |
| `server/routes/payments.js` | Task 2.2 — Checkout Session (direct charge) |
| `server/routes/terminal.js` | Task 2.3 — Terminal payment (server-driven) |
| `server/routes/webhooks.js` | Task 2.4 — Webhook handler |
| `server/routes/refunds.js` | Task 3A.1 — Refund with clawback |
| `server/routes/terminal.js` | Task 3A.2 — Pre-authorization |

## Terminal (Task 2.3) — server-driven integration

No client SDK — your caller (standing in for a restaurant/hotel's existing PMS/POS system) drives a Stripe Terminal reader entirely via this API. To test without physical hardware, register a simulated reader using `simulated-s710`, `simulated-s700`, or `simulated-wpe` as the registration code, then call `POST /terminal/simulate-card` (wraps Stripe's `test_helpers` present-payment-method endpoint) instead of tapping a real card.

## Pre-auth

`server/routes/terminal.js` extends the base Task 2.3 flow with `manualCapture` (hold now, capture later), plus `capture`, `saved-card`, and `off-session-charge` endpoints. The idea: hold an amount up front, let the final total grow (more rounds added to a tab, more nights added to a stay), then on close capture the final total and off-session-charge any overage to the card the reader collected.

## Test data

`server/db.js` auto-seeds two merchants (The Golden Fork, Harbour Bites) into SQLite on first run if the `merchants` table is empty. Once you implement the routes above, connected accounts and Terminal locations get created lazily and cached back onto each merchant's row — no manual copying of Stripe IDs required.
