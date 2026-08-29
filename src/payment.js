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
      // Le prix est gere dans Stripe : aucun produit ou tarif n'est recréé au
      // passage en caisse. Cela centralise TVA, devise et historique des prix.
      price: config.stripePriceId,
      quantity: 1,
    }],
    locale: 'fr',
    client_reference_id: betDate,
    metadata: { betDate, stripePriceId: config.stripePriceId },
    success_url: config.baseUrl + '/paiement/retour?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: config.baseUrl + '/paiement/annule',
  });

  return { url: session.url };
}

// Une session Stripe payee devient une commande. La reference est l'ID de
// session : le retour navigateur et le webhook decrivent donc la meme vente,
// et l'enregistrement etant idempotent, elle n'est comptee qu'une fois.
function orderFromSession(session) {
  if (!session || session.payment_status !== 'paid') return null;
  return {
    reference: session.id,
    provider: 'stripe',
    betDate: session.metadata?.betDate || session.client_reference_id,
    amountCents: session.amount_total,
    email: session.customer_details?.email || null,
  };
}

// Verifie aupres de Stripe que la session est bien payee avant de donner l'acces.
async function confirmCheckout(sessionId) {
  if (config.demoMode) return null;
  return orderFromSession(await stripe.checkout.sessions.retrieve(sessionId));
}

/**
 * Valide la signature d'un webhook Stripe sur le corps BRUT de la requete.
 * Renvoie null si les webhooks ne sont pas configures ; leve si la signature
 * est invalide, pour qu'on reponde 400 sans rien enregistrer.
 */
function verifyWebhook(rawBody, signature) {
  if (config.demoMode || !config.stripeWebhookSecret) return null;
  return stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
}

/**
 * Relit le tarif configure dans Stripe. Sert au diagnostic : si le montant
 * facture differe du prix affiche sur le site, il vaut mieux le voir avant
 * qu'un client ne le decouvre.
 */
async function describePrice() {
  if (config.demoMode) return { source: 'démo', amountCents: config.priceCents, currency: config.currency };
  if (!config.stripePriceId) {
    return { source: 'PRICE_CENTS', amountCents: config.priceCents, currency: config.currency };
  }
  const price = await stripe.prices.retrieve(config.stripePriceId);
  return {
    source: 'STRIPE_PRICE_ID',
    id: price.id,
    amountCents: price.unit_amount,
    currency: price.currency,
    actif: price.active,
    recurrent: Boolean(price.recurring),
  };
}

function confirmDemo(token) {
  const payload = auth.verify(token);
  if (!payload || payload.kind !== 'demo') return null;
  // Reference derivee du jeton, comme l'ID de session Stripe : rejouer le
  // retour de paiement ne cree pas une seconde vente.
  return {
    reference: 'demo_' + crypto.createHash('sha256').update(token).digest('hex').slice(0, 32),
    provider: 'demo',
    betDate: payload.betDate,
    amountCents: config.priceCents,
    email: null,
  };
}

module.exports = {
  createCheckout, confirmCheckout, confirmDemo,
  verifyWebhook, orderFromSession, describePrice,
};
