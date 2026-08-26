// Platform CMS API — everything the operator console needs that isn't a
// Stripe money-movement call: merchant config, menu CRUD, reader fleet,
// and the activity feed.

const express = require('express');
const router = express.Router();
const db = require('../db');
const { config } = require('../config');
const { stripe, onAccount, describeStripeError } = require('../lib/stripe');
const { logEvent, recentEvents } = require('../lib/events');

// GET /platform/merchants
// Local data only — no Stripe round-trip, so the console paints instantly.
// Live account status is fetched per-row from /accounts/:id/status.
router.get('/merchants', (req, res) => {
  res.json({ merchants: db.merchants.all().map(m => ({
    ...m,
    product_count: db.products.where('merchant_id = ?', m.id).length,
    // Lets the POS default to an outlet that can actually take a payment,
    // without a Stripe round-trip per merchant on page load.
    reader_count: db.readers.where('merchant_id = ?', m.id).length,
  })) });
});

// PATCH /platform/merchants/:id
// The per-client "30%" configuration surface: fee rate, statutory rates,
// currency, branding. Everything behind it ships unchanged between clients.
const EDITABLE = [
  'name', 'type', 'cuisine', 'country', 'currency',
  'fee_bps', 'service_charge_bps', 'gst_bps',
  'brand_color', 'logo_emoji',
];

router.patch('/merchants/:id', (req, res) => {
  const merchant = db.merchants.findById(req.params.id);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });

  const changes = {};
  for (const key of EDITABLE) {
    if (req.body[key] !== undefined) {
      changes[key] = ['fee_bps', 'service_charge_bps', 'gst_bps'].includes(key)
        ? parseInt(req.body[key], 10)
        : req.body[key];
    }
  }
  if (!Object.keys(changes).length) return res.status(400).json({ error: 'No editable fields supplied' });

  const updated = db.merchants.update(merchant.id, changes);
  logEvent({
    merchantId: merchant.id,
    kind: 'platform.config.updated',
    message: `Config updated for ${merchant.name}`,
    payload: changes,
  });
  res.json(updated);
});

// ---------------------------------------------------------------------------
// Menu CRUD — shared by the storefront and the POS, so one edit lands on both
// ---------------------------------------------------------------------------
router.get('/merchants/:id/products', (req, res) => {
  const merchant = db.merchants.findById(req.params.id);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });

  // A menu reads Mains -> Sides -> Drinks -> Desserts. Alphabetical ordering
  // opens the storefront on the dessert list, which is not how anyone orders.
  const CATEGORY_ORDER = ['Mains', 'Sides', 'Drinks', 'Desserts'];
  const rank = c => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };

  const products = db.products
    .where('merchant_id = ?', merchant.id)
    .filter(p => (req.query.all === 'true' ? true : p.active))
    .sort((a, b) => rank(a.category) - rank(b.category) || a.sort_order - b.sort_order);

  res.json({ merchant, products });
});

router.post('/merchants/:id/products', (req, res) => {
  const merchant = db.merchants.findById(req.params.id);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });

  const { name, description = '', category = 'Mains', unit_amount, image_emoji = '' } = req.body;
  if (!name || !unit_amount) return res.status(400).json({ error: 'name and unit_amount are required' });

  const existing = db.products.where('merchant_id = ?', merchant.id);
  const product = db.products.insert({
    id: `${merchant.id}_p${Date.now().toString(36)}`,
    merchant_id: merchant.id,
    name,
    description,
    category,
    unit_amount: parseInt(unit_amount, 10),
    currency: merchant.currency || config.platform.currency,
    image_emoji,
    sort_order: existing.length,
    active: 1,
  });

  res.json(product);
});

