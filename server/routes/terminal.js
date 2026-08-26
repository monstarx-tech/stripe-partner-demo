// Task 2.3 — Terminal Payment (server-driven integration)
// Lab page: Module 2 → Task 2.3
//
// Server-driven: no client SDK. The restaurant's POS calls these routes and the
// S710 is driven entirely over the Stripe API. The reader talks to Stripe's
// cloud, not to this server, so it needs no LAN access and works identically
// against localhost or a deployed host.

const express = require('express');
const router = express.Router();
const db = require('../db');
const { config } = require('../config');
const { stripe, onAccount, idemKey, describeStripeError } = require('../lib/stripe');
const { logEvent } = require('../lib/events');
const { ensureLocation, cacheReader } = require('../lib/terminal');
const { applicationFee, formatAmount } = require('../lib/money');
const { buildOrder, saveOrder, hydrate } = require('./orders');

function requireMerchantWithAccount(req, res) {
  const merchant = db.merchants.findById(req.body.merchantId || req.query.merchantId);
  if (!merchant) { res.status(404).json({ error: 'Merchant not found' }); return null; }
  if (!merchant.stripe_account_id) { res.status(400).json({ error: 'Merchant has no Stripe account yet' }); return null; }
  return merchant;
}

// POST /terminal/readers/register
// One-time setup: register a physical S710 using the registration code shown on its screen
router.post('/readers/register', async (req, res) => {
  const merchant = requireMerchantWithAccount(req, res);
  if (!merchant) return;
  const { registrationCode, label } = req.body;

  try {
    const locationId = await ensureLocation(merchant);
    const reader = await stripe.terminal.readers.create(
      { registration_code: registrationCode, label: label || 'Reader', location: locationId },
      onAccount(merchant),
    );

    cacheReader(merchant, reader, label);
    logEvent({
      merchantId: merchant.id,
      kind: 'terminal.reader.registered',
      message: `Reader ${reader.label || reader.id} registered to ${merchant.name}`,
      payload: { readerId: reader.id, deviceType: reader.device_type, locationId },
    });

    res.json({ readerId: reader.id, status: reader.status, deviceType: reader.device_type });
  } catch (err) {
    console.error('Reader registration failed:', describeStripeError(err));
    res.status(400).json(describeStripeError(err));
  }
});

// GET /terminal/readers
// List readers registered to a merchant's connected account
router.get('/readers', async (req, res) => {
  const merchant = requireMerchantWithAccount(req, res);
  if (!merchant) return;

  try {
    const readers = await stripe.terminal.readers.list({ limit: 20 }, onAccount(merchant));
    res.json({
      readers: readers.data.map(r => ({
        id: r.id,
        label: r.label,
        status: r.status,
        deviceType: r.device_type,
        kind: (r.device_type || '').startsWith('simulated') ? 'simulated' : 'physical',
      })),
    });
  } catch (err) {
    res.status(400).json(describeStripeError(err));
  }
});

// POST /terminal/payment-intent
// Create a direct-charge PaymentIntent on the connected account for a card-present payment.
//
// Accepts either a raw `amount`, or `items` — in which case the order is built
// and priced server-side and persisted to the shared ledger, exactly as the
// web channel does.
//
// Extension (pre-auth / "open tab"): manualCapture: true holds the auth instead
// of charging, and marks the card reusable off-session later.
router.post('/payment-intent', async (req, res) => {
  const merchant = requireMerchantWithAccount(req, res);
  if (!merchant) return;
  const { amount, items, manualCapture, tableNumber, orderType } = req.body;

  try {
    let order = null;
    let chargeAmount = parseInt(amount, 10) || 0;
    let fee;

    if (items && items.length) {
      const built = buildOrder(merchant, items);
      order = saveOrder(merchant, built, {
        channel: 'pos',
        orderType: orderType || (manualCapture ? 'tab' : 'dine_in'),
        tableNumber,
      });
      chargeAmount = built.totals.total;
      fee = built.fee;
    } else {
      if (!chargeAmount) return res.status(400).json({ error: 'amount or items is required' });
      fee = applicationFee({ total: chargeAmount, tip: 0, feeBps: merchant.fee_bps || config.platform.feeBps });
    }

    const params = {
      amount: chargeAmount,
      currency: merchant.currency || config.platform.currency,
      payment_method_types: ['card_present'],
      capture_method: manualCapture ? 'manual' : 'automatic',
      application_fee_amount: fee,
      description: `${merchant.name} — ${order ? order.id : 'terminal sale'}`,
      metadata: {
        merchant_id: merchant.id,
        channel: 'pos',
        ...(order ? { order_id: order.id } : {}),
        ...(tableNumber ? { table_number: String(tableNumber) } : {}),
      },
    };

    // Holding a card for a tab means charging it again after the guest leaves.
    // setup_future_usage makes the reader tap produce a reusable PaymentMethod.
    if (manualCapture) params.setup_future_usage = 'off_session';

    const paymentIntent = await stripe.paymentIntents.create(params, {
      ...onAccount(merchant),
      idempotencyKey: idemKey('terminal-pi', order ? order.id : `${merchant.id}-${chargeAmount}-${Date.now()}`),
    });

    if (order) db.orders.update(order.id, { payment_intent_id: paymentIntent.id });

    logEvent({
      merchantId: merchant.id,
      orderId: order ? order.id : '',
      kind: manualCapture ? 'terminal.preauth.created' : 'terminal.payment_intent.created',
      message: `${manualCapture ? 'Pre-auth hold' : 'Card-present charge'} ${formatAmount(chargeAmount, merchant.currency)} — fee ${formatAmount(fee, merchant.currency)}`,
      payload: { paymentIntentId: paymentIntent.id, amount: chargeAmount, applicationFee: fee, manualCapture: !!manualCapture },
    });

    res.json({
      paymentIntentId: paymentIntent.id,
      amount: chargeAmount,
      applicationFee: fee,
      captureMethod: params.capture_method,
      orderId: order ? order.id : null,
      order: order ? hydrate(order) : null,
    });
  } catch (err) {
    console.error('Terminal PaymentIntent failed:', describeStripeError(err));
    res.status(400).json(describeStripeError(err));
  }
});

