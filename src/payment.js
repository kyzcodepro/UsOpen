'use strict';

const crypto = require('crypto');
const config = require('./config');
const auth = require('./auth');

let stripe = null;
if (!config.demoMode) {
  stripe = require('stripe')(config.stripeSecretKey);
}

// Cree la session de paiement et renvoie l'URL vers laquelle rediriger l'acheteur.
// En mode demo, on renvoie une URL interne qui simule le retour de Stripe.
async function createCheckout(betDate) {
  if (config.demoMode) {
    const token = auth.sign({ kind: 'demo', betDate, exp: Date.now() + 30 * 60 * 1000 });
    return { url: '/paiement/demo?token=' + encodeURIComponent(token) };
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: config.currency,
        unit_amount: config.priceCents,
        product_data: { name: 'Pari du jour — ' + betDate },
      },
    }],
    client_reference_id: betDate,
    metadata: { betDate },
    success_url: config.baseUrl + '/paiement/retour?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: config.baseUrl + '/paiement/annule',
  });

  return { url: session.url };
}

// Verifie aupres de Stripe que la session est bien payee avant de donner l'acces.
async function confirmCheckout(sessionId) {
  if (config.demoMode) return null;
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== 'paid') return null;
  return {
    reference: session.id,
    provider: 'stripe',
    betDate: session.metadata?.betDate || session.client_reference_id,
    amountCents: session.amount_total,
    email: session.customer_details?.email || null,
  };
}

function confirmDemo(token) {
  const payload = auth.verify(token);
  if (!payload || payload.kind !== 'demo') return null;
  return {
    reference: 'demo_' + crypto.randomUUID(),
    provider: 'demo',
    betDate: payload.betDate,
    amountCents: config.priceCents,
    email: null,
  };
}

module.exports = { createCheckout, confirmCheckout, confirmDemo };
