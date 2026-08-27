# Email — send this

**Subject:** Thank you — Partner Build Day

---

Hi [Name],

Thanks for yesterday — we really enjoyed the Partner Build session. We carried
on afterwards and completed the integration end to end, live here:
**https://stripe-demo.monstarx.app** (Connect onboarding, online Checkout with
PayNow, and a Terminal POS with running tabs and refunds).

We've also open-sourced the whole thing under MIT —
**https://github.com/monstarx-tech/stripe-partner-demo** — with the architecture
decisions, a Postman collection and a runbook in the repo, in case it's useful
as a reference for other partners.

Overall the integration was easier than expected — the APIs compose really
cleanly, and pre-authorisation turned out to be one parameter away from the
standard Terminal flow.

A few small bits of feedback: some of the Drive links in the lab pages weren't
accessible to us, and a "Download as .md" option on each page would help a lot —
developers increasingly feed docs straight into AI-assisted IDEs. One doc fix
too: the webhook step suggests `stripe listen --forward-to`, but since every
charge is a direct charge on a connected account it needs `--forward-connect-to`,
otherwise no events arrive.

Do feel free to share the demo or the repo if it's useful. And we'd love to stay
close to the Stripe team here — Monstar Lab has a good footprint in Singapore, so
if delivery partner opportunities come up, we'd be glad to be considered.

Best regards,
**Vinoth Varatharajan**
Monstar Lab Singapore
