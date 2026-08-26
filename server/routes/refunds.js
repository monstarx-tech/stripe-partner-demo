// Track A — Task 3A.2: Refund with Clawback
// Lab page: Module 3A → Task 3A.2

const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db');

// POST /refunds
// Refund a direct charge on the connected account and claw back the platform fee
router.post('/', async (req, res) => {
  const { paymentIntentId, merchantId, reason = 'requested_by_customer' } = req.body;
  const merchant = db.merchants.findById(merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (!merchant.stripe_account_id) return res.status(400).json({ error: 'Merchant has no Stripe account yet' });

  try {
    // TODO: Create a refund for paymentIntentId on the connected account, with
    // refund_application_fee: true so the platform forgoes its fee too.
    // Note: reverse_transfer does not apply here — these are direct charges, so
    // there is no transfer to reverse (the connected account is merchant of record).
    // Respond with { refundId, amount, status }.
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
