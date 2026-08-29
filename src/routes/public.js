'use strict';

const express = require('express');
const store = require('../store');
const views = require('../views');
const auth = require('../auth');
const payment = require('../payment');
const config = require('../config');
const db = require('../db');

const router = express.Router();

// Les handlers sont asynchrones : sans ce relais, un rejet de promesse
// terminerait la requete sans reponse.
const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

// Diagnostic de deploiement : sans lui, une base injoignable ne donne qu'une
// page d'erreur muette. On ne renvoie jamais le jeton ni l'URL complete.
function redact(text) {
  let out = String(text);
  if (config.databaseAuthToken) out = out.split(config.databaseAuthToken).join('«jeton»');
  return out.replace(/authToken=[^&\s]+/gi, 'authToken=«jeton»').slice(0, 400);
}

router.get('/sante', wrap(async (req, res) => {
  const started = Date.now();
  const cible = config.databaseUrl.replace(/\?.*$/, '').replace(/\/\/[^@]*@/, '//');
  try {
    await db.query('SELECT 1 AS ok');
    res.json({ base: 'ok', cible, ms: Date.now() - started });
  } catch (err) {
    console.error('[sante] base injoignable :', err);
    res.status(503).json({
      base: 'erreur',
      cible,
      jeton: config.databaseAuthToken
        ? config.databaseAuthToken.length + ' caractères'
        : 'absent',
      code: err.code || err.name || null,
      message: redact(err.message || err),
      cause: err.cause ? redact(err.cause.message || err.cause) : null,
      ms: Date.now() - started,
    });
  }
}));

router.get('/', wrap(async (req, res) => {
  const bet = await store.getTodayBet();
  res.send(views.homePage({
    bet,
    hasAccess: Boolean(bet) && auth.hasAccess(req, bet.date),
    error: req.query.erreur ? String(req.query.erreur).slice(0, 200) : null,
  }));
}));

router.get('/pari', wrap(async (req, res) => {
  const bet = await store.getTodayBet();
  if (!bet) return res.redirect('/');
  if (!auth.hasAccess(req, bet.date)) {
    return res.redirect('/?erreur=' + encodeURIComponent('Accès expiré ou non payé pour le pari du jour.'));
  }
  res.send(views.betPage({ bet }));
}));

// La photo n'est jamais servie en statique : elle passe par ici, et seulement
// pour un visiteur qui a paye le pari du jour.
router.get('/pari/photo', wrap(async (req, res) => {
  const bet = await store.getTodayBet();
  if (!bet || !bet.photo) return res.status(404).end();
  if (!auth.hasAccess(req, bet.date)) return res.status(403).end();

  const photo = await store.getBetPhoto(bet.id);
  if (!photo) return res.status(404).end();

  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.type(photo.mime);
  res.send(photo.data);
}));

// Demarre le paiement pour le pari du jour.
router.post('/paiement', wrap(async (req, res) => {
  const bet = await store.getTodayBet();
  if (!bet) return res.redirect('/');
  if (auth.hasAccess(req, bet.date)) return res.redirect('/pari');
  const { url } = await payment.createCheckout(bet.date);
  res.redirect(303, url);
}));

// Retour depuis Stripe apres paiement.
router.get('/paiement/retour', wrap(async (req, res) => {
  const sessionId = String(req.query.session_id || '');
  if (!sessionId) return res.redirect('/');
  const order = await payment.confirmCheckout(sessionId);
  if (!order) {
    return res.redirect('/?erreur=' + encodeURIComponent('Paiement non confirmé.'));
  }
  await store.recordOrder(order);
  auth.grantAccess(res, order.betDate);
  res.redirect('/pari');
}));

// Equivalent du retour Stripe quand aucune cle n'est configuree.
router.get('/paiement/demo', wrap(async (req, res) => {
  const order = payment.confirmDemo(String(req.query.token || ''));
  if (!order) {
    return res.redirect('/?erreur=' + encodeURIComponent('Lien de paiement démo invalide ou expiré.'));
  }
  await store.recordOrder(order);
  auth.grantAccess(res, order.betDate);
  res.redirect('/pari');
}));

router.get('/paiement/annule', (req, res) => {
  res.send(views.messagePage({
    title: 'Paiement annulé',
    heading: 'Paiement annulé',
    message: "Aucun montant n'a été débité. Vous pouvez réessayer quand vous voulez.",
    link: { href: '/', label: "Retour à l'accueil" },
  }));
});

module.exports = router;
