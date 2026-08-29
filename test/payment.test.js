'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const originalEnv = {
  TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID,
  BASE_URL: process.env.BASE_URL,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function loadPaymentWithStripe(fakeStripe) {
  process.env.TURSO_DATABASE_URL = 'file:data/test.db';
  process.env.STRIPE_SECRET_KEY = 'rk_live_checkout';
  process.env.STRIPE_PRICE_ID = 'price_1U9cHpDtqk1qvqGzPK7j5hi5';
  process.env.BASE_URL = 'https://example.test';

  const stripePath = require.resolve('stripe');
  const originalStripe = require.cache[stripePath];
  require.cache[stripePath] = {
    id: stripePath,
    filename: stripePath,
    loaded: true,
    exports: () => fakeStripe,
  };

  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/payment')];
  const config = require('../src/config');
  const payment = require('../src/payment');

  return {
    config,
    payment,
    cleanup() {
      delete require.cache[require.resolve('../src/config')];
      delete require.cache[require.resolve('../src/payment')];
      if (originalStripe) require.cache[stripePath] = originalStripe;
      else delete require.cache[stripePath];
      restoreEnv();
    },
  };
}

test('Checkout uses the configured Stripe Price ID without recreating a product', async (t) => {
  let request;
  const fakeStripe = {
    checkout: {
      sessions: {
        create: async (input) => {
          request = input;
          return { url: 'https://checkout.stripe.test/c/session' };
        },
      },
    },
  };

  const { config, payment, cleanup } = loadPaymentWithStripe(fakeStripe);
  t.after(cleanup);

  const result = await payment.createCheckout('2026-08-29');

  assert.equal(config.stripeLive, true);
  assert.equal(result.url, 'https://checkout.stripe.test/c/session');
  assert.deepEqual(request.line_items, [{
    price: 'price_1U9cHpDtqk1qvqGzPK7j5hi5',
    quantity: 1,
  }]);
  assert.equal(request.line_items[0].price_data, undefined);
  assert.deepEqual(request.metadata, {
    betDate: '2026-08-29',
    stripePriceId: 'price_1U9cHpDtqk1qvqGzPK7j5hi5',
  });
  assert.equal(request.success_url,
    'https://example.test/paiement/retour?session_id={CHECKOUT_SESSION_ID}');
});
