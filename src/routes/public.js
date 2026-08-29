'use strict';

const express = require('express');
const store = require('../store');
const views = require('../views');
const auth = require('../auth');
const payment = require('../payment');
const uploads = require('../uploads');

const router = express.Router();

router.get('/', (req, res) => {
  const bet = store.getTodayBet();
  res.send(views.homePage({
    bet,
    hasAccess: Boolean(bet) && auth.hasAccess(req, bet.date),
    error: req.query.erreur ? String(req.query.erreur).slice(0, 200) : null,
  }));
});

router.get('/pari', (req, res) => {
  const bet = store.getTodayBet();
  if (!bet) return res.redirect('/');
  if (!auth.hasAccess(req, bet.date)) {
    return res.redirect('/?erreur=' + encodeURIComponent('Accès expiré ou non payé pour le pari du jour.'));
  }
  res.send(views.betPage({ bet }));
});

// La photo n'est jamais servie en statique : elle passe par ici, et seulement
// pour un visiteur qui a paye le pari du jour.
router.get('/pari/photo', (req, res) => {
  const bet = store.getTodayBet();
  if (!bet || !bet.photo) return res.status(404).end();
  if (!auth.hasAccess(req, bet.date)) return res.status(403).end();

  const full = uploads.resolve(bet.photo);
  if (!full) return res.status(404).end();

  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.type(bet.photo.mime);
  res.sendFile(full);
});

// Demarre le paiement pour le pari du jour.
router.post('/paiement', async (req, res, next) => {
  const bet = store.getTodayBet();
  if (!bet) return res.redirect('/');
  if (auth.hasAccess(req, bet.date)) return res.redirect('/pari');
  try {
    const { url } = await payment.createCheckout(bet.date);
    res.redirect(303, url);
  } catch (err) {
    next(err);
  }
});

// Retour depuis Stripe apres paiement.
router.get('/paiement/retour', async (req, res, next) => {
  const sessionId = String(req.query.session_id || '');
  if (!sessionId) return res.redirect('/');
  try {
    const order = await payment.confirmCheckout(sessionId);
    if (!order) {
      return res.redirect('/?erreur=' + encodeURIComponent('Paiement non confirmé.'));
    }
    store.recordOrder(order);
    auth.grantAccess(res, order.betDate);
    res.redirect('/pari');
  } catch (err) {
    next(err);
  }
});

// Equivalent du retour Stripe quand aucune cle n'est configuree.
router.get('/paiement/demo', (req, res) => {
  const order = payment.confirmDemo(String(req.query.token || ''));
  if (!order) {
    return res.redirect('/?erreur=' + encodeURIComponent('Lien de paiement démo invalide ou expiré.'));
  }
  store.recordOrder(order);
  auth.grantAccess(res, order.betDate);
  res.redirect('/pari');
});

router.get('/paiement/annule', (req, res) => {
  res.send(views.messagePage({
    title: 'Paiement annulé',
    heading: 'Paiement annulé',
    message: "Aucun montant n'a été débité. Vous pouvez réessayer quand vous voulez.",
    link: { href: '/', label: "Retour à l'accueil" },
  }));
});

module.exports = router;
