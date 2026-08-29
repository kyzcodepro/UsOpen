# 🎯 Le pari du jour

Une page unique où les visiteurs paient **1 €** pour débloquer le pronostic du jour,
avec une interface d'administration pour publier ce pronostic.

## Ce que ça fait

**Côté public** (`/`)
- Le pari du jour est affiché en aperçu flouté, avec la date.
- Bouton « Débloquer pour 1,00 € » → paiement Stripe Checkout.
- Après paiement, redirection vers `/pari` qui affiche le pronostic complet
  (match, pronostic, cote, bookmaker, niveau de confiance, analyse) et, s'il y en
  a une, la photo du ticket.
- La photo est annoncée sur l'accueil (« Photo du ticket jointe ») mais jamais
  servie avant paiement.
- L'accès est mémorisé dans un cookie signé, valable 24 h et lié à la date du pari payé.

**Côté admin** (`/admin`)
- Connexion par mot de passe (limitée à 8 tentatives par IP / 15 min).
- Formulaire pour publier ou modifier le pari du jour (un pari par date),
  avec envoi facultatif d'une photo du ticket (JPEG, PNG ou WebP, 5 Mo max).
- Historique des paris publiés, avec édition et suppression.
- Compteurs de ventes et de chiffre d'affaires (jour et total).

## Démarrage en local

La base est [Turso](https://turso.tech) (libSQL). En local, inutile de créer
quoi que ce soit en ligne : le même client lit un fichier SQLite.

```bash
npm install
cp .env.example .env    # TURSO_DATABASE_URL=file:data/local.db suffit
npm start               # http://localhost:3000
```

Le schéma (`bets`, `orders`) est créé automatiquement au premier appel.
Sans `ADMIN_PASSWORD`, un mot de passe aléatoire est généré et affiché dans la
console ; sans `STRIPE_SECRET_KEY`, l'application passe en **mode démo** où le
paiement est simulé, ce qui permet de tester le parcours de bout en bout.

Si une variable indispensable manque, l'application ne plante pas : elle répond
`503` avec la liste précise de ce qu'il faut définir.

## Déploiement sur Vercel

L'application tourne en fonction serverless : `api/index.js` exporte
l'application Express et `vercel.json` y renvoie toutes les requêtes.

1. Créez la base et son jeton :

   ```bash
   turso db create pari-du-jour
   turso db show pari-du-jour --url      # → libsql://...
   turso db tokens create pari-du-jour   # → le jeton
   ```

2. Dans le projet Vercel, Settings → Environment Variables, définissez :
   `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_PASSWORD`, `APP_SECRET`,
   `BASE_URL` (et `STRIPE_SECRET_KEY` pour encaisser réellement).
3. Redéployez.

libSQL parle HTTP : il n'y a pas de connexion à maintenir ni de pool à
dimensionner, ce qui évite l'écueil classique des bases SQL en serverless.

### Vérifier que la base répond

`GET /sante` tente une requête triviale et renvoie du JSON :

```json
{ "base": "ok", "cible": "libsql://…turso.io", "ms": 42 }
```

En cas d'échec, la réponse nomme la cause (`401` = jeton invalide, `404` = URL
de base erronée, un délai dépassé = hôte injoignable). Le jeton n'est jamais
renvoyé, seulement sa longueur. Les mêmes détails partent dans les logs de la
fonction (Vercel → Logs).

Rien n'est écrit sur le disque en production : le disque de Vercel est en
lecture seule et chaque instance est jetable. La base de données et les photos
vivent dans Turso, le secret de signature et le mot de passe admin dans
les variables d'environnement — c'est pourquoi `APP_SECRET` est obligatoire :
sans lui, chaque instance signerait les cookies différemment et les accès payés
seraient invalides d'une requête à l'autre.

## Configuration

| Variable | Rôle |
|---|---|
| `TURSO_DATABASE_URL` | **Obligatoire.** `libsql://…` en production, `file:data/local.db` en local. `DATABASE_URL` est accepté aussi |
| `TURSO_AUTH_TOKEN` | Jeton Turso. Obligatoire dès que l'URL est distante |
| `ADMIN_PASSWORD` | Mot de passe de `/admin`. Obligatoire en production ; généré aléatoirement en local |
| `APP_SECRET` | Secret de signature des cookies. Obligatoire en production ; persisté dans `data/secret.key` en local |
| `BASE_URL` | URL publique, utilisée pour les redirections Stripe |
| `STRIPE_SECRET_KEY` | Clé secrète Stripe. Si absente → mode démo |
| `STRIPE_PRICE_ID` | Identifiant du tarif Stripe Checkout. Par défaut : `price_1U9cHpDtqk1qvqGzPK7j5hi5` (« Prono du jour », 1,00 €) |
| `STRIPE_WEBHOOK_SECRET` | Secret du webhook (`whsec_…`). Sans lui, l'endpoint webhook est désactivé |
| `PRICE_CENTS` | Prix affiché et prix du mode démo en centimes (défaut `100`, soit 1,00 €), à garder cohérent avec le tarif Stripe |
| `MAX_PHOTO_MB` | Taille maximale d'une photo, en Mo (défaut `2`) |
| `PORT` | Port d'écoute en local (ignoré en serverless) |

## Brancher Stripe

1. Le projet utilise déjà le tarif Stripe **« Prono du jour » à 1,00 €** :
   `price_1U9cHpDtqk1qvqGzPK7j5hi5`. Il est transmis à Checkout comme
   `line_items[0].price`, de sorte qu'aucun produit n'est créé à chaque achat.
