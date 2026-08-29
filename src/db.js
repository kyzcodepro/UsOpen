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
`;

// Le schema est cree a la demande, une fois par instance. La promesse est
// memorisee pour que des requetes simultanees ne le jouent pas en double.
let ready = null;

function ensureSchema() {
  if (!ready) {
    ready = getClient().executeMultiple(SCHEMA).catch((err) => {
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
