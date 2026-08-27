# Email — short version (send this one)

**Subject:** Thank you — Partner Build Day, and our completed integration

---

Hi [Name],

Thank you for yesterday — we really enjoyed the Partner Build session, and the
team came away energised. It was well run and the material was easy to follow.

We took it a bit further after the session and completed the full integration
end to end. It's live here if you'd like a look:

**https://stripe-partner-demo-production.up.railway.app**

Three surfaces, all in test mode — a platform console for onboarding outlets via
Connect, a customer storefront paying by card or PayNow, and a POS driving
Stripe Terminal. We also built out the F&B-specific pieces: running tabs with
pre-authorisation, refunds with fee clawback, and Singapore service charge and GST.

**Honestly, the integration was easier than we expected.** The APIs compose
really cleanly — pre-authorisation turned out to be one parameter away from the
standard Terminal flow, which was a nice surprise. The server-driven Terminal
path especially: no client SDK, no local network setup, the reader driven
entirely from the backend. A team comfortable with REST could be taking
card-present payments within a day.

A little feedback, in the spirit of the exercise:

- **Some of the Drive links referenced in the lab pages weren't accessible to
  us** — having the full detailed instructions open would help.
- **A "Download as .md" option on each page would be genuinely useful.**
  Developers increasingly feed documentation straight into AI-assisted IDEs, and
  clean Markdown works far better than copy-pasted HTML.
- One small thing that cost us time: the webhook step suggests
  `stripe listen --forward-to`. Since every charge in the lab is a direct charge
  on a connected account, events fire on the connected account and that command
  receives nothing — it needs `--forward-connect-to`.
- For Singapore specifically, creating the connected account as a *company*
  makes onboarding very difficult to complete in test mode (ACRA, UEN and UBO
  documents). Using *individual* avoids all of it — worth a note for SG participants.

Please feel free to share the demo with other partners or customers if it's
useful — it's a fair illustration of how quickly a Stripe integration can come
together.

We'd love to stay close to the Stripe team here. Monstar Lab has a strong
presence in Singapore and we work with a number of clients who'd benefit from
this kind of embedded payments capability — so if there are opportunities where
a delivery partner would help, we'd be glad to be considered.

Thanks again, and do let us know if you'd like a walkthrough.

Best regards,

**Vinoth Varatharajan**
Monstar Lab Singapore
