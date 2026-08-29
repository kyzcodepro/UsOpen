'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const EMPTY = { bets: [], orders: [] };

function read() {
  try {
    const raw = fs.readFileSync(config.dbFile, 'utf8');
    const parsed = JSON.parse(raw);
    return { bets: parsed.bets || [], orders: parsed.orders || [] };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[store] base illisible, repartie a vide :', err.message);
    }
    return { ...EMPTY };
  }
}

// Ecriture atomique : on passe par un fichier temporaire puis un rename.
function write(db) {
  const tmp = config.dbFile + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, config.dbFile);
}

function today() {
  // Date du jour au format YYYY-MM-DD, fuseau Europe/Paris.
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

function getBetByDate(date) {
  return read().bets.find((bet) => bet.date === date) || null;
}

function getBetById(id) {
  return read().bets.find((bet) => bet.id === id) || null;
}

function getTodayBet() {
  return getBetByDate(today());
}

function listBets() {
  return read().bets.sort((a, b) => b.date.localeCompare(a.date));
}

// Un seul pari par date : on remplace celui du jour s'il existe deja.
function upsertBet(input) {
  const db = read();
  const now = new Date().toISOString();
  const index = db.bets.findIndex((bet) => bet.date === input.date);
  const bet = {
    id: index === -1 ? crypto.randomUUID() : db.bets[index].id,
    date: input.date,
    match: input.match,
    pick: input.pick,
    odds: input.odds,
    bookmaker: input.bookmaker,
    confidence: input.confidence,
    analysis: input.analysis,
    // { file, mime, size } ou null. L'appelant fournit la valeur finale :
    // le store ne touche pas aux fichiers sur disque.
    photo: input.photo || null,
    createdAt: index === -1 ? now : db.bets[index].createdAt,
    updatedAt: now,
  };
  if (index === -1) db.bets.push(bet);
  else db.bets[index] = bet;
  write(db);
  return bet;
}

// Renvoie le pari supprime pour que l'appelant puisse effacer sa photo.
function deleteBet(id) {
  const db = read();
  const removed = db.bets.find((bet) => bet.id === id) || null;
  if (!removed) return null;
  db.bets = db.bets.filter((bet) => bet.id !== id);
  write(db);
  return removed;
}

function recordOrder(order) {
  const db = read();
  if (order.reference && db.orders.some((o) => o.reference === order.reference)) {
    return db.orders.find((o) => o.reference === order.reference);
  }
  const entry = {
    id: crypto.randomUUID(),
    reference: order.reference,
    provider: order.provider,
    betDate: order.betDate,
    amountCents: order.amountCents,
    email: order.email || null,
    createdAt: new Date().toISOString(),
  };
  db.orders.push(entry);
  write(db);
  return entry;
}

function listOrders() {
  return read().orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function stats() {
  const orders = read().orders;
  const currentDay = today();
  const todayOrders = orders.filter((o) => o.betDate === currentDay);
  const sum = (list) => list.reduce((total, o) => total + (o.amountCents || 0), 0);
  return {
    totalOrders: orders.length,
    totalCents: sum(orders),
    todayOrders: todayOrders.length,
    todayCents: sum(todayOrders),
  };
}

module.exports = {
  today,
  getBetByDate,
  getBetById,
  getTodayBet,
  listBets,
  upsertBet,
  deleteBet,
  recordOrder,
  listOrders,
  stats,
};
