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
<link rel="stylesheet" href="/styles.css">
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
</article>`;
}

function homePage({ bet, hasAccess, error }) {
  const teaser = bet
    ? `<div class="teaser">
        <div class="teaser-inner">
          <span class="tag">Pari du jour · ${escape(formatDate(bet.date))}</span>
          <p class="blur">${escape(bet.match)}</p>
          <p class="blur small">${escape(bet.pick)} — cote ${escape(bet.odds)}</p>
        </div>
        <div class="lock">🔒</div>
      </div>`
    : `<div class="teaser empty"><p>Le pari du jour n'est pas encore publié. Repassez dans un moment.</p></div>`;

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
    title: 'Le pari du jour',
    bodyClass: 'public',
    body: `${demoBanner}
<main class="wrap">
  <h1 class="logo">🎯 Le pari du jour</h1>
  <p class="baseline">Un seul pronostic par jour, sélectionné et argumenté. ${escape(config.priceLabel)} pour le lire.</p>
  ${error ? `<p class="error">${escape(error)}</p>` : ''}
  ${teaser}
  <div class="cta">${action}</div>
  <ul class="perks">
    <li>1 pari sélectionné chaque jour</li>
    <li>Analyse, cote et niveau de confiance</li>
    <li>Paiement unique de ${escape(config.priceLabel)}, pas d'abonnement</li>
  </ul>
  <footer class="foot">
    <a href="/admin">Espace admin</a>
    <span>Jouer comporte des risques : endettement, isolement, dépendance. 18+</span>
  </footer>
</main>`,
  });
}

function betPage({ bet }) {
  return layout({
    title: 'Pari du jour — débloqué',
    bodyClass: 'public',
    body: `${demoBanner}
<main class="wrap">
  <h1 class="logo">🎯 Le pari du jour</h1>
  <p class="unlocked">✅ Paiement confirmé — voici le pronostic.</p>
  ${betCard(bet, { blurred: false })}
  <div class="cta"><a class="btn ghost" href="/">Retour à l'accueil</a></div>
  <footer class="foot"><span>Jouer comporte des risques. 18+</span></footer>
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

function adminDashboard({ bet, bets, stats, today, flash, error }) {
  const value = (field) => escape(bet ? bet[field] : '');
  const rows = bets.length
    ? bets.map((item) => `<tr>
        <td>${escape(formatDate(item.date))}</td>
        <td>${escape(item.match)}</td>
        <td>${escape(item.pick)}</td>
        <td>${escape(item.odds)}</td>
        <td class="row-actions">
          <a href="/admin?date=${escape(item.date)}">Éditer</a>
          <form method="post" action="/admin/bets/${escape(item.id)}/delete"
                onsubmit="return confirm('Supprimer le pari du ${escape(item.date)} ?')">
            <button type="submit" class="link danger">Supprimer</button>
          </form>
        </td>
      </tr>`).join('')
    : `<tr><td colspan="5" class="muted">Aucun pari publié pour le moment.</td></tr>`;

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
    <form method="post" action="/admin/bets" class="form">
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
      <button class="btn" type="submit">${bet ? 'Mettre à jour' : 'Publier'}</button>
    </form>
  </section>

  <section class="card">
    <h2>Historique</h2>
    <table>
      <thead><tr><th>Date</th><th>Match</th><th>Pronostic</th><th>Cote</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>
</main>`,
  });
}

module.exports = {
  escape,
  formatDate,
  money,
  homePage,
  betPage,
  messagePage,
  adminLoginPage,
  adminDashboard,
};
