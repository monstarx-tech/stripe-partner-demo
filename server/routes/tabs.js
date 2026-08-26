// F&B running tab — the "unknown final amount" problem.
//
// A guest opens a tab: hold a card now, let rounds accumulate, settle later —
// possibly against a card that left the building hours ago. This is the same
// shape as a hotel folio at check-in, and it is the reason pre-auth exists.
//
// Orchestrates the Terminal primitives rather than reimplementing them:
//   open   payment-intent (manualCapture) -> process (allow_redisplay)
//   close  capture(final) [+ saved-card -> off-session-charge(overage)]

const express = require('express');
const router = express.Router();
const db = require('../db');
const { config } = require('../config');
const { stripe, onAccount, idemKey, describeStripeError } = require('../lib/stripe');
const { logEvent } = require('../lib/events');
const { computeTotals, applicationFee, formatAmount } = require('../lib/money');
const { buildOrder, saveOrder, hydrate } = require('./orders');

function requireMerchant(req, res) {
  const merchant = db.merchants.findById(req.body.merchantId || req.query.merchantId);
  if (!merchant) { res.status(404).json({ error: 'Merchant not found' }); return null; }
  if (!merchant.stripe_account_id) { res.status(400).json({ error: 'Merchant has no Stripe account yet' }); return null; }
  return merchant;
}

// Recompute an order's totals from its current line items. Called every time a
// round is added, so the tab's running total is always the real bill.
function reprice(merchant, order) {
  const items = db.orderItems.where('order_id = ?', order.id);
  const totals = computeTotals({
    items,
    serviceChargeBps: merchant.service_charge_bps,
    gstBps: merchant.gst_bps,
    tip: order.tip || 0,
  });
  const fee = applicationFee({ total: totals.total, tip: totals.tip, feeBps: merchant.fee_bps || config.platform.feeBps });

  db.orders.update(order.id, {
    subtotal: totals.subtotal,
    service_charge: totals.serviceCharge,
    gst: totals.gst,
    amount: totals.total,
    application_fee: fee,
  });

  return { totals, fee };
}

function view(tab) {
  const order = tab.order_id ? db.orders.findById(tab.order_id) : null;
  return {
    ...tab,
    order: order ? hydrate(order) : null,
    runningTotal: order ? order.amount : 0,
    // Negative means the hold still covers the bill.
    overage: order ? Math.max(0, order.amount - tab.hold_amount) : 0,
  };
}

