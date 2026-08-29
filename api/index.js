'use strict';

// Point d'entree serverless : Vercel importe ce fichier et passe chaque requete
// a l'application Express, qui n'ouvre alors aucun port.
module.exports = require('../src/server.js');
