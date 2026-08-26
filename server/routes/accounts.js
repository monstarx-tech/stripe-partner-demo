// Task 2.1 — Connected Account Creation
// Lab page: Module 2 → Task 2.1
//
// Four Connect decisions applied here, deliberately (see DECISIONS.md):
//   Monetization  buy-rate — fees_collector 'application' + application_fee_amount
//   Merchant risk losses_collector 'application'  (requires fees_collector 'application')
//   Merchant UI   dashboard 'express' — Stripe-hosted onboarding + Express Dashboard
//   Fund flow     direct charges — set at request time via { stripeAccount }, not here

const express = require('express');
const router = express.Router();
const db = require('../db');
const { config } = require('../config');
const { stripe, idemKey, describeStripeError } = require('../lib/stripe');
const { logEvent } = require('../lib/events');
const { sgTestOnboarding } = require('../lib/testdata');

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

// The v2 Accounts API create payload lives here on its own.
//
// stripe-node 22.5.0 ships no TypeScript definitions for v2, so this shape is
// built from the lab spec rather than from types. If Stripe rejects a field,
// this is the single place to adjust — the route surfaces the raw error
// (param + code + requestId) so the fix is obvious.
function buildAccountPayload(merchant, dashboard = 'express') {
  return {
    display_name: merchant.name,
    identity: {
      country: (merchant.country || config.platform.country).toLowerCase(),
      // 'individual', not 'company'. A Singapore COMPANY triggers full KYB:
      // ACRA Bizfile, UEN verification, UBO proof and company-authorization
      // documents — none of which a fictional demo outlet can produce, in test
      // mode or otherwise. 'individual' needs data fields only, no uploads.
      entity_type: 'individual',
    },
    // 'express' — Stripe-hosted onboarding, Stripe owns KYC (lab default).
    // 'none'    — API-based onboarding, the PLATFORM owns KYC and can prefill.
    // This is Module 1's Decision 3, and it is per-client configuration.
    dashboard,
    defaults: {
      currency: merchant.currency || config.platform.currency,
      responsibilities: {
        // Buy-rate model: the platform bears Stripe's processing cost and
        // marks it up via application_fee_amount on each PaymentIntent.
        fees_collector: 'application',
        // Immutable once set, and only valid alongside fees_collector 'application'.
        losses_collector: 'application',
      },
    },
    configuration: {
      merchant: {
        capabilities: {
          card_payments: { requested: true },
        },
      },
    },
    include: ['configuration.merchant', 'identity', 'requirements'],
  };
}

// Accounts v2 requires a one-time enablement on the platform account. Until that
// is done the API returns non_connect_platform_accounts_v2_access_blocked.
//
// Rather than let a Dashboard toggle block the whole build, fall back to v1
// Express. Module 1 states these are equivalent: v2's dashboard 'express' +
// fees/losses_collector 'application' IS v1's type 'express'. The difference is
// where the responsibility config lives — per-account in v2, in the platform's
// Connect settings in v1. Every downstream call (direct charges, Terminal,
// refunds) is identical either way.
function isV2Unavailable(err) {
  return err.code === 'non_connect_platform_accounts_v2_access_blocked'
    || /Accounts v2 is not enabled/i.test(err.message || '');
}

