// Phase 0 smoke test — validates the physical S710 path end to end before the
// rest of the build depends on it.
//
// Highest-risk assumption in this project: a physical reader registered to a
// TEST-mode account only completes taps with a physical Stripe TEST card.
// presentPaymentMethod (the software "tap") works on SIMULATED readers only —
// it cannot drive real hardware. Find that out here, in minute five, not at
// hour fourteen.

const express = require('express');
const router = express.Router();
const db = require('../db');
const { config } = require('../config');
const { stripe, onAccount, idemKey, describeStripeError } = require('../lib/stripe');
const { logEvent } = require('../lib/events');
const { applicationFee, formatAmount } = require('../lib/money');
const { ensureLocation, cacheReader } = require('../lib/terminal');

// GET /smoke/preflight?merchantId=merchant_001
// Answers "what is blocking me right now" without touching the reader.
router.get('/preflight', async (req, res) => {
  const merchantId = req.query.merchantId || 'merchant_001';
  const merchant = db.merchants.findById(merchantId);

  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  add('STRIPE_SECRET_KEY set', Boolean(config.stripe.secretKey),
      config.stripe.secretKey ? `${config.stripe.secretKey.slice(0, 12)}…` : 'missing — add to .env');
  add('Test-mode key', config.stripe.secretKey.startsWith('sk_test_'),
      config.stripe.secretKey.startsWith('sk_test_') ? 'ok' : 'must be sk_test_');
  add('BASE_URL set', Boolean(config.baseUrl), config.baseUrl);
  add('Merchant exists', Boolean(merchant), merchantId);

  if (!merchant) return res.status(404).json({ ok: false, checks });

  add('Connected account', Boolean(merchant.stripe_account_id),
      merchant.stripe_account_id || 'none — POST /accounts { merchantId } first');

  if (merchant.stripe_account_id) {
    try {
      const account = await stripe.accounts.retrieve(merchant.stripe_account_id);
      add('details_submitted', account.details_submitted,
          account.details_submitted ? 'onboarded' : 'open GET /accounts/' + merchant.id + '/onboard');
      add('charges_enabled', account.charges_enabled,
          account.charges_enabled ? 'ok' : 'required before card_present PaymentIntents work');

      if (account.charges_enabled) {
        const readers = await stripe.terminal.readers.list({ limit: 10 }, onAccount(merchant));
        add('Readers registered', readers.data.length > 0,
            readers.data.length
              ? readers.data.map(r => `${r.label || r.id} [${r.device_type}] ${r.status}`).join(', ')
              : 'none — POST /smoke/s710 with a registrationCode');
      }
    } catch (err) {
      add('Stripe reachable', false, describeStripeError(err).error);
    }
  }

  add('Terminal Location', Boolean(merchant.stripe_location_id),
      merchant.stripe_location_id || 'created lazily on first reader registration');

  res.json({ ok: checks.every(c => c.ok), merchantId, checks });
});

