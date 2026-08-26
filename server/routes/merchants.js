// Platform-side onboarding — creating a new merchant record on the platform,
// before any Stripe account exists for it (that happens in accounts.js).

const express = require('express');
const router = express.Router();
const db = require('../db');

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

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

  const merchant = db.merchants.insert({
    id,
    name,
    type,
    stripe_account_id: '',
    payout_schedule: 'manual',
    stripe_location_id: '',
  });

  res.json(merchant);
});

module.exports = router;
