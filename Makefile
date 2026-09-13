# Cibles usuelles. GISPULSE peut pointer vers un binaire précis (ex. un venv).
GISPULSE ?= gispulse
PORT ?= 8000

.PHONY: spots refresh serve preview publish-map

spots:            ## régénère data/spots.geojson (caches OSM, pipeline gispulse)
	GISPULSE=$(GISPULSE) python3 scripts/build_spots.py

refresh:          ## idem, en réinterrogeant Overpass
	GISPULSE=$(GISPULSE) python3 scripts/build_spots.py --refresh

serve:            ## sert l'application en local
	python3 -m http.server $(PORT)

preview:          ## visionneuse gispulse embarquée sur les spots
	$(GISPULSE) serve data/spots.geojson

publish-map:      ## crée la carte sauvegardée sur un portail gispulse (GISPULSE_API=http://localhost:8001)
	python3 scripts/publish_gispulse_map.py
