// Data access layer — SQLite-backed for persistence across restarts.
// Routes call db.merchants.findById() etc. and never touch SQL directly.
//
// To migrate to Postgres/MySQL in production: reimplement the collections
// below using your ORM or query builder of choice. The interface stays the same.

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'lab.db'));

// Auto-create schema on first run
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
`);

// Migrate existing databases created before this column existed
for (const col of ['stripe_location_id']) {
  try {
    db.exec(`ALTER TABLE merchants ADD COLUMN ${col} TEXT DEFAULT ''`);
  } catch (err) {
    if (!err.message.includes('duplicate column name')) throw err;
  }
}

// Seed initial data if tables are empty
const merchantCount = db.prepare('SELECT COUNT(*) as n FROM merchants').get().n;
if (merchantCount === 0) {
  db.prepare(`INSERT INTO merchants VALUES ('merchant_001', 'The Golden Fork', 'restaurant', '', 'manual', '')`).run();
  db.prepare(`INSERT INTO merchants VALUES ('merchant_002', 'Harbour Bites', 'restaurant', '', 'manual', '')`).run();
  db.prepare(`INSERT INTO orders VALUES ('order_001', 'merchant_001', 4800, 'sgd', 'pending')`).run();
  db.prepare(`INSERT INTO orders VALUES ('order_002', 'merchant_002', 12000, 'sgd', 'pending')`).run();
}

function makeCollection(table) {
  return {
    all: () => db.prepare(`SELECT * FROM ${table}`).all(),

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
  };
}

module.exports = {
  merchants: makeCollection('merchants'),
  orders:    makeCollection('orders'),
};
