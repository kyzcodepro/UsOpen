'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { buildPublicScoreboard, publicScoreboard, profitCents } = require('../src/store');
const { homePage } = require('../src/views');

const SETTINGS = {
  startingBalanceCents: 2000,
  goalCents: 5000,
  goalTitle: 'OBJECTIF GRAND CHELEM',
  goalText: 'Chaque pari réglé rapproche la bankroll du prochain niveau.',
};

const WON = { date: '2026-08-28', match: 'Sinner vs Alcaraz', pick: 'Plus de 22,5 jeux', odds: '1.85', stakeCents: 1000, outcome: 'won' };
const LOST = { date: '2026-08-27', match: 'Gauff vs Swiatek', pick: 'Victoire Gauff', odds: '2.10', stakeCents: 500, outcome: 'lost' };

test('Bankroll derives profit and balance from stakes, odds, and results', () => {
  const result = buildPublicScoreboard(SETTINGS, [WON, LOST], [WON, LOST]);

  assert.equal(profitCents(WON), 850);
  assert.equal(profitCents(LOST), -500);
  assert.equal(result.balanceCents, 2350);
  assert.equal(result.targetCents, 5000);
  assert.equal(result.remainingCents, 2650);
  assert.equal(result.progress, 47);
  assert.equal(result.settledCount, 2);
  assert.equal(result.wins, 1);
  assert.equal(result.goalTitle, 'OBJECTIF GRAND CHELEM');
  assert.equal(result.history[0].profitCents, 850);
});

test('Pending and void results cannot change the bankroll', () => {
  const pending = { ...WON, stakeCents: 2000, outcome: 'pending' };
  const voided = { ...LOST, stakeCents: 800, outcome: 'void' };
  const result = buildPublicScoreboard(SETTINGS, [pending, voided], [pending, voided]);

  assert.equal(profitCents(pending), 0);
  assert.equal(profitCents(voided), 0);
  assert.equal(result.balanceCents, SETTINGS.startingBalanceCents);
  assert.equal(result.progress, 40);
});

test('Public scoreboard excludes today’s bet from the public history query', async (t) => {
  const originalQuery = db.query;
  const current = {
    id: '11111111-1111-4111-8111-111111111111', date: '2026-08-29', matchLabel: 'Aujourd’hui',
    pick: 'À cacher', odds: '1.70', bookmaker: null, confidence: 3, analysis: null,
    stakeCents: 1000, outcome: 'pending', photo_mime: null, photo_size: null,
  };
  const past = {
    id: '22222222-2222-4222-8222-222222222222', date: '2026-08-28', matchLabel: 'Hier',
    pick: 'Visible', odds: '1.90', bookmaker: null, confidence: 4, analysis: null,
    stakeCents: 1000, outcome: 'won', photo_mime: null, photo_size: null,
  };

  db.query = async (sql) => {
    if (sql.includes('INSERT INTO bankroll_settings')) return { rows: [] };
    if (sql.includes('FROM bankroll_settings')) return { rows: [SETTINGS] };
    if (sql.includes('WHERE bet_date <')) return { rows: [past] };
    if (sql.includes('FROM bets ORDER BY')) return { rows: [current, past] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  t.after(() => { db.query = originalQuery; });

  const result = await publicScoreboard();

  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].match, 'Hier');
  assert.doesNotMatch(JSON.stringify(result.history), /Aujourd’hui|À cacher/);
});

test('Homepage renders a configurable live balance and public history without an admin link', () => {
  const scoreboard = buildPublicScoreboard(SETTINGS, [WON], [WON]);
  const html = homePage({ bet: null, hasAccess: false, scoreboard, error: null });

  assert.match(html, /data-balance-hero>28,50 €<\/b> LIVE \/ <span data-hero-target>50,00 €<\/span>/);
  assert.match(html, /OBJECTIF GRAND CHELEM/);
  assert.match(html, /Sinner vs Alcaraz/);
  assert.match(html, /TRACK RECORD/);
  assert.doesNotMatch(html, /href="\/admin"/);
});
