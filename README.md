# 🎯 Le pari du jour

Une page unique où les visiteurs paient **1 €** pour débloquer le pronostic du jour,
avec une interface d'administration pour publier ce pronostic.

## Ce que ça fait

**Côté public** (`/`)
- Le pari du jour est affiché en aperçu flouté, avec la date.
- Bouton « Débloquer pour 1,00 € » → paiement Stripe Checkout.
- Après paiement, redirection vers `/pari` qui affiche le pronostic complet
  (match, pronostic, cote, bookmaker, niveau de confiance, analyse).
- L'accès est mémorisé dans un cookie signé, valable 24 h et lié à la date du pari payé.

**Côté admin** (`/admin`)
- Connexion par mot de passe (limitée à 8 tentatives par IP / 15 min).
- Formulaire pour publier ou modifier le pari du jour (un pari par date).
- Historique des paris publiés, avec édition et suppression.
- Compteurs de ventes et de chiffre d'affaires (jour et total).

## Démarrage

```bash
npm install
cp .env.example .env    # puis éditez .env
npm start               # http://localhost:3000
```

Sans `.env`, l'application démarre quand même : elle génère un mot de passe admin
aléatoire (affiché dans la console) et passe en **mode démo**, où le paiement est
simulé pour permettre de tester le parcours de bout en bout.

## Configuration

| Variable | Rôle |
|---|---|
| `PORT` | Port d'écoute (défaut `3000`) |
| `BASE_URL` | URL publique, utilisée pour les redirections Stripe |
| `ADMIN_PASSWORD` | Mot de passe de `/admin`. Généré aléatoirement si absent |
| `STRIPE_SECRET_KEY` | Clé secrète Stripe. Si absente → mode démo |
| `PRICE_CENTS` | Prix en centimes (défaut `100`, soit 1,00 €) |
| `APP_SECRET` | Secret de signature des cookies. Généré et persisté dans `data/secret.key` si absent |

## Brancher Stripe

1. Créez un compte sur [stripe.com](https://stripe.com) et récupérez votre clé secrète
   (`sk_test_…` pour les tests, `sk_live_…` en production).
2. Renseignez `STRIPE_SECRET_KEY` et `BASE_URL` dans `.env`, puis redémarrez.
3. En test, utilisez la carte `4242 4242 4242 4242` avec une date future et n'importe quel CVC.

Le paiement est confirmé au retour de Stripe : l'application interroge l'API pour
vérifier que `payment_status === 'paid'` avant de donner l'accès. Aucune clé Stripe
n'est exposée côté navigateur.

## Structure

```
src/
  server.js       point d'entrée Express
  config.js       configuration + chargement du .env
  store.js        persistance JSON (data/db.json), écriture atomique
  auth.js         cookies signés HMAC : accès payant et session admin
  payment.js      Stripe Checkout (et son équivalent en mode démo)
  views.js        rendu HTML (échappement systématique)
  routes/
    public.js     accueil, paiement, page du pari
    admin.js      connexion, publication, historique
public/styles.css
data/db.json      base de données (créée au premier lancement, non versionnée)
```

## Notes

- Les données vivent dans un simple fichier JSON, suffisant pour un pari par jour.
  Pour un volume important, remplacez `src/store.js` par une vraie base.
- Le dossier `data/` n'est pas versionné : sur un hébergement éphémère (conteneur
  recréé à chaque déploiement), montez un volume persistant, sinon les paris et
  les ventes seront perdus.
- Le mode démo doit rester désactivé en production : sans clé Stripe, n'importe qui
  accède au pari gratuitement.
