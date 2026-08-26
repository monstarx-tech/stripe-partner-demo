# DECISIONS.md — MakanPay

**MakanPay** — embedded payments for F&B platforms. Online ordering, in-person
Terminal, and running tabs on one Stripe Connect backbone, deployable in four weeks.

Built during the Stripe Partner Solutions Lab. Track A patterns (refund clawback,
pre-authorisation) implemented and documented as a Track B accelerator for the
Singapore F&B vertical.

---

## Scenario

**The problem.** F&B platforms — restaurant management SaaS, ordering systems, POS
vendors — control the transaction but not the payment. They own the menu, the order
and the table, then hand the actual money to a terminal provider they don't
integrate with and a payment gateway they don't own. The outlet reconciles two
systems by hand. The platform captures none of the payment revenue and can't offer
the flows the vertical actually needs.

**Who has it.** Multi-outlet F&B operators (8–200 outlets) and the vertical SaaS
platforms serving them, initially in Singapore and the wider SEA market.

**Why it's hard without a purpose-built integration.** Not the Stripe API — that
part is well documented. The difficulty is the vertical logic that sits on top and
appears in every F&B engagement but in no Stripe tutorial:

- Statutory bill composition (service charge, then GST on the inclusive amount)
- A bill whose final amount is unknown when the card is present (a running tab)
- Tips that must reach staff without the platform skimming them
- Comps and service recovery, where the fee treatment is a business decision
- Revenue that never touches Stripe at all (delivery aggregators, OTAs)

**Core payment flows.** (1) Online ordering with a hosted checkout. (2) In-person
card-present at the till. (3) Running tabs — hold now, settle later.

**Stripe products.** Connect (v2 Accounts), Checkout, Terminal (server-driven),
Refunds, Webhooks.

**Explicitly out of scope.** Stripe Tax (GST computed platform-side), Billing and
subscriptions, Issuing, Capital, multi-party splits, offline-capable Terminal.

**Platform and sub-merchants.** The platform is the SaaS vendor. Sub-merchants are
the outlets — separate legal entities with their own bank accounts and their own
liquor and food licences. That legal separation is what drives Decision 4.

---

## 1. Monetization

**Model:** Buy-rate. `defaults.responsibilities.fees_collector: 'application'`,
with the platform's revenue set per-PaymentIntent via `application_fee_amount`.

**Rate:** 2.50% flat, tier-ready. Stored per outlet as `fee_bps`, so a volume
tier is a configuration change and not a code change.

**Why this model for this client.** F&B margins are thin and outlets negotiate. A
platform that controls its own take rate through the API can discount a 40-outlet
group without a conversation with Stripe. Rev-share (`fees_collector: 'stripe'`)
is a negotiated partnership term, not an API field, and it puts the platform's
pricing outside its own control.

**`application_fee_amount` is not `fees_collector`.** `application_fee_amount` is
the platform's commercial revenue, set per transaction. `fees_collector` decides
who bears Stripe's own processing cost. Under buy-rate the platform bears that
cost, so the real margin is `application_fee_amount` minus Stripe's cost — not the
headline 2.5%. The rate card prices against the net.

**Tips are excluded from the platform fee.** `application_fee_amount` is computed
on the pre-tip total and fixed at PaymentIntent creation. An on-reader tip raises
the PaymentIntent amount but not the fee, so the platform's cut of a tip is exactly
zero. This falls out of the API rather than needing special-casing, and it is a
defensible commercial position: staff tips are not platform revenue.

---

## 2. Merchant Risk

**Choice:** `defaults.responsibilities.losses_collector: 'application'` — the
platform bears unrecoverable negative balances.

**Why.** Required pairing: `losses_collector: 'application'` is only valid
alongside `fees_collector: 'application'`, so Decision 1 forces this. It is also
the honest answer for the segment — a single-outlet restaurant that closes owing a
chargeback has no balance to recover from, and the platform is the party with the
commercial relationship and the leverage.

**This is immutable once set.** It is the decision to review hardest with a client
before the first account is created. Mitigations belong in the commercial layer,
not the API: manual payouts (Decision 5) let the platform hold funds against a
dispute window, and a deposit or rolling reserve can be negotiated per outlet.

**Merchant risk is not transaction risk.** Transaction risk is per-payment — fraud
and chargebacks on a single charge, addressed with Radar and evidence. Merchant
risk is entity-level: an outlet that is gone. `losses_collector` addresses the
second only. Separately, `on_behalf_of` changes merchant of record but does *not*
change who handles disputes.

---

## 3. Merchant UIs

**Choice:** Both, selected per outlet. `dashboard: 'express'` is the default;
`dashboard: 'none'` is available for enterprise groups.

| | `'express'` — Stripe-hosted | `'none'` — API-based |
|---|---|---|
| Who owns KYC | Stripe | The platform |
| Onboarding | Hosted flow, outlet self-serves | Platform submits via API |
| Merchant dashboard | Express Dashboard, zero build | None — the platform is the entire UI |
| Best for | Independents, small groups | Chains that already hold outlet data |

