'use strict';

const config = require('./config');

function escape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function money(cents) {
  return (cents / 100).toFixed(2).replace('.', ',') + ' €';
}

function layout({ title, body, bodyClass = '' }) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<link rel="stylesheet" href="/styles.css?v=usopen-live-score-2">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>🎯</text></svg>">
</head>
<body class="${bodyClass}">
${body}
</body>
</html>`;
}

const demoBanner = config.demoMode
  ? `<div class="banner">Mode démo — aucune clé Stripe configurée, le paiement est simulé.</div>`
  : '';

function betCard(bet, { blurred }) {
  const confidence = Number(bet.confidence) || 0;
  const dots = Array.from({ length: 5 }, (_, i) =>
    `<span class="dot ${i < confidence ? 'on' : ''}"></span>`).join('');
  return `
<article class="bet ${blurred ? 'locked' : ''}">
  <header class="bet-head">
    <span class="tag">Pari du jour</span>
    <span class="bet-date">${escape(formatDate(bet.date))}</span>
  </header>
  <h2 class="bet-match">${escape(bet.match)}</h2>
  <div class="bet-grid">
    <div><span class="label">Pronostic</span><strong>${escape(bet.pick)}</strong></div>
    <div><span class="label">Cote</span><strong>${escape(bet.odds)}</strong></div>
    <div><span class="label">Bookmaker</span><strong>${escape(bet.bookmaker || '—')}</strong></div>
    <div><span class="label">Confiance</span><span class="dots">${dots}</span></div>
  </div>
  ${bet.analysis ? `<div class="analysis"><span class="label">Analyse</span><p>${escape(bet.analysis).replace(/\n/g, '<br>')}</p></div>` : ''}
  ${!blurred && bet.photo ? `<figure class="shot">
    <span class="label">Le ticket</span>
    <a href="/pari/photo" target="_blank" rel="noopener">
      <img src="/pari/photo" alt="Photo du ticket de pari">
    </a>
    <figcaption>Cliquez pour l'ouvrir en grand.</figcaption>
  </figure>` : ''}
</article>`;
}

function shortDate(isoDate) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' })
    .format(new Date(Date.UTC(y, m - 1, d)))
    .replace('.', '');
}

function scoreboardPanel(scoreboard) {
  const score = scoreboard || {
    balanceCents: 0, targetCents: 10000, remainingCents: 10000,
    progress: 0, percentage: 0, orders: 0, history: [],
  };
  const progress = Math.min(100, Math.max(0, Number(score.progress) || 0));
  const history = score.history.length
    ? score.history.map((bet, index) => `<article class="history-card">
        <span class="history-index">${String(index + 1).padStart(2, '0')}</span>
        <div><span class="history-date">${escape(shortDate(bet.date))}</span><h3>${escape(bet.match)}</h3></div>
        <div class="history-pick"><span>SÉLECTION</span><strong>${escape(bet.pick)}</strong></div>
        <div class="history-odd"><span>COTE</span><strong>${escape(bet.odds)}</strong></div>
      </article>`).join('')
    : `<div class="history-empty"><span>ARCHIVES</span><p>Les premières sélections apparaîtront ici.<br>Le premier point se joue maintenant.</p></div>`;

  return `
  <section class="scoreboard" aria-label="Objectif et solde des ventes">
    <div class="goal-copy">
      <p class="eyebrow">MISSION <span>///</span> OBJECTIF 100 €</p>
      <h2>ROAD TO<br><i>ONE HUNDRED.</i></h2>
      <p>Chaque accès débloqué pousse le compteur. On joue la montée, point après point.</p>
    </div>
    <div class="goal-meter" data-scoreboard data-target-cents="${Number(score.targetCents)}">
      <div class="goal-topline"><span>SOLDE LIVE</span><span class="live-dot"><i></i> CONFIRMÉ</span></div>
      <div class="goal-number"><strong data-balance>${escape(money(score.balanceCents))}</strong><span>/ ${escape(money(score.targetCents))}</span></div>
      <div class="goal-track" role="progressbar" aria-label="Progression vers l'objectif de 100 euros" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span data-progress style="--progress:${progress}%"></span></div>
      <div class="goal-scale"><span>0 €</span><b data-progress-label>${progress}%</b><span>100 €</span></div>
      <p class="goal-status" data-goal-status>${score.balanceCents >= score.targetCents ? 'OBJECTIF ATTEINT — ON LANCE LE SET SUIVANT.' : `PLUS QUE ${money(score.remainingCents)} POUR FAIRE 100 €.`}</p>
    </div>
  </section>

  <section class="history" id="historique" aria-label="Historique des paris">
    <header class="history-heading"><div><span>02 / TRACK RECORD</span><h2>HISTORIQUE<br><i>DES PARIS.</i></h2></div><p><b data-orders>${Number(score.orders)}</b> accès confirmés<br>au compteur</p></header>
    <div class="history-list">${history}</div>
  </section>`;
}

function homePage({ bet, hasAccess, scoreboard, error }) {
  const teaser = bet
    ? `<div class="teaser">
        <div class="teaser-inner">
          <span class="tag">Carte verrouillée · ${escape(formatDate(bet.date))}</span>
          <p class="blur">${escape(bet.match)}</p>
          <p class="blur small">${escape(bet.pick)} — cote ${escape(bet.odds)}</p>
          ${bet.photo ? '<p class="joined">Photo du ticket jointe</p>' : ''}
        </div>
        <div class="lock" aria-hidden="true">⌁</div>
      </div>`
    : `<div class="teaser empty"><span class="empty-orb" aria-hidden="true"></span><p>La carte du jour arrive bientôt.<br>Restez dans le jeu.</p></div>`;

  const action = !bet
    ? ''
    : hasAccess
      ? `<a class="btn" href="/pari">Voir le pari du jour</a>
         <p class="note">Accès déjà réglé — valable 24 h.</p>`
      : `<form method="post" action="/paiement">
           <button class="btn" type="submit">Débloquer pour ${escape(config.priceLabel)}</button>
         </form>
         <p class="note">Paiement unique, sans abonnement. Accès valable 24 h.</p>`;

  return layout({
    title: 'US Open — Le pari du jour',
    bodyClass: 'public',
    body: `${demoBanner}
