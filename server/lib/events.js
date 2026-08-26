// Append-only event log. Two jobs:
//   1. Feeds the live trace panel in the POS UI — this is what makes a
//      server-driven Terminal integration visible during a demo.
//   2. Doubles as an audit trail for reconciliation.

const db = require('../db');

function logEvent({ merchantId = '', orderId = '', kind, message = '', payload = null }) {
  const row = {
    merchant_id: merchantId,
    order_id: orderId,
    kind,
    message,
    payload_json: payload ? JSON.stringify(payload) : '',
    created_at: new Date().toISOString(),
  };

  try {
    db.events.insert(row);
  } catch (err) {
    // Never let telemetry break a payment.
    console.error('logEvent failed:', err.message);
  }

  console.log(`[${kind}] ${message}`);
  return row;
}

// Newest-first feed for the trace panel.
function recentEvents({ merchantId, since = 0, limit = 100 } = {}) {
  const clauses = ['id > ?'];
  const params = [since];

  if (merchantId) {
    clauses.push('(merchant_id = ? OR merchant_id = \'\')');
    params.push(merchantId);
  }

  return db.db
    .prepare(`SELECT * FROM events WHERE ${clauses.join(' AND ')} ORDER BY id DESC LIMIT ?`)
    .all(...params, limit)
    .map(e => ({ ...e, payload: e.payload_json ? JSON.parse(e.payload_json) : null }));
}

module.exports = { logEvent, recentEvents };
