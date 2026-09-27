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
<meta name="color-scheme" content="dark">
<meta name="description" content="Un seul pronostic sportif par jour, publié avant la rencontre. Accès 24 h pour ${escape(config.priceLabel)}.">
<title>${escape(title)}</title>
<link rel="stylesheet" href="/styles.css?v=onepage-v3">
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

function shortDate(isoDate) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' })
    .format(new Date(Date.UTC(y, m - 1, d)))
    .replace('.', '');
}

function moneyInput(cents) {
  return (Math.max(0, Number(cents) || 0) / 100).toFixed(2);
}

function outcomeLabel(outcome) {
  return {
    won: 'GAGNÉ',
    lost: 'PERDU',
    void: 'ANNULÉ',
    pending: 'EN ATTENTE',
  }[outcome] || 'EN ATTENTE';
}

function confidenceDots(confidence) {
  const level = Math.min(5, Math.max(0, Number(confidence) || 0));
  const dots = Array.from({ length: 5 }, (_, i) =>
    `<span class="dot${i < level ? ' is-on' : ''}"></span>`).join('');
  return `<span class="dots" role="img" aria-label="Confiance ${level} sur 5">${dots}</span>`;
}

/**
 * Le coeur de la page, dans ses deux etats. C'est le meme bloc, a la meme
 * place : l'acheteur voit se remplir l'encadre qu'il regardait deja, plutot
 * que d'etre emmene sur une autre page apres avoir paye.
 */
function pickCard({ bet, hasAccess }) {
  if (!bet) {
    return `<article class="card card-empty" id="pronostic">
      <p class="eyebrow">Pronostic du jour</p>
      <h2>Pas encore de sélection.</h2>
      <p class="lede">La sélection du jour est publiée avant la rencontre. Repassez d'ici là.</p>
    </article>`;
  }

  const head = `<header class="card-head">
    <p class="eyebrow">Pronostic du jour</p>
    <time datetime="${escape(bet.date)}">${escape(formatDate(bet.date))}</time>
  </header>`;

  if (!hasAccess) {
    // La cote et la confiance sont annoncees : sans elles, l'acheteur paierait
    // sans rien savoir de ce qu'il achete. Le match et la selection, eux, sont
    // exactement ce qu'il paie.
    return `<article class="card card-locked" id="pronostic">
      ${head}
      <dl class="facts facts-teaser">
        <div><dt>Cote</dt><dd class="fact-strong">${escape(bet.odds)}</dd></div>
        <div><dt>Confiance</dt><dd>${confidenceDots(bet.confidence)}</dd></div>
        <div><dt>Sélections</dt><dd class="fact-strong">1</dd></div>
      </dl>
      <div class="veil" aria-hidden="true">
        <span class="veil-label">Match &amp; sélection</span>
        <span class="veil-bar veil-bar-lg"></span>
        <span class="veil-bar"></span>
        <span class="veil-bar veil-bar-sm"></span>
      </div>
      <div class="unlock">
        <form method="post" action="/paiement">
          <button class="btn" type="submit">Débloquer pour ${escape(config.priceLabel)}</button>
        </form>
        <p class="fine">Paiement unique. Sans abonnement. Accès valable 24 h${bet.photo ? ', photo du ticket incluse' : ''}.</p>
      </div>
    </article>`;
  }

  return `<article class="card card-open" id="pronostic">
    ${head}
    <p class="granted"><span class="tick" aria-hidden="true"></span> Accès confirmé — valable 24 h</p>
    <h2 class="match">${escape(bet.match)}</h2>
    <p class="the-pick">${escape(bet.pick)}</p>
    <dl class="facts">
      <div><dt>Cote</dt><dd class="fact-strong">${escape(bet.odds)}</dd></div>
      <div><dt>Bookmaker</dt><dd>${escape(bet.bookmaker || '—')}</dd></div>
      <div><dt>Confiance</dt><dd>${confidenceDots(bet.confidence)}</dd></div>
    </dl>
    ${bet.analysis ? `<section class="analysis">
      <h3>L'analyse</h3>
      <p>${escape(bet.analysis).replace(/\n/g, '<br>')}</p>
    </section>` : ''}
    ${bet.photo ? `<figure class="ticket">
      <figcaption>Le ticket</figcaption>
      <a href="/pari/photo" target="_blank" rel="noopener">
        <img src="/pari/photo" alt="Photo du ticket de pari" loading="lazy">
      </a>
      <p class="fine">Touchez l'image pour l'ouvrir en grand.</p>
    </figure>` : ''}
  </article>`;
}