<main class="site-shell">
  <header class="site-head">
    <a class="brand" href="/"><span class="brand-court" aria-hidden="true"></span><span>PARI<span>DU</span>JOUR</span></a>
    <div class="live-status"><i></i> LIVE <span>·</span> FLUSHING, NY</div>
  </header>

  <section class="hero" aria-labelledby="hero-title">
    <div class="hero-copy">
      <p class="eyebrow">TENNIS INTELLIGENCE <span>///</span> 2026</p>
      <h1 id="hero-title"><span>US</span> <strong>OPEN</strong><em>PARI DU<br>JOUR</em></h1>
      <p class="baseline">Le signal avant le service. Un seul pronostic travaillé, au rythme du tournoi.</p>
      <div class="hero-meta" aria-label="Informations sur le pari">
        <span><b>01</b> PICK / JOUR</span><span><b>24H</b> ACCÈS</span><span><b>${escape(config.priceLabel)}</b> ONE SHOT</span><span class="meta-balance"><b data-balance-hero>${escape(money(scoreboard.balanceCents))}</b> LIVE / 100 €</span>
      </div>
    </div>
    <div class="hero-art" aria-hidden="true">
      <span class="court-lines"></span><span class="court-net"></span><span class="court-ball"></span>
      <span class="hero-number">2026</span><span class="art-label">NIGHT<br>SESSION</span>
    </div>
  </section>

  <section class="daily-drop" aria-label="Le pronostic du jour">
    <div class="section-heading"><span>01 / DAILY DROP</span><h2>LE POINT<br><i>DE BASCULE</i></h2><p>Format court. Lecture longue.</p></div>
    <div class="drop-content">
      ${error ? `<p class="error">${escape(error)}</p>` : ''}
      ${teaser}
      <div class="cta">${action}</div>
    </div>
  </section>

  <section class="perks" aria-label="Les garanties du service">
    <article><span>01</span><h3>UN SEUL<br>ANGLE</h3><p>Zéro bruit. Une sélection assumée.</p></article>
    <article><span>02</span><h3>ANALYSE<br>NETTE</h3><p>Contexte, cote et confiance.</p></article>
    <article><span>03</span><h3>NO<br>SUBSCRIPTION</h3><p>${escape(config.priceLabel)}. Puis c'est tout.</p></article>
  </section>

  ${scoreboardPanel(scoreboard)}

  <footer class="foot">
    <span>Jouer comporte des risques : endettement, isolement, dépendance. 18+</span>
    <span class="foot-mark">NYC / HARD COURT</span>
  </footer>
