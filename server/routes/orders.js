// Order ledger — shared by the web storefront, the POS, and (later) aggregator
// channels. One table, one bill-composition path, so a dine-in ticket and an
// online order are priced identically.

const express = require('express');
const router = express.Router();
const db = require('../db');
const { config } = require('../config');
const { computeTotals, applicationFee } = require('../lib/money');

// Build an order from product IDs. Prices are ALWAYS looked up server-side —
// a client that posts its own unit_amount is a client that sets its own prices.
function buildOrder(merchant, rawItems, { tip = 0 } = {}) {
  const items = [];

  for (const raw of rawItems || []) {
    const product = db.products.findById(raw.productId || raw.id);
    if (!product) throw new Error(`Unknown product: ${raw.productId || raw.id}`);
    if (product.merchant_id !== merchant.id) throw new Error(`Product ${product.id} does not belong to ${merchant.id}`);

    const quantity = Math.max(1, parseInt(raw.quantity, 10) || 1);
    items.push({
      product_id: product.id,
      name: product.name,
      unit_amount: product.unit_amount,
      quantity,
      image_emoji: product.image_emoji,
    });
  }

  if (!items.length) throw new Error('Order has no items');

  const totals = computeTotals({
    items,
    serviceChargeBps: merchant.service_charge_bps,
    gstBps: merchant.gst_bps,
    tip: parseInt(tip, 10) || 0,
  });

  const fee = applicationFee({
    total: totals.total,
    tip: totals.tip,
    feeBps: merchant.fee_bps || config.platform.feeBps,
  });

  return { items, totals, fee };
}

// Persist an order plus its line items. Returns the stored row.
function saveOrder(merchant, { items, totals, fee }, meta = {}) {
  const id = meta.id || `ord_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

  const order = db.orders.insert({
    id,
    merchant_id: merchant.id,
    amount: totals.total,
    currency: merchant.currency || config.platform.currency,
    status: meta.status || 'pending',
    channel: meta.channel || 'web',
    order_type: meta.orderType || 'takeaway',
    table_number: meta.tableNumber || '',
    subtotal: totals.subtotal,
    service_charge: totals.serviceCharge,
    gst: totals.gst,
    tip: totals.tip,
    application_fee: fee,
    payment_intent_id: '',
    checkout_session_id: '',
    refund_id: '',
    customer_email: meta.customerEmail || '',
    created_at: new Date().toISOString(),
  });

  items.forEach((it, i) => db.orderItems.insert({
    id: `${id}_i${i}`,
    order_id: id,
    product_id: it.product_id,
    name: it.name,
    unit_amount: it.unit_amount,
    quantity: it.quantity,
  }));

  return order;
}

function hydrate(order) {
  return { ...order, items: db.orderItems.where('order_id = ?', order.id) };
}

// POST /orders
router.post('/', (req, res) => {
  const { merchantId, items, channel, orderType, tableNumber, tip, customerEmail } = req.body;
  const merchant = db.merchants.findById(merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });

  try {
    const built = buildOrder(merchant, items, { tip });
    const order = saveOrder(merchant, built, { channel, orderType, tableNumber, customerEmail });
    res.json(hydrate(order));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /orders?merchantId=&limit=&channel=
router.get('/', (req, res) => {
  let rows = db.orders.all();
  if (req.query.merchantId) rows = rows.filter(o => o.merchant_id === req.query.merchantId);
  if (req.query.channel) rows = rows.filter(o => o.channel === req.query.channel);

  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ orders: rows.slice(0, parseInt(req.query.limit, 10) || 25).map(hydrate) });
});

// GET /orders/:id
router.get('/:id', (req, res) => {
  const order = db.orders.findById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(hydrate(order));
});

module.exports = { router, buildOrder, saveOrder, hydrate };
