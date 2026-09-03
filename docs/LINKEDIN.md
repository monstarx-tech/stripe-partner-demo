# LinkedIn post

---

As a Stripe partner, Monstar Lab Singapore joined Stripe's Partner Build Day
last week — and then kept building.

The session covered the fundamentals. Over the following days our team took it
further and shipped a complete embedded payments platform for the F&B vertical:

→ Merchant onboarding through Stripe Connect
→ Online ordering with Checkout, card and PayNow
→ A POS driving Stripe Terminal for card-present payments
→ Running tabs — hold a card, let the bill grow, settle after the guest leaves

The honest verdict: the integration was easier than we expected. Pre-authorisation
turned out to be one parameter away from the standard Terminal flow, and the
server-driven Terminal path needs no client SDK at all — the reader is driven
entirely from the backend.

We've open-sourced the whole thing under MIT, along with the architecture
decisions, a Postman collection and an operational runbook — so any team scoping
a Connect build has a working reference to start from.

Live demo → https://stripe-demo.monstarx.app
Source → https://github.com/monstarx-tech/stripe-partner-demo

Thanks to [SA NAME] and the Stripe team for a genuinely well-run session — good
to keep deepening the partnership.

And if you're a product or engineering team weighing up embedded payments for
your platform, the repo is a fair place to see what the build actually involves.
Happy to talk it through.

#Stripe #Payments #StripeConnect #Fintech #Singapore #MonstarLab

---

## Notes before posting

- Replace `[SA NAME]` with an actual @mention — type `@` and pick from the
  dropdown. Pasting the name as plain text does not notify them, which is the
  whole point of the post.
- The first two lines are all LinkedIn shows before "…see more". They lead with
  the partner status and carry the post on their own.
- Everything is test mode — no live keys, no real payments. Worth knowing if
  anyone asks in the comments.
- Mid-morning on a weekday tends to get better B2B reach.
- The thanks and the call-to-action are deliberately separate paragraphs. Run
  together they read as if you are telling the Stripe SA to reach out to you.
