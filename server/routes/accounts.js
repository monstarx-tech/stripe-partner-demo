// Task 2.1 — Connected Account Creation
// Lab page: Module 2 → Task 2.1

const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db');

// GET /accounts
// List merchants and their connected-account linkage (local data only, no Stripe calls)
router.get('/', (req, res) => {
  const merchants = db.merchants.all().map(m => ({
    id: m.id,
    name: m.name,
    type: m.type,
    stripe_account_id: m.stripe_account_id,
  }));
  res.json({ merchants });
});

// POST /accounts
// Create a new connected account for a merchant using the v2 Accounts API.
// dashboard: 'express' + fees/losses_collector: 'application' is the v2 equivalent
// of v1's type: 'express'. Payout schedule isn't yet a v2 create param — set it
// afterward via the interoperable v1 stripe.accounts.update() endpoint.
router.post('/', async (req, res) => {
  const { merchantId } = req.body;
  const merchant = db.merchants.findById(merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });

  try {
    // TODO: Create a v2 connected account (stripe.v2.core.accounts.create) with
    // an Express Dashboard, the merchant's country, card_payments capability
    // requested, and fees_collector/losses_collector both set to 'application'.

    // TODO: Set the account's payout schedule to manual (stripe.accounts.update) —
    // Track A's premise is that the platform controls payout timing.

    // TODO: Save the new account id onto the merchant record (db.merchants.update)
    // and respond with { accountId }.
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /accounts/:id/onboard
// Generate a Stripe-hosted onboarding link for the connected account
router.get('/:id/onboard', async (req, res) => {
  const merchant = db.merchants.findById(req.params.id);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (!merchant.stripe_account_id) return res.status(400).json({ error: 'No Stripe account — create one first' });

  try {
    // TODO: Create an Account Link (type: 'account_onboarding') for the merchant's
    // account, with a refresh_url (back to this same endpoint) and a return_url
    // (e.g. the account status endpoint below). Respond with { url }.
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /accounts/:id/status
// Return onboarding status; if the account is fully onboarded, include a dashboard login link
router.get('/:id/status', async (req, res) => {
  const merchant = db.merchants.findById(req.params.id);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (!merchant.stripe_account_id) return res.status(400).json({ error: 'No Stripe account — create one first' });

  try {
    // TODO: Retrieve the account and respond with charges_enabled, payouts_enabled,
    // and details_submitted.

    // TODO: Once details_submitted is true, also create a dashboard login link
    // (stripe.accounts.createLoginLink) and include it as dashboard_url.
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
