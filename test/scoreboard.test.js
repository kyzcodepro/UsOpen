'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPublicScoreboard } = require('../src/store');
const { homePage } = require('../src/views');

test('Public scoreboard derives a capped 100 euro goal and safe history', () => {
  const stats = { totalCents: 3250, totalOrders: 7 };
  const bets = [
    { date: '2026-08-29', match: 'Sinner vs Alcaraz', pick: 'Plus de 22,5 jeux', odds: '1.85', confidence: 4 },
    { date: '2026-08-28', match: 'Gauff vs Swiatek', pick: 'Victoire Gauff', odds: '2.10', confidence: 3 },
  ];
  const sales = new Map([['2026-08-29', 5], ['2026-08-28', 2]]);

  const result = buildPublicScoreboard(stats, bets, sales);

  assert.deepEqual(result, {
    targetCents: 10000,
    balanceCents: 3250,
    remainingCents: 6750,
    percentage: 33,
    progress: 33,
    orders: 7,
    history: [
      { date: '2026-08-29', match: 'Sinner vs Alcaraz', pick: 'Plus de 22,5 jeux', odds: '1.85', confidence: 4, sales: 5 },
      { date: '2026-08-28', match: 'Gauff vs Swiatek', pick: 'Victoire Gauff', odds: '2.10', confidence: 3, sales: 2 },
    ],
  });
});

test('Public scoreboard never renders a progress bar above 100 percent', () => {
  const result = buildPublicScoreboard({ totalCents: 12850, totalOrders: 12 }, [], new Map());

  assert.equal(result.percentage, 129);
  assert.equal(result.progress, 100);
  assert.equal(result.remainingCents, 0);
});

test('Homepage renders the live balance and public bet history without an admin link', () => {
  const scoreboard = buildPublicScoreboard(
    { totalCents: 2500, totalOrders: 3 },
    [{ date: '2026-08-29', match: 'Sinner vs Alcaraz', pick: 'Plus de 22,5 jeux', odds: '1.85', confidence: 4 }],
    new Map([['2026-08-29', 3]]),
  );

  const html = homePage({ bet: null, hasAccess: false, scoreboard, error: null });

  assert.match(html, /data-balance-hero>25,00 €<\/b> LIVE \/ 100 €/);
  assert.match(html, /Sinner vs Alcaraz/);
  assert.match(html, /TRACK RECORD/);
  assert.doesNotMatch(html, /href="\/admin"/);
});
