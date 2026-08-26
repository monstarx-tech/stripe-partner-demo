// Single Stripe client + the two helpers that would otherwise be copy-pasted
// into every route: connected-account scoping and idempotency keys.

const { config } = require('../config');
const crypto = require('crypto');

const stripe = require('stripe')(config.stripe.secretKey);

// Every call in this platform is a DIRECT CHARGE on the connected account, so
// almost every Stripe call needs { stripeAccount }. Centralising it means one
// place to get it wrong instead of twelve.
function onAccount(merchantOrAccountId) {
  const accountId = typeof merchantOrAccountId === 'string'
    ? merchantOrAccountId
    : merchantOrAccountId && merchantOrAccountId.stripe_account_id;

  if (!accountId) throw new Error('onAccount() called without a connected account id');
  return { stripeAccount: accountId };
}

// Deterministic idempotency key. Same logical operation => same key, so a retry
// (or a double-clicked POS button) never creates a second charge.
function idemKey(...parts) {
  const seed = parts.filter(Boolean).join(':');
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 40);
}

// Stripe errors carry far more than .message. Surfacing the whole shape makes
// the v2 Accounts API (which has no shipped TS types in stripe-node 22.5.0)
// debuggable instead of guesswork.
function describeStripeError(err) {
  return {
    error: err.message,
    type: err.type,
    code: err.code,
    param: err.param,
    statusCode: err.statusCode,
    requestId: err.requestId,
    docUrl: err.doc_url,
  };
}

module.exports = { stripe, onAccount, idemKey, describeStripeError };
