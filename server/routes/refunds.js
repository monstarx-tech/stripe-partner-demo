// Track A — Task 3A.1: Refund with Clawback
// Lab page: Module 3A → Task 3A.1

const express = require('express');
const router = express.Router();
const db = require('../db');
const { stripe, onAccount, idemKey, describeStripeError } = require('../lib/stripe');
const { logEvent } = require('../lib/events');
const { formatAmount } = require('../lib/money');

// POST /refunds
// Refund a direct charge on the connected account and claw back the platform fee.
router.post('/', async (req, res) => {
  const {
    paymentIntentId, merchantId, orderId,
    amount,
    reason = 'requested_by_customer',
    // Goodwill refund: the platform gives up its fee alongside the outlet.
    // A partial refund where the platform isn't at fault is the case for
    // leaving this false — the outlet refunds the food, the platform still
    // did the work of processing the payment.
    refundApplicationFee = true,
  } = req.body;

  const merchant = db.merchants.findById(merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  if (!merchant.stripe_account_id) return res.status(400).json({ error: 'Merchant has no Stripe account yet' });

  const order = orderId ? db.orders.findById(orderId) : null;
  const targetPi = paymentIntentId || (order && order.payment_intent_id);
  if (!targetPi) return res.status(400).json({ error: 'paymentIntentId or a paid orderId is required' });

  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: targetPi,
        reason,
        ...(amount ? { amount: parseInt(amount, 10) } : {}),
        // The ONLY lever that matters here. These are direct charges — the
        // connected account is merchant of record and the funds already live
        // on it, so there is no transfer to reverse. reverse_transfer is
        // irrelevant: setting it changes nothing.
        refund_application_fee: Boolean(refundApplicationFee),
      },
      { ...onAccount(merchant), idempotencyKey: idemKey('refund', targetPi, String(amount || 'full')) },
    );

    if (order) {
      db.orders.update(order.id, {
        status: amount && amount < order.amount ? 'partially_refunded' : 'refunded',
        refund_id: refund.id,
      });
    }

    logEvent({
      merchantId: merchant.id,
      orderId: order ? order.id : '',
      kind: 'refund.created',
      message: `Refunded ${formatAmount(refund.amount, refund.currency)}`
        + (refundApplicationFee ? ' — platform fee clawed back' : ' — platform fee retained'),
      payload: { refundId: refund.id, paymentIntentId: targetPi, refundApplicationFee: Boolean(refundApplicationFee) },
    });

    res.json({
      refundId: refund.id,
      amount: refund.amount,
      currency: refund.currency,
      status: refund.status,
      applicationFeeRefunded: Boolean(refundApplicationFee),
    });
  } catch (err) {
    console.error('Refund failed:', describeStripeError(err));
    res.status(400).json(describeStripeError(err));
  }
});

module.exports = router;
