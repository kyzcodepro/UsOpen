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

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
if (!databaseUrl) errors.push('DATABASE_URL');

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
  // Les bases managees (Neon, Vercel Postgres, Supabase) exigent TLS ;
  // un Postgres local, non.
  databaseSsl: Boolean(databaseUrl)
    && !/sslmode=disable/.test(databaseUrl)
    && !/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  priceCents: Number(process.env.PRICE_CENTS) || 100,
  currency: 'eur',
  // Duree de validite de l'acces achete (24 h).
  accessTtlMs: 24 * 60 * 60 * 1000,
  // Taille maximale d'une photo de ticket.
  maxPhotoBytes: 5 * 1024 * 1024,
  errors,
  warnings,
};

config.demoMode = !config.stripeSecretKey;
config.priceLabel = (config.priceCents / 100).toFixed(2).replace('.', ',') + ' €';

module.exports = config;