// POST /tabs
// Open a tab: hold `holdAmount` on the guest's card, optionally seeding the
// first round. The reader tap both authorises the hold and leaves behind a
// reusable card for the overage path.
router.post('/', async (req, res) => {
  const merchant = requireMerchant(req, res);
  if (!merchant) return;
  const { holdAmount, items = [], readerId, label, tableNumber } = req.body;

  const hold = parseInt(holdAmount, 10);
  if (!hold || hold < 100) return res.status(400).json({ error: 'holdAmount (in cents, min 100) is required' });

  try {
    // An empty tab still needs an order to hang rounds off.
    let order;
    if (items.length) {
      const built = buildOrder(merchant, items);
      order = saveOrder(merchant, built, { channel: 'pos', orderType: 'tab', tableNumber, status: 'open' });
    } else {
      order = db.orders.insert({
        id: `ord_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
        merchant_id: merchant.id,
        amount: 0, currency: merchant.currency || config.platform.currency, status: 'open',
        channel: 'pos', order_type: 'tab', table_number: tableNumber || '',
        subtotal: 0, service_charge: 0, gst: 0, tip: 0, application_fee: 0,
        payment_intent_id: '', checkout_session_id: '', refund_id: '',
        customer_email: '', created_at: new Date().toISOString(),
      });
    }

    // capture_method manual holds the funds; setup_future_usage makes the tap
    // leave a reusable card behind. Both on the same PaymentIntent.
    const fee = applicationFee({ total: hold, tip: 0, feeBps: merchant.fee_bps || config.platform.feeBps });
    const pi = await stripe.paymentIntents.create(
      {
        amount: hold,
        currency: merchant.currency || config.platform.currency,
        payment_method_types: ['card_present'],
        capture_method: 'manual',
        setup_future_usage: 'off_session',
        application_fee_amount: fee,
        description: `${merchant.name} — tab ${label || order.id}`,
        metadata: { merchant_id: merchant.id, order_id: order.id, channel: 'pos', kind: 'tab_hold' },
      },
      { ...onAccount(merchant), idempotencyKey: idemKey('tab-hold', order.id) },
    );

    db.orders.update(order.id, { payment_intent_id: pi.id });

    const tab = db.tabs.insert({
      id: `tab_${Date.now().toString(36)}`,
      merchant_id: merchant.id,
      order_id: order.id,
      label: label || `Table ${tableNumber || '?'}`,
      hold_amount: hold,
      captured_amount: 0,
      overage_amount: 0,
      payment_intent_id: pi.id,
      overage_payment_intent_id: '',
      saved_payment_method_id: '',
      reader_id: readerId || '',
      status: 'awaiting_card',
      created_at: new Date().toISOString(),
      closed_at: '',
    });

    // allow_redisplay is required whenever setup_future_usage is set — the
    // guest is being told their card will be kept for later.
    let action = null;
    if (readerId) {
      const reader = await stripe.terminal.readers.processPaymentIntent(
        readerId,
        { payment_intent: pi.id, process_config: { allow_redisplay: 'always' } },
        onAccount(merchant),
      );
      action = reader.action && reader.action.status;
    }

    logEvent({
      merchantId: merchant.id,
      orderId: order.id,
      kind: 'tab.opened',
      message: `Tab ${tab.label} opened — ${formatAmount(hold, pi.currency)} hold`,
      payload: { tabId: tab.id, paymentIntentId: pi.id, readerId },
    });

    res.json({ ...view(tab), paymentIntentId: pi.id, action });
  } catch (err) {
    console.error('Tab open failed:', describeStripeError(err));
    res.status(400).json(describeStripeError(err));
  }
});

// GET /tabs?merchantId=&status=
router.get('/', (req, res) => {
  let rows = db.tabs.all();
  if (req.query.merchantId) rows = rows.filter(t => t.merchant_id === req.query.merchantId);
  if (req.query.status) rows = rows.filter(t => t.status === req.query.status);
  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ tabs: rows.map(view) });
});

// GET /tabs/:id — also syncs the hold's state off Stripe
router.get('/:id', async (req, res) => {
  const tab = db.tabs.findById(req.params.id);
  if (!tab) return res.status(404).json({ error: 'Tab not found' });
  const merchant = db.merchants.findById(tab.merchant_id);

  try {
    const pi = await stripe.paymentIntents.retrieve(tab.payment_intent_id, {}, onAccount(merchant));
    // requires_capture means the guest has tapped and the hold is live.
    if (pi.status === 'requires_capture' && tab.status === 'awaiting_card') {
      db.tabs.update(tab.id, { status: 'open' });
    }
    res.json({ ...view(db.tabs.findById(tab.id)), holdStatus: pi.status });
  } catch (err) {
    res.json({ ...view(tab), holdStatus: 'unknown', holdError: err.message });
  }
});

// POST /tabs/:id/items — add a round
router.post('/:id/items', (req, res) => {
  const tab = db.tabs.findById(req.params.id);
  if (!tab) return res.status(404).json({ error: 'Tab not found' });
  if (tab.status === 'closed') return res.status(400).json({ error: 'Tab is already closed' });

  const merchant = db.merchants.findById(tab.merchant_id);
  const order = db.orders.findById(tab.order_id);

  try {
    // Validates products and pricing; we keep the priced items, not its totals.
    const built = buildOrder(merchant, req.body.items);
    const existing = db.orderItems.where('order_id = ?', order.id).length;

    built.items.forEach((it, i) => db.orderItems.insert({
      id: `${order.id}_i${existing + i}`,
      order_id: order.id,
      product_id: it.product_id,
      name: it.name,
      unit_amount: it.unit_amount,
      quantity: it.quantity,
    }));

    const { totals } = reprice(merchant, order);
    const overage = Math.max(0, totals.total - tab.hold_amount);

    logEvent({
      merchantId: merchant.id,
      orderId: order.id,
      kind: 'tab.round_added',
      message: `Round added to ${tab.label} — running total ${formatAmount(totals.total, order.currency)}${overage ? ` (${formatAmount(overage, order.currency)} over hold)` : ''}`,
      payload: { tabId: tab.id, runningTotal: totals.total, overage },
    });

    res.json(view(db.tabs.findById(tab.id)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /tabs/:id/close
// Settle the tab in one call:
//   capture min(final, hold)
//   if the bill ran over, read the saved card and off-session-charge the rest
router.post('/:id/close', async (req, res) => {
  const tab = db.tabs.findById(req.params.id);
  if (!tab) return res.status(404).json({ error: 'Tab not found' });
  if (tab.status === 'closed') return res.status(400).json({ error: 'Tab is already closed' });

  const merchant = db.merchants.findById(tab.merchant_id);
  const order = db.orders.findById(tab.order_id);
  const steps = [];

  try {
    const { totals } = reprice(merchant, order);
    const finalTotal = totals.total;
    if (!finalTotal) return res.status(400).json({ error: 'Tab has no items to settle' });

    // Capture at most what was held. Capturing LESS releases the difference —
    // the common case when a table drinks less than it planned to.
    const captureAmount = Math.min(finalTotal, tab.hold_amount);
    const captured = await stripe.paymentIntents.capture(
      tab.payment_intent_id,
      { amount_to_capture: captureAmount },
      onAccount(merchant),
    );
    steps.push({
      step: 'capture',
      detail: `${formatAmount(captured.amount_received, captured.currency)} captured of a ${formatAmount(tab.hold_amount, captured.currency)} hold`,
      released: Math.max(0, tab.hold_amount - captureAmount),
    });

    let overageAmount = Math.max(0, finalTotal - tab.hold_amount);
    let overagePi = null;
    let savedPm = tab.saved_payment_method_id;

    if (overageAmount > 0) {
      // The reader tap left a reusable card behind precisely for this.
      const pi = await stripe.paymentIntents.retrieve(
        tab.payment_intent_id, { expand: ['latest_charge'] }, onAccount(merchant),
      );
      const cp = pi.latest_charge
        && pi.latest_charge.payment_method_details
        && pi.latest_charge.payment_method_details.card_present;
      savedPm = cp && cp.generated_card;

      if (!savedPm) {
        steps.push({ step: 'saved-card', detail: 'no reusable card on the hold — overage cannot be auto-charged' });
      } else {
        steps.push({ step: 'saved-card', detail: `${savedPm} (${cp.brand} ••${cp.last4})` });

        const fee = applicationFee({ total: overageAmount, tip: 0, feeBps: merchant.fee_bps || config.platform.feeBps });
        overagePi = await stripe.paymentIntents.create(
          {
            amount: overageAmount,
            currency: order.currency,
            payment_method: savedPm,
            off_session: true,
            confirm: true,
            application_fee_amount: fee,
            description: `${merchant.name} — ${tab.label} overage`,
            metadata: { merchant_id: merchant.id, order_id: order.id, tab_id: tab.id, kind: 'overage' },
          },
          { ...onAccount(merchant), idempotencyKey: idemKey('tab-overage', tab.id, String(overageAmount)) },
        );
        steps.push({ step: 'off-session-charge', detail: `${formatAmount(overageAmount, order.currency)} — ${overagePi.status}` });
      }
    }

    db.tabs.update(tab.id, {
      status: 'closed',
      captured_amount: captured.amount_received,
      overage_amount: overagePi ? overageAmount : 0,
      overage_payment_intent_id: overagePi ? overagePi.id : '',
      saved_payment_method_id: savedPm || '',
      closed_at: new Date().toISOString(),
    });
    db.orders.update(order.id, { status: 'paid' });

    logEvent({
      merchantId: merchant.id,
      orderId: order.id,
      kind: 'tab.closed',
      message: `Tab ${tab.label} closed — ${formatAmount(finalTotal, order.currency)} settled`
        + (overagePi ? ` (${formatAmount(overageAmount, order.currency)} off-session)` : ''),
      payload: { tabId: tab.id, captured: captured.amount_received, overage: overageAmount },
    });

    res.json({ ...view(db.tabs.findById(tab.id)), finalTotal, steps });
  } catch (err) {
    console.error('Tab close failed:', describeStripeError(err));
    res.status(400).json({ ...describeStripeError(err), steps });
  }
});

module.exports = router;
