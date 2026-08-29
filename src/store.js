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
  stake_cents AS stakeCents, outcome,
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
    stakeCents: Number(row.stakeCents || 0),
    outcome: row.outcome || 'pending',
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
    input.stakeCents, input.outcome,
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
    `INSERT INTO bets (id, bet_date, "match", pick, odds, bookmaker, confidence, analysis, stake_cents, outcome${
      withPhoto ? ', photo_data, photo_mime, photo_size' : ''})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?${withPhoto ? ', ?, ?, ?' : ''})
     ON CONFLICT(bet_date) DO UPDATE SET
       "match" = excluded."match",
       pick = excluded.pick,
       odds = excluded.odds,
       bookmaker = excluded.bookmaker,
       confidence = excluded.confidence,
       analysis = excluded.analysis,
       stake_cents = excluded.stake_cents,
       outcome = excluded.outcome,
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

const DEFAULT_BANKROLL_SETTINGS = {
  startingBalanceCents: 0,
  goalCents: 10000,
  goalTitle: 'ROAD TO ONE HUNDRED.',
  goalText: 'Chaque pari réglé fait avancer le compteur. On joue la montée, point après point.',
};

const OUTCOMES = new Set(['pending', 'won', 'lost', 'void']);

function toBankrollSettings(row) {
  if (!row) return { ...DEFAULT_BANKROLL_SETTINGS };
  return {
    startingBalanceCents: Number(row.startingBalanceCents || 0),
    goalCents: Number(row.goalCents || DEFAULT_BANKROLL_SETTINGS.goalCents),
    goalTitle: row.goalTitle || DEFAULT_BANKROLL_SETTINGS.goalTitle,
    goalText: row.goalText || DEFAULT_BANKROLL_SETTINGS.goalText,
  };
}

async function getBankrollSettings() {
  await db.query(
    `INSERT INTO bankroll_settings (id, starting_balance_cents, goal_cents, goal_title, goal_text)
     VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    [
      DEFAULT_BANKROLL_SETTINGS.startingBalanceCents,
      DEFAULT_BANKROLL_SETTINGS.goalCents,
      DEFAULT_BANKROLL_SETTINGS.goalTitle,
      DEFAULT_BANKROLL_SETTINGS.goalText,
    ],
  );
  const { rows } = await db.query(
    `SELECT starting_balance_cents AS startingBalanceCents, goal_cents AS goalCents,
            goal_title AS goalTitle, goal_text AS goalText
     FROM bankroll_settings WHERE id = 1`,
  );
  return toBankrollSettings(rows[0]);
}

async function updateBankrollSettings(input) {
  await db.query(
    `INSERT INTO bankroll_settings (id, starting_balance_cents, goal_cents, goal_title, goal_text, updated_at)
     VALUES (1, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       starting_balance_cents = excluded.starting_balance_cents,
       goal_cents = excluded.goal_cents,
       goal_title = excluded.goal_title,
       goal_text = excluded.goal_text,
       updated_at = datetime('now')`,
    [input.startingBalanceCents, input.goalCents, input.goalTitle, input.goalText],
  );
  return getBankrollSettings();
}

function decimalOdds(value) {
  const odds = Number(String(value || '').replace(',', '.'));
  return Number.isFinite(odds) && odds >= 1 ? odds : 1;
}

// Le P&L n'est jamais saisi : il est uniquement derive de la mise, de la cote
// et du resultat. Une victoire rend la mise puis ajoute le benefice net ; une
// perte retire la mise ; un pari annule ne modifie pas la bankroll.
function profitCents(bet) {
  const stake = Math.max(0, Math.round(Number(bet.stakeCents) || 0));
  if (bet.outcome === 'won') return Math.round(stake * (decimalOdds(bet.odds) - 1));
  if (bet.outcome === 'lost') return -stake;
  return 0;
}

function buildPublicScoreboard(settings, bets, historyBets) {
  const safeSettings = { ...DEFAULT_BANKROLL_SETTINGS, ...(settings || {}) };
  const goalCents = Math.max(1, Number(safeSettings.goalCents) || DEFAULT_BANKROLL_SETTINGS.goalCents);
  const startingBalanceCents = Math.max(0, Number(safeSettings.startingBalanceCents) || 0);
  const settled = bets.filter((bet) => bet.outcome === 'won' || bet.outcome === 'lost' || bet.outcome === 'void');
  const balanceCents = startingBalanceCents + settled.reduce((sum, bet) => sum + profitCents(bet), 0);
  const percentage = Math.round((balanceCents / goalCents) * 100);

  return {
    targetCents: goalCents,
    startingBalanceCents,
    balanceCents,
    remainingCents: Math.max(0, goalCents - balanceCents),
    percentage,
    progress: Math.min(100, Math.max(0, percentage)),
    settledCount: settled.length,
    wins: settled.filter((bet) => bet.outcome === 'won').length,
    goalTitle: String(safeSettings.goalTitle).slice(0, 80),
    goalText: String(safeSettings.goalText).slice(0, 240),
    history: historyBets.slice(0, 12).map((bet) => ({
      date: bet.date,
      match: bet.match,
      pick: bet.pick,
      odds: bet.odds,
      stakeCents: Math.max(0, Number(bet.stakeCents) || 0),
      outcome: OUTCOMES.has(bet.outcome) ? bet.outcome : 'pending',
      profitCents: profitCents(bet),
    })),
  };
}

async function publicScoreboard() {
  const cutoff = today();
  const [settings, bets, history] = await Promise.all([
    getBankrollSettings(),
    listBets(),
    // Le pari du jour reste prive tant qu'il est en attente. Des qu'un
    // resultat est saisi, il rejoint l'historique sans attendre minuit.
    db.query(
      `SELECT ${BET_COLUMNS} FROM bets
       WHERE bet_date < ? OR (bet_date = ? AND outcome IN ('won', 'lost', 'void'))
       ORDER BY bet_date DESC`,
      [cutoff, cutoff],
    ),
  ]);
  return buildPublicScoreboard(settings, bets, history.rows.map(toBet));
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
  getBankrollSettings,
  updateBankrollSettings,
  profitCents,
  buildPublicScoreboard,
  publicScoreboard,
};
