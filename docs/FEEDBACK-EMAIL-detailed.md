# Draft reply — Stripe Partner Solutions Lab

**Subject:** Partner Solutions Lab — completed end-to-end build + feedback (Monstar Lab Singapore)

---

Hi [Name],

Great to meet you and the team last week — thanks for having us.

We've completed the lab end to end, and rather than stop at the tasks we built it
out as a working accelerator for the F&B vertical so we could stress-test the
integration properly. It's live here:

**https://stripe-partner-demo-production.up.railway.app**

Three surfaces you can click through, all in test mode:

- **Platform console** — outlet onboarding (Stripe-hosted *and* API-based), menu
  management, reader fleet, per-outlet commercial config, reconciliation
- **Storefront** — a diner orders online and pays by card or PayNow, with the
  direct-charge fee split shown on the receipt
- **POS** — server-driven Terminal with an on-screen S710, on-reader tipping,
  running tabs with pre-auth, and refunds — plus a live trace of every API call

All six lab tasks are implemented and verified against the live test API,
including the optional webhook handler. On top of Track A's refund clawback and
pre-authorisation, we added the vertical logic that shows up in every F&B
engagement: Singapore bill composition (service charge, then GST on the
inclusive amount), tips that carry a 0% platform fee, and an explicit
reconciliation boundary for delivery-aggregator revenue that never touches
Stripe. Architecture decisions, a runbook and a Postman collection are in the
repo, linked from the landing page.

**Overall: the integration was genuinely straightforward.** The primitives are
well designed and compose cleanly — the pre-auth flow in particular is one
parameter away from the standard Terminal flow, which is exactly right. The
server-driven Terminal path was the pleasant surprise: no client SDK, no local
network dependency, and the reader is driven entirely from the backend. A team
that knows REST can be taking card-present payments in a day.

Some feedback, offered in the spirit of the exercise:

**Documentation access**
- Several Drive links referenced from the lab pages weren't accessible to us —
  having the full detailed instructions open would help.
- **A "Download as .md" button on each lab page would be genuinely valuable.**
  Developers increasingly feed documentation straight into AI-assisted IDEs, and
  clean Markdown lands far better than copy-pasted HTML. A single concatenated
  file for the whole lab would be even better.

**Two things that cost us real time**
- The webhook instructions say `stripe listen --forward-to localhost:3000/webhooks`.
  Every charge in this lab is a **direct charge on a connected account**, so events
  fire on the connected account and that command receives nothing at all. It needs
  `--forward-connect-to`. Anyone attempting Task 2.4 will hit this.
- For Singapore, creating the account with `entity_type: 'company'` makes onboarding
  effectively uncompletable in test mode — it requires ACRA Bizfile, UEN verification,
  UBO proof and company-authorisation documents, and the hosted flow asks the operator
  to be a registered ACRA director. `individual` needs data fields only, no uploads.
  A note for SG participants would save an hour.

**Smaller gaps we ran into**
- `individual.full_name_aliases: []` does not clear the requirement — it has to be
  `['']`. Charges stay disabled until you find that.
- SG test data: `tok_sg` is a card token, not a bank account, so it fails external
  account attachment; most plausible SG routing numbers are rejected (`7171-001`
  worked); and `business_profile.url` rejects reserved domains like `example.com`.
  An SG section on the testing page would cover all three.
- Accounts v2 needs a one-time enablement on the platform account. The error message
  is excellent and points straight at the fix, but the prerequisites page says
  everything is available by default in test mode.
- The starter repo and the lab pages differ in a few places — the setup step asks you
  to confirm `client/` and `.env.example` exist (neither is in the repo),
  `/health` returns a different shape than documented, and `/terminal/simulate-card`
  is described as already implemented but is a TODO.

**Suggestions**
- Module 1's Merchant UI decision would land harder with its practical consequences
  spelled out: `dashboard: 'express'` means the platform is *forbidden* from
  prefilling KYC (`oauth_not_supported`), and `createLoginLink` returns a 400 on a
  `dashboard: 'none'` account because there is no dashboard to log into. We only
  learned both by hitting them, and they're the clearest illustration of why that
  decision matters.
- Worth a line in Task 2.2 that a Checkout Session is created successfully for an
  account whose `charges_enabled` is still false — the failure only surfaces when the
  customer presses Pay, as an opaque error on Stripe's page. Checking the account
  first turns a confusing dead end into a clear message.
- Task 2.4 is marked optional, but the page itself makes the strongest possible case
  against skipping it: disputes have no polling signal. Might be worth promoting it,
  or reframing as "optional for the demo, required for production".

Happy to walk through any of it live, or dig into the F&B accelerator if that's
useful to your team. We enjoyed this a lot and would like to keep going.

Best regards,

**Vinoth Varatharajan**
Monstar Lab Singapore