// POST /terminal/process
// Push a PaymentIntent to a reader — the guest taps/inserts their card on the S710.
//
// allowRedisplay is required when the PaymentIntent has setup_future_usage set
// (the tab pre-auth), because the card is being stored for later.
//
// tipEligibleAmount turns on ON-READER TIPPING: the S710 renders tip options
// against that base. The tip raises the PaymentIntent's amount but NOT its
// application_fee_amount, which was fixed at creation — so the platform
// deliberately takes no cut of staff tips.
router.post('/process', async (req, res) => {
  const merchant = requireMerchantWithAccount(req, res);
  if (!merchant) return;
  const { readerId, paymentIntentId, allowRedisplay, tipEligibleAmount } = req.body;

  const processConfig = {};
  if (allowRedisplay) processConfig.allow_redisplay = allowRedisplay;
  if (tipEligibleAmount) processConfig.tipping = { amount_eligible: parseInt(tipEligibleAmount, 10) };

  const push = cfg => stripe.terminal.readers.processPaymentIntent(
    readerId,
    { payment_intent: paymentIntentId, ...(Object.keys(cfg).length ? { process_config: cfg } : {}) },
    onAccount(merchant),
  );

  try {
    let reader;
    try {
      reader = await push(processConfig);
    } catch (tipErr) {
      // Tipping support varies by currency and reader firmware. Losing the tip
      // prompt is better than losing the sale.
      if (!processConfig.tipping || !/tipping|amount_eligible/i.test(tipErr.message || '')) throw tipErr;
      console.warn('On-reader tipping rejected, retrying without it:', tipErr.message);
      delete processConfig.tipping;
      reader = await push(processConfig);
    }

    logEvent({
      merchantId: merchant.id,
      kind: 'terminal.process',
      message: `Pushed ${paymentIntentId} to ${reader.label || readerId}`,
      payload: { readerId, paymentIntentId, action: reader.action && reader.action.status, tipping: !!processConfig.tipping },
    });

    res.json({ readerId, action: reader.action && reader.action.status, tipping: !!processConfig.tipping });
  } catch (err) {
    console.error('Terminal process failed:', describeStripeError(err));
    res.status(400).json(describeStripeError(err));
  }
});

// POST /terminal/simulate-card
// Test-mode only: simulates a card tap. SIMULATED readers only — this cannot
// drive a physical S710, which needs a real tap with a physical test card.
router.post('/simulate-card', async (req, res) => {
  const merchant = requireMerchantWithAccount(req, res);
  if (!merchant) return;
  const { readerId } = req.body;

  try {
    const reader = await stripe.testHelpers.terminal.readers.presentPaymentMethod(
      readerId, {}, onAccount(merchant),
    );
    logEvent({
      merchantId: merchant.id,
      kind: 'terminal.simulate_card',
      message: `Simulated card tap on ${readerId}`,
    });
    res.json({ readerId, action: reader.action && reader.action.status });
  } catch (err) {
    res.status(400).json({
      ...describeStripeError(err),
      hint: 'Simulated readers only. A physical S710 needs a real tap with a physical Stripe test card.',
    });
  }
});

// GET /terminal/payment-intent/:id/status
// Poll after pushing to a reader. Reconciles the order on the way through.
router.get('/payment-intent/:id/status', async (req, res) => {
  const merchant = requireMerchantWithAccount(req, res);
  if (!merchant) return;

  try {
    // retrieve(id, params, options) — the connected-account scope is the THIRD
    // argument. Passed second, Stripe parses it as a query param.
    const pi = await stripe.paymentIntents.retrieve(req.params.id, {}, onAccount(merchant));

    const order = db.orders.findOne(o => o.payment_intent_id === pi.id);
    if (order) {
      const next = pi.status === 'succeeded' ? 'paid'
        : pi.status === 'requires_capture' ? 'authorized'
        : order.status;

      const tip = Math.max(0, pi.amount - (order.subtotal + order.service_charge + order.gst));
      const changes = {};
      if (next !== order.status) changes.status = next;
      if (tip !== order.tip) { changes.tip = tip; changes.amount = pi.amount; }
      if (Object.keys(changes).length) db.orders.update(order.id, changes);

      if (next === 'paid' && order.status !== 'paid') {
        logEvent({
          merchantId: merchant.id,
          orderId: order.id,
          kind: 'terminal.payment.succeeded',
          message: `Order ${order.id} paid in person — ${formatAmount(pi.amount, pi.currency)}${tip ? ` (incl. ${formatAmount(tip, pi.currency)} tip)` : ''}`,
        });
      }
    }

    res.json({
      status: pi.status,
      amount: pi.amount,
      amount_capturable: pi.amount_capturable,
      amount_received: pi.amount_received,
      application_fee_amount: pi.application_fee_amount,
      currency: pi.currency,
      orderId: order ? order.id : null,
      // Anything above the priced bill is an on-reader tip.
      tip: order ? Math.max(0, pi.amount - (order.subtotal + order.service_charge + order.gst)) : 0,
    });
  } catch (err) {
    res.status(400).json(describeStripeError(err));
  }
});

module.exports = router;
