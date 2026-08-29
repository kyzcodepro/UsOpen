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
// Un jeton Turso est un JWT : « eyJ… » en trois parties separees par des
// points. On ne revele que sa forme, jamais son contenu.
function tokenShape(token) {
  if (!token) return 'absent';
  const shape = /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(token) ? 'JWT valide en la forme' : 'PAS un JWT';
  return `${token.length} caractères, ${shape}`;
}

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
    res.json({ base: 'ok', cible, jeton: tokenShape(config.databaseAuthToken), ms: Date.now() - started });
  } catch (err) {
    console.error('[sante] base injoignable :', err);
    res.status(503).json({
      base: 'erreur',
      cible,
      jeton: tokenShape(config.databaseAuthToken),
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

/**
 * La signature Stripe porte sur les octets exacts du corps. On les lit
 * nous-memes : certains hebergeurs parsent le corps avant nous, auquel cas
 * la signature devient inverifiable et il vaut mieux le dire que d'enregistrer
 * une vente non authentifiee.
 */
function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (typeof req.body === 'string') return Promise.resolve(Buffer.from(req.body, 'utf8'));
  if (req.body && typeof req.body === 'object') return Promise.resolve(null);
  if (req.readableEnded) return Promise.resolve(null);
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}

// Filet de securite : si l'acheteur ferme l'onglet avant la redirection, le
// retour navigateur n'a pas lieu et la vente serait perdue. Stripe la notifie
// ici. L'enregistrement etant idempotent, une vente confirmee des deux cotes
// n'est comptee qu'une fois.
router.post('/paiement/webhook', wrap(async (req, res) => {
  if (!config.stripeWebhookSecret) return res.status(404).end();

  const raw = await readRawBody(req);
  if (!raw || !raw.length) {
    console.error('[webhook] corps brut indisponible : signature invérifiable');
    return res.status(400).json({ error: 'corps brut indisponible' });
  }

  let event;
  try {
    event = payment.verifyWebhook(raw, req.get('stripe-signature'));
  } catch (err) {
    console.error('[webhook] signature refusée :', err.message);
    return res.status(400).json({ error: 'signature invalide' });
  }
  if (!event) return res.status(404).end();

  if (event.type === 'checkout.session.completed'
    || event.type === 'checkout.session.async_payment_succeeded') {
    const order = payment.orderFromSession(event.data.object);
    if (order) {
      await store.recordOrder(order);
      console.log('[webhook] vente enregistrée', order.reference, order.betDate);
    }
  }

  res.json({ received: true });
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
