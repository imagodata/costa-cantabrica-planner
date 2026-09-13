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

## Régénérer les spots

```bash
python3 scripts/build_spots.py            # réutilise data/overpass_raw.json
python3 scripts/build_spots.py --refresh  # réinterroge Overpass
```

Le script :
1. interroge Overpass (`natural=beach` + `name`) sur la bbox `43.25,-7.05,43.75,-3.15` ;
2. estime la taille de chaque plage (diagonale de sa bbox) → `cala` sous 220 m ou si le nom
   commence par « Cala », sinon `playa` ;
3. écarte les plages fluviales et de lac en ne gardant que les points à moins de 1,5 km de
   la ligne de côte OSM (`natural=coastline`, mise en cache dans `data/coastline_raw.json`) ;
4. écrit `data/spots.geojson`.

## Structure

```
index.html            page unique
css/style.css         mobile-first, panneau glissant, mode sombre
js/config.js          sources, profils, codes météo
js/forecast.js        appels Open-Meteo, cache, score, marées
js/app.js             carte Leaflet, liste, fiche, filtres, voyageurs, partage
data/spots.geojson    spots (généré)
scripts/build_spots.py
```

## Limites connues

- La houle affichée est celle de la cellule marine la plus proche (au large) ; une crique
  orientée est ou abritée par un cap peut être bien plus calme.
- Le score est un indicateur, pas une garantie : vérifier drapeaux et consignes sur place.
- Pas de mode hors-ligne complet (les tuiles et l'API nécessitent le réseau).

## Licence

Code sous licence MIT. Données OpenStreetMap © contributeurs, ODbL. Prévisions Open-Meteo, CC BY 4.0.
