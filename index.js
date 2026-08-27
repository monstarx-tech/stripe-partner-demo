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

// GET /health/storage
// Where is the database actually being written, and will it survive a redeploy?
//
// A volume that is configured but not mounted at the path DB_PATH points to
// fails silently: SQLite happily writes to the container filesystem and the
// data disappears on the next deploy, which looks like a seeding bug rather
// than a storage one.
app.get('/health/storage', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const db = require('./server/db');

  const resolved = path.isAbsolute(config.dbPath)
    ? config.dbPath
    : path.join(__dirname, config.dbPath);
  const dir = path.dirname(resolved);

  const info = {
    DB_PATH_env: process.env.DB_PATH || '(unset — defaulting to ./lab.db)',
    resolvedPath: resolved,
    isAbsolute: path.isAbsolute(config.dbPath),
    directory: dir,
  };

  try {
    info.dbFileExists = fs.existsSync(resolved);
    if (info.dbFileExists) info.dbSizeBytes = fs.statSync(resolved).size;
    info.directoryContents = fs.readdirSync(dir).slice(0, 20);
    fs.accessSync(dir, fs.constants.W_OK);
    info.directoryWritable = true;
  } catch (err) {
    info.directoryError = err.message;
    info.directoryWritable = false;
  }

  // Does a volume exist at all, wherever it is mounted?
  for (const candidate of ['/data', '/app/data', '/mnt/data', '/var/data']) {
    try {
      info.mountedVolumes = info.mountedVolumes || {};
      info.mountedVolumes[candidate] = fs.readdirSync(candidate).slice(0, 10);
    } catch { /* not present */ }
  }

  info.merchantsInDb = db.merchants.all().length;
  info.merchantsWithAccounts = db.merchants.all().filter(m => m.stripe_account_id).length;
  info.persistent = info.isAbsolute && info.directoryWritable === true;

  res.json(info);
});

app.listen(config.port, () => {
  console.log(`MakanPay running on ${config.baseUrl} (port ${config.port}, ${config.nodeEnv})`);
});
