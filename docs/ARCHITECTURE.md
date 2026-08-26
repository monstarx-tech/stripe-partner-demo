# MakanPay — Reference Architecture

Three levels, following the lab's own convention: L100 landscape, L200 fund flow,
L300 sequence detail.

---

## L100 — Platform landscape

Where Stripe sits, and — as importantly — where it does not.

```mermaid
graph TB
  subgraph diners["Diners"]
    web["Web / mobile<br/>online ordering"]
    inperson["In person<br/>S710 at the till"]
  end

  subgraph platform["MakanPay platform"]
    console["Platform console<br/>onboarding · menus · config"]
    ledger["Order ledger<br/>one table, all channels"]
    pos["POS<br/>tickets · tabs · refunds"]
    store["Storefront<br/>menu · cart · checkout"]
  end

  subgraph stripe["Stripe"]
    connect["Connect<br/>v2 accounts"]
    checkout["Checkout<br/>card · PayNow"]
    terminal["Terminal<br/>server-driven"]
    hooks["Webhooks<br/>Connect events"]
  end

  subgraph outlets["Outlets — connected accounts"]
    o1["Harbour Bites<br/>acct_xxx"]
    o2["The Golden Fork<br/>acct_yyy"]
  end

  subgraph outside["NOT through Stripe"]
    agg["Delivery aggregators<br/>GrabFood · Foodpanda"]
    ota["OTA channels"]
    acct["Accounting<br/>Xero · SAP"]
  end

  web --> store --> checkout
  inperson --> pos --> terminal
  console --> connect
  store --> ledger
  pos --> ledger
  checkout --> o1
  terminal --> o1
  connect --> o1
  connect --> o2
  hooks --> ledger
  o1 -.->|manual payout| bank["Outlet bank accounts"]
  agg -.->|net proceeds, separate| o1
  ota -.->|net proceeds, separate| o1
  ledger -.->|reconciliation export| acct

  classDef out fill:#fff6e0,stroke:#9a6700
  class agg,ota,outside out
```

**The boundary that matters.** Aggregator and OTA revenue reaches the outlet
without passing through Stripe. Those orders have no PaymentIntent and no platform
fee. Assuming otherwise is the most common scoping error in an F&B engagement, so
the ledger records them as their own channel and reconciliation shows them
explicitly as *not* flowing through Stripe.

---

## L200 — Fund flow (direct charges)

```mermaid
sequenceDiagram
  autonumber
  participant D as Diner
  participant P as MakanPay
  participant S as Stripe
  participant O as Outlet<br/>(connected account)

  D->>P: Order S$100.00
  P->>S: Create charge { stripeAccount: acct_xxx }<br/>application_fee_amount = 250
  Note over S,O: DIRECT CHARGE — the outlet is merchant of record.<br/>The diner's statement reads "Harbour Bites".
  S->>O: S$97.50 to the outlet's own balance
  S->>P: S$2.50 platform fee, collected automatically
  Note over S,P: No transfer. No platform treasury.<br/>Nothing to reconcile between the two.
  S-->>P: payment_intent.succeeded (on the CONNECTED account)
  O->>O: Manual payout — platform controls timing
```

Refunds reverse the same way: `refund_application_fee: true` returns the platform's
S$2.50 alongside the outlet's S$97.50. There is no transfer to reverse, so
`reverse_transfer` plays no part.

---

## L300a — Connected account creation, both onboarding modes

```mermaid
sequenceDiagram
  autonumber
  participant C as Console
  participant API as MakanPay API
  participant S as Stripe

  C->>API: POST /accounts { merchantId, dashboard }
  API->>S: POST /v2/core/accounts<br/>identity.entity_type: individual<br/>fees_collector + losses_collector: application
  S-->>API: acct_xxx
  API->>S: POST /v1/accounts/:id (payouts.schedule.interval = manual)

  alt dashboard: 'express' — Stripe owns KYC
    C->>API: GET /accounts/:id/onboard
    API->>S: POST /v1/account_links (account_onboarding)
    S-->>C: hosted onboarding URL
    Note over C,S: Merchant self-serves.<br/>Reaches charges_enabled AND payouts_enabled.
  else dashboard: 'none' — the platform owns KYC
    C->>API: POST /accounts/:id/prefill-test
    API->>S: POST /v1/accounts/:id (individual, external_account, tos_acceptance)
    Note over API,S: Reaches charges_enabled.<br/>proof_of_liveness still blocks PAYOUTS.
  end
```

**Why `entity_type: 'individual'`.** A Singapore *company* account triggers full KYB
— ACRA Bizfile, UEN verification, UBO proof, company-authorization documents — none
of which test mode relaxes. `individual` needs data fields only, no uploads.

