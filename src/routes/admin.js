'use strict';

const express = require('express');
const store = require('../store');
const views = require('../views');
const auth = require('../auth');

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

router.post('/admin/bets', auth.requireAdmin, (req, res) => {
  const body = req.body || {};
  const clean = (value, max) => String(value || '').trim().slice(0, max);
  const date = clean(body.date, 10);
  const match = clean(body.match, 120);
  const pick = clean(body.pick, 120);
  const odds = clean(body.odds, 12);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !match || !pick || !odds) {
    return res.status(400).send(views.adminDashboard({
      bet: { date, match, pick, odds, bookmaker: clean(body.bookmaker, 60), confidence: body.confidence, analysis: clean(body.analysis, 4000) },
      bets: store.listBets(),
      stats: store.stats(),
      today: store.today(),
      flash: null,
      error: 'Date, match, pronostic et cote sont obligatoires.',
    }));
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
  });
  res.redirect('/admin?ok=1&date=' + encodeURIComponent(date));
});

router.post('/admin/bets/:id/delete', auth.requireAdmin, (req, res) => {
  store.deleteBet(req.params.id);
  res.redirect('/admin');
});

module.exports = router;
