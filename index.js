const { config, assertStripeKey } = require('./server/config');
const express = require('express');
const path = require('path');

assertStripeKey();

const app = express();

// Railway terminates TLS at the edge — without this, req.protocol reports http
// and every Stripe redirect URL we build comes out insecure.
app.set('trust proxy', 1);

// Raw body needed for Stripe webhook signature verification
app.use('/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json());

// UIs (platform CMS, storefront, POS) land here in later phases
app.use(express.static(path.join(__dirname, 'public')));

app.use('/merchants', require('./server/routes/merchants'));
app.use('/accounts', require('./server/routes/accounts'));
app.use('/checkout', require('./server/routes/payments'));
app.use('/terminal', require('./server/routes/terminal'));
app.use('/webhooks', require('./server/routes/webhooks'));
app.use('/refunds', require('./server/routes/refunds'));
app.use('/smoke', require('./server/routes/smoke').router);
app.use('/platform', require('./server/routes/platform'));
app.use('/orders', require('./server/routes/orders').router);
app.use('/tabs', require('./server/routes/tabs'));

app.get('/health', (req, res) => res.json({
  status: 'ok',
  env: config.nodeEnv,
  baseUrl: config.baseUrl,
}));

app.listen(config.port, () => {
  console.log(`MakanPay running on ${config.baseUrl} (port ${config.port}, ${config.nodeEnv})`);
});
