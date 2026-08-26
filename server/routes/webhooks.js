// Task 2.4 — Webhook Handler
// Lab page: Module 2 → Task 2.4
//
// The lab marks this optional because the reference build polls. We build it
// anyway, and the lab gives the reason: polling covers a diner watching an open
// tab; it cannot cover a closed browser, a server-to-server reconciliation, or
// a DISPUTE — nothing polls for those.
//
// Local:  stripe listen --forward-connect-to localhost:3000/webhooks
//         (--forward-to alone only sees PLATFORM events. Every charge in this
//          build is a direct charge on a CONNECTED account, so a plain
//          `stripe listen` would silently show nothing.)
// Hosted: Dashboard > Developers > Webhooks > add endpoint, and tick
//         "Listen to events on Connected accounts".

const express = require('express');
const router = express.Router();
const db = require('../db');
const { config } = require('../config');
const { stripe } = require('../lib/stripe');
const { logEvent } = require('../lib/events');
const { formatAmount } = require('../lib/money');

// Stripe may deliver the same event more than once, and a retry after a
// timeout is normal. The event id is the natural dedupe key.
function alreadyProcessed(event) {
  if (db.webhookEvents.findById(event.id)) return true;
  db.webhookEvents.insert({
    id: event.id,
    type: event.type,
    account_id: event.account || '',
    processed_at: new Date().toISOString(),
  });
  return false;
}

// Direct-charge events fire on the CONNECTED account, so event.account tells us
// which outlet this belongs to. Fall back to metadata for platform-level events.
function resolveMerchant(event) {
  if (event.account) {
    const byAccount = db.merchants.findOne(m => m.stripe_account_id === event.account);
    if (byAccount) return byAccount;
  }
  const meta = (event.data.object && event.data.object.metadata) || {};
  return meta.merchant_id ? db.merchants.findById(meta.merchant_id) : null;
}

function orderFor(event, merchant) {
  const obj = event.data.object || {};
  const meta = obj.metadata || {};
  if (meta.order_id) return db.orders.findById(meta.order_id);

  const piId = obj.payment_intent || (obj.object === 'payment_intent' ? obj.id : null);
  return piId ? db.orders.findOne(o => o.payment_intent_id === piId) : null;
}

const handlers = {
  'payment_intent.succeeded': (event, merchant) => {
    const pi = event.data.object;
    const order = orderFor(event, merchant);
    if (!order) return `no local order for ${pi.id}`;

    // Idempotent by state, not just by event id — a replay must not double-post.
    if (order.status === 'paid') return `order ${order.id} already paid`;

    db.orders.update(order.id, { status: 'paid', payment_intent_id: pi.id });
    return `order ${order.id} marked paid — ${formatAmount(pi.amount_received, pi.currency)}`;
  },

  'payment_intent.payment_failed': (event) => {
    const pi = event.data.object;
    const reason = (pi.last_payment_error && pi.last_payment_error.message) || 'unknown reason';
    return `payment failed for ${pi.id}: ${reason}`;
  },

  'payment_intent.amount_capturable_updated': (event) => {
    const pi = event.data.object;
    const tab = db.tabs.findOne(t => t.payment_intent_id === pi.id);
    if (tab && tab.status === 'awaiting_card') db.tabs.update(tab.id, { status: 'open' });
    return `hold live on ${pi.id} — ${formatAmount(pi.amount_capturable, pi.currency)} capturable`;
  },

  'charge.refunded': (event, merchant) => {
    const charge = event.data.object;
    const order = orderFor(event, merchant);
    if (!order) return `no local order for refunded charge ${charge.id}`;

    const fully = charge.amount_refunded >= charge.amount;
    db.orders.update(order.id, { status: fully ? 'refunded' : 'partially_refunded' });
    return `order ${order.id} ${fully ? 'refunded' : 'partially refunded'} — ${formatAmount(charge.amount_refunded, charge.currency)}`;
  },

  // The reason this handler exists at all. A dispute has NO polling signal —
  // nothing in the POS or the storefront would ever ask about it.
  'charge.dispute.created': (event) => {
    const d = event.data.object;
    return `DISPUTE opened ${formatAmount(d.amount, d.currency)} — reason: ${d.reason}, respond by ${
      d.evidence_details && d.evidence_details.due_by
        ? new Date(d.evidence_details.due_by * 1000).toISOString().slice(0, 10)
        : 'unknown'}`;
  },

  // Capability changes arrive asynchronously after onboarding — this is how the
  // platform learns an outlet went live without anyone refreshing a page.
  'account.updated': (event) => {
    const account = event.data.object;
    const merchant = db.merchants.findOne(m => m.stripe_account_id === account.id);
    if (!merchant) return `unknown account ${account.id}`;
    return `${merchant.name}: charges=${account.charges_enabled} payouts=${account.payouts_enabled}`;
  },
};

// POST /webhooks
// Receives Stripe events — raw body required (configured in index.js)
router.post('/', (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ACK first. Stripe retries on anything slow or non-2xx, and our handlers are
  // local writes — there is nothing worth making Stripe wait for.
  res.json({ received: true });

  try {
    if (alreadyProcessed(event)) {
      console.log(`[webhook] duplicate ${event.type} ${event.id} ignored`);
      return;
    }

    const merchant = resolveMerchant(event);
    const handler = handlers[event.type];
    if (!handler) {
      console.log(`[webhook] unhandled ${event.type}`);
      return;
    }

    const outcome = handler(event, merchant);
    logEvent({
      merchantId: merchant ? merchant.id : '',
      kind: `webhook.${event.type}`,
      message: outcome,
      payload: { eventId: event.id, account: event.account || null },
    });
  } catch (err) {
    // We already ACKed, so a handler bug must not crash the process.
    console.error('Webhook handler error:', err);
  }
});

module.exports = router;
