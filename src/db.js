'use strict';

const { createClient } = require('@libsql/client');
const config = require('./config');

// libSQL parle HTTP : pas de connexion persistante a gerer, ce qui convient
// bien au serverless ou chaque instance est jetable.
let client = null;

function getClient() {
  if (!client) {
    client = createClient({
      url: config.databaseUrl,
      authToken: config.databaseAuthToken || undefined,
    });
  }
  return client;
}

// `match` est un mot-cle SQLite : la colonne est citee partout.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS bets (
  id          TEXT PRIMARY KEY,
  bet_date    TEXT NOT NULL UNIQUE,
  "match"     TEXT NOT NULL,
  pick        TEXT NOT NULL,
  odds        TEXT NOT NULL,
  bookmaker   TEXT,
  confidence  INTEGER NOT NULL DEFAULT 3,
  analysis    TEXT,
  photo_data  BLOB,
  photo_mime  TEXT,
  photo_size  INTEGER,
  stake_cents INTEGER NOT NULL DEFAULT 0,
  outcome     TEXT NOT NULL DEFAULT 'pending',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id           TEXT PRIMARY KEY,
  reference    TEXT NOT NULL UNIQUE,
  provider     TEXT NOT NULL,
  bet_date     TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  email        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS orders_bet_date_idx ON orders (bet_date);

CREATE TABLE IF NOT EXISTS bankroll_settings (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  starting_balance_cents INTEGER NOT NULL DEFAULT 0,
  goal_cents             INTEGER NOT NULL DEFAULT 10000,
  goal_title             TEXT NOT NULL DEFAULT 'ROAD TO ONE HUNDRED.',
  goal_text              TEXT NOT NULL DEFAULT 'Chaque pari réglé fait avancer le compteur. On joue la montée, point après point.',
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// Le schema est cree a la demande, une fois par instance. La promesse est
// memorisee pour que des requetes simultanees ne le jouent pas en double.
let ready = null;

async function migrateBetsSchema() {
  const { rows } = await getClient().execute('PRAGMA table_info(bets)');
  const columns = new Set(rows.map((row) => row.name));
  // Les installations existantes possedent deja `bets`. SQLite ne propose pas
  // un ADD COLUMN IF NOT EXISTS portable : on n'ajoute que ce qui manque.
  if (!columns.has('stake_cents')) {
    await getClient().execute('ALTER TABLE bets ADD COLUMN stake_cents INTEGER NOT NULL DEFAULT 0');
  }
  if (!columns.has('outcome')) {
    await getClient().execute("ALTER TABLE bets ADD COLUMN outcome TEXT NOT NULL DEFAULT 'pending'");
  }
}

function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      await getClient().executeMultiple(SCHEMA);
      await migrateBetsSchema();
    })().catch((err) => {
      ready = null; // on retentera a la prochaine requete
      throw err;
    });
  }
  return ready;
}

async function query(sql, args = []) {
  await ensureSchema();
  return getClient().execute({ sql, args });
}

module.exports = { query, ensureSchema, getClient };