</main>
<script>
(() => {
  const root = document.querySelector('[data-scoreboard]');
  if (!root || !window.fetch) return;
  const euros = (cents) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format((Number(cents) || 0) / 100);
  const setAll = (selector, value) => document.querySelectorAll(selector).forEach((node) => { node.textContent = value; });
  const refresh = async () => {
    try {
      const response = await fetch('/api/scoreboard', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const score = await response.json();
      const progress = Math.min(100, Math.max(0, Number(score.progress) || 0));
      const bar = root.querySelector('[data-progress]');
      const meter = root.querySelector('[role="progressbar"]');
      setAll('[data-balance]', euros(score.balanceCents));
      setAll('[data-balance-hero]', euros(score.balanceCents));
      setAll('[data-progress-label]', progress + '%');
      setAll('[data-orders]', String(Number(score.orders) || 0));
      setAll('[data-goal-status]', score.balanceCents >= score.targetCents
        ? 'OBJECTIF ATTEINT — ON LANCE LE SET SUIVANT.'
        : 'PLUS QUE ' + euros(score.remainingCents) + ' POUR FAIRE 100 €.');
      if (bar) bar.style.setProperty('--progress', progress + '%');
      if (meter) meter.setAttribute('aria-valuenow', String(progress));
    } catch (_) { /* Le compteur garde la derniere valeur valide. */ }
  };
  window.setInterval(refresh, 30000);
})();
</script>`,
  });
}

function betPage({ bet }) {
  return layout({
    title: 'US Open — Pari débloqué',
    bodyClass: 'public',
    body: `${demoBanner}
<main class="site-shell unlocked-shell">
  <header class="site-head">
    <a class="brand" href="/"><span class="brand-court" aria-hidden="true"></span><span>PARI<span>DU</span>JOUR</span></a>
    <div class="live-status"><i></i> ACCESS GRANTED</div>
  </header>
  <section class="unlocked-intro">
    <p class="eyebrow">NIGHT SESSION <span>///</span> ANALYSE PREMIUM</p>
    <h1>LE COURT<br><i>EST À TOI.</i></h1>
    <p class="unlocked">Paiement confirmé. Voici le pronostic du jour.</p>
  </section>
  ${betCard(bet, { blurred: false })}
  <div class="cta"><a class="btn ghost" href="/">← Retour à l'accueil</a></div>
  <footer class="foot"><span>Jouer comporte des risques. 18+</span><span class="foot-mark">NYC / HARD COURT</span></footer>
</main>`,
  });
}

function messagePage({ title, heading, message, link }) {
  return layout({
    title,
    bodyClass: 'public',
    body: `<main class="wrap narrow">
  <h1 class="logo">🎯 Le pari du jour</h1>
  <h2>${escape(heading)}</h2>
  <p class="baseline">${escape(message)}</p>
  <div class="cta"><a class="btn" href="${escape(link.href)}">${escape(link.label)}</a></div>
</main>`,
  });
}

function configErrorPage({ missing, env, present }) {
  const rows = missing.map((name) => `<li><code>${escape(name)}</code></li>`).join('');
  const seen = present && present.length
    ? `<p class="note">Variables effectivement reçues par cette fonction :<br>${
        present.map((name) => `<code>${escape(name)}</code>`).join(' ')}</p>`
    : `<p class="note"><strong>Cette fonction ne reçoit aucune variable.</strong> Si vous les avez définies, elles le sont pour un autre environnement que celui-ci, ou le déploiement date d'avant leur ajout.</p>`;
  return layout({
    title: 'Configuration incomplète',
    bodyClass: 'public',
    body: `<main class="wrap narrow">
  <h1 class="logo">Configuration incomplète</h1>
  <p class="baseline">L'application ne peut pas démarrer tant que ces variables d'environnement ne sont pas définies :</p>
  <ul class="missing">${rows}</ul>
  ${env ? `<p class="note">Environnement de ce déploiement : <code>${escape(env)}</code></p>` : ''}
  ${seen}
  <p class="note">Sur Vercel : Settings → Environment Variables. Cochez les trois environnements (Production, Preview, Development), puis redéployez.</p>
</main>`,
  });
}

function adminLoginPage({ error }) {
  return layout({
    title: 'Admin — connexion',
    bodyClass: 'admin',
    body: `<main class="wrap narrow">
  <h1 class="logo">Espace admin</h1>
  ${error ? `<p class="error">${escape(error)}</p>` : ''}
  <form method="post" action="/admin/login" class="card">
    <label>Mot de passe
      <input type="password" name="password" autocomplete="current-password" required autofocus>
    </label>
    <button class="btn" type="submit">Se connecter</button>
  </form>
  <p class="note"><a href="/">← Retour au site</a></p>
</main>`,
  });
}

