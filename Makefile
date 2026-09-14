# Cibles usuelles. GISPULSE peut pointer vers un binaire précis (ex. un venv).
GISPULSE ?= gispulse
PORT ?= 8000
REGION ?= config/region.json

.PHONY: spots pois refresh photos galleries openverse pages serve preview publish-map bump deploy test lint build

spots:            ## régénère data/spots.geojson (caches OSM, pipeline gispulse)
	GISPULSE=$(GISPULSE) python3 scripts/build_spots.py --region $(REGION)

refresh:          ## idem, en réinterrogeant Overpass
	GISPULSE=$(GISPULSE) python3 scripts/build_spots.py --region $(REGION) --refresh

pois:             ## régénère data/pois.geojson (restos, bars, cafés, sites) via gispulse
	GISPULSE=$(GISPULSE) python3 scripts/build_pois.py --region $(REGION)

photos:           ## complète data/photos.json (Wikimedia Commons)
	python3 scripts/fetch_photos.py --retry-missing --workers 1

galleries:        ## complète les galeries (plusieurs photos par spot)
	python3 scripts/fetch_photos.py --gallery

openverse:        ## repli Openverse (Flickr…) pour les spots sans photo
	python3 scripts/fetch_photos.py --openverse

pages:            ## régénère les pages de partage s/<slug>.html (aperçu WhatsApp, redirection vers la fiche)
	python3 scripts/build_pages.py

deploy: build     ## déploie la version protégée par mot de passe sur le VPS (Caddy)
	scripts/deploy_vps.sh

bump: build       ## invalide le cache navigateur (versionne css/js/data dans index.html)
	sed -i "s/?v=[0-9]*/?v=$$(date +%Y%m%d%H%M)/g" app.html login.html index.html
	sed -i "s/const VERSION = 'v[0-9]*'/const VERSION = 'v$$(date +%Y%m%d%H%M)'/" sw.js

serve:            ## sert l'application en local
	python3 -m http.server $(PORT)

preview:          ## visionneuse gispulse embarquée sur les spots
	$(GISPULSE) serve data/spots.geojson

publish-map:      ## crée la carte sauvegardée sur un portail gispulse (GISPULSE_API=http://localhost:8001)
	python3 scripts/publish_gispulse_map.py

build:            ## assemble js/app.js depuis js/src/*.js (à lancer après toute modification des sources)
	python3 scripts/build_app.py

test: build       ## tests : unitaires (fusion, score), service de synchro, puis banc navigateur (Chromium sans tête de Playwright, si présent)
	python3 scripts/build_app.py --check
	python3 scripts/test_merge.py
	node scripts/test_score.js
	python3 scripts/test_sync.py
	scripts/run_browser_tests.sh

lint:             ## analyse statique du JavaScript (npm install une fois)
	npx eslint js/*.js sw.js scripts/*.js
