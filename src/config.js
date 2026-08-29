'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

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

loadDotEnv();

// Secret de signature persiste sur disque pour survivre aux redemarrages.
function resolveAppSecret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  const file = path.join(DATA_DIR, 'secret.key');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const generatedAdminPassword = process.env.ADMIN_PASSWORD
  ? null
  : crypto.randomBytes(9).toString('base64url');

const config = {
  root: ROOT,
  dataDir: DATA_DIR,
  dbFile: path.join(DATA_DIR, 'db.json'),
  port: Number(process.env.PORT) || 3000,
  baseUrl: (process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000)).replace(/\/$/, ''),
  appSecret: resolveAppSecret(),
  adminPassword: process.env.ADMIN_PASSWORD || generatedAdminPassword,
  generatedAdminPassword,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  priceCents: Number(process.env.PRICE_CENTS) || 100,
  currency: 'eur',
  // Duree de validite de l'acces achete (24 h).
  accessTtlMs: 24 * 60 * 60 * 1000,
};

config.demoMode = !config.stripeSecretKey;
config.priceLabel = (config.priceCents / 100).toFixed(2).replace('.', ',') + ' €';

module.exports = config;
