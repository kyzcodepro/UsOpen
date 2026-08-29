'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

// Charge un .env minimaliste sans dependance externe.
function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (/^".*"$|^'.*'$/.test(value)) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

try {
  loadDotEnv();
} catch {
  // Systeme de fichiers en lecture seule : il n'y a pas de .env en production.
}

// En hebergement serverless le disque est en lecture seule et chaque instance
// est jetable : rien n'est ecrit, tout vient des variables d'environnement.
const hosted = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

const errors = [];
const warnings = [];

// Secret de signature des cookies. En local on le garde sur disque pour ne pas
// invalider les sessions a chaque redemarrage ; en production il doit venir de
// l'environnement, sinon chaque instance signerait avec un secret different.
function resolveAppSecret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  if (hosted) {
    errors.push('APP_SECRET');
    return crypto.randomBytes(32).toString('hex');
  }
  const file = path.join(ROOT, 'data', 'secret.key');
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  } catch {
    warnings.push("APP_SECRET non defini et non persistable : les acces payes seront perdus au redemarrage.");
    return crypto.randomBytes(32).toString('hex');
  }
}

function resolveAdminPassword() {
  if (process.env.ADMIN_PASSWORD) return { password: process.env.ADMIN_PASSWORD, generated: null };
  if (hosted) {
    errors.push('ADMIN_PASSWORD');
    return { password: crypto.randomBytes(24).toString('hex'), generated: null };
  }
  const generated = crypto.randomBytes(9).toString('base64url');
  return { password: generated, generated };
}

// Turso fournit une URL libsql:// et un jeton. En local, un simple
// `file:data/local.db` fait tourner la meme base SQLite sans reseau.
const databaseUrl = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || '';
const databaseAuthToken = process.env.TURSO_AUTH_TOKEN || '';
if (!databaseUrl) errors.push('TURSO_DATABASE_URL');
// Une base Turso distante refuse les requetes sans jeton : autant le dire ici.
if (/^libsql:|^wss:|^https:/.test(databaseUrl) && !databaseAuthToken) {
  errors.push('TURSO_AUTH_TOKEN');
}

const admin = resolveAdminPassword();

const config = {
  root: ROOT,
  hosted,
  port: Number(process.env.PORT) || 3000,
  baseUrl: (process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000)).replace(/\/$/, ''),
  appSecret: resolveAppSecret(),
  adminPassword: admin.password,
  generatedAdminPassword: admin.generated,
  databaseUrl,
  databaseAuthToken,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  // Tarif cree dans le tableau de bord Stripe (price_...). Facultatif : sans
  // lui, le tarif est construit a la volee a partir de PRICE_CENTS.
  stripePriceId: process.env.STRIPE_PRICE_ID || '',
  priceCents: Number(process.env.PRICE_CENTS) || 100,
  currency: 'eur',
  // Duree de validite de l'acces achete (24 h).
  accessTtlMs: 24 * 60 * 60 * 1000,
  // Taille maximale d'une photo de ticket. Elle transite par le protocole
  // HTTP de libSQL, encodee en base64 : une photo pese environ un tiers de
  // plus sur le reseau, a l'ecriture comme a chaque lecture.
  maxPhotoBytes: Math.round((Number(process.env.MAX_PHOTO_MB) || 2) * 1024 * 1024),
  errors,
  warnings,
  // Sur Vercel, une variable definie pour le seul environnement Production
  // n'est pas injectee dans un deploiement Preview (et inversement) : savoir
  // ou l'on tourne, et quels noms sont vus, distingue « mal renseigne » de
  // « renseigne au mauvais endroit ». Seuls les NOMS sont exposes.
  vercelEnv: process.env.VERCEL_ENV || null,
  presentVars: [
    'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'DATABASE_URL', 'ADMIN_PASSWORD',
    'APP_SECRET', 'BASE_URL', 'STRIPE_SECRET_KEY', 'MAX_PHOTO_MB', 'PRICE_CENTS',
  ].filter((name) => Boolean(process.env[name])),
};

config.demoMode = !config.stripeSecretKey;
config.stripeLive = config.stripeSecretKey.startsWith('sk_live_');

// Stripe redirige l'acheteur vers BASE_URL apres paiement. Mal renseignee,
// on encaisse puis on renvoie le client dans le vide : mieux vaut afficher
// une page de configuration que de prendre l'argent sans livrer.
if (config.stripeSecretKey && /localhost|127\.0\.0\.1/.test(config.baseUrl)) {
  errors.push('BASE_URL (Stripe est actif mais BASE_URL pointe encore sur localhost)');
}
if (config.stripeLive && !config.baseUrl.startsWith('https://')) {
  errors.push('BASE_URL (une clé Stripe live exige une URL https)');
}
config.priceLabel = (config.priceCents / 100).toFixed(2).replace('.', ',') + ' €';

module.exports = config;
