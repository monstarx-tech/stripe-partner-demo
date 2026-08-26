# MakanPay — 5-Minute Solution Pitch

Structure per the lab: 30s problem · 2m architecture · 90s live demo · 30s repeatability.

---

## Slide 1 — Problem (30 seconds)

> F&B platforms control the transaction but not the payment.
>
> They own the menu, the order and the table — then hand the money to a terminal
> provider they don't integrate with and a gateway they don't own. The outlet
> reconciles two systems by hand. The platform captures none of the payment revenue.
>
> **MakanPay delivers a production-ready Stripe Connect integration for F&B in four
> weeks** — online ordering, in-person Terminal, and running tabs on one backbone.

---

## Slide 2 — Architecture (2 minutes)

**The four Connect decisions, made deliberately:**

| Decision | Choice | In one sentence |
|---|---|---|
| Monetization | Buy-rate, 2.5% flat, tier-ready | The platform controls its own margin through the API |
| Merchant risk | `losses_collector: 'application'` | Forced by buy-rate, and honest — a closed restaurant has no balance to recover from |
| Merchant UI | `'express'` **and** `'none'`, per outlet | Independents self-serve; a 200-outlet chain bulk-onboards via API |
| Fund flow | Direct charges | The outlet is merchant of record — its licences, its brand, its name on the statement |

**Terminal:** smart reader, server-driven, no offline. Reader type mechanically
permits server-driven; the POS is a browser, so there is **no SDK to maintain**.
Stripe relays to the reader over its own cloud — the reader never touches our
network.

**Say this if only one thing lands:** with a direct charge, S$100 becomes S$97.50
in the outlet's own Stripe balance and S$2.50 in ours, automatically. No transfer,
no platform treasury, nothing to reconcile between the two.

---

## Slide 3 — Live demo (90 seconds)

Have three tabs pre-opened, one outlet onboarded, the reader awake.

| Time | Do | Say |
|---|---|---|
| 0:00 | Console, outlets list | "Outlets onboard through Stripe-hosted KYC — or via API for a chain that already holds the data. Both, per outlet." |
| 0:15 | Storefront, add items, pay | "Diner orders online. Direct charge." |
| 0:35 | Receipt — **point at the split bar** | "S$97.50 to the restaurant. S$2.50 to us. No transfer, no treasury." |
| 0:45 | POS, tap items, **Open tab** | "Same platform, in person. Server-driven — no client SDK anywhere." |
| 0:55 | **Card taps the S710** | *(say nothing — let the hardware land)* |
| 1:05 | **Point at the trace panel** | "Pre-auth hold, card saved off-session. That's the F&B problem: you don't know the final total while the card is present." |
| 1:15 | Add a round, **Close tab** | "Capture the hold, off-session-charge the overage to the saved card. The guest left twenty minutes ago." |
| 1:25 | Reconciliation | "Both channels, one ledger — and the aggregator revenue that never touched Stripe, shown as exactly that." |

**The trace panel is the demo.** A server-driven Terminal integration is otherwise
invisible; the panel is what makes it legible in 90 seconds.

---

## Slide 4 — Why this is repeatable (30 seconds)

> Everything you just saw is the **70%** — Connect onboarding, direct-charge fund
> flow, Checkout, server-driven Terminal, pre-auth tabs, refund clawback,
> reconciliation. It ships unchanged.
>
> The **30%** is one configuration screen: fee rate, service charge, GST, currency,
> dashboard mode, payment methods, branding, menu.
>
> **MakanPay — embedded payments for F&B platforms. Four weeks, not six months.**

---

## Technical differentiators — what to lead with if pressed

1. **Tips carry a 0% platform fee.** `application_fee_amount` is computed pre-tip
   and fixed at PaymentIntent creation, so an on-reader tip raises the amount but
   not the fee. Falls out of the API; no special-casing. Commercially defensible and
   it survives a technical follow-up.
2. **Dual onboarding modes.** Express and API-based, chosen per outlet. Enforced by
   the API — `accounts.update` on an Express account returns `oauth_not_supported`,
   because Stripe owns that account's KYC.
3. **Pre-auth with overage, no Customer object.** The reader tap generates a
   reusable card via `setup_future_usage`; the raw PaymentMethod id is enough. The
   platform never stores a walk-in guest's identity.
4. **Webhooks built, not skipped.** The lab marks them optional because the
   reference build polls. Polling cannot see a **dispute** — nothing polls for
   those. Idempotent by event id and by state.
5. **GST on the service charge.** Getting the order of operations backwards
   under-collects GST on every transaction. Vertical knowledge, not API knowledge.
6. **The aggregator boundary is explicit.** GrabFood and OTA revenue is recorded as
   its own channel with no PaymentIntent and no fee, so reconciliation is honest
   about what never flowed through Stripe.

---

## Customer journey — claim only what was demoed

✅ **Demonstrated end to end, against the live test API**
- Connected account creation via the v2 Accounts API, both onboarding modes
- Stripe-hosted onboarding to `charges_enabled` **and** `payouts_enabled`
- API-based onboarding to `charges_enabled` in two calls, no browser
- Checkout Session as a direct charge, card and PayNow both offered
- Card-present payment on a simulated S710, with on-reader tipping accepted
- Pre-auth tab: hold S$60 → captured S$60 + off-session S$28.73 overage
- Pre-auth under-hold: hold S$100, bill S$27.58 → captured S$27.58, S$72.42 released
- Refund with fee clawback — application fee fully refunded, confirmed on Stripe
- Webhooks over Connect, including `charge.dispute.created`, with replay suppressed
- Reconciliation by outlet and by channel

⚠️ **Not yet demonstrated — do not claim**
- A physical S710 completing a live tap
- A card actually entered on the Checkout page
- PayNow QR completed by a payer
- Any live customer delivery or pilot

---

## Questions to expect

**"Why not destination charges?"** The outlet holds the F&B and liquor licences and
is the party selling the food. Its name belongs on the diner's statement — a
platform name there generates chargebacks in this vertical.

**"What if one order spans multiple vendors?"** Direct charges cannot split a single
payment. A food hall needs separate charges and transfers, which makes the platform
merchant of record and hands it the treasury burden. **That is the boundary of this
accelerator**, and it's a different architecture, not a configuration change.

**"You bear the losses — is that wise?"** It's forced by buy-rate, and it's honest
for the segment. Mitigation is commercial rather than technical: manual payouts hold
funds through the dispute window, and a reserve can be negotiated per outlet.

**"Could you submit this to the Partner Solutions Program today?"** The 70/30 rule,
technical rigour and commercial readiness are addressed. **Proven delivery is not** —
there's no live customer yet. That's the gap, and it's a sales exercise rather than
an engineering one.