async function createConnectedAccount(merchant, dashboard = 'express') {
  // The idempotency key must include an attempt counter, not just the merchant.
  //
  // Keyed on merchantId alone, Stripe replays the cached response for 24h — so a
  // merchant whose account was closed can never be given a replacement, and any
  // caller that expects a NEW account silently receives the old one instead.
  // That is a genuinely dangerous failure mode: it makes a fresh database look
  // like it created an account when it actually adopted an existing one.
  const attempt = merchant.account_attempt || 0;
  const idempotencyKey = idemKey('account-create', merchant.id, dashboard, String(attempt));

  try {
    const account = await stripe.v2.core.accounts.create(buildAccountPayload(merchant, dashboard), { idempotencyKey });
    return { account, api: 'v2' };
  } catch (err) {
    if (!isV2Unavailable(err)) throw err;

    console.warn('Accounts v2 unavailable on this platform — falling back to v1 Express.');
    const account = await stripe.accounts.create(
      {
        type: 'express',
        country: merchant.country || config.platform.country,
        default_currency: merchant.currency || config.platform.currency,
        business_type: 'company',
        business_profile: {
          name: merchant.name,
          // 5812 = Eating Places / Restaurants. Correct MCC matters for
          // interchange and for Radar rules in F&B.
          mcc: '5812',
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        settings: { payouts: { schedule: { interval: 'manual' } } },
      },
      { idempotencyKey: idempotencyKey + '-v1' },
    );
    return { account, api: 'v1' };
  }
}

// POST /accounts
// Create a new connected account for a merchant using the v2 Accounts API.
router.post('/', async (req, res) => {
  const { merchantId, dashboard = 'express' } = req.body;
  const merchant = db.merchants.findById(merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (!['express', 'none'].includes(dashboard)) {
    return res.status(400).json({ error: "dashboard must be 'express' or 'none'" });
  }

  if (merchant.stripe_account_id) {
    return res.json({ accountId: merchant.stripe_account_id, alreadyExisted: true });
  }

  try {
    const { account, api } = await createConnectedAccount(merchant, dashboard);

    // Payout schedule isn't a v2 create param. Set it afterwards through the
    // interoperable v1 endpoint — Track A's premise is that the PLATFORM
    // controls payout timing, so nothing leaves the outlet automatically.
    // (The v1 fallback already set it at create time; this is idempotent.)
    await stripe.accounts.update(account.id, {
      settings: { payouts: { schedule: { interval: 'manual' } } },
    });

    db.merchants.update(merchant.id, {
      stripe_account_id: account.id,
      payout_schedule: 'manual',
      onboarding_mode: dashboard,
      // Bump so a future re-create gets a fresh idempotency key.
      account_attempt: (merchant.account_attempt || 0) + 1,
    });

    logEvent({
      merchantId: merchant.id,
      kind: 'connect.account.created',
      message: `Connected account created for ${merchant.name}`,
      payload: { accountId: account.id, api, dashboard: 'express', payouts: 'manual' },
    });

    res.json({
      accountId: account.id,
      api,
      dashboard,
      next: dashboard === 'express'
        ? `GET ${config.baseUrl}/accounts/${merchant.id}/onboard`
        : `POST ${config.baseUrl}/accounts/${merchant.id}/prefill-test`,
    });
  } catch (err) {
    console.error('Account create failed:', describeStripeError(err));
    res.status(400).json(describeStripeError(err));
  }
});

// GET /accounts/:id/onboard
// Generate a Stripe-hosted onboarding link for the connected account
router.get('/:id/onboard', async (req, res) => {
  const merchant = db.merchants.findById(req.params.id);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (!merchant.stripe_account_id) return res.status(400).json({ error: 'No Stripe account — create one first' });

  try {
    const link = await stripe.accountLinks.create({
      account: merchant.stripe_account_id,
      // Account Links are single-use and expire. refresh_url sends the merchant
      // back here to mint a fresh one rather than showing them a dead page.
      refresh_url: `${config.baseUrl}/accounts/${merchant.id}/onboard`,
      return_url: `${config.baseUrl}/accounts/${merchant.id}/status`,
      type: 'account_onboarding',
    });

    logEvent({
      merchantId: merchant.id,
      kind: 'connect.onboarding.link',
      message: `Onboarding link generated for ${merchant.name}`,
    });

    // Browser hits this directly from the CMS, so redirect unless JSON is asked for.
    if (req.query.format === 'json') return res.json({ url: link.url });
    res.redirect(link.url);
  } catch (err) {
    console.error('Account link failed:', describeStripeError(err));
    res.status(400).json(describeStripeError(err));
  }
});

// GET /accounts/:id/status
// Return onboarding status; if fully onboarded, include a dashboard login link
router.get('/:id/status', async (req, res) => {
  const merchant = db.merchants.findById(req.params.id);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (!merchant.stripe_account_id) return res.status(400).json({ error: 'No Stripe account — create one first' });

  try {
    const account = await stripe.accounts.retrieve(merchant.stripe_account_id);

    const status = {
      merchantId: merchant.id,
      name: merchant.name,
      accountId: account.id,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
      // Card-present PaymentIntents need charges_enabled — surface it plainly
      // so the POS can explain itself instead of failing cryptically.
      terminal_ready: Boolean(account.charges_enabled),
    };

    status.onboarding_mode = merchant.onboarding_mode || 'express';

    // An Express Dashboard login link only exists for dashboard: 'express'
    // accounts. API-onboarded ('none') merchants have no Stripe-hosted
    // dashboard at all — the platform is their entire UI. Asking anyway
    // returns a 400, so don't, and never let this optional extra take down
    // the status response.
    if (account.details_submitted && status.onboarding_mode === 'express') {
      try {
        const loginLink = await stripe.accounts.createLoginLink(account.id);
        status.dashboard_url = loginLink.url;
      } catch (linkErr) {
        status.dashboard_error = linkErr.message;
      }
    }

    res.json(status);
  } catch (err) {
    console.error('Account status failed:', describeStripeError(err));
    res.status(400).json(describeStripeError(err));
  }
});

// POST /accounts/:id/prefill-test
// API-based onboarding: the platform submits the merchant's KYC on their behalf
// using Stripe test-mode values. Only valid for dashboard: 'none' accounts —
// an Express account's KYC belongs to Stripe and this call returns
// oauth_not_supported by design.
//
// In production this is the same code path an enterprise chain would use to
// bulk-onboard outlets from data it already holds, instead of sending 60
// franchisees through 60 separate browser sessions.
router.post('/:id/prefill-test', async (req, res) => {
  const merchant = db.merchants.findById(req.params.id);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (!merchant.stripe_account_id) return res.status(400).json({ error: 'No Stripe account — create one first' });

  if (merchant.onboarding_mode === 'express') {
    return res.status(400).json({
      error: 'This account uses Stripe-hosted (express) onboarding — the platform cannot submit its KYC.',
      hint: `Open ${config.baseUrl}/accounts/${merchant.id}/onboard instead.`,
    });
  }

  try {
    const account = await stripe.accounts.update(
      merchant.stripe_account_id,
      sgTestOnboarding(merchant),
    );

    // Payout timing stays with the platform (Track A's premise).
    await stripe.accounts.update(merchant.stripe_account_id, {
      settings: { payouts: { schedule: { interval: 'manual' } } },
    });

    logEvent({
      merchantId: merchant.id,
      kind: 'connect.onboarding.prefilled',
      message: `${merchant.name} onboarded via API with test data`,
      payload: { accountId: account.id, charges_enabled: account.charges_enabled },
    });

    res.json({
      accountId: account.id,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
      capabilities: account.capabilities,
      // proof_of_liveness stays outstanding and blocks PAYOUTS only.
      // Charges and Terminal work regardless.
      remaining_requirements: account.requirements.currently_due,
    });
  } catch (err) {
    console.error('Prefill failed:', describeStripeError(err));
    res.status(400).json(describeStripeError(err));
  }
});

module.exports = router;
