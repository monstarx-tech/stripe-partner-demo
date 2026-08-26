// Task 2.2 — Online Payment (Checkout Session)
// Lab page: Module 2 → Task 2.2

const express = require('express');
const router = express.Router();
const db = require('../db');
const { config } = require('../config');
const { stripe, onAccount, idemKey, describeStripeError } = require('../lib/stripe');
const { logEvent } = require('../lib/events');
const { buildOrder, saveOrder, hydrate } = require('./orders');

// Service charge and GST ride as their own line items rather than being folded
// into dish prices. That's how a Singapore F&B receipt reads, and the diner can
// see what they're paying for on Stripe's own Checkout page.
function toLineItems(order, built, currency) {
  const lines = built.items.map(it => ({
    price_data: {
      currency,
      product_data: {
        name: `${it.image_emoji ? it.image_emoji + ' ' : ''}${it.name}`,
      },
      unit_amount: it.unit_amount,
    },
    quantity: it.quantity,
  }));

  const add = (name, amount) => {
    if (amount > 0) {
      lines.push({
        price_data: { currency, product_data: { name }, unit_amount: amount },
        quantity: 1,
      });
    }
  };

  add('Service charge', built.totals.serviceCharge);
  add('GST', built.totals.gst);
  return lines;
}

// POST /checkout
// Create a Checkout Session as a direct charge on the connected account —
// the merchant is the merchant of record and pays Stripe's processing fee;
// application_fee_amount is the platform's cut, routed to the platform automatically.
router.post('/', async (req, res) => {
  const { merchantId, items, customerEmail } = req.body;
  const merchant = db.merchants.findById(merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (!merchant.stripe_account_id) return res.status(400).json({ error: 'Merchant has no Stripe account yet' });

  const currency = merchant.currency || config.platform.currency;

  try {
    const built = buildOrder(merchant, items);
    const order = saveOrder(merchant, built, { channel: 'web', orderType: 'takeaway', customerEmail });
    const lineItems = toLineItems(order, built, currency);

    const params = {
      mode: 'payment',
      line_items: lineItems,
      payment_intent_data: {
        // The platform's commercial revenue. With a direct charge there is no
        // transfer step — this lands in the platform balance automatically.
        application_fee_amount: built.fee,
        description: `${merchant.name} — order ${order.id}`,
        // The webhook reads this to reconcile the order. Checkout metadata and
        // PaymentIntent metadata are separate objects, so set both.
        metadata: { order_id: order.id, merchant_id: merchant.id, channel: 'web' },
      },
      metadata: { order_id: order.id, merchant_id: merchant.id },
      success_url: `${config.baseUrl}/store-success.html?session_id={CHECKOUT_SESSION_ID}&merchantId=${merchant.id}&orderId=${order.id}`,
      cancel_url: `${config.baseUrl}/store.html?merchantId=${merchant.id}&cancelled=1`,
    };
    if (customerEmail) params.customer_email = customerEmail;

    const opts = { ...onAccount(merchant), idempotencyKey: idemKey('checkout', order.id) };

    let session;
    try {
      // PayNow is what a Singapore diner actually reaches for. It has to be
      // enabled on the CONNECTED account, so fall back rather than hard-fail
      // for an outlet that hasn't turned it on.
      session = await stripe.checkout.sessions.create(
        { ...params, payment_method_types: ['card', 'paynow'] },
        opts,
      );
    } catch (pmErr) {
      if (!/paynow/i.test(pmErr.message || '')) throw pmErr;
      console.warn('PayNow unavailable on this account, falling back to card:', pmErr.message);
      session = await stripe.checkout.sessions.create(
        { ...params, payment_method_types: ['card'] },
        { ...onAccount(merchant), idempotencyKey: idemKey('checkout-card', order.id) },
      );
    }

    db.orders.update(order.id, { checkout_session_id: session.id });

    logEvent({
      merchantId: merchant.id,
      orderId: order.id,
      kind: 'checkout.session.created',
      message: `Checkout session for ${order.id} — ${(built.totals.total / 100).toFixed(2)} ${currency.toUpperCase()}`,
      payload: { sessionId: session.id, total: built.totals.total, applicationFee: built.fee },
    });

    res.json({ url: session.url, sessionId: session.id, orderId: order.id, totals: built.totals, applicationFee: built.fee });
  } catch (err) {
    console.error('Checkout failed:', describeStripeError(err));
    res.status(400).json(describeStripeError(err));
  }
});

// GET /checkout/status
// Look up a Checkout Session's payment status by session_id (session lives on the connected account)
router.get('/status', async (req, res) => {
  const { session_id, merchantId } = req.query;
  if (!session_id) return res.status(400).json({ error: 'session_id is required' });
  const merchant = db.merchants.findById(merchantId);
  if (!merchant || !merchant.stripe_account_id) return res.status(400).json({ error: 'Unknown merchant account' });

  try {
    const session = await stripe.checkout.sessions.retrieve(
      session_id,
      { expand: ['payment_intent'] },
      onAccount(merchant),
    );

    const pi = session.payment_intent;
    const orderId = session.metadata && session.metadata.order_id;
    const order = orderId ? db.orders.findById(orderId) : null;

    // The reference build polls here instead of waiting on a webhook: the tab
    // is still open and the diner is watching. The webhook handler exists for
    // the cases polling cannot cover — a closed tab, or a dispute.
    if (order && session.payment_status === 'paid' && order.status !== 'paid') {
      db.orders.update(order.id, {
        status: 'paid',
        payment_intent_id: (pi && pi.id) || '',
      });
      logEvent({
        merchantId: merchant.id,
        orderId: order.id,
        kind: 'checkout.session.paid',
        message: `Order ${order.id} paid via Checkout`,
        payload: { sessionId: session.id },
      });
    }

    res.json({
      payment_status: session.payment_status,
      amount_total: session.amount_total,
      currency: session.currency,
      customer_details: session.customer_details,
      payment_method_types: session.payment_method_types,
      application_fee_amount: (pi && pi.application_fee_amount) || null,
      merchant: { id: merchant.id, name: merchant.name, logo_emoji: merchant.logo_emoji },
      order: order ? hydrate(db.orders.findById(order.id)) : null,
    });
  } catch (err) {
    console.error('Checkout status failed:', describeStripeError(err));
    res.status(400).json(describeStripeError(err));
  }
});

module.exports = router;
