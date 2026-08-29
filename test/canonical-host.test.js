'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const app = require('../src/server');

// Envoie une requete reelle : la redirection lit l'en-tete Host, qu'aucun
// client HTTP de haut niveau ne laisse choisir librement.
function request({ method = 'GET', path = '/', headers = {} }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
        res.resume();
        res.on('end', () => server.close(() => resolve({
          status: res.statusCode,
          location: res.headers.location || null,
        })));
      });
      req.on('error', (err) => server.close(() => reject(err)));
      req.end();
    });
  });
}

test('A www visitor is sent to the apex domain, path and query intact', async () => {
  const res = await request({
    path: '/pari?erreur=test',
    headers: { host: 'www.pronogang.com', 'x-forwarded-proto': 'https' },
  });

  assert.equal(res.status, 301);
  assert.equal(res.location, 'https://pronogang.com/pari?erreur=test');
});

test('The apex domain is served without redirecting', async () => {
  const res = await request({ path: '/', headers: { host: 'pronogang.com' } });

  assert.notEqual(res.status, 301);
  assert.equal(res.location, null);
});

test('The Stripe webhook is never redirected: a POST would lose its signature', async () => {
  const res = await request({
    method: 'POST',
    path: '/paiement/webhook',
    headers: { host: 'www.pronogang.com', 'x-forwarded-proto': 'https' },
  });

  assert.notEqual(res.status, 301);
  assert.equal(res.location, null);
});

test('A forged Host header cannot turn the redirect into an open one', async () => {
  const res = await request({ path: '/', headers: { host: 'www.attaquant' } });

  assert.notEqual(res.status, 301);
  assert.equal(res.location, null);
});
