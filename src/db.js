'use strict';

const { Pool } = require('pg');
const config = require('./config');

// En serverless chaque instance vit peu de temps et traite une requete a la
// fois : un petit pool, reutilise entre les invocations a froid, suffit. La
// chaine de connexion doit pointer vers l'endpoint *poole* du fournisseur.
let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
    });
    pool.on('error', (err) => console.error('[db] connexion inactive perdue :', err.message));
  }
  return pool;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bets (
  id          uuid PRIMARY KEY,
  bet_date    date NOT NULL UNIQUE,
  match       text NOT NULL,
  pick        text NOT NULL,
  odds        text NOT NULL,
  bookmaker   text,
  confidence  smallint NOT NULL DEFAULT 3,
  analysis    text,
  photo_data  bytea,
  photo_mime  text,
  photo_size  integer,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id           uuid PRIMARY KEY,
  reference    text NOT NULL UNIQUE,
  provider     text NOT NULL,
  bet_date     date NOT NULL,
  amount_cents integer NOT NULL,
  email        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_bet_date_idx ON orders (bet_date);
`;

// Le schema est cree a la demande, une fois par instance. La promesse est
// memorisee pour que des requetes simultanees ne le jouent pas en double.
let ready = null;

function ensureSchema() {
  if (!ready) {
    ready = getPool().query(SCHEMA).catch((err) => {
      ready = null; // on retentera a la prochaine requete
      throw err;
    });
  }
  return ready;
}

async function query(text, params) {
  await ensureSchema();
  return getPool().query(text, params);
}

module.exports = { query, ensureSchema, getPool };
