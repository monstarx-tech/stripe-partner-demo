# MakanPay — Operational Runbook

Procedures for running the platform in production. Written for a support engineer
with Dashboard access, not for the person who built it.

---

## 1. Onboard a new outlet

**Decide the onboarding mode first.** Stripe-hosted (`express`) if the outlet
self-serves; API-based (`none`) if head office already holds their registration and
bank details. This cannot be changed later without recreating the account.

1. Console → Outlets → *Add an outlet*. Platform record only, no Stripe account yet.
2. Configuration tab → set fee, service charge and GST rates before going live.
3. Menu tab → add items, or import.
4. Outlets tab → **Onboard (hosted)** or **Onboard (API)**.
   - Hosted: send the outlet the link. They complete KYC themselves.
   - API: click *Submit KYC*.
5. Wait for `charges_enabled: true` (Check button, or the `account.updated` webhook).
6. Readers tab → register readers.

**Go-live gate:** `charges_enabled: true`. Payouts may lag — see §3.

---

## 2. Provision a Terminal reader

**Physical S710**
1. Reader must be on Wi-Fi or Ethernet with internet access. It does **not** need to
   be on the same network as the server — server-driven Terminal relays through
   Stripe's cloud.
2. On the device: Settings → generate pairing code (three words). Short-lived.
3. Console → Readers → select the outlet → paste code and label → Register.
4. Verify status shows `online`.

**Simulated (no hardware)**
Use `simulated-s710` as the registration code. Identical code path; the tap is
software-driven via the test helper.

**Common failures**

| Symptom | Cause | Fix |
|---|---|---|
| `No such location` | Outlet has no Terminal Location | Registration creates one automatically; retry |
| Reader shows `offline` | Network or asleep | Wake the device; check Wi-Fi |
| Pairing code rejected | Code expired | Generate a fresh one |
| `charges_enabled: false` on PI create | Outlet not fully onboarded | Complete §1 |
| Physical reader won't complete a tap in test mode | Real cards are rejected in test mode | Use a physical Stripe **test** card |

---

## 3. Payouts

Payouts are **manual** by default — the platform controls timing.

- Outlet trading but not paid out: check `payouts_enabled`. An API-onboarded outlet
  commonly owes `proof_of_liveness`, which blocks payouts while charges work fine.
  Resolution requires the outlet to complete a liveness check.
- To release funds: trigger a payout on the connected account from the Dashboard, or
  switch the account to a scheduled interval.
- Hold funds against an open dispute before releasing.

---

## 4. Refunds

Console/POS → Recent orders → **Refund**.

Decide the fee treatment:
- **Goodwill / full refund** → `refundApplicationFee: true` (default). The platform
  gives up its fee alongside the outlet.
- **Partial, platform not at fault** → `refundApplicationFee: false`. The outlet
  refunds the food; the platform keeps its processing revenue.

Verify in Dashboard → Connect → Accounts → *outlet* → Payments → the charge. The
application fee shows `amount_refunded`.

**These are direct charges.** There is no transfer to reverse; `reverse_transfer`
does nothing.

---

## 5. Disputes

Disputes have **no polling signal**. They arrive only via `charge.dispute.created`.

1. The webhook logs the dispute with its amount, reason and evidence deadline.
2. Notify the outlet — they hold the evidence (receipts, till records, CCTV).
3. Submit evidence in Dashboard before `evidence_details.due_by`.
4. With `losses_collector: 'application'`, **the platform bears the loss** if the
   dispute is lost and the outlet's balance cannot cover it. Consider holding
   payouts for that outlet while the dispute is open.

---

## 6. Webhook health

**Local**
```
stripe listen --forward-connect-to localhost:3000/webhooks
```
`--forward-connect-to`, not `--forward-to`. Every charge here is a direct charge on
a connected account; plain `--forward-to` sees only platform events and will show
nothing.

**Hosted**
Dashboard → Developers → Webhooks → add `https://<host>/webhooks` and tick
**"Listen to events on Connected accounts"**. Copy the signing secret to
`STRIPE_WEBHOOK_SECRET`.

**If events stop arriving**
1. Check the endpoint's recent deliveries in Dashboard for non-2xx responses.
2. Verify `STRIPE_WEBHOOK_SECRET` matches the endpoint — a rotated secret fails
   every signature check.
3. Confirm Connect events are enabled on the endpoint.
4. Replay from Dashboard. Handlers are idempotent by `event.id` and by state, so
   replay is safe.

---

## 7. Tabs that will not close

| Symptom | Cause | Action |
|---|---|---|
| Hold stuck `requires_payment_method` | Guest never tapped | Cancel the PI, re-open the tab |
| Overage `authentication_required` | Issuer wants SCA; guest is gone | Send the guest a payment link for the balance |
| No saved card on close | PI created without `setup_future_usage` | Capture what is held; collect the balance manually |
| Capture fails, hold expired | Auth holds expire (~7 days) | Charge the saved card off-session instead |

---

## 8. Reconciliation

Console → Reconciliation. Gross, platform revenue, effective take rate, net to
outlets, refunds — by outlet and by channel.

**Aggregator revenue does not appear as Stripe volume.** GrabFood, Foodpanda and OTA
orders are recorded on the `aggregator` channel with no PaymentIntent and no
platform fee. They reconcile against the aggregator's own settlement file, not
against Stripe. Do not expect these totals to match Stripe's Dashboard — by design.

---

## 9. Deployment

```
Railway → volume mounted at /data → DB_PATH=/data/lab.db
```
Without the volume the SQLite database is wiped on every deploy.

Environment: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
`STRIPE_WEBHOOK_SECRET`, `BASE_URL` (public URL — Connect onboarding returns and
Checkout redirects both depend on it), `DB_PATH`, `NODE_ENV`.

The server refuses to boot on an `sk_live_` key. This is deliberate.

**After changing `BASE_URL`:** redeploy, then re-issue any outstanding onboarding
links — Account Links embed the return URL at creation.

---

## 10. Escalation

| Situation | Owner |
|---|---|
| Outlet cannot complete KYC | Platform support → Stripe support with `acct_` id |
| Capability stuck `pending` >48h | Stripe support |
| Dispute evidence deadline <48h | Escalate to the outlet immediately |
| Reader RMA | Stripe Terminal support with the `tmr_` id |
| Negative balance on a closed outlet | Platform finance — `losses_collector: 'application'` means this is the platform's loss |
