# Costa Cantábrica · plages & criques

Carte-sélecteur des plages et criques de la côte cantabrique (**Asturies** et **Cantabrie**,
de la ría de Ribadeo à Castro Urdiales / Santander) avec prévisions **météo, houle et marées**
à 7 jours, pour planifier des sorties plage, crique, surf ou balade côtière.

Application web statique (aucun serveur, aucune clé API), pensée **mobile d'abord**, à
utiliser à **deux** : chaque voyageur marque ses envies, un lien de partage fusionne les
deux listes sur l'autre téléphone.

## Fonctionnalités

- **362 plages et criques** issues d'OpenStreetMap (nom, type, surface, taille estimée,
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
  minimum, tri (score, distance, nom, taille), recherche par nom. La liste **suit la carte** :
  après un geste (glisser, pincer), seules les plages visibles sont listées (puce « Vue carte »
  pour revenir à toute la côte) ; les recadrages automatiques n'y touchent pas.
- **Deux voyageurs** : prénoms personnalisables, envies ♡ distinctes par personne, filtre
  « envies communes », **partage par lien** (Web Share sur mobile, sinon presse-papiers) ou
  « Copier le code » à coller à la connexion (utile sur iPhone quand le lien s'ouvre hors de
  l'application installée), export GeoJSON des envies. Le lien est un instantané : il ajoute
  envies, programmes et séjour sur l'autre téléphone, sans jamais en retirer. Dans une fiche,
  « Proposer à Marie » glisse la plage dans la liste de l'autre avec la mention « Proposé par » ;
  un cœur l'accepte, « Ignorer » l'écarte.
- **Lieux sur mobile** : toucher un lieu ouvre sa fiche dans le panneau (horaires, adresse,
  itinéraire, appel, site, OSM) avec « Ajouter au programme de la plage la plus proche » et
  « Ajouter à un jour du séjour », « Rattacher à une autre plage » ; lien direct
  `app.html#poi=<id OSM>`. Chaque étape du
  séjour a un menu d'actions (voir, monter, descendre, déplacer vers un autre jour, retirer).
- **Mobile et tactile** : panneau glissant qui suit le doigt (trois hauteurs, aimantation selon
  la vitesse du geste, déplacé par translation sans remise en page), glisser la carte replie le panneau, toucher un repère le rouvre, tout
  champ de saisie déploie le panneau au-dessus du clavier, la fiche s'ouvre en plein panneau
  depuis une liste, les étapes du séjour se réordonnent à la poignée, le bouton retour ferme
  aussi la fiche de lieu, liste rendue par lots au défilement, cibles tactiles de 44 px, zones
  sûres iOS, retour haptique, installable sur l'écran d'accueil (manifest PWA), thème sombre,
  panneau latéral sur tablette et en paysage.
- **Photos** : galerie Wikimedia Commons par spot (jusqu'à 10 images : catégorie Commons,
  Wikidata, photos géolocalisées), repli Openverse, avec crédit et licence, en carrousel en tête
  de fiche. Chaque galerie **s'ouvre sur la vue aérienne** zoomée (tuiles satellite Esri), qui
  sert aussi de vignette à toutes les plages dans les listes et d'image aux plages sans photo
  dans l'aperçu des pages de partage. Les vues aériennes sont nettes sur écran haute densité (tuiles
  demandées un niveau plus loin), zoomées selon la taille de la plage, avec une barre d'échelle ;
  le bouton « Satellite » de la fiche bascule la carte sur l'imagerie, centrée sur la plage.
- **Restaurants, bars, bars de plage, cafés, sites culturels et à visiter** (~4 400 lieux OSM
  dans la bande côtière) : couche carte activable (visible à partir du zoom 13), fiche popup
  (cuisine, horaires, site, téléphone, itinéraire) et rubrique « À proximité » dans chaque fiche
  de plage (lieux à moins de 1,5 km, par catégorie).