2. Ce tarif a été créé en **mode réel** ; récupérez une clé `sk_live_…` dans le
   même compte Stripe pour la production. Pour tester sans encaisser, créez un
   tarif séparé en mode test, puis définissez à la fois sa clé `sk_test_…` et
   son identifiant dans `STRIPE_PRICE_ID`.
3. Définissez `STRIPE_SECRET_KEY` **et** `BASE_URL` (l'URL publique du site). Le
   `STRIPE_PRICE_ID` par défaut convient ; ne le remplacez que si vous créez un
   autre tarif. Gardez `PRICE_CENTS` à `100` tant que le tarif reste à 1,00 €.
4. Avec un tarif et une clé de test, utilisez la carte `4242 4242 4242 4242`, une date future,
   n'importe quel CVC.

`BASE_URL` n'est pas optionnelle une fois Stripe actif : c'est l'adresse où
Stripe renvoie l'acheteur après paiement. Si elle pointe encore sur
`localhost`, ou si une clé `sk_live_` est utilisée sans `https`, l'application
refuse de démarrer et le dit — encaisser puis renvoyer le client dans le vide
serait pire qu'une page d'erreur.

Le paiement est confirmé au retour de Stripe : l'application interroge l'API
pour vérifier que `payment_status === 'paid'` avant de donner l'accès. Aucune
clé Stripe n'est exposée côté navigateur.

### Utiliser un tarif du tableau de bord

Le tarif par défaut est celui du produit **« Prono du jour »** fourni :
`price_1U9cHpDtqk1qvqGzPK7j5hi5`. L'identifiant du produit (`prod_…`) ne peut
pas être utilisé pour Checkout ; il faut l'identifiant de son **tarif**
(`price_…`).

Pour modifier le prix, créez un nouveau tarif ponctuel dans Stripe puis
définissez son identifiant dans `STRIPE_PRICE_ID`. `PRICE_CENTS` ne sert qu'à
l'affichage et au mode démo : gardez-le cohérent avec le tarif. `GET /sante`
compare les montants et signale un écart, un tarif archivé ou un abonnement.

### Le webhook (recommandé)

Si l'acheteur ferme l'onglet avant d'être redirigé, le retour navigateur n'a
jamais lieu : il a payé, mais la vente n'est pas comptabilisée. Le webhook
rattrape ce cas.

1. Stripe → Developers → Webhooks → *Add endpoint*
2. URL : `https://votre-site/paiement/webhook`
3. Événement : `checkout.session.completed`
4. Copiez le secret (`whsec_…`) dans `STRIPE_WEBHOOK_SECRET`, puis redéployez.

La signature est vérifiée sur les octets bruts du corps ; une signature
invalide donne un `400` et n'enregistre rien. Comme l'enregistrement est
idempotent (la référence est l'ID de session Stripe), une vente confirmée à la
fois par le retour navigateur et par le webhook n'est comptée qu'une seule
fois. Sans `STRIPE_WEBHOOK_SECRET`, l'endpoint répond `404`.

## Structure

```
api/index.js      point d'entrée serverless (exporte l'app Express)
vercel.json       renvoie toutes les requêtes vers la fonction
src/
  server.js       application Express
  config.js       configuration, .env, contrôle des variables obligatoires
  db.js           client libSQL + création du schéma à la demande
  store.js        accès aux paris et aux commandes (SQL)
  auth.js         cookies signés HMAC : accès payant et session admin
  payment.js      Stripe Checkout (et son équivalent en mode démo)
  uploads.js      réception des photos : signature vérifiée, rien sur disque
  views.js        rendu HTML (échappement systématique)
  routes/
    public.js     accueil, paiement, page du pari
    admin.js      connexion, publication, historique
public/styles.css
```

## La photo du ticket

Elle est traitée comme du contenu payant, pas seulement masquée à l'écran :

- les octets vivent dans la colonne `photo_data` (BLOB) de la table `bets` :
  rien n'est servi en statique et l'URL n'est pas devinable ;
- ils ne sortent que par `GET /pari/photo`, qui exige un accès payé pour le pari
  du jour, et répond `403` sinon. L'accueil ne contient pas cette URL ;
- la réponse porte `Cache-Control: private, no-store` pour qu'aucun cache
  partagé ne la conserve ;
- le type est déduit de la **signature du fichier**, pas de ce que déclare le
  navigateur : un script renommé en `.png` est refusé ;
- le nom de fichier d'origine n'est jamais utilisé ni conservé ;
- les octets ne sont lus qu'à la demande, jamais chargés avec le reste du pari ;
- supprimer le pari supprime la photo avec lui.

## Notes

- Le mode démo doit rester désactivé en production : sans clé Stripe, n'importe qui
  accède au pari gratuitement.
- La limitation des tentatives de connexion admin est en mémoire, donc par
  instance serverless : c'est un garde-fou, pas un rempart. Un mot de passe long
  reste la vraie protection.
- Les photos sont stockées telles quelles, sans recompression, et transitent par
  le protocole HTTP de libSQL où un BLOB est encodé en base64 : comptez environ
  un tiers de plus sur le réseau, à l'écriture comme à **chaque lecture**. D'où
  la limite par défaut de 2 Mo, réglable avec `MAX_PHOTO_MB`. Si vous montez
  beaucoup plus haut, mieux vaut déplacer les photos vers un stockage d'objets
  et ne garder qu'une référence en base.
