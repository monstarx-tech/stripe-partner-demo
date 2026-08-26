// Singapore F&B bill composition + platform fee maths.
// All amounts are integer minor units (cents). Never floats.

// SG restaurants bill in a specific order: service charge applies to the
// subtotal, then GST applies to (subtotal + service charge) — GST is charged on
// the service charge too. Getting this order wrong under-collects GST.
function computeTotals({ items = [], serviceChargeBps = 0, gstBps = 0, tip = 0 }) {
  const subtotal = items.reduce((sum, i) => sum + i.unit_amount * i.quantity, 0);
  const serviceCharge = Math.round((subtotal * serviceChargeBps) / 10000);
  const gst = Math.round(((subtotal + serviceCharge) * gstBps) / 10000);
  const total = subtotal + serviceCharge + gst + tip;

  return { subtotal, serviceCharge, gst, tip, total };
}

// The platform fee is computed on the pre-tip amount.
//
// This is a deliberate commercial decision, not an oversight: tips belong to
// staff, so the platform does not take a percentage of them. It is also a
// differentiator worth stating in the pitch.
function applicationFee({ total, tip = 0, feeBps }) {
  const feeable = Math.max(0, total - tip);
  return Math.round((feeable * feeBps) / 10000);
}

// Display helper — 2400 => "S$24.00"
function formatAmount(minorUnits, currency = 'sgd') {
  const symbol = { sgd: 'S$', usd: '$', myr: 'RM', eur: '€', gbp: '£' }[currency.toLowerCase()] || '';
  return `${symbol}${(minorUnits / 100).toFixed(2)}`;
}

module.exports = { computeTotals, applicationFee, formatAmount };
