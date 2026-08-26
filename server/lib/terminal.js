// Terminal helpers shared by the smoke test, the CMS and the POS.

const db = require('../db');
const { config } = require('../config');
const { stripe, onAccount, idemKey } = require('../lib/stripe');

// Every reader — simulated ones included — must belong to a Location.
// Cached on the merchant row so each outlet gets exactly one.
async function ensureLocation(merchant) {
  if (merchant.stripe_location_id) return merchant.stripe_location_id;

  const location = await stripe.terminal.locations.create(
    {
      display_name: merchant.name,
      address: {
        line1: '1 Raffles Place',
        city: 'Singapore',
        postal_code: '048616',
        country: merchant.country || config.platform.country,
      },
    },
    {
      ...onAccount(merchant),
      // Guards the race where two concurrent registrations each create a Location.
      idempotencyKey: idemKey('terminal-location', merchant.id),
    },
  );

  db.merchants.update(merchant.id, { stripe_location_id: location.id });
  return location.id;
}

// Cache a Stripe reader onto our local fleet table.
function cacheReader(merchant, reader, label) {
  const existing = db.readers.findOne(r => r.stripe_reader_id === reader.id);
  const kind = (reader.device_type || '').startsWith('simulated') ? 'simulated' : 'physical';

  if (existing) {
    return db.readers.update(existing.id, {
      status: reader.status || 'unknown',
      label: label || reader.label || existing.label,
    });
  }

  return db.readers.insert({
    id: `rdr_${Date.now().toString(36)}`,
    merchant_id: merchant.id,
    stripe_reader_id: reader.id,
    label: label || reader.label || reader.id,
    kind,
    device_type: reader.device_type || '',
    status: reader.status || 'unknown',
    created_at: new Date().toISOString(),
  });
}

module.exports = { ensureLocation, cacheReader };
