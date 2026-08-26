// Task 2.4 — Webhook Handler
// Lab page: Module 2 → Task 2.4
//
// Before testing: run `stripe listen --forward-to localhost:3000/webhooks`
// Copy the webhook signing secret it prints into your .env as STRIPE_WEBHOOK_SECRET

const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db');

// POST /webhooks
// Receives Stripe events — raw body required (configured in index.js)
router.post('/', (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // TODO: On payment_intent.succeeded, look up the order by
  // event.data.object.metadata.order_id and mark it paid (db.orders.update).

  // TODO: On payment_intent.payment_failed, log the failure reason
  // (event.data.object.last_payment_error?.message).

  res.json({ received: true });
});

module.exports = router;
