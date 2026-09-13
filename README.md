# Costa Cantábrica · plages & criques

Carte-sélecteur des plages et criques de la côte cantabrique (**Asturies** et **Cantabrie**,
de la ría de Ribadeo à Castro Urdiales / Santander) avec prévisions **météo, houle et marées**
à 7 jours, pour planifier des sorties plage, crique, surf ou balade côtière.

Application web statique (aucun serveur, aucune clé API), pensée **mobile d'abord**, à
utiliser à **deux** : chaque voyageur marque ses envies, un lien de partage fusionne les
deux listes sur l'autre téléphone.

## Fonctionnalités

- **~170 plages et criques** issues d'OpenStreetMap (nom, type, surface, taille estimée,
  surveillance, naturisme, chiens, Wikipédia, accès).
- **Score 0–100 par jour et par profil** : *Plage & baignade*, *Famille (calme)*, *Surf*,
  *Balade & photo*. Le score combine pluie, ciel, température, vent, rafales et hauteur de
  houle (avec, pour le surf, période et vent de terre). Les marqueurs de la carte sont
  colorés selon le score du jour choisi.
- **Fiche détaillée** : 7 cartes journalières, heure par heure (température, pluie, vent et
  direction, houle et période, UV), **marées** (pleine mer / basse mer) calculées à partir
  du niveau de la mer horaire, température de l'eau, lever/coucher du soleil, itinéraire
  Google Maps, lien GPS, Wikipédia, OSM.
- **Filtres** : province, plage/crique, sable ou non, envies (A, B, communes), score
  minimum, tri (score, distance, nom, taille), recherche par nom.
- **Deux voyageurs** : prénoms personnalisables, envies ♡ distinctes par personne, filtre
  « envies communes », **partage par lien** (Web Share sur mobile, sinon presse-papiers),
  export GeoJSON des envies.
- **Mobile** : panneau glissant (3 hauteurs), gros boutons tactiles, géolocalisation et tri
  par distance, installable sur l'écran d'accueil (manifest PWA), thème sombre automatique.
- Fonds de carte : plan OSM, satellite Esri, relief OpenTopoMap.

## Sources de données

| Donnée | Source | Notes |
|---|---|---|
| Plages, criques | [OpenStreetMap](https://www.openstreetmap.org) via Overpass, `natural=beach` + `name` | licence ODbL |
| Météo | [Open-Meteo](https://open-meteo.com) `forecast` | gratuit, sans clé, usage non commercial |
| Houle, niveau de la mer, T° eau | Open-Meteo `marine` (`cell_selection=sea`) | grille marine grossière près des côtes (~10–20 km) : la houle est celle du large, pas celle de la plage abritée |
| Marées | dérivées du `sea_level_height_msl` horaire d'Open-Meteo | approximation (±20 min) ; pour une sortie qui dépend de la marée (Gulpiyuri, grottes…), vérifier avec les tables officielles |

Les prévisions sont mises en cache dans le navigateur pendant 60 min.

## Utilisation

Hébergée sur GitHub Pages : ouvrir la page, choisir le jour et le profil, parcourir la liste
classée ou toucher un point de la carte.

En local :

```bash
python3 -m http.server 8000
# puis http://localhost:8000
```

(Un simple `file://` ne suffit pas : le GeoJSON est chargé par `fetch`.)

## Données : pipeline gispulse

Les spots sont produits avec [gispulse](https://github.com/imagodata/gispulse), moteur de
règles spatiales déclaratif (CLI + portail). Le traitement est décrit dans
`gispulse/spots_pipeline.json` (pipeline v2) et exécuté par `gispulse run` :

```bash
pip install gispulse           # ou pipx install gispulse
make spots                     # caches OSM → gispulse run → data/spots.geojson
make refresh                   # idem en réinterrogeant Overpass
GISPULSE=/chemin/venv/bin/gispulse make spots   # binaire précis
```

Étapes :

1. `scripts/fetch_osm.py` interroge Overpass (`natural=beach` + `name`, bbox
   `43.25,-7.05,43.75,-3.15`) et la ligne de côte (`natural=coastline`), met les réponses
   en cache dans `data/raw/` et écrit deux GeoJSON bruts : `beaches_osm.geojson` (centre de
   chaque plage, tags utiles, `size_m` = diagonale de sa bbox) et `coastline_pts.geojson`
   (sommets de côte amincis à ~200 m).
2. `gispulse run data/raw/beaches_osm.geojson --rules gispulse/spots_pipeline.json` enchaîne
   trois capabilities :
   - `nearest_neighbor` (réf. `coast`, EPSG:25830) → `coast_m`, distance à la côte ;
   - `calculate` → `coast_km`, `is_cala` (nom commençant par « Cala » ou taille < 220 m),
     `type` (`cala`/`playa`), `province` (Asturies à l'ouest de -4,515°, ría de Tina Mayor) ;
   - `filter` → `coast_m <= 2500`, ce qui écarte plages fluviales et de lac.
3. `scripts/build_spots.py` orchestre le tout, dédoublonne (égalités de distance),
   trie par nom et ne garde que les colonnes utiles → `data/spots.geojson`.

Aperçu rapide des spots dans la visionneuse embarquée de gispulse : `make preview`
(`gispulse serve data/spots.geojson`).

### Carte sur un portail gispulse

`gispulse/saved_map.json` décrit la composition (couches, styles, vue) d'une « carte
sauvegardée » du portail. Pour la créer sur un portail en marche
(`gispulse portal`, ou `docker compose up` dans le dépôt gispulse) :

```bash
GISPULSE_API=http://localhost:8001 make publish-map
# → imprime l'URL /maps/<id> ; GISPULSE_MAP_ID=<id> pour mettre à jour ensuite
```

## Structure

```
index.html                    page unique
css/style.css                 mobile-first, panneau glissant, mode sombre
js/config.js                  sources, profils, codes météo
js/forecast.js                appels Open-Meteo, cache, score, marées
js/app.js                     carte Leaflet, liste, fiche, filtres, voyageurs, partage
data/spots.geojson            spots (généré)
data/raw/                     caches OSM + GeoJSON bruts (entrées du pipeline)
gispulse/spots_pipeline.json  pipeline gispulse v2 (nearest_neighbor → calculate → filter)
gispulse/saved_map.json       composition de carte pour le portail gispulse
scripts/fetch_osm.py          extraction Overpass → data/raw/
scripts/build_spots.py        orchestrateur : fetch → gispulse run → post-traitement
scripts/publish_gispulse_map.py   POST/PUT de la carte sur un portail
Makefile                      spots, refresh, serve, preview, publish-map
```

## Limites connues

- La houle affichée est celle de la cellule marine la plus proche (au large) ; une crique
  orientée est ou abritée par un cap peut être bien plus calme.
- Le score est un indicateur, pas une garantie : vérifier drapeaux et consignes sur place.
- Pas de mode hors-ligne complet (les tuiles et l'API nécessitent le réseau).

## Licence

Code sous licence MIT. Données OpenStreetMap © contributeurs, ODbL. Prévisions Open-Meteo, CC BY 4.0.