// POST /smoke/s710
// { merchantId, registrationCode, label?, amount? }
//
// registrationCode:
//   physical S710 — Settings > generate pairing code (three words)
//   simulated     — "simulated-s710" | "simulated-s700" | "simulated-wpe"
router.post('/s710', async (req, res) => {
  const { merchantId = 'merchant_001', registrationCode, label = 'Smoke Test Reader', amount = 100 } = req.body;

  if (!registrationCode) {
    return res.status(400).json({
      error: 'registrationCode is required',
      hint: 'Physical S710: Settings > generate pairing code. Or use "simulated-s710".',
    });
  }

  const merchant = db.merchants.findById(merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (!merchant.stripe_account_id) {
    return res.status(400).json({ error: 'Merchant has no Stripe account — POST /accounts { merchantId } first' });
  }

  const trace = [];
  const step = (name, detail) => { trace.push({ step: trace.length + 1, name, detail }); };

  try {
    const locationId = await ensureLocation(merchant);
    step('ensureLocation', locationId);

    const reader = await stripe.terminal.readers.create(
      { registration_code: registrationCode, label, location: locationId },
      onAccount(merchant),
    );
    step('readers.create', `${reader.id} [${reader.device_type}] status=${reader.status}`);

    const isSimulated = registrationCode.startsWith('simulated-');
    db.readers.insert({
      id: `rdr_${Date.now()}`,
      merchant_id: merchant.id,
      stripe_reader_id: reader.id,
      label,
      kind: isSimulated ? 'simulated' : 'physical',
      device_type: reader.device_type || '',
      status: reader.status || 'unknown',
      created_at: new Date().toISOString(),
    });

    const fee = applicationFee({ total: amount, tip: 0, feeBps: merchant.fee_bps || config.platform.feeBps });
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount,
        currency: merchant.currency || config.platform.currency,
        payment_method_types: ['card_present'],
        capture_method: 'automatic',
        application_fee_amount: fee,
        description: `Smoke test — ${merchant.name}`,
        metadata: { smoke_test: 'true', merchant_id: merchant.id },
      },
      { ...onAccount(merchant), idempotencyKey: idemKey('smoke-pi', merchant.id, String(Date.now())) },
    );
    step('paymentIntents.create', `${paymentIntent.id} ${formatAmount(amount, merchant.currency)} fee=${formatAmount(fee, merchant.currency)}`);

    const pushed = await stripe.terminal.readers.processPaymentIntent(
      reader.id,
      { payment_intent: paymentIntent.id },
      onAccount(merchant),
    );
    step('readers.processPaymentIntent', `action=${pushed.action && pushed.action.status}`);

    logEvent({
      merchantId: merchant.id,
      kind: 'smoke.s710',
      message: `Smoke test pushed ${formatAmount(amount, merchant.currency)} to ${label}`,
      payload: { readerId: reader.id, paymentIntentId: paymentIntent.id },
    });

    res.json({
      ok: true,
      readerId: reader.id,
      readerKind: isSimulated ? 'simulated' : 'physical',
      paymentIntentId: paymentIntent.id,
      trace,
      next: isSimulated
        ? `POST /smoke/tap { "merchantId": "${merchant.id}", "readerId": "${reader.id}" }`
        : 'Tap a physical Stripe TEST card on the reader now, then poll /smoke/status',
    });
  } catch (err) {
    const described = describeStripeError(err);
    console.error('S710 smoke test failed:', described);
    res.status(400).json({ ok: false, failedAtStep: trace.length + 1, trace, ...described });
  }
});

// POST /smoke/tap — { merchantId, readerId }
// Software card tap. SIMULATED readers only — this cannot drive a physical S710.
router.post('/tap', async (req, res) => {
  const { merchantId = 'merchant_001', readerId } = req.body;
  const merchant = db.merchants.findById(merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (!readerId) return res.status(400).json({ error: 'readerId is required' });

  try {
    const reader = await stripe.testHelpers.terminal.readers.presentPaymentMethod(
      readerId, {}, onAccount(merchant),
    );
    res.json({ ok: true, readerId, action: reader.action && reader.action.status });
  } catch (err) {
    res.status(400).json({
      ok: false,
      ...describeStripeError(err),
      hint: 'presentPaymentMethod works on simulated readers only. A physical S710 needs a real tap with a physical Stripe test card.',
    });
  }
});

// GET /smoke/status?merchantId=&paymentIntentId=
router.get('/status', async (req, res) => {
  const { merchantId = 'merchant_001', paymentIntentId } = req.query;
  const merchant = db.merchants.findById(merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (!paymentIntentId) return res.status(400).json({ error: 'paymentIntentId is required' });

  try {
    // retrieve(id, params, options) — the connected-account scope is the THIRD
    // argument. Passing it second makes Stripe parse it as a query param and
    // reject it with parameter_unknown: stripeAccount.
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {}, onAccount(merchant));
    res.json({
      status: pi.status,
      amount: pi.amount,
      amount_received: pi.amount_received,
      application_fee_amount: pi.application_fee_amount,
      currency: pi.currency,
      display: formatAmount(pi.amount, pi.currency),
    });
  } catch (err) {
    res.status(400).json(describeStripeError(err));
  }
});

module.exports = { router };