function adminDashboard({ bet, bets, stats, sales, today, flash, error }) {
  const value = (field) => escape(bet ? bet[field] : '');
  const rows = bets.length
    ? bets.map((item) => `<tr>
        <td>${escape(formatDate(item.date))}</td>
        <td>${escape(item.match)}</td>
        <td>${escape(item.pick)}</td>
        <td>${escape(item.odds)}</td>
        <td>${sales && sales.get(item.date) ? sales.get(item.date) : 0}</td>
        <td class="row-actions">
          <a href="/admin?date=${escape(item.date)}">Éditer</a>
          <form method="post" action="/admin/bets/${escape(item.id)}/delete"
                onsubmit="return confirm('Supprimer le pari du ${escape(item.date)} ?')">
            <button type="submit" class="link danger">Supprimer</button>
          </form>
        </td>
      </tr>`).join('')
    : `<tr><td colspan="6" class="muted">Aucun pari publié pour le moment.</td></tr>`;

  return layout({
    title: 'Admin — pari du jour',
    bodyClass: 'admin',
    body: `${demoBanner}
<header class="topbar">
  <span class="logo">🎯 Admin</span>
  <nav>
    <a href="/" target="_blank" rel="noopener">Voir le site</a>
    <form method="post" action="/admin/logout"><button class="link" type="submit">Déconnexion</button></form>
  </nav>
</header>
<main class="wrap">
  ${flash ? `<p class="success">${escape(flash)}</p>` : ''}
  ${error ? `<p class="error">${escape(error)}</p>` : ''}

  <section class="stats">
    <div class="stat"><span class="label">Ventes aujourd'hui</span><strong>${stats.todayOrders}</strong></div>
    <div class="stat"><span class="label">CA aujourd'hui</span><strong>${escape(money(stats.todayCents))}</strong></div>
    <div class="stat"><span class="label">Ventes totales</span><strong>${stats.totalOrders}</strong></div>
    <div class="stat"><span class="label">CA total</span><strong>${escape(money(stats.totalCents))}</strong></div>
  </section>

  <section class="card">
    <h2>${bet ? 'Modifier le pari' : 'Publier un pari'}</h2>
    <form method="post" action="/admin/bets" class="form" enctype="multipart/form-data">
      <label>Date
        <input type="date" name="date" value="${value('date') || escape(today)}" required>
      </label>
      <label>Match / événement
        <input type="text" name="match" value="${value('match')}" placeholder="PSG - Marseille" required maxlength="120">
      </label>
      <label>Pronostic
        <input type="text" name="pick" value="${value('pick')}" placeholder="Victoire PSG &amp; +2,5 buts" required maxlength="120">
      </label>
      <div class="row">
        <label>Cote
          <input type="text" name="odds" value="${value('odds')}" placeholder="1.85" required maxlength="12">
        </label>
        <label>Bookmaker
          <input type="text" name="bookmaker" value="${value('bookmaker')}" placeholder="Winamax" maxlength="60">
        </label>
        <label>Confiance (1-5)
          <input type="number" name="confidence" min="1" max="5" value="${value('confidence') || 3}">
        </label>
      </div>
      <label>Analyse
        <textarea name="analysis" rows="6" placeholder="Pourquoi ce pari…" maxlength="4000">${value('analysis')}</textarea>
      </label>
      <div class="photo-field">
        <span class="label">Photo du ticket (facultatif)</span>
        ${bet && bet.photo ? `<div class="photo-current">
          <img src="/admin/bets/${escape(bet.id)}/photo" alt="Photo actuelle du ticket">
          <div>
            <p class="muted">Photo enregistrée — ${Math.round(bet.photo.size / 1024)} Ko. Elle n'est visible qu'après paiement.</p>
            <label class="inline"><input type="checkbox" name="removePhoto" value="1"> Retirer la photo</label>
          </div>
        </div>` : ''}
        <input type="file" name="photo" accept="image/jpeg,image/png,image/webp">
        <p class="muted">JPEG, PNG ou WebP, 5 Mo maximum.${bet && bet.photo ? ' En choisir une nouvelle remplace l’actuelle.' : ''}</p>
      </div>
      <button class="btn" type="submit">${bet ? 'Mettre à jour' : 'Publier'}</button>
    </form>
  </section>

  <section class="card">
    <h2>Historique</h2>
    <table>
      <thead><tr><th>Date</th><th>Match</th><th>Pronostic</th><th>Cote</th><th>Ventes</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>
</main>`,
  });
}

module.exports = {
  escape,
  configErrorPage,
  formatDate,
  money,
  homePage,
  betPage,
  messagePage,
  adminLoginPage,
  adminDashboard,
};