function ledger(score) {
  const progress = Math.min(100, Math.max(0, Number(score.progress) || 0));
  return `<section class="ledger" data-scoreboard data-target-cents="${Number(score.targetCents)}" aria-label="Suivi de la bankroll">
    <div class="ledger-head">
      <h2 data-goal-title>${escape(score.goalTitle)}</h2>
      <p class="lede" data-goal-text>${escape(score.goalText)}</p>
    </div>
    <div class="meter">
      <p class="meter-top"><span>Solde</span><span class="live"><i></i> à jour</span></p>
      <p class="meter-figure"><strong data-balance>${escape(money(score.balanceCents))}</strong><span>sur <span data-target>${escape(money(score.targetCents))}</span></span></p>
      <div class="track" role="progressbar" aria-label="Progression vers l'objectif" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
        <span data-progress style="--progress:${progress}%"></span>
      </div>
      <p class="meter-foot"><b data-progress-label>${progress}%</b> de l'objectif · <span data-settled>${Number(score.settledCount) || 0}</span> paris réglés, <span data-wins>${Number(score.wins) || 0}</span> gagnants</p>
    </div>
  </section>`;
}

function record(score) {
  if (!score.history.length) {
    return `<section class="record" aria-label="Historique des paris">
      <h2>Historique</h2>
      <p class="lede">Retrouvez bientôt les résultats des paris publiés.</p>
    </section>`;
  }

  const rows = score.history.map((bet) => `<li class="entry entry-${escape(bet.outcome)}">
    <time datetime="${escape(bet.date)}">${escape(shortDate(bet.date))}</time>
    <div class="entry-what">
      <h3>${escape(bet.match)}</h3>
      <p>${escape(bet.pick)}</p>
    </div>
    <span class="entry-odds">${escape(bet.odds)}</span>
    <span class="entry-result">
      <b>${escape(outcomeLabel(bet.outcome))}</b>
      ${bet.outcome === 'pending' ? '' : `<span>${bet.profitCents > 0 ? '+' : ''}${escape(money(bet.profitCents))}</span>`}
    </span>
  </li>`).join('');

  return `<section class="record" aria-label="Historique des paris">
    <h2>Historique</h2>
    <p class="lede">Tous les paris réglés, gagnants comme perdants.</p>
    <ol class="entries">${rows}</ol>
  </section>`;
}

function homePage({ bet, hasAccess, scoreboard, error }) {
  return layout({
    title: 'Le pari du jour — Pronostics sportifs',
    bodyClass: 'public',
    body: `${demoBanner}
<main class="page">
  <header class="masthead">
    <p class="brand"><span class="mark" aria-hidden="true"></span> Le pari du jour</p>
    <p class="live"><i></i> Multisport</p>
  </header>

  <section class="intro">
    <h1>Un seul pronostic<br>par jour.</h1>
    <p class="lede">Football, tennis, basket… Un pronostic travaillé, publié avant la rencontre. Pas de combiné, pas de rattrapage, pas d'abonnement.</p>
  </section>

  ${error ? `<p class="error" role="alert">${escape(error)}</p>` : ''}

  ${pickCard({ bet, hasAccess })}

  ${ledger(scoreboard)}
  ${record(scoreboard)}

  <footer class="foot">
    <p>Les paris sportifs comportent des risques : endettement, isolement, dépendance. Interdit aux mineurs.</p>
    <p class="foot-mark">18+ · Jouer comporte des risques</p>
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
      setAll('[data-target]', euros(score.targetCents));
      setAll('[data-goal-title]', score.goalTitle);
      setAll('[data-goal-text]', score.goalText);
      setAll('[data-progress-label]', progress + '%');
      setAll('[data-settled]', String(Number(score.settledCount) || 0));
      setAll('[data-wins]', String(Number(score.wins) || 0));
      if (bar) bar.style.setProperty('--progress', progress + '%');
      if (meter) meter.setAttribute('aria-valuenow', String(progress));
    } catch (_) { /* Le compteur garde la derniere valeur valide. */ }
  };
  window.setInterval(refresh, 30000);
})();
</script>`,
  });
}

function messagePage({ title, heading, message, link }) {
  return layout({
    title,
    bodyClass: 'public',
    body: `<main class="page page-slim">
  <header class="masthead">
    <p class="brand"><span class="mark" aria-hidden="true"></span> Le pari du jour</p>
  </header>
  <section class="intro">
    <h1>${escape(heading)}</h1>
    <p class="lede">${escape(message)}</p>
  </section>
  <p><a class="btn" href="${escape(link.href)}">${escape(link.label)}</a></p>
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
    bodyClass: 'admin',
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
  <form method="post" action="/admin/login" class="card-admin">
    <label>Mot de passe
      <input type="password" name="password" autocomplete="current-password" required autofocus>
    </label>
    <button class="btn" type="submit">Se connecter</button>
  </form>
  <p class="note"><a href="/">← Retour au site</a></p>
</main>`,
  });
}

