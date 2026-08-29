'use strict';

const crypto = require('crypto');
const db = require('./db');

function today() {
  // Date du jour au format YYYY-MM-DD, fuseau Europe/Paris.
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

// La colonne est de type `date` : on la lit en texte pour eviter que le driver
// ne la convertisse en Date et ne decale le jour selon le fuseau du serveur.
const BET_COLUMNS = `
  id,
  to_char(bet_date, 'YYYY-MM-DD') AS date,
  match, pick, odds, bookmaker, confidence, analysis,
  photo_mime, photo_size,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

function toBet(row) {
  if (!row) return null;
  const bet = { ...row };
  bet.photo = row.photo_mime ? { mime: row.photo_mime, size: row.photo_size } : null;
  delete bet.photo_mime;
  delete bet.photo_size;
  return bet;
}

async function getBetByDate(date) {
  const { rows } = await db.query(`SELECT ${BET_COLUMNS} FROM bets WHERE bet_date = $1`, [date]);
  return toBet(rows[0]);
}

async function getBetById(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const { rows } = await db.query(`SELECT ${BET_COLUMNS} FROM bets WHERE id = $1`, [id]);
  return toBet(rows[0]);
}

function getTodayBet() {
  return getBetByDate(today());
}

async function listBets() {
  const { rows } = await db.query(`SELECT ${BET_COLUMNS} FROM bets ORDER BY bet_date DESC`);
  return rows.map(toBet);
}

// Les octets de la photo ne sortent que par ici : ils ne sont jamais charges
// avec le reste du pari, pour ne pas les trainer dans chaque page rendue.
async function getBetPhoto(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const { rows } = await db.query(
    'SELECT photo_data, photo_mime FROM bets WHERE id = $1 AND photo_data IS NOT NULL',
    [id],
  );
  if (!rows[0]) return null;
  return { data: rows[0].photo_data, mime: rows[0].photo_mime };
}

/**
 * Un seul pari par date : on remplace celui du jour s'il existe deja.
 * `photo` vaut undefined (ne pas toucher), null (retirer) ou
 * { buffer, mime, size } (remplacer).
 */
async function upsertBet(input) {
  const base = [
    input.date, input.match, input.pick, input.odds,
    input.bookmaker, input.confidence, input.analysis,
  ];

  let photoSet = '';
  const params = base.slice();
  if (input.photo === null) {
    photoSet = ', photo_data = NULL, photo_mime = NULL, photo_size = NULL';
  } else if (input.photo) {
    params.push(input.photo.buffer, input.photo.mime, input.photo.size);
    photoSet = ', photo_data = $8, photo_mime = $9, photo_size = $10';
  }

  const insertPhoto = input.photo
    ? { columns: ', photo_data, photo_mime, photo_size', values: ', $8, $9, $10' }
    : { columns: '', values: '' };

  const { rows } = await db.query(
    `INSERT INTO bets (id, bet_date, match, pick, odds, bookmaker, confidence, analysis${insertPhoto.columns})
     VALUES ($${params.length + 1}, $1, $2, $3, $4, $5, $6, $7${insertPhoto.values})
     ON CONFLICT (bet_date) DO UPDATE SET
       match = EXCLUDED.match,
       pick = EXCLUDED.pick,
       odds = EXCLUDED.odds,
       bookmaker = EXCLUDED.bookmaker,
       confidence = EXCLUDED.confidence,
       analysis = EXCLUDED.analysis,
       updated_at = now()${photoSet}
     RETURNING ${BET_COLUMNS}`,
    params.concat([crypto.randomUUID()]),
  );
  return toBet(rows[0]);
}

async function deleteBet(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const { rows } = await db.query(`DELETE FROM bets WHERE id = $1 RETURNING ${BET_COLUMNS}`, [id]);
  return toBet(rows[0]);
}

// Idempotent : rejouer le retour d'un paiement ne compte pas la vente deux fois.
async function recordOrder(order) {
  const { rows } = await db.query(
    `INSERT INTO orders (id, reference, provider, bet_date, amount_cents, email)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (reference) DO UPDATE SET reference = EXCLUDED.reference
     RETURNING id, reference, provider, to_char(bet_date, 'YYYY-MM-DD') AS "betDate",
               amount_cents AS "amountCents", email, created_at AS "createdAt"`,
    [crypto.randomUUID(), order.reference, order.provider, order.betDate,
      order.amountCents, order.email || null],
  );
  return rows[0];
}

async function stats() {
  const { rows } = await db.query(
    `SELECT
       count(*)::int AS "totalOrders",
       coalesce(sum(amount_cents), 0)::int AS "totalCents",
       count(*) FILTER (WHERE bet_date = $1)::int AS "todayOrders",
       coalesce(sum(amount_cents) FILTER (WHERE bet_date = $1), 0)::int AS "todayCents"
     FROM orders`,
    [today()],
  );
  return rows[0];
}

async function salesByDate() {
  const { rows } = await db.query(
    `SELECT to_char(bet_date, 'YYYY-MM-DD') AS date, count(*)::int AS sales
     FROM orders GROUP BY bet_date`,
  );
  return new Map(rows.map((row) => [row.date, row.sales]));
}

module.exports = {
  today,
  getBetByDate,
  getBetById,
  getTodayBet,
  getBetPhoto,
  listBets,
  upsertBet,
  deleteBet,
  recordOrder,
  stats,
  salesByDate,
};
