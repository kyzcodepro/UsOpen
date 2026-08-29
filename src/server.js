'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const config = require('./config');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const views = require('./views');

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

// Aucune page de ce site n'est rejouable : l'accueil affiche le solde live et
// le pari du jour, /pari n'a de sens que pour le cookie qui l'accompagne. Un
// validateur sur ces reponses n'apporte donc rien, et il coute cher : le
// navigateur revalide, recoit un 304 sans corps, et s'il a perdu le corps de
// son cote il affiche une page vide. Sans ETag, une revalidation ne peut plus
// que renvoyer la page entiere. Les fichiers de public/ gardent le leur :
// express.static tient sa propre option.
app.set('etag', false);

// L'apex et le sous-domaine www servent la meme application. Sans redirection,
// un acheteur qui paie depuis www recoit son cookie d'acces sur ce hote-la :
// revenu sur l'apex, il a paye sans plus rien voir. On ramene donc tout sur un
// seul hote, avant meme le controle de configuration : une variable manquante
// ne doit pas laisser deux domaines vivre leur vie.
//
// Seules les lectures sont redirigees : le webhook Stripe ne suit pas les
// redirections, et un POST redirige perdrait sa signature.
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const forwarded = req.get('x-forwarded-host');
  const host = String(forwarded ? forwarded.split(',')[0] : req.get('host') || '').trim();
  // On ne reconstruit une URL qu'a partir d'un hote de forme connue : l'en-tete
  // Host vient du client, il ne doit jamais devenir une redirection ouverte.
  if (!/^www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?$/i.test(host)) return next();
  res.redirect(301, `${req.protocol}://${host.slice(4)}${req.originalUrl}`);
});

// Une variable d'environnement manquante donnerait sinon une 500 opaque :
// on affiche precisement ce qu'il faut definir.
if (config.errors.length) {
  app.use((req, res) => {
    res.status(503).send(views.configErrorPage({
      missing: config.errors,
      env: config.vercelEnv,
      present: config.presentVars,
    }));
  });
} else {
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(cookieParser());
  app.use(express.static(path.join(config.root, 'public'), { maxAge: '1h' }));

  // Passe ce point : plus aucun fichier statique, express.static a deja repondu
  // pour eux. Sans en-tete explicite, l'hebergeur etiquette ces pages
  // « public, max-age=0, must-revalidate » : le solde live et le pari du jour
  // deviennent stockables par un cache partage, et /pari — payant, lie a un
  // cookie — avec eux. Une route qui a mieux a dire ecrase cette valeur.
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.use(publicRoutes);
  app.use(adminRoutes);

  app.use((req, res) => {
    res.status(404).send(views.messagePage({
      title: 'Page introuvable',
      heading: 'Page introuvable',
      message: "Cette page n'existe pas.",
      link: { href: '/', label: "Retour à l'accueil" },
    }));
  });

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    // Ces traces sont visibles dans les logs de la fonction (Vercel → Logs).
    console.error('[erreur]', req.method, req.url, '\n', err && err.stack ? err.stack : err);
    if (err && err.cause) console.error('[erreur] cause :', err.cause);
    res.status(500).send(views.messagePage({
      title: 'Erreur',
      heading: 'Une erreur est survenue',
      message: 'Merci de réessayer dans un instant.',
      link: { href: '/', label: "Retour à l'accueil" },
    }));
  });
}

// En serverless, l'hebergeur importe ce module et appelle app lui-meme :
// on n'ouvre un port que lorsqu'on est lance directement.
if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`▶ Le pari du jour — http://localhost:${config.port}`);
    console.log(`  Admin      : ${config.baseUrl}/admin`);
    console.log(`  Paiement   : ${config.demoMode ? 'MODE DÉMO (aucune clé Stripe)' : 'Stripe'}`);
    console.log(`  Base       : ${config.databaseUrl ? 'libSQL — ' + config.databaseUrl.replace(/\?.*$/, '') : 'NON CONFIGURÉE'}`);
    if (config.errors.length) {
      console.log(`  ⚠ Variables manquantes : ${config.errors.join(', ')}`);
    }
    for (const warning of config.warnings) console.log('  ⚠ ' + warning);
    if (config.generatedAdminPassword) {
      console.log(`  Mot de passe admin généré : ${config.generatedAdminPassword}`);
      console.log('  (définissez ADMIN_PASSWORD dans .env pour le fixer)');
    }
  });
}

module.exports = app;
