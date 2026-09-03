# LinkedIn post

---

Last week we joined Stripe's Partner Build Day in Singapore — and then kept building.

By the end of the session we had the fundamentals. Over the following days we
took it further and shipped a complete embedded payments platform for the F&B
vertical:

→ Merchant onboarding through Stripe Connect
→ Online ordering with Checkout, card and PayNow
→ A POS driving Stripe Terminal for card-present payments
→ Running tabs — hold a card, let the bill grow, settle after the guest leaves

The honest verdict: the integration was easier than we expected. Pre-authorisation
turned out to be one parameter away from the standard Terminal flow, and the
server-driven Terminal path needs no client SDK at all — the reader is driven
entirely from the backend.

We've open-sourced the whole thing under MIT, along with the architecture
decisions, a Postman collection and an operational runbook.

Live demo → https://stripe-demo.monstarx.app
Source → https://github.com/monstarx-tech/stripe-partner-demo

Thanks to [SA NAME] and the Stripe team for a genuinely well-run session. If
you're building payments into a vertical platform, have a look — and do reach
out if it's useful.

#Stripe #Payments #StripeConnect #Fintech #Singapore #MonstarLab

---

## Notes before posting

- Replace `[SA NAME]` with an actual @mention so they get notified — type `@`
  and pick from the dropdown; pasting the name as plain text does not tag them.
- The first two lines are all LinkedIn shows before "…see more", so they carry
  the post. They are written to work on their own.
- Everything is test mode — no live keys, no real payments. Worth knowing if
  anyone asks in the comments.
- Consider posting mid-morning on a weekday; B2B reach is better before lunch.
