'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.TURSO_DATABASE_URL = 'file:data/test.db';
process.env.APP_SECRET = 'secret-de-test-sans-consequence';
process.env.ADMIN_PASSWORD = 'mot-de-passe-de-test';

const app = require('../src/server');

function get(path) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.request({ host: '127.0.0.1', port, method: 'GET', path }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => server.close(() => resolve({
          status: res.statusCode,
          type: res.headers['content-type'] || '',
          cacheControl: res.headers['cache-control'] || null,
          body,
        })));
      });
      req.on('error', (err) => server.close(() => reject(err)));
      req.end();
    });
  });
}

test('The old service worker gets a replacement instead of the 404 that kept it alive', async () => {
  const res = await get('/sw.js');

  // Une 404 fait echouer la verification de mise a jour, et l'ancien service
  // worker reste enregistre : c'est exactement ce qu'il faut eviter.
  assert.equal(res.status, 200);
  assert.match(res.type, /javascript/);
});

test('The replacement uninstalls itself, empties the caches and reloads the tabs', async () => {
  const { body } = await get('/sw.js');

  assert.match(body, /skipWaiting\(\)/);
  assert.match(body, /caches\.delete/);
  assert.match(body, /registration\.unregister\(\)/);
  assert.match(body, /\.navigate\(/);
  // Un service worker qui repondrait aux requetes rejouerait le probleme.
  assert.doesNotMatch(body, /addEventListener\(\s*'fetch'/);
});

test('The replacement is never cached: it would reinstate the problem it repairs', async () => {
  const res = await get('/sw.js');
  assert.equal(res.cacheControl, 'no-store');
});
