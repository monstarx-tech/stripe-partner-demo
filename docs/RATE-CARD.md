# MakanPay — Rate Card

Indicative commercial terms. Figures are illustrative and require validation
against Stripe's Singapore buy-rate and a signed customer deal before being quoted.

---

## Transaction pricing

Buy-rate model: MakanPay bears Stripe's processing cost and charges the outlet a
single blended rate. Set per outlet via `fee_bps` — a tier change is configuration,
not code.

| Tier | Monthly GMV per outlet | Rate | Set as |
|---|---|---|---|
| Standard | Under S$50k | **2.50%** | `fee_bps: 250` |
| Growth | S$50k – S$250k | **2.20%** | `fee_bps: 220` |
| Group | S$250k – S$500k | **1.95%** | `fee_bps: 195` |
| Enterprise | Above S$500k | **Negotiated** | per outlet |

**Included at every tier:** card and PayNow acceptance, in-person Terminal,
running-tab pre-authorisation, refunds with fee clawback, webhook reconciliation,
and the outlet dashboard.

**What the rate is not.** The headline rate is gross. Under buy-rate MakanPay pays
Stripe's own processing cost, so net margin is this rate minus Stripe's Singapore
rate. Price against the net.

**Tips are not charged.** The platform fee is computed on the pre-tip amount. A tip
taken on the reader carries a 0% platform fee.

---

## Platform fees

| Item | Price | Notes |
|---|---|---|
| Platform licence | **S$180 / outlet / month** | Console, storefront, POS, reconciliation |
| Implementation — up to 10 outlets | **S$18,000** one-off | 4 weeks |
| Implementation — 11–50 outlets | **S$32,000** one-off | 6 weeks |
| Implementation — 50+ outlets | **Quoted** | Includes bulk API onboarding |
| Additional outlet, post go-live | **S$450** one-off | Onboarding and configuration |
| Custom vertical logic | **S$1,600 / day** | Beyond the 30% configuration surface |

Hardware (S710 readers) is billed at cost plus 10% handling, or the customer
procures directly from Stripe.

---

## What the implementation fee covers

The 70% deploys unchanged. The fee covers the 30% and the integration work around it:

- Connect platform setup and onboarding-mode selection
- Per-outlet configuration: fee, service charge, GST, currency, branding
- Menu load and channel mapping
- Reader provisioning and floor testing
- Integration with the customer's existing ordering or PMS system
- Webhook endpoint and reconciliation wiring
- UAT, go-live support, and runbook handover

**Four weeks, ten outlets** assumes the customer supplies legal entities, bank
details and menus on day one, and has an integration owner available.

---

## Commercial boundaries

Quote these as out of scope, not as gaps to be absorbed:

| Not included | Why |
|---|---|
| Splitting one payment across multiple outlets | Requires separate charges and transfers — a different architecture, not a config change |
| Offline card acceptance | Forces an SDK integration; server-driven Terminal cannot do it |
| Stripe Tax | GST is computed platform-side; Stripe Tax is a separate engagement |
| Aggregator settlement ingestion | Scoped separately per aggregator |
| Multi-currency | Single currency per outlet today |

---

## Comparison anchor

| | Build in-house | MakanPay |
|---|---|---|
| Time to first payment | 4–6 months | 4 weeks |
| Engineering cost | ~S$180k+ loaded | S$18k implementation |
| In-person payments | Separate integration | Included |
| Running tabs | Rarely attempted | Included |
| Ongoing maintenance | Customer's team | Included in the licence |
