# Maquettes — refonte de l'interface

Sources des maquettes présentées sur le canevas de design.
Chaque `.dc.html` est un écran ; `canvas.json` décrit leur disposition.

- `Main.dc.html` — accueil, pronostic sous pli
- `Debloque.dc.html` — après paiement
- `Mobile.dc.html` — accueil en 390 px
- `Admin.dc.html` — interface de publication
- `DirectionB.dc.html` / `DirectionC.dc.html` — deux directions alternatives, à l'état d'esquisse

Direction retenue : registre éditorial (papier journal, Bodoni Moda + Archivo,
un rouge d'encre). Aucune de ces maquettes n'est encore portée dans l'application :
`src/views.js` et `public/styles.css` utilisent toujours l'interface d'origine.

Les valeurs affichées (ventes, recettes, analyse, historique) sont des exemples
destinés à juger la mise en page, pas des données réelles.
