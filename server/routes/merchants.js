// Platform-side onboarding — creating a new merchant record on the platform,
// before any Stripe account exists for it (that happens in accounts.js).

const express = require('express');
const router = express.Router();
const db = require('../db');

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// GET /merchants
// List every merchant on the platform
router.get('/', (req, res) => res.json({ merchants: db.merchants.all() }));

// POST /merchants
// Register a new merchant on the platform (no Stripe account yet)
router.post('/', (req, res) => {
  const { name, type } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });

  const base = slugify(name) || 'merchant';
  let id = base;
  let suffix = 1;
  while (db.merchants.findById(id)) {
    id = `${base}_${suffix++}`;
  }

  const { config } = require('../config');
  const merchant = db.merchants.insert({
    id,
    name,
    type,
    stripe_account_id: '',
    payout_schedule: 'manual',
    stripe_location_id: '',
    country: req.body.country || config.platform.country,
    currency: req.body.currency || config.platform.currency,
    fee_bps: config.platform.feeBps,
    service_charge_bps: config.platform.serviceChargeBps,
    gst_bps: config.platform.gstBps,
    cuisine: req.body.cuisine || '',
    brand_color: req.body.brand_color || '#635bff',
    logo_emoji: req.body.logo_emoji || '🍽️',
    onboarding_mode: 'express',
    created_at: new Date().toISOString(),
  });

  res.json(merchant);
});

module.exports = router;