**Why both.** A 200-outlet group will not put 200 franchisees through 200 browser
sessions when head office already holds every outlet's registration and bank
details. A single independent restaurant, conversely, wants to see its own balance
without the platform building a reporting UI. Supporting both is roughly 40 lines
of code and it is the difference between an accelerator and a demo.

**What we learned building it.** The API enforces this decision rather than merely
recording it:

- `stripe.accounts.update()` on an Express account returns `oauth_not_supported`
  for KYC fields. Stripe owns that account's onboarding and the platform may not
  write to it.
- `stripe.accounts.createLoginLink()` returns a 400 on a `'none'` account. There is
  no hosted dashboard to log into. Choosing `'none'` means committing to being the
  outlet's only interface — including statements, balances and payout history.
- Hosted onboarding reached `payouts_enabled: true`. API prefill reached
  `charges_enabled: true` but left `proof_of_liveness` outstanding, which blocks
  payouts. **Charges and Terminal work either way; payouts still need the human.**
  An API-onboarded outlet can trade from day one but needs a liveness check before
  money leaves.

**If sub-merchants demand dashboard access later:** `dashboard` is set at account
creation. Moving an existing outlet from `'none'` to `'express'` is a migration,
not a toggle. Where an outlet's preference is uncertain, default to `'express'` —
it is the reversible-by-default choice.

---

## 4. Fund Flow (Merchant of Record)

**Choice:** Direct charges. Every call is scoped with `{ stripeAccount }`; there is
no `transfer_data` and no `on_behalf_of` anywhere in the build.

**Why.** The outlet is the merchant of record. That is the correct answer legally —
each outlet holds its own F&B and liquor licences and is the party actually selling
the food — and commercially: the diner's card statement reads *Harbour Bites*, not
*MakanPay*. In a vertical where the venue is the brand, a platform name on the
statement generates chargebacks. Stripe's own Checkout page renders **"Pay Harbour
Bites"**, which is exactly right.

Funds settle straight into the outlet's Stripe balance and the platform fee is
collected automatically. No transfer step, no platform treasury, nothing to
reconcile between the two.

**What would break if a single payment had to split to multiple parties.**
Direct charges cannot do it — one charge settles on one account. A shared-kitchen
or food-hall scenario where one diner order spans three vendors would force
separate charges and transfers, with the platform becoming merchant of record and
inheriting the treasury and reconciliation burden it currently avoids. **That is
the boundary of this accelerator.** A food-hall client is a different architecture,
not a configuration change.

---

## 5. Vertical-specific logic

### Running tab pre-authorisation with overage

**When it applies.** Any bill whose final amount is unknown while the card is
present — a bar tab, a long dinner, a function. Structurally identical to a hotel
folio at check-in.

**Implementation.**
1. `paymentIntents.create` — `card_present`, `capture_method: 'manual'`,
   `setup_future_usage: 'off_session'`, `application_fee_amount` on the hold.
2. `terminal.readers.processPaymentIntent` with
   `process_config.allow_redisplay: 'always'` (required whenever
   `setup_future_usage` is set). Guest taps once; the card leaves.
3. Rounds accrue. The order is repriced from its line items on every addition, so
   the running total is always the real bill.
4. On close: `paymentIntents.capture` with
   `amount_to_capture: min(final, hold)`. Capturing less releases the remainder.
5. If the bill ran over: read `latest_charge.payment_method_details.card_present
   .generated_card`, then `paymentIntents.create` with `off_session: true,
   confirm: true` for the difference.

**Why this approach.** `setup_future_usage` is the whole trick — a card-present tap
leaves nothing chargeable behind without it, and the overage would be
uncollectable. **No Customer object is involved**; the raw PaymentMethod id is
enough, which keeps the platform out of storing guest identities for a walk-in.

**Alternatives rejected.** Holding a large amount up front and capturing down is
worse for the guest (their available balance is reduced all evening) and generates
complaints. Asking the guest to tap again at close defeats the point and fails the
moment they have left. Card-on-file via a Customer requires collecting guest
identity a walk-in has no reason to give.

**Known limitation.** An off-session charge can be declined with
`authentication_required` — the issuer wants SCA and nobody is present to provide
it. The API surfaces this explicitly. Production handling is to notify the guest
with a hosted payment link; the accelerator returns the error with that guidance
rather than silently swallowing it.

### Refund with fee clawback

**When it applies.** Comps, service recovery, order errors — routine in F&B.

**Implementation.** `refunds.create` on the connected account with
`refund_application_fee: true`.

**Why this approach.** With a direct charge the connected account is merchant of
record and the funds already live on it. **There is no transfer to reverse, so
`reverse_transfer` is irrelevant** — setting it changes nothing.
`refund_application_fee` is the only lever.

**The decision that is actually a business decision.** `true` means the platform
gives up its fee alongside the outlet: correct for a goodwill refund where the
platform is part of the apology. `false` means the platform keeps its fee: arguable
for a partial refund where the outlet got the order wrong and the platform still
processed the payment correctly. The default is `true` and the API takes it
explicitly, so the alternative stays visible at the call site rather than being
buried in a default.

