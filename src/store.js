'use strict';

const crypto = require('crypto');
const db = require('./db');

function today() {
  // Date du jour au format YYYY-MM-DD, fuseau Europe/Paris.
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

const BET_COLUMNS = `
  id,
  bet_date AS date,
  "match" AS matchLabel,
  pick, odds, bookmaker, confidence, analysis,
  photo_mime, photo_size,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

// Les lignes libSQL exposent aussi des index numeriques : on recopie
// explicitement les champs attendus plutot que d'etaler l'objet.
function toBet(row) {
  if (!row) return null;
  return {
    id: row.id,
    date: row.date,
    match: row.matchLabel,
    pick: row.pick,
    odds: row.odds,
    bookmaker: row.bookmaker,
    confidence: Number(row.confidence),
    analysis: row.analysis,
    photo: row.photo_mime ? { mime: row.photo_mime, size: Number(row.photo_size) } : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const isId = (id) => /^[0-9a-f-]{36}$/i.test(String(id));

async function getBetByDate(date) {
  const { rows } = await db.query(`SELECT ${BET_COLUMNS} FROM bets WHERE bet_date = ?`, [date]);
  return toBet(rows[0]);
}

async function getBetById(id) {
  if (!isId(id)) return null;
  const { rows } = await db.query(`SELECT ${BET_COLUMNS} FROM bets WHERE id = ?`, [id]);
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
  if (!isId(id)) return null;
  const { rows } = await db.query(
    'SELECT photo_data, photo_mime FROM bets WHERE id = ? AND photo_data IS NOT NULL',
    [id],
  );
  if (!rows[0]) return null;
  return { data: Buffer.from(rows[0].photo_data), mime: rows[0].photo_mime };
}

/**
 * Un seul pari par date : on remplace celui du jour s'il existe deja.
 * `photo` vaut undefined (ne pas toucher), null (retirer) ou
 * { buffer, mime, size } (remplacer).
 */
async function upsertBet(input) {
  const withPhoto = Boolean(input.photo);
  const args = [
    crypto.randomUUID(), input.date, input.match, input.pick, input.odds,
    input.bookmaker || null, input.confidence, input.analysis || null,
  ];
  if (withPhoto) args.push(input.photo.buffer, input.photo.mime, input.photo.size);

  let photoUpdate = '';
  if (input.photo === null) {
    photoUpdate = ', photo_data = NULL, photo_mime = NULL, photo_size = NULL';
  } else if (withPhoto) {
    photoUpdate = ', photo_data = excluded.photo_data'
      + ', photo_mime = excluded.photo_mime, photo_size = excluded.photo_size';
  }

  const { rows } = await db.query(
    `INSERT INTO bets (id, bet_date, "match", pick, odds, bookmaker, confidence, analysis${
      withPhoto ? ', photo_data, photo_mime, photo_size' : ''})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?${withPhoto ? ', ?, ?, ?' : ''})
     ON CONFLICT(bet_date) DO UPDATE SET
       "match" = excluded."match",
       pick = excluded.pick,
       odds = excluded.odds,
       bookmaker = excluded.bookmaker,
       confidence = excluded.confidence,
       analysis = excluded.analysis,
       updated_at = datetime('now')${photoUpdate}
     RETURNING ${BET_COLUMNS}`,
    args,
  );
  return toBet(rows[0]);
}

async function deleteBet(id) {
  if (!isId(id)) return null;
  const { rows } = await db.query(`DELETE FROM bets WHERE id = ? RETURNING ${BET_COLUMNS}`, [id]);
  return toBet(rows[0]);
}

// Idempotent : rejouer le retour d'un paiement ne compte pas la vente deux fois.
async function recordOrder(order) {
  await db.query(
    `INSERT INTO orders (id, reference, provider, bet_date, amount_cents, email)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(reference) DO NOTHING`,
    [crypto.randomUUID(), order.reference, order.provider, order.betDate,
      order.amountCents, order.email || null],
  );
  const { rows } = await db.query(
    `SELECT id, reference, provider, bet_date AS betDate,
            amount_cents AS amountCents, email, created_at AS createdAt
     FROM orders WHERE reference = ?`,
    [order.reference],
  );
  return rows[0] || null;
}

async function stats() {
  const day = today();
  const { rows } = await db.query(
    `SELECT
       COUNT(*) AS totalOrders,
       COALESCE(SUM(amount_cents), 0) AS totalCents,
       COALESCE(SUM(CASE WHEN bet_date = ? THEN 1 ELSE 0 END), 0) AS todayOrders,
       COALESCE(SUM(CASE WHEN bet_date = ? THEN amount_cents ELSE 0 END), 0) AS todayCents
     FROM orders`,
    [day, day],
  );
  const row = rows[0] || {};
  return {
    totalOrders: Number(row.totalOrders || 0),
    totalCents: Number(row.totalCents || 0),
    todayOrders: Number(row.todayOrders || 0),
    todayCents: Number(row.todayCents || 0),
  };
}

async function salesByDate() {
  const { rows } = await db.query(
    'SELECT bet_date AS date, COUNT(*) AS sales FROM orders GROUP BY bet_date',
  );
  return new Map(rows.map((row) => [row.date, Number(row.sales)]));
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