- **Listes par voyageur** : onglet « Nos envies » (filtre Simon / Marie / communes, tri d'ouest en
  est ou par score), repères numérotés sur la carte avec la couleur du score et l'anneau du
  voyageur, autres plages estompées, tracé de l'ordre de visite, itinéraire Google Maps
  multi-étapes, partage et export.
- **Programme par plage** : note de chaque voyageur, compléments ajoutés depuis « À proximité »
  (resto, monument…) ou activités libres, visibles sur la carte et dans le lien partagé.
- **Séjour** : hébergement (recherche d'un lieu, position, ou point sur la carte), jours datés,
  étapes ordonnées (plage, resto, visite, étape libre) avec distance par tronçon et aller-retour
  estimé, **horaires estimés** par étape (départ à l'heure choisie, trajets à 45 km/h, environ
  2 h 30 par plage, 1 h 15 au resto) avec alertes (déjeuner tardif, journée chargée, plage qui
  dépend de la marée, pas de déjeuner prévu), ajout d'une plage avec son programme en bloc,
  **étapes verrouillées** que le planificateur conserve, « Proposer un planning selon la météo »
  (répartit les envies sur les jours selon le score, en pénalisant l'éloignement de
  l'hébergement, autour des étapes verrouillées), sélecteur d'étapes qui propose les
  **restos et visites retenus dans les programmes**, puis les **restos possibles** à moins de
  1,5 km et les **visites possibles** à moins de 3 km des plages du jour, lien Google Maps par
  jour avec départ et retour à l'hébergement, tout partagé par lien.
- **Page de configuration** (icône voyageurs) : prénoms et « qui je suis », résidence
  (recherche, position GPS, point sur la carte, nom), période du séjour (dates d'arrivée et de
  départ), planning dynamique, retour quotidien, déjeuner proposé, plages par jour, rayon
  depuis la résidence, profil par défaut, couches, partage, export, remise à zéro, crédits.
- **Séjour dynamique** : en mode dynamique, le planning est recalculé à chaque mise à jour des
  prévisions à partir des envies et des préférences ; toute modification manuelle d'une étape
  fige le planning (mode manuel), réactivable d'un geste.
- **Carte** : les lieux secondaires retenus dans les programmes (restos, visites) restent
  visibles dans toutes les vues, cerclés et reliés à leur plage, ainsi que le parcours du
  séjour (tracé discret) et la résidence.
- **Liens courts par plage** : `index.html#<slug>` ouvre la fiche ; `s/<slug>.html` est une page
  de partage avec aperçu (titre, photo) qui redirige vers la fiche. Le bouton « partager » d'une
  fiche copie ce lien.
- **Expérience** : premier lancement guidé en trois étapes, squelette de chargement, bandeau
  d'erreur avec nouvel essai, bouton retour du navigateur qui ferme la fiche, touche Échap,
  focus clavier visible, mouvements réduits respectés, service worker (coquille et données
  disponibles hors ligne, tuiles en cache), thème sombre, panneau latéral sur grand écran.
- Fonds de carte : **satellite Esri par défaut**, **orthophoto PNOA © IGN** (25 cm, CC BY 4.0), plan
  OSM, relief OpenTopoMap ; superpositions **Noms de lieux** et **Relief (ombrage)** ; choix mémorisés
  sur l'appareil (les fonds satellite ne sont pas mis en cache hors ligne).
- **Carte 3D par défaut** : MapLibre GL hébergé localement (`vendor/maplibre/`, chargé à la demande)
  remplace la carte 2D dans la même zone : terrain issu des Terrain Tiles Mapzen (AWS Open Data),
  orthophoto PNOA drapée (Esri si c'est le fond 2D choisi), ombrage, étiquettes, plages colorées par
  score, lieux (restos, bars, visites) à partir du zoom 13 avec leurs liens vers la plage du programme,
  parcours du séjour, hébergement, épingles numérotées des envies et des jours. Par défaut la carte
  s'ouvre en 2D sur toute la côte et passe en 3D dès qu'on zoome (retour en 2D en dézoomant) ; le bouton
  « 3D / 2D » fixe un mode (mémorisé) et le réglage « Carte 3D automatique » rétablit la bascule ; « Relief 3D » dans une fiche place la caméra au-dessus de la
  mer, tournée vers la plage (`coastBearing` dans `js/config.js`). Les fonds de carte alternatifs
  (plan, relief) restent propres à la 2D ; sans WebGL, la 2D reste seule.

## Sources de données

| Donnée | Source | Notes |
|---|---|---|
| Plages, criques | [OpenStreetMap](https://www.openstreetmap.org) via Overpass, `natural=beach` + `name` | licence ODbL |
| Météo | [Open-Meteo](https://open-meteo.com) `forecast` | gratuit, sans clé, usage non commercial |
| Houle, niveau de la mer, T° eau | Open-Meteo `marine` (`cell_selection=sea`) | grille marine grossière près des côtes (~10–20 km) : la houle est celle du large, pas celle de la plage abritée |
| Marées | dérivées du `sea_level_height_msl` horaire d'Open-Meteo | approximation (±20 min) ; pour une sortie qui dépend de la marée (Gulpiyuri, grottes…), vérifier avec les tables officielles |
| Orthophoto | [PNOA](https://pnoa.ign.es) © Instituto Geográfico Nacional | CC BY 4.0, WMTS `pnoa-ma` |
| Relief 3D | [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen, AWS Open Data), étiquettes Esri | encodage Terrarium, zoom 15 max |
| Photos | [Wikimedia Commons](https://commons.wikimedia.org) via Wikidata (P18), Wikipédia ou recherche géographique ; repli [Openverse](https://openverse.org) (Flickr…) | licences libres, crédit affiché ; `python3 scripts/fetch_photos.py` → `data/photos.json` |

Les prévisions sont mises en cache dans le navigateur pendant 60 min.

## Utilisation

Hébergée sur GitHub Pages :

- `index.html` : page d'accueil publique (présentation, « Entrer avec mon prénom », « Tester
  sans compte (à zéro) »).
- `login.html` : **compte** (e-mail, prénom, mot de passe) puis choix du **séjour partagé** : en
  créer un (le créateur est le voyageur 1) ou en rejoindre un avec son **code d'invitation** (le
  second arrivé est le voyageur 2). Le service est celui du VPS (`apiBase` dans `js/config.js`,
  CORS) : la version publique GitHub Pages et une future application mobile s'y connectent avec
  le même jeton. En bas de page, le mode **sans compte** subsiste : prénom et couleur mémorisés sur
  l'appareil, code ou lien de séjour à coller, « Repartir de zéro ».
- `app.html` : l'application. Vues directes : `app.html#view=trip`, `#view=config`,
  `#view=wishes` ; fiche : `#<slug>` ; `#reset` repart d'un état vierge.

Sans compte, il n'y a pas de serveur : l'identité et les données restent sur l'appareil, la
synchronisation entre deux voyageurs passe par le lien de partage. Avec un compte, le séjour est
partagé par le service décrit plus bas.

En local :

```bash
python3 -m http.server 8000
# puis http://localhost:8000
```

(Un simple `file://` ne suffit pas : le GeoJSON est chargé par `fetch`.)

Après toute modification de `css/`, `js/` ou `data/`, lancer `make bump` avant de pousser :
les ressources sont versionnées (`?v=…`) dans `index.html` pour invalider le cache du navigateur.

## Version protégée sur le VPS

`make deploy` (ou `scripts/deploy_vps.sh`) publie l'application sur le serveur derrière une
authentification par mot de passe (Caddy `basic_auth`, TLS Let's Encrypt), à l'adresse
`https://costa.188-245-235-42.sslip.io/` (nom automatique pointant sur l'IP ; pour un vrai nom,
créer un enregistrement A `costa.gispulse.dev → 188.245.235.42` chez Infomaniak puis relancer
avec `HOST=costa.gispulse.dev scripts/deploy_vps.sh --init costa 'motdepasse'`).

- Comptes : `scripts/deploy_vps.sh --init simon:motdepasse marie:motdepasse` (re)crée le bloc
  Caddy avec un compte par voyageur (sauvegarde du Caddyfile, validation, rechargement) puis
  synchronise. L'application lit `/whoami` au démarrage et active automatiquement le voyageur
  correspondant (`simon` → voyageur 1, `marie` → voyageur 2, ou le prénom configuré).
- Déploiements suivants : `make deploy` (rsync des fichiers suivis par git, sans sources ni
  données brutes, et pages de partage régénérées avec l'URL du serveur).
- Changer un mot de passe : relancer `--init` avec tous les comptes ; l'ancien bloc est
  remplacé automatiquement.
- **Comptes et séjours partagés** : `server/costa_sync.py` (service systemd `costa-sync`,
  bibliothèque standard, SQLite dans `/opt/costa-data/costa.db`, port local 8095) gère des
  comptes (`POST /api/auth/register`, `/api/auth/login`, `/api/auth/logout`, mot de passe haché
  scrypt, jeton de session 180 jours), des séjours (`POST /api/workspaces`, `POST
  /api/workspaces/join {code}`, `GET /api/me`, `GET|PUT /api/w/<id>`, `POST /api/w/<id>/leave`)
  et l'état de chaque séjour (`GET|PUT /api/w/<id>/state`). Chaque séjour a deux places (a, b)
  et un code d'invitation à 8 caractères ; CORS pour les origines de `COSTA_ORIGINS` (GitHub
  Pages par défaut) ; limitation des tentatives de connexion par adresse. Dans Caddy, ces routes
  sont hors `basic_auth` (matcher `@site`) pour être joignables de partout ; le reste du site
  garde le mot de passe. Au premier démarrage, `state.json` est migré dans le séjour hérité
  `legacy`, dont le code d'invitation est imprimé dans le journal et affiché dans Réglages : avec
  un compte, ce code ouvre le même séjour depuis n'importe quel appareil.
- **Écriture en tant que profil connecté** (mode hérité, toujours actif) : Caddy transmet
  l'utilisateur authentifié (`X-User`) sur `/api/state`, qui pointe sur le séjour `legacy`.
  Dans les deux modes, l'application n'envoie
  que ce qu'elle a changé depuis le dernier état serveur connu (sa liste d'envies, les programmes
  touchés, les champs du séjour modifiés, les préférences) et le serveur **fusionne clé par clé** :
  chaque voyageur n'écrit que sa liste d'envies, sa note et ses compléments ; les étapes du séjour
  sont remplacées jour par jour. La version est vérifiée par `If-Match` ; sur un 409, la
  différence locale est rejouée sur l'état reçu puis renvoyée, rien n'est perdu. Hors ligne, les
  modifications attendent (persistées) et repartent au retour du réseau ou au lancement suivant ;
  le point de synchro (vert, orange = en attente, rouge = injoignable) le dit au toucher.
  Resynchronisation toutes les 20 s et au retour au premier plan, sans redessiner pendant une
  saisie. Chaque écriture porte un **résumé lisible** (« Marie a ajouté Playa de Toró à ses
  envies ») : toast précis, bloc « Activité » en tête de l'onglet Envies, étiquette « nouveau » et
  pastille sur les envies de l'autre reçues depuis la dernière consultation. En mode dynamique,
  seul l'appareil qui l'a activé recalcule le planning.

## Tests

```bash
make test
```

`scripts/test_sync.py` exerce le service de synchronisation (fusion partielle, conflits 409,
journal, préférences). `scripts/run_browser_tests.sh` lance ensuite le service et
`scripts/dev_server.py` (qui joue le rôle de Caddy en local : `/whoami`, relais `/api/state`),
puis ouvre `scripts/test_harness.html` dans le Chromium sans tête de Playwright (s'il est présent
dans `~/.cache/ms-playwright`) : l'application y est pilotée dans un cadre de 390 px et une
quarantaine de comportements mobiles et collaboratifs sont vérifiés.

## Adapter à une autre côte

Tout ce qui est propre à la zone tient dans `config/region.json` : nom, sous-titre, bbox,
centre et zoom de la carte, fuseau horaire, CRS métrique, URL de publication et **zones**
(provinces, comarcas…) avec leur requête Nominatim. Les scripts et l'application lisent ce
fichier ; rien n'est codé en dur.

```bash
cp config/region.json config/costa-vasca.json   # puis éditer : bbox, zones, base_url…
make spots REGION=config/costa-vasca.json
make pois  REGION=config/costa-vasca.json
make photos && make galleries && make openverse
make pages && make bump
```

Le pipeline attribue la zone de chaque plage par **jointure spatiale** (`spatial_join`) sur
les polygones administratifs récupérés via Nominatim (`data/raw/areas.geojson`), les plages
d'estran hors polygone héritant de la zone voisine la plus proche. L'application construit le
filtre « Province » à partir de `data/region.json`, produit à la construction.

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

Les lieux (`make pois`, `gispulse/pois_pipeline.json`) suivent le même schéma :
`scripts/fetch_osm.py --pois` extrait restaurants, bars, cafés, sites (`amenity`, `tourism`,
`historic`, phares), puis `nearest_neighbor` vers la côte et vers les plages, `calculate`
promeut en `beach_bar` tout bar/resto/café à moins de 150 m d'une plage et fixe un rayon
(3 km restauration, 10 km sites), `filter` applique ce rayon → `data/pois.geojson`.

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
config/region.json            zone, bbox, fuseau, zones administratives (Nominatim)
data/region.json              copie servie à l'application (générée)
sw.js                         service worker (hors-ligne)
```


```
index.html                    accueil public
login.html                    connexion par voyageur
app.html                      l'application
css/site.css                  styles des pages publiques
vendor/leaflet/               Leaflet 1.9.4 hébergé localement (hors-ligne)
data/slugs.json               slugs attribués (stables entre exécutions)
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
scripts/build_pois.py         idem pour les lieux (restos, bars, sites) → data/pois.geojson
gispulse/pois_pipeline.json   pipeline gispulse des lieux (côte, plage la plus proche, bar de plage)
data/pois.geojson             lieux (généré)
scripts/publish_gispulse_map.py   POST/PUT de la carte sur un portail
scripts/fetch_photos.py       photos Commons → data/photos.json (--gallery, --openverse, --retry-missing)
scripts/build_pages.py        pages de partage s/<slug>.html (OpenGraph + redirection)
s/                            pages de partage (générées)
Makefile                      spots, refresh, serve, preview, publish-map
```

## Limites connues

- La houle affichée est celle de la cellule marine la plus proche (au large) ; une crique
  orientée est ou abritée par un cap peut être bien plus calme.
- Le score est un indicateur, pas une garantie : vérifier drapeaux et consignes sur place.
- Hors ligne : l'application, Leaflet, les données et les tuiles déjà vues restent disponibles ;
  les prévisions et les photos nécessitent le réseau.
- Photos : 21 images Openverse sont sous licence Creative Commons NC ou ND (usage non commercial,
  sans modification) : adapté à ce site personnel, à exclure via `STRICT_LICENSES = True` dans
  `scripts/fetch_photos.py` pour un usage commercial.
- Imagerie Esri (fond satellite et vues aériennes) via le service public sans clé : soumis aux
  conditions d'Esri, jamais mis en cache par le service worker.
- Open-Meteo (gratuit, non commercial) limite le débit par adresse IP : les prévisions sont
  regroupées par cellules (~60 météo, ~30 marine) et mises en cache 3 h.

## Licence

Code sous licence MIT. Données OpenStreetMap © contributeurs, ODbL. Prévisions Open-Meteo, CC BY 4.0.
