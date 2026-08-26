// Central config. Everything env-driven so the same build runs locally and on
// Railway with no code changes.

require('dotenv').config();

const int = (v, fallback) => (v === undefined || v === '' ? fallback : parseInt(v, 10));

const config = {
  port: int(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  get isProd() { return this.nodeEnv === 'production'; },

  // Public origin of this server. Drives Connect onboarding refresh/return URLs
  // and Checkout success/cancel URLs — must be the PUBLIC url once deployed.
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),

  // SQLite location. On Railway this points at the mounted volume (/data/lab.db)
  // so the database survives redeploys.
  dbPath: process.env.DB_PATH || './lab.db',

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },

  // Platform-wide defaults. Each merchant row can override these — this is the
  // "30%" configuration surface the Partner Solutions 70/30 rule talks about.
  platform: {
    feeBps: int(process.env.PLATFORM_FEE_BPS, 250),        // 2.50%
    country: (process.env.DEFAULT_COUNTRY || 'SG').toUpperCase(),
    currency: (process.env.DEFAULT_CURRENCY || 'sgd').toLowerCase(),
    serviceChargeBps: int(process.env.DEFAULT_SERVICE_CHARGE_BPS, 1000), // 10%
    gstBps: int(process.env.DEFAULT_GST_BPS, 900),                       // 9% SG GST
  },
};

// Fail loudly at boot rather than with a confusing Stripe 401 on first request.
function assertStripeKey() {
  if (!config.stripe.secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not set. Copy .env.example to .env and add your sk_test_ key.');
  }
  if (config.stripe.secretKey.startsWith('sk_live_')) {
    throw new Error('Refusing to start with a LIVE Stripe key. This project is test-mode only.');
  }
}

module.exports = { config, assertStripeKey };