### Singapore F&B bill composition

**When it applies.** Every priced order, on every channel.

**Implementation.** `service_charge = round(subtotal × service_charge_bps)`, then
`gst = round((subtotal + service_charge) × gst_bps)`. **GST applies to the service
charge**, not just the subtotal. Both ride as their own Checkout line items so the
diner sees them itemised the way a Singapore receipt reads. Rates are per outlet.

**Why this approach.** Getting the order of operations backwards under-collects GST
on every transaction — a compliance problem that compounds silently. Computing it
platform-side rather than with Stripe Tax keeps one pricing path across web and
POS, which is what makes a dine-in ticket and an online order price identically.

### On-reader tipping

**When it applies.** Card-present payments where the outlet accepts tips.

**Implementation.** `process_config.tipping.amount_eligible` set to the pre-tip
total. The S710 renders the tip options itself.

**Why this approach.** The tip raises the PaymentIntent amount but not
`application_fee_amount`, which was fixed at creation — so tips are automatically
fee-exempt without special-casing. Falls back to a plain push if the reader or
currency rejects tipping: losing the tip prompt beats losing the sale.

### Aggregator reconciliation boundary

**When it applies.** Any outlet also selling through GrabFood, Foodpanda, Deliveroo
or an OTA.

**Implementation.** An `aggregator` order channel that records revenue but carries
no PaymentIntent and no platform fee, surfaced as its own row in reconciliation.

**Why this approach.** Aggregators collect payment themselves and remit net
proceeds separately. Assuming all revenue flows through Stripe is the most common
scoping error in an F&B engagement. Making the gap an explicit, visible channel
beats discovering it during UAT.

---

## 6. What changes per client (the 30%)

Configurable per outlet, at deployment, without touching code:

- [x] **Platform fee** — `fee_bps`, per outlet, tier-ready
- [x] **Service charge and GST rates** — per outlet, per market
- [x] **Country and currency**
- [x] **Dashboard mode** — `'express'` vs `'none'`, per outlet
- [x] **Payout cadence** — manual by default; interval is a settings change
- [x] **Payment methods per market** — PayNow enabled per connected account
- [x] **Branding** — outlet name, colour, icon on the storefront
- [x] **Menu** — full CRUD, shared by storefront and POS
- [x] **Reader fleet** — physical or simulated, per outlet

**Required from a customer before go-live:** legal entity and registration per
outlet, bank account per outlet, negotiated fee rate, menu and pricing, reader
count and shipping addresses, and the integration point with their existing
ordering system.

**The 70% that ships unchanged:** Connect onboarding in both modes, direct-charge
fund flow, Checkout, server-driven Terminal, pre-auth tabs with overage, refund
clawback, webhook reconciliation with idempotency, and the order ledger shared
across channels.

---

## 7. What to call this and who to pitch it to

**Accelerator name:** MakanPay — embedded payments for F&B platforms.

**One-sentence value proposition:** MakanPay gives an F&B platform online ordering,
in-person Terminal and running tabs on one Stripe Connect backbone, cutting payment
integration from six months to four weeks.

**Next client to pitch:** Singapore and SEA multi-outlet restaurant groups and the
vertical SaaS vendors serving them — the segment already running a POS they don't
own and reconciling it against a payment gateway they don't own either.

**Why they'd buy it.** They cannot self-serve this. Stripe's documentation covers
each primitive, but nothing covers the composition: a tab that holds a card and
settles against it hours later, a fee model that deliberately skips tips, GST on
the service charge, and a reconciliation view honest about the revenue that never
touched Stripe. That composition is roughly six months of engineering that has to
be got right, on a system where errors are financial.

---

## Payout approach (operational, beyond the four decisions)

**Choice:** Manual. **Cadence:** Platform-controlled, weekly by default.

**Why.** Manual payouts let the platform hold funds against the dispute window,
which is the only real mitigation available once `losses_collector: 'application'`
is set and immutable. It also enables clawback before funds leave the connected
account. The trade-off is real — outlets want their money and cash flow is tight in
F&B — so the hold period is a per-client commercial negotiation, not a technical
default.

---

## Gaps between this and a Partner Solutions Program submission

Honest accounting of what is still missing:

| Criterion | Status |
|---|---|
| 70/30 rule | **Met.** The 30% is enumerated in §6 and exposed as a configuration screen. |
| Technical rigour | **Met.** Reference architecture, Postman collection and runbook in `docs/` and `postman/`. |
| Commercial readiness | **Partial.** Rate card drafted in `docs/RATE-CARD.md`; not yet validated against a signed deal. |
| Proven delivery | **Not met.** No live customer delivery or active pilot. This is the gap that matters, and it is a commercial exercise, not an engineering one. |

**Not yet built:** physical S710 validated end to end with a live tap; tiered fee
logic (designed, not implemented); Radar for Connect rules tuned for F&B;
aggregator settlement file ingestion; payout scheduling UI; multi-currency.