function adminDashboard({ bet, bets, stats, sales, bankroll, today, flash, error }) {
  const value = (field) => escape(bet ? bet[field] : '');
  const stake = moneyInput(bet ? bet.stakeCents : 0);
  const outcome = bet && bet.outcome ? bet.outcome : 'pending';
  const moneyField = (cents) => moneyInput(cents);
  const bankrollValues = bankroll || {
    startingBalanceCents: 0,
    goalCents: 10000,
    goalTitle: 'ROAD TO ONE HUNDRED.',
    goalText: 'Chaque pari réglé fait avancer le compteur. On joue la montée, point après point.',
  };
  const rows = bets.length
    ? bets.map((item) => `<tr>
        <td>${escape(formatDate(item.date))}</td>
        <td>${escape(item.match)}</td>
        <td>${escape(item.pick)}</td>
        <td>${escape(item.odds)}</td>
        <td>${escape(money(item.stakeCents))}</td>
        <td>${escape(outcomeLabel(item.outcome))}</td>
        <td>${sales && sales.get(item.date) ? sales.get(item.date) : 0}</td>
        <td class="row-actions">
          <a href="/admin?date=${escape(item.date)}">Éditer</a>
          <form method="post" action="/admin/bets/${escape(item.id)}/delete"
                onsubmit="return confirm('Supprimer le pari du ${escape(item.date)} ?')">
            <button type="submit" class="link danger">Supprimer</button>
          </form>
        </td>
      </tr>`).join('')
    : `<tr><td colspan="8" class="muted">Aucun pari publié pour le moment.</td></tr>`;

  return layout({
    title: 'Admin — pari du jour',
    bodyClass: 'admin',
    body: `${demoBanner}
<header class="topbar">
  <span class="logo">Admin</span>
  <nav>
    <a href="/" target="_blank" rel="noopener">Voir le site</a>
    <form method="post" action="/admin/logout"><button class="link" type="submit">Déconnexion</button></form>
  </nav>
</header>
<main class="wrap">
  ${flash ? `<p class="success">${escape(flash)}</p>` : ''}
  ${error ? `<p class="error">${escape(error)}</p>` : ''}

  <section class="card-admin bankroll-config">
    <div class="admin-section-head"><div><span class="label">Solde live public</span><h2>Objectif bankroll</h2></div><p>Le solde se calcule automatiquement après chaque résultat enregistré : mise × cote pour un gain, mise retirée pour une perte.</p></div>
    <form method="post" action="/admin/bankroll" class="form">
      <div class="row">
        <label>Solde initial (€)
          <input type="number" name="startingBalance" value="${escape(moneyField(bankrollValues.startingBalanceCents))}" min="0" max="1000000" step="0.01" required>
        </label>
        <label>Objectif (€)
          <input type="number" name="goal" value="${escape(moneyField(bankrollValues.goalCents))}" min="0.01" max="1000000" step="0.01" required>
        </label>
      </div>
      <label>Titre de l’objectif
        <input type="text" name="goalTitle" value="${escape(bankrollValues.goalTitle)}" maxlength="80" required>
      </label>
      <label>Texte de l’objectif
        <textarea name="goalText" rows="3" maxlength="240" required>${escape(bankrollValues.goalText)}</textarea>
      </label>
      <button class="btn" type="submit">Mettre à jour le live</button>
    </form>
  </section>

  <section class="stats">
    <div class="stat"><span class="label">Ventes aujourd'hui</span><strong>${stats.todayOrders}</strong></div>
    <div class="stat"><span class="label">CA aujourd'hui</span><strong>${escape(money(stats.todayCents))}</strong></div>
    <div class="stat"><span class="label">Ventes totales</span><strong>${stats.totalOrders}</strong></div>
    <div class="stat"><span class="label">CA total</span><strong>${escape(money(stats.totalCents))}</strong></div>
  </section>

  <section class="card-admin">
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
      <div class="row bet-resolution">
        <label>Mise (€)
          <input type="number" name="stake" value="${escape(stake)}" min="0.01" max="1000000" step="0.01" required>
        </label>
        <label>Résultat
          <select name="outcome" required>
            <option value="pending"${outcome === 'pending' ? ' selected' : ''}>En attente</option>
            <option value="won"${outcome === 'won' ? ' selected' : ''}>Gagné</option>
            <option value="lost"${outcome === 'lost' ? ' selected' : ''}>Perdu</option>
            <option value="void"${outcome === 'void' ? ' selected' : ''}>Annulé / remboursé</option>
          </select>
        </label>
      </div>
      <p class="muted resolution-note">Le gain ou la perte est calculé automatiquement à partir de la mise, de la cote et du résultat. Il ne peut pas être saisi manuellement.</p>
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

  <section class="card-admin">
    <h2>Historique</h2>
    <table>
      <thead><tr><th>Date</th><th>Match</th><th>Pronostic</th><th>Cote</th><th>Mise</th><th>Résultat</th><th>Ventes</th><th></th></tr></thead>
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
  messagePage,
  adminLoginPage,
  adminDashboard,
};
