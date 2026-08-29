'use strict';

const express = require('express');
const store = require('../store');
const views = require('../views');
const auth = require('../auth');
const uploads = require('../uploads');

const router = express.Router();
const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

// Limitation basique des tentatives de connexion, par adresse IP. En serverless
// le compteur est par instance : c'est un garde-fou, pas un rempart.
const attempts = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

function throttled(ip) {
  const entry = attempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    attempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function registerFailure(ip) {
  const entry = attempts.get(ip);
  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    attempts.set(ip, { count: 1, first: Date.now() });
  } else {
    entry.count += 1;
  }
}

async function dashboard(req, res, extra = {}) {
  const date = typeof req.query.date === 'string' ? req.query.date : store.today();
  const [current, bets, stats, sales, bankroll] = await Promise.all([
    store.getBetByDate(date),
    store.listBets(),
    store.stats(),
    store.salesByDate(),
    store.getBankrollSettings(),
  ]);
  res.status(extra.status || 200).send(views.adminDashboard({
    bet: extra.bet || current || (date === store.today() ? null : { date }),
    bets,
    stats,
    sales,
    bankroll,
    today: store.today(),
    flash: extra.flash || (req.query.ok === 'bankroll' ? 'Objectif bankroll mis à jour.' : (req.query.ok ? 'Pari enregistré.' : null)),
    error: extra.error || null,
  }));
}

router.get('/admin', wrap(async (req, res) => {
  if (auth.isAdmin(req)) return dashboard(req, res);
  res.send(views.adminLoginPage({ error: req.query.erreur ? 'Mot de passe incorrect.' : null }));
}));

router.post('/admin/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (throttled(ip)) {
    return res.status(429).send(views.adminLoginPage({
      error: 'Trop de tentatives. Réessayez dans quelques minutes.',
    }));
  }
  if (!auth.checkPassword(req.body.password)) {
    registerFailure(ip);
    return res.status(401).send(views.adminLoginPage({ error: 'Mot de passe incorrect.' }));
  }
  attempts.delete(ip);
  auth.loginAdmin(res);
  res.redirect('/admin');
});

router.post('/admin/logout', (req, res) => {
  auth.logoutAdmin(res);
  res.redirect('/admin');
});

router.post('/admin/bets', auth.requireAdmin, uploads.single('photo'), wrap(async (req, res) => {
  const body = req.body || {};
  const clean = (value, max) => String(value || '').trim().slice(0, max);
  const date = clean(body.date, 10);
  const match = clean(body.match, 120);
  const pick = clean(body.pick, 120);
  const odds = clean(body.odds, 12);
  const outcome = clean(body.outcome, 12);
  const stakeEuros = clean(body.stake, 16).replace(',', '.');
  const stakeCents = Math.round(Number(stakeEuros) * 100);
  const existing = /^\d{4}-\d{2}-\d{2}$/.test(date) ? await store.getBetByDate(date) : null;

  const fail = (message) => dashboard(req, res, {
    status: 400,
    error: message,
    bet: {
      date, match, pick, odds,
      bookmaker: clean(body.bookmaker, 60),
      confidence: body.confidence,
      analysis: clean(body.analysis, 4000),
      stakeCents: Number.isFinite(stakeCents) ? stakeCents : 0,
      outcome,
      photo: existing ? existing.photo : null,
      id: existing ? existing.id : null,
    },
  });

  if (req.uploadError) return fail(req.uploadError);

  const eventYear = Number(date.slice(0, 4));
  const currentYear = Number(store.today().slice(0, 4));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !match || !pick || !odds || !stakeEuros || !outcome) {
    return fail('Date, match, pronostic, cote, mise et résultat sont obligatoires.'
      + (req.file ? ' La photo est à re-sélectionner.' : ''));
  }
  if (eventYear < currentYear) return fail(`La date du pari ne peut pas être antérieure à ${currentYear}.`);
  if (!Number.isFinite(stakeCents) || stakeCents <= 0 || stakeCents > 100000000) {
    return fail('La mise doit être un montant positif valide.');
  }
  if (!['pending', 'won', 'lost', 'void'].includes(outcome)) {
    return fail('Le résultat du pari est invalide.');
  }

  // undefined : on ne touche pas a la photo. null : on la retire.
  let photo;
  if (body.removePhoto === '1') photo = null;
  if (req.file && req.file.buffer && req.file.buffer.length) {
    const accepted = uploads.accept(req.file.buffer);
    if (!accepted) return fail('Format de photo non reconnu : envoyez un JPEG, un PNG ou un WebP.');
    photo = accepted;
  }

  await store.upsertBet({
    date,
    match,
    pick,
    odds,
    bookmaker: clean(body.bookmaker, 60),
    confidence: Math.min(5, Math.max(1, Number(body.confidence) || 3)),
    analysis: clean(body.analysis, 4000),
    stakeCents,
    outcome,
    photo,
  });

  res.redirect('/admin?ok=1&date=' + encodeURIComponent(date));
}));

router.post('/admin/bankroll', auth.requireAdmin, wrap(async (req, res) => {
  const startingBalanceRaw = String(req.body.startingBalance || '').trim();
  const goalRaw = String(req.body.goal || '').trim();
  const money = (value) => Math.round(Number(value.replace(',', '.')) * 100);
  const startingBalanceCents = money(startingBalanceRaw);
  const goalCents = money(goalRaw);
  const goalTitle = String(req.body.goalTitle || '').trim().slice(0, 80);
  const goalText = String(req.body.goalText || '').trim().slice(0, 240);

  if (!startingBalanceRaw || !goalRaw || !Number.isFinite(startingBalanceCents) || startingBalanceCents < 0
    || !Number.isFinite(goalCents) || goalCents <= 0 || !goalTitle || !goalText) {
    return dashboard(req, res, {
      status: 400,
      error: 'Solde initial, objectif, titre et texte de l’objectif sont obligatoires et doivent être valides.',
    });
  }
  await store.updateBankrollSettings({ startingBalanceCents, goalCents, goalTitle, goalText });
  res.redirect('/admin?ok=bankroll');
}));

// Apercu de la photo cote admin, derriere la session admin.
router.get('/admin/bets/:id/photo', auth.requireAdmin, wrap(async (req, res) => {
  const photo = await store.getBetPhoto(req.params.id);
  if (!photo) return res.status(404).end();
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.type(photo.mime);
  res.send(photo.data);
}));

router.post('/admin/bets/:id/delete', auth.requireAdmin, wrap(async (req, res) => {
  await store.deleteBet(req.params.id);
  res.redirect('/admin');
}));

module.exports = router;