---

## L300b — Terminal, server-driven

```mermaid
sequenceDiagram
  autonumber
  participant T as POS (browser)
  participant API as MakanPay API
  participant S as Stripe
  participant R as S710 reader

  T->>API: POST /terminal/payment-intent { items }
  API->>S: paymentIntents.create<br/>card_present · application_fee_amount<br/>{ stripeAccount }
  S-->>API: pi_xxx
  API-->>T: paymentIntentId

  T->>API: POST /terminal/process { readerId, tipEligibleAmount }
  API->>S: readers.processPaymentIntent<br/>process_config.tipping.amount_eligible
  S->>R: Wake, show amount, offer tip
  Note over S,R: Stripe relays to the reader over ITS OWN cloud.<br/>The reader never talks to our server —<br/>no LAN, no client SDK, no SDK to maintain.

  R->>S: Card presented (+ tip selection)
  loop poll
    T->>API: GET /terminal/payment-intent/:id/status
    API->>S: paymentIntents.retrieve
  end
  S-->>API: succeeded
  Note over API: Tip raised the PI amount but NOT<br/>application_fee_amount — tips are fee-exempt.
```

---

## L300c — Running tab, hold → grow → settle

```mermaid
sequenceDiagram
  autonumber
  participant G as Guest
  participant T as POS
  participant API as MakanPay API
  participant S as Stripe

  T->>API: POST /tabs { holdAmount, readerId }
  API->>S: paymentIntents.create<br/>capture_method: manual<br/>setup_future_usage: off_session
  API->>S: readers.processPaymentIntent<br/>process_config.allow_redisplay: always
  G->>S: Taps once
  S-->>API: requires_capture — hold live
  Note over G: The card leaves. The tab stays open.

  loop rounds
    T->>API: POST /tabs/:id/items
    Note over API: Order repriced from line items.<br/>Running total is always the real bill.
  end

  T->>API: POST /tabs/:id/close
  API->>S: paymentIntents.capture<br/>amount_to_capture = min(final, hold)
  Note over API,S: Capturing LESS releases the remainder.

  alt bill exceeded the hold
    API->>S: retrieve, expand latest_charge
    S-->>API: card_present.generated_card = pm_xxx
    API->>S: paymentIntents.create<br/>payment_method: pm_xxx<br/>off_session: true, confirm: true
    Note over API,S: Guest is gone. No Customer object —<br/>the raw PaymentMethod id is enough.
  end
```

---

## L300d — Webhook reconciliation

```mermaid
sequenceDiagram
  autonumber
  participant S as Stripe
  participant W as POST /webhooks
  participant DB as Ledger

  S->>W: event (raw body)
  W->>W: constructEvent — verify Stripe-Signature
  W-->>S: 200 immediately
  Note over W,S: ACK first. Stripe retries anything slow<br/>or non-2xx; our handlers are local writes.
  W->>DB: seen event.id before?
  alt duplicate
    Note over W: Suppressed. Plus state-level guards —<br/>a replay cannot double-post a paid order.
  else new
    W->>W: resolve outlet from event.account
    W->>DB: apply handler
  end
```

**Connect routing.** Direct-charge events fire on the **connected** account, so
`event.account` identifies the outlet. Locally this requires
`stripe listen --forward-connect-to`. Plain `--forward-to` sees only platform
events and would show nothing at all for this build.

---

## Component map

| Path | Responsibility |
|---|---|
| `server/config.js` | Env-driven config; refuses to boot on a live key |
| `server/db.js` | SQLite schema, migrations, seed |
| `server/lib/stripe.js` | Client, `onAccount()` scoping, idempotency keys, error surfacing |
| `server/lib/money.js` | SG bill composition, tip-exempt fee calculation |
| `server/lib/terminal.js` | `ensureLocation`, reader cache |
| `server/lib/testdata.js` | SG test-mode KYC values |
| `server/routes/accounts.js` | Connect — create, onboard, status, prefill |
| `server/routes/payments.js` | Checkout Session, status |
| `server/routes/terminal.js` | Reader registration, card-present, capture, off-session |
| `server/routes/tabs.js` | Pre-auth tab state machine |
| `server/routes/refunds.js` | Refund with fee clawback |
| `server/routes/webhooks.js` | Signature verification, idempotency, Connect routing |
| `server/routes/orders.js` | Shared order ledger |
| `server/routes/platform.js` | CMS API, reconciliation |
| `public/admin.html` | Platform console |
| `public/store.html` | Customer storefront |
| `public/pos.html` | POS with live API trace |
