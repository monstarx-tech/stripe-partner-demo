// Data access layer — SQLite-backed for persistence across restarts.
// Routes call db.merchants.findById() etc. and never touch SQL directly.
//
// To migrate to Postgres/MySQL in production: reimplement the collections
// below using your ORM or query builder of choice. The interface stays the same.

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { config } = require('./config');

// DB_PATH is absolute on Railway (/data/lab.db, the mounted volume) and
// relative locally. Make sure the directory exists either way.
const dbPath = path.isAbsolute(config.dbPath)
  ? config.dbPath
  : path.join(__dirname, '..', config.dbPath);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    stripe_account_id TEXT DEFAULT '',
    payout_schedule TEXT DEFAULT 'manual',
    stripe_location_id TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT DEFAULT 'Mains',
    unit_amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'sgd',
    image_emoji TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    product_id TEXT DEFAULT '',
    name TEXT NOT NULL,
    unit_amount INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS tabs (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    order_id TEXT DEFAULT '',
    label TEXT DEFAULT '',
    hold_amount INTEGER NOT NULL DEFAULT 0,
    captured_amount INTEGER NOT NULL DEFAULT 0,
    overage_amount INTEGER NOT NULL DEFAULT 0,
    payment_intent_id TEXT DEFAULT '',
    overage_payment_intent_id TEXT DEFAULT '',
    saved_payment_method_id TEXT DEFAULT '',
    reader_id TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'opening',
    created_at TEXT DEFAULT '',
    closed_at TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS readers (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    stripe_reader_id TEXT NOT NULL,
    label TEXT DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'simulated',
    device_type TEXT DEFAULT '',
    status TEXT DEFAULT 'unknown',
    created_at TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_id TEXT DEFAULT '',
    order_id TEXT DEFAULT '',
    kind TEXT NOT NULL,
    message TEXT DEFAULT '',
    payload_json TEXT DEFAULT '',
    created_at TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,
    type TEXT DEFAULT '',
    account_id TEXT DEFAULT '',
    processed_at TEXT DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_products_merchant ON products(merchant_id);
  CREATE INDEX IF NOT EXISTS idx_orders_merchant   ON orders(merchant_id);
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_events_created    ON events(created_at);
  CREATE INDEX IF NOT EXISTS idx_readers_merchant  ON readers(merchant_id);
`);

// ---------------------------------------------------------------------------
// Additive column migrations — safe to re-run on an existing lab.db
// ---------------------------------------------------------------------------
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

// merchants: the per-client "30%" configuration surface
ensureColumn('merchants', 'stripe_location_id',  `TEXT DEFAULT ''`);
ensureColumn('merchants', 'country',             `TEXT DEFAULT 'SG'`);
ensureColumn('merchants', 'currency',            `TEXT DEFAULT 'sgd'`);
ensureColumn('merchants', 'fee_bps',             `INTEGER DEFAULT ${config.platform.feeBps}`);
ensureColumn('merchants', 'service_charge_bps',  `INTEGER DEFAULT ${config.platform.serviceChargeBps}`);
ensureColumn('merchants', 'gst_bps',             `INTEGER DEFAULT ${config.platform.gstBps}`);
ensureColumn('merchants', 'cuisine',             `TEXT DEFAULT ''`);
ensureColumn('merchants', 'brand_color',         `TEXT DEFAULT '#635bff'`);
ensureColumn('merchants', 'logo_emoji',          `TEXT DEFAULT ''`);
ensureColumn('merchants', 'created_at',          `TEXT DEFAULT ''`);

// orders: one ledger shared by web + POS + aggregator channels
ensureColumn('orders', 'channel',              `TEXT DEFAULT 'web'`);
ensureColumn('orders', 'order_type',           `TEXT DEFAULT 'takeaway'`);
ensureColumn('orders', 'table_number',         `TEXT DEFAULT ''`);
ensureColumn('orders', 'subtotal',             `INTEGER DEFAULT 0`);
ensureColumn('orders', 'service_charge',       `INTEGER DEFAULT 0`);
ensureColumn('orders', 'gst',                  `INTEGER DEFAULT 0`);
ensureColumn('orders', 'tip',                  `INTEGER DEFAULT 0`);
ensureColumn('orders', 'application_fee',      `INTEGER DEFAULT 0`);
ensureColumn('orders', 'payment_intent_id',    `TEXT DEFAULT ''`);
ensureColumn('orders', 'checkout_session_id',  `TEXT DEFAULT ''`);
ensureColumn('orders', 'refund_id',            `TEXT DEFAULT ''`);
ensureColumn('orders', 'customer_email',       `TEXT DEFAULT ''`);
ensureColumn('orders', 'created_at',           `TEXT DEFAULT ''`);

// ---------------------------------------------------------------------------
// Collections — same interface the starter routes already use
// ---------------------------------------------------------------------------
const now = () => new Date().toISOString();

function makeCollection(table) {
  return {
    all: () => db.prepare(`SELECT * FROM ${table}`).all(),

    where: (clause, ...params) =>
      db.prepare(`SELECT * FROM ${table} WHERE ${clause}`).all(...params),

    insert: (row) => {
      const cols = Object.keys(row);
      const placeholders = cols.map(() => '?').join(', ');
      db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`).run(...Object.values(row));
      return row;
    },

    findById: (id) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) || null,

    findOne: (predicate) => {
      const rows = db.prepare(`SELECT * FROM ${table}`).all();
      return rows.find(predicate) || null;
    },

    update: (predicate, changes) => {
      const id = typeof predicate === 'string' ? predicate : null;
      const row = id
        ? db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
        : db.prepare(`SELECT * FROM ${table}`).all()
            .find(r => Object.entries(predicate).every(([k, v]) => r[k] === v));

      if (!row) return null;

      const sets = Object.keys(changes).map(k => `${k} = ?`).join(', ');
      db.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`).run(...Object.values(changes), row.id);
      return { ...row, ...changes };
    },

    remove: (id) => db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0,
  };
}

const collections = {
  merchants:      makeCollection('merchants'),
  orders:         makeCollection('orders'),
  products:       makeCollection('products'),
  orderItems:     makeCollection('order_items'),
  tabs:           makeCollection('tabs'),
  readers:        makeCollection('readers'),
  events:         makeCollection('events'),
  webhookEvents:  makeCollection('webhook_events'),
};

// ---------------------------------------------------------------------------
// Seed — two Singapore F&B outlets with real menus
// ---------------------------------------------------------------------------
const SEED_MERCHANTS = [
  {
    id: 'merchant_001', name: 'The Golden Fork', type: 'restaurant',
    cuisine: 'Modern European', logo_emoji: '🍴', brand_color: '#b8860b',
  },
  {
    id: 'merchant_002', name: 'Harbour Bites', type: 'restaurant',
    cuisine: 'Singapore Seafood', logo_emoji: '🦀', brand_color: '#c0392b',
  },
];

// [name, category, cents, emoji, description]
const SEED_MENUS = {
  merchant_001: [
    ['Truffle Mushroom Pasta', 'Mains', 2400, '🍝', 'Tagliatelle, wild mushrooms, black truffle'],
    ['Wagyu Beef Burger',      'Mains', 2800, '🍔', 'MB5 wagyu patty, aged cheddar, brioche'],
    ['Grilled Barramundi',     'Mains', 3200, '🐟', 'Line-caught, lemon butter, seasonal greens'],
    ['Half Roast Chicken',     'Mains', 2200, '🍗', 'Herb-brined, pan jus, confit garlic'],
    ['Truffle Fries',          'Sides',  1200, '🍟', 'Parmesan, truffle oil, chives'],
    ['Caesar Salad',           'Sides',  1400, '🥗', 'Cos lettuce, anchovy dressing, sourdough croutons'],
    ['Garlic Sourdough',       'Sides',   800, '🥖', 'House sourdough, cultured garlic butter'],
    ['Iced Latte',             'Drinks',  700, '☕', 'Single-origin espresso, oat or dairy'],
    ['Fresh Orange Juice',     'Drinks',  800, '🍊', 'Cold-pressed daily'],
    ['Craft Lager',            'Drinks', 1400, '🍺', 'Local Singapore microbrewery, 330ml'],
    ['Sticky Date Pudding',    'Desserts', 1200, '🍮', 'Butterscotch sauce, vanilla bean ice cream'],
    ['Tiramisu',               'Desserts', 1300, '🍰', 'Mascarpone, espresso-soaked savoiardi'],
  ],
  merchant_002: [
    ['Chilli Crab (per kg)',   'Mains', 8800, '🦀', 'Sri Lankan mud crab, signature chilli gravy'],
    ['Black Pepper Crab',      'Mains', 8800, '🦀', 'Wok-tossed, coarse Sarawak pepper'],
    ['Butter Prawns',          'Mains', 3200, '🍤', 'Wok-fried, curry leaf, milk floss'],
    ['Seafood Hor Fun',        'Mains', 1800, '🍜', 'Flat rice noodles, prawn, squid, egg gravy'],
    ['Cereal Butter Squid',    'Sides', 2200, '🦑', 'Crisp cereal, curry leaf, chilli padi'],
    ['Kang Kong Belacan',      'Sides', 1400, '🥬', 'Water spinach, sambal belacan'],
    ['Fried Mantou',           'Sides',  600, '🥐', 'Golden buns, for the gravy'],
    ['Sugarcane Juice',        'Drinks',  500, '🥤', 'Fresh-pressed, served over ice'],
    ['Lime Juice',             'Drinks',  500, '🍋', 'Calamansi, lightly sweetened'],
    ['Tiger Beer',             'Drinks', 1000, '🍺', 'Ice cold, 320ml bottle'],
    ['Chendol',                'Desserts', 600, '🍧', 'Gula melaka, coconut milk, pandan jelly'],
    ['Mango Sago Pomelo',      'Desserts', 700, '🥭', 'Chilled, fresh pomelo pearls'],
  ],
};

if (db.prepare('SELECT COUNT(*) AS n FROM merchants').get().n === 0) {
  const insertMerchant = db.prepare(`
    INSERT INTO merchants (id, name, type, stripe_account_id, payout_schedule, stripe_location_id,
                           country, currency, fee_bps, service_charge_bps, gst_bps,
                           cuisine, brand_color, logo_emoji, created_at)
    VALUES (@id, @name, @type, '', 'manual', '',
            @country, @currency, @fee_bps, @service_charge_bps, @gst_bps,
            @cuisine, @brand_color, @logo_emoji, @created_at)
  `);

  for (const m of SEED_MERCHANTS) {
    insertMerchant.run({
      ...m,
      country: config.platform.country,
      currency: config.platform.currency,
      fee_bps: config.platform.feeBps,
      service_charge_bps: config.platform.serviceChargeBps,
      gst_bps: config.platform.gstBps,
      created_at: now(),
    });
  }
}

if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n === 0) {
  const insertProduct = db.prepare(`
    INSERT INTO products (id, merchant_id, name, description, category, unit_amount,
                          currency, image_emoji, sort_order, active)
    VALUES (@id, @merchant_id, @name, @description, @category, @unit_amount,
            @currency, @image_emoji, @sort_order, 1)
  `);

  for (const [merchantId, menu] of Object.entries(SEED_MENUS)) {
    menu.forEach(([name, category, unit_amount, image_emoji, description], i) => {
      insertProduct.run({
        id: `${merchantId}_p${String(i + 1).padStart(2, '0')}`,
        merchant_id: merchantId,
        name, description, category, unit_amount,
        currency: config.platform.currency,
        image_emoji,
        sort_order: i,
      });
    });
  }
}

module.exports = { ...collections, db, ensureColumn, now, makeCollection };
