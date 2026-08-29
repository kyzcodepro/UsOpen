'use strict';

const express = require('express');
const store = require('../store');
const views = require('../views');
const auth = require('../auth');
const uploads = require('../uploads');

const router = express.Router();

// Limitation basique des tentatives de connexion, par adresse IP.
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

function renderDashboard(req, res, extra = {}) {
  const date = typeof req.query.date === 'string' ? req.query.date : store.today();
  res.send(views.adminDashboard({
    bet: store.getBetByDate(date) || (date === store.today() ? null : { date }),
    bets: store.listBets(),
    stats: store.stats(),
    today: store.today(),
    flash: extra.flash || (req.query.ok ? 'Pari enregistré.' : null),
    error: extra.error || null,
  }));
}

router.get('/admin', (req, res) => {
  if (auth.isAdmin(req)) return renderDashboard(req, res);
  res.send(views.adminLoginPage({ error: req.query.erreur ? 'Mot de passe incorrect.' : null }));
});

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

router.post('/admin/bets', auth.requireAdmin, uploads.single('photo'), (req, res) => {
  const body = req.body || {};
  const clean = (value, max) => String(value || '').trim().slice(0, max);
  const date = clean(body.date, 10);
  const match = clean(body.match, 120);
  const pick = clean(body.pick, 120);
  const odds = clean(body.odds, 12);
  const existing = store.getBetByDate(date);
  const previousPhoto = existing ? existing.photo || null : null;

  const fail = (message) => res.status(400).send(views.adminDashboard({
    bet: {
      date, match, pick, odds,
      bookmaker: clean(body.bookmaker, 60),
      confidence: body.confidence,
      analysis: clean(body.analysis, 4000),
      photo: previousPhoto,
      id: existing ? existing.id : null,
    },
    bets: store.listBets(),
    stats: store.stats(),
    today: store.today(),
    flash: null,
    error: message,
  }));

  if (req.uploadError) return fail(req.uploadError);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !match || !pick || !odds) {
    return fail('Date, match, pronostic et cote sont obligatoires.'
      + (req.file ? ' La photo est à re-sélectionner.' : ''));
  }

  // La valeur finale de la photo se decide ici ; le store ne fait que l'enregistrer.
  let photo = previousPhoto;
  if (body.removePhoto === '1') photo = null;
  if (req.file && req.file.buffer && req.file.buffer.length) {
    const saved = uploads.save(req.file.buffer);
    if (!saved) return fail('Format de photo non reconnu : envoyez un JPEG, un PNG ou un WebP.');
    photo = saved;
  }

  const confidence = Math.min(5, Math.max(1, Number(body.confidence) || 3));
  store.upsertBet({
    date,
    match,
    pick,
    odds,
    bookmaker: clean(body.bookmaker, 60),
    confidence,
    analysis: clean(body.analysis, 4000),
    photo,
  });

  // L'ancien fichier n'est efface qu'une fois la base ecrite.
  if (previousPhoto && photo !== previousPhoto) uploads.remove(previousPhoto);

  res.redirect('/admin?ok=1&date=' + encodeURIComponent(date));
});

// Apercu de la photo cote admin, derriere la session admin.
router.get('/admin/bets/:id/photo', auth.requireAdmin, (req, res) => {
  const bet = store.getBetById(req.params.id);
  const full = bet && bet.photo ? uploads.resolve(bet.photo) : null;
  if (!full) return res.status(404).end();
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.type(bet.photo.mime);
  res.sendFile(full);
});

router.post('/admin/bets/:id/delete', auth.requireAdmin, (req, res) => {
  const removed = store.deleteBet(req.params.id);
  if (removed && removed.photo) uploads.remove(removed.photo);
  res.redirect('/admin');
});

module.exports = router;