router.patch('/products/:id', (req, res) => {
  const product = db.products.findById(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const changes = {};
  for (const key of ['name', 'description', 'category', 'unit_amount', 'image_emoji', 'active']) {
    if (req.body[key] !== undefined) {
      changes[key] = ['unit_amount', 'active'].includes(key)
        ? parseInt(req.body[key], 10)
        : req.body[key];
    }
  }
  if (!Object.keys(changes).length) return res.status(400).json({ error: 'No editable fields supplied' });

  res.json(db.products.update(product.id, changes));
});

router.delete('/products/:id', (req, res) => {
  const product = db.products.findById(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  db.products.remove(product.id);
  res.json({ deleted: product.id });
});

// ---------------------------------------------------------------------------
// Reader fleet — local cache refreshed from Stripe on demand
// ---------------------------------------------------------------------------
router.get('/readers', async (req, res) => {
  const merchant = db.merchants.findById(req.query.merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (!merchant.stripe_account_id) return res.json({ readers: [] });

  try {
    const live = await stripe.terminal.readers.list({ limit: 20 }, onAccount(merchant));

    // Reconcile Stripe's view onto our local rows so the console shows fresh
    // status without the POS having to call Stripe on every paint.
    for (const r of live.data) {
      const local = db.readers.findOne(x => x.stripe_reader_id === r.id);
      if (local) {
        db.readers.update(local.id, { status: r.status || 'unknown', label: r.label || local.label });
      } else {
        db.readers.insert({
          id: `rdr_${Date.now()}_${Math.abs(r.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0))}`,
          merchant_id: merchant.id,
          stripe_reader_id: r.id,
          label: r.label || r.id,
          kind: (r.device_type || '').startsWith('simulated') ? 'simulated' : 'physical',
          device_type: r.device_type || '',
          status: r.status || 'unknown',
          created_at: new Date().toISOString(),
        });
      }
    }

    res.json({
      readers: live.data.map(r => ({
        id: r.id,
        label: r.label,
        status: r.status,
        device_type: r.device_type,
        kind: (r.device_type || '').startsWith('simulated') ? 'simulated' : 'physical',
      })),
    });
  } catch (err) {
    res.status(400).json(describeStripeError(err));
  }
});

// GET /platform/events?merchantId=&since=
// Feeds the activity panel. `since` makes it a cheap incremental poll.
router.get('/events', (req, res) => {
  res.json({
    events: recentEvents({
      merchantId: req.query.merchantId,
      since: parseInt(req.query.since, 10) || 0,
      limit: parseInt(req.query.limit, 10) || 50,
    }),
  });
});

// GET /platform/reconciliation?merchantId=
// What the platform actually earned, and — just as importantly — which revenue
// never touched Stripe at all.
//
// Module 1 plants this as a scoping trap: delivery aggregators (GrabFood,
// Foodpanda) and OTAs collect payment themselves and remit net proceeds
// separately. Those orders have no PaymentIntent and no application fee, and
// assuming otherwise is how a reconciliation design goes wrong. We record them
// as a channel so the gap is explicit rather than silently missing.
router.get('/reconciliation', (req, res) => {
  const merchants = db.merchants.all()
    .filter(m => !req.query.merchantId || m.id === req.query.merchantId);

  const blank = () => ({ orders: 0, gross: 0, platformFee: 0, netToMerchant: 0, refunded: 0 });
  const totals = blank();
  const byChannel = {};

  const rows = merchants.map(m => {
    const orders = db.orders.where('merchant_id = ?', m.id);
    const summary = blank();

    for (const o of orders) {
      const settled = ['paid', 'refunded', 'partially_refunded'].includes(o.status);
      if (!settled) continue;

      const channel = o.channel || 'web';
      byChannel[channel] = byChannel[channel] || blank();

      // Aggregator revenue is recognised but carries no Stripe fee — the money
      // never flowed through us.
      const fee = channel === 'aggregator' ? 0 : (o.application_fee || 0);
      const refunded = o.status === 'refunded' ? o.amount : 0;

      for (const bucket of [summary, totals, byChannel[channel]]) {
        bucket.orders += 1;
        bucket.gross += o.amount;
        bucket.platformFee += fee;
        bucket.netToMerchant += o.amount - fee;
        bucket.refunded += refunded;
      }
    }

    return {
      merchantId: m.id,
      name: m.name,
      logo_emoji: m.logo_emoji,
      currency: m.currency,
      feeBps: m.fee_bps,
      accountId: m.stripe_account_id,
      payoutSchedule: m.payout_schedule,
      ...summary,
    };
  });

  res.json({
    totals,
    byChannel,
    merchants: rows,
    note: 'Aggregator-channel orders are recorded for revenue but carry no Stripe fee — those funds are collected by the aggregator and remitted separately. They require their own reconciliation path.',
  });
});

module.exports = router;
