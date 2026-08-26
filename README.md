# MakanPay

**Embedded payments for F&B platforms.** Online ordering, in-person Terminal, and
running tabs on one Stripe Connect backbone — deployable in four weeks.

Built for the Stripe Partner Solutions Lab. Track A patterns implemented and
documented as a Track B accelerator for the Singapore F&B vertical.

---

## What it does

| Surface | Route | Proves |
|---|---|---|
| **Platform console** | `/admin.html` | Connect onboarding (both modes), menu CMS, reader fleet, per-outlet config, reconciliation |
| **Customer storefront** | `/store.html` | Checkout Session, direct charge, PayNow, fee-split receipt |
| **POS** | `/pos.html` | Server-driven Terminal, on-reader tipping, pre-auth tabs, refunds, live API trace |

One order ledger underneath all three, so a dine-in ticket and an online order price
identically.

## Architecture in one line

**Direct charges on Stripe Connect.** The outlet is merchant of record; funds settle
into its own balance and the platform's `application_fee_amount` is collected
automatically. No transfer step, no platform treasury.

## Vertical logic

- **Running tab pre-auth with overage** — hold now, settle later against a card that
  left hours ago. No Customer object required.
- **Refund with fee clawback** — `refund_application_fee`; `reverse_transfer` is
  irrelevant with direct charges.
- **Singapore bill composition** — service charge, then GST on the inclusive amount.
- **On-reader tipping** — tips carry a **0% platform fee**, by construction.
- **Aggregator boundary** — revenue that never touched Stripe, shown as exactly that.

## Quick start

```bash
npm install
cp .env.example .env      # add your sk_test_ / pk_test_ keys
npm run dev
```

Open http://localhost:3000/admin.html — two Singapore outlets are seeded with menus.

Onboard an outlet (API mode reaches `charges_enabled` with no browser), register
`simulated-s710` as a reader, then charge from the POS.

Webhooks, locally:
```bash
stripe listen --forward-connect-to localhost:3000/webhooks
```
`--forward-connect-to`, not `--forward-to`. Every charge here is a direct charge on a
connected account; plain `--forward-to` sees only platform events.

## Deployment

Railway, with a volume mounted at `/data` and `DB_PATH=/data/lab.db` — without it the
database is wiped on every deploy. Set `BASE_URL` to the public URL; Connect
onboarding returns and Checkout redirects both depend on it.

The server refuses to boot on an `sk_live_` key.

## Documentation

| | |
|---|---|
| [DECISIONS.md](DECISIONS.md) | The four Connect decisions, vertical logic, the 70/30 split |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | L100 landscape, L200 fund flow, L300 sequences |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Onboarding, readers, payouts, disputes, webhook health |
| [docs/RATE-CARD.md](docs/RATE-CARD.md) | Commercial terms and scope boundaries |
| [docs/PITCH.md](docs/PITCH.md) | 5-minute solution pitch |
| [postman/](postman/) | 35 requests across 10 folders |

## Lab coverage

| Task | |
|---|---|
| 2.1 Connected accounts | ✅ v2 Accounts API, dual onboarding modes |
| 2.2 Online payment | ✅ Checkout, direct charge, PayNow |
| 2.3 Terminal payment | ✅ Server-driven, on-reader tipping |
| 2.4 Reconciliation webhook | ✅ Built — polling cannot see disputes |
| 3A.1 Refund with clawback | ✅ Fee refund confirmed on Stripe |
| 3A.2 Pre-authorization | ✅ Both capture paths, plus off-session overage |

Test mode only.
