// Task 2.2 — Online Payment (Checkout Session)
// Lab page: Module 2 → Task 2.2

const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db');

// POST /checkout
// Create a Checkout Session as a direct charge on the connected account —
// the merchant is the merchant of record and pays Stripe's processing fee;
// application_fee_amount is the platform's cut, routed to the platform automatically.
router.post('/', async (req, res) => {
  const { merchantId, items } = req.body;
  const merchant = db.merchants.findById(merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (!merchant.stripe_account_id) return res.status(400).json({ error: 'Merchant has no Stripe account yet' });

  try {
    // TODO: Build Checkout Session line items from `items` (name, unit_amount, quantity).

    // TODO: Compute the platform's application fee (2.5% of the order total) and
    // create the Checkout Session as a direct charge on the connected account
    // (mode: 'payment', payment_intent_data.application_fee_amount, success_url,
    // cancel_url). Respond with { url: session.url }.
  } catch (err) {
    res.status(400).json({ error: err.message });
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
    // TODO: Retrieve the Checkout Session on the connected account and respond
    // with its payment_status, amount_total, currency, and customer_details.
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
