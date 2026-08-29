'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

// L'application ne monte ses routes qu'une fois configuree ; sans ces valeurs
// elle ne sert que sa page « configuration incomplete ».
process.env.TURSO_DATABASE_URL = 'file:data/test.db';
process.env.APP_SECRET = 'secret-de-test-sans-consequence';
process.env.ADMIN_PASSWORD = 'mot-de-passe-de-test';

const app = require('../src/server');

// Page servie sans toucher la base : ce qui est teste ici, ce sont les
// en-tetes poses pour toute page, pas le contenu d'une page en particulier.
const PAGE = '/paiement/annule';

function request({ path = PAGE, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.request({ host: '127.0.0.1', port, method: 'GET', path, headers }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => server.close(() => resolve({
          status: res.statusCode,
          cacheControl: res.headers['cache-control'] || null,
          etag: res.headers.etag || null,
          body,
        })));
      });
      req.on('error', (err) => server.close(() => reject(err)));
      req.end();
    });
  });
}

test('A page carries no validator, so a revalidation cannot answer 304 with no body', async () => {
  const first = await request();
  assert.equal(first.status, 200);
  assert.equal(first.etag, null);
  assert.ok(first.body.length > 0);

  // Le scenario qui noircissait l'ecran : un navigateur qui a garde le
  // validateur mais perdu le corps redemande la page. Il doit la recevoir
  // entiere, jamais un 304 vide.
  const revalidated = await request({
    headers: { 'if-none-match': 'W/"19c1-41ERy59aUERRbpcoT40BrVxGIpE"' },
  });
  assert.notEqual(revalidated.status, 304);
  assert.equal(revalidated.body.length, first.body.length);
});

test('A page is never stored by a shared cache', async () => {
  const res = await request();
  assert.equal(res.cacheControl, 'no-store');
});

test('Static files keep their own caching rules', async () => {
  const res = await request({ path: '/styles.css' });

  assert.equal(res.status, 200);
  assert.notEqual(res.cacheControl, 'no-store');
  assert.ok(res.etag, 'express.static garde son validateur : ces fichiers sont versionnes');
});
