'use strict';

const crypto = require('crypto');
const config = require('./config');

const ACCESS_COOKIE = 'prono_access';
const ADMIN_COOKIE = 'prono_admin';

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', config.appSecret).update(body).digest('base64url');
  return body + '.' + mac;
}

function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', config.appSecret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.baseUrl.startsWith('https://'),
    maxAge: maxAgeMs,
    path: '/',
  };
}

function grantAccess(res, betDate) {
  const token = sign({ kind: 'access', betDate, exp: Date.now() + config.accessTtlMs });
  res.cookie(ACCESS_COOKIE, token, cookieOptions(config.accessTtlMs));
}

// L'acces achete vaut pour la date du pari payee, pas pour tous les paris.
function hasAccess(req, betDate) {
  const payload = verify(req.cookies[ACCESS_COOKIE]);
  return Boolean(payload && payload.kind === 'access' && payload.betDate === betDate);
}

function loginAdmin(res) {
  const ttl = 8 * 60 * 60 * 1000;
  res.cookie(ADMIN_COOKIE, sign({ kind: 'admin', exp: Date.now() + ttl }), cookieOptions(ttl));
}

function logoutAdmin(res) {
  res.clearCookie(ADMIN_COOKIE, { path: '/' });
}

function isAdmin(req) {
  const payload = verify(req.cookies[ADMIN_COOKIE]);
  return Boolean(payload && payload.kind === 'admin');
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  return res.redirect('/admin');
}

function checkPassword(candidate) {
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(config.adminPassword);
  if (a.length !== b.length) {
    // Comparaison factice pour garder un temps d'execution constant.
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  ACCESS_COOKIE,
  ADMIN_COOKIE,
  grantAccess,
  hasAccess,
  loginAdmin,
  logoutAdmin,
  isAdmin,
  requireAdmin,
  checkPassword,
  sign,
  verify,
};
