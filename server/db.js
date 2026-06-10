const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// PANTRY_DATA_DIR lets tests point at a throwaway database.
const DATA_DIR = process.env.PANTRY_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'pantry_audit.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const raw = new DatabaseSync(DB_PATH);
raw.exec('PRAGMA journal_mode = WAL');
raw.exec('PRAGMA foreign_keys = ON');

raw.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_name        TEXT NOT NULL,
    compass_id       TEXT,
    storage_location TEXT,
    item_description TEXT,
    brand            TEXT,
    distributor      TEXT,
    distributor_sku  TEXT,
    gtin             TEXT,
    manufacturer     TEXT,
    audit_scope      INTEGER NOT NULL DEFAULT 1,
    audit_status     TEXT NOT NULL DEFAULT 'pending',
    gtin_prefill     TEXT,
    UNIQUE (unit_name, distributor_sku)
  );

  CREATE TABLE IF NOT EXISTS audit_records (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id            INTEGER NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
    vendor_type           TEXT,
    ingredients           TEXT,
    voluntary_disclaimers TEXT,
    allergen_milk         INTEGER NOT NULL DEFAULT 0,
    allergen_eggs         INTEGER NOT NULL DEFAULT 0,
    allergen_fish         INTEGER NOT NULL DEFAULT 0,
    allergen_shellfish    INTEGER NOT NULL DEFAULT 0,
    allergen_tree_nuts    INTEGER NOT NULL DEFAULT 0,
    allergen_peanuts      INTEGER NOT NULL DEFAULT 0,
    allergen_wheat        INTEGER NOT NULL DEFAULT 0,
    allergen_soybeans     INTEGER NOT NULL DEFAULT 0,
    allergen_sesame       INTEGER NOT NULL DEFAULT 0,
    allergen_gluten       INTEGER NOT NULL DEFAULT 0,
    allergen_other        TEXT,
    ask_us_flag           INTEGER NOT NULL DEFAULT 0,
    label_photo_path      TEXT,
    reviewed_by           TEXT,
    date_reviewed         TEXT,
    review_due            TEXT,
    gtin_prefill_used     INTEGER NOT NULL DEFAULT 0,
    notes                 TEXT
  );
`);

// Thin compatibility layer over node:sqlite exposing the better-sqlite3
// surface the rest of the app uses: prepare().run/get/all, exec, transaction.
const db = {
  prepare: (sql) => raw.prepare(sql),
  exec: (sql) => raw.exec(sql),
  transaction(fn) {
    return (...args) => {
      raw.exec('BEGIN');
      try {
        const result = fn(...args);
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    };
  },
};

module.exports = db;
