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

// Une variable d'environnement manquante donnerait sinon une 500 opaque :
// on affiche precisement ce qu'il faut definir.
if (config.errors.length) {
  app.use((req, res) => {
    res.status(503).send(views.configErrorPage({ missing: config.errors }));
  });
} else {
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(cookieParser());
  app.use(express.static(path.join(config.root, 'public'), { maxAge: '1h' }));

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
    console.error('[erreur]', err);
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
