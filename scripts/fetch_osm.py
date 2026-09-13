#!/usr/bin/env python3
"""Extraction brute OpenStreetMap (Overpass) → data/raw/.

  - data/raw/overpass_beaches.json   réponse Overpass brute (natural=beach + name), mise en cache
  - data/raw/beaches_osm.geojson     points bruts (centre de chaque plage) avec tags utiles, lat/lon, size_m
  - data/raw/coastline_pts.geojson   sommets amincis de la ligne de côte (natural=coastline)
  - data/raw/overpass_pois.json      réponse Overpass brute (restaurants, bars, cafés, sites), mise en cache
  - data/raw/pois_osm.geojson        points d'intérêt bruts, avec un « kind » de départ

  - data/raw/areas.geojson           polygones des zones (provinces…) de la région, via Nominatim

Usage : python3 scripts/fetch_osm.py [--region config/region.json] [--refresh] [--bbox S,W,N,E]
Sans --refresh, les caches existants sont réutilisés (aucun appel réseau).
"""
import argparse
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
REGION_FILE = ROOT / "config" / "region.json"
NOMINATIM = "https://nominatim.openstreetmap.org/search"


def load_region(path=None):
    return json.loads(Path(path or REGION_FILE).read_text(encoding="utf-8"))


# Sud, Ouest, Nord, Est (valeur de repli : de la ría de Ribadeo à Ontón)
DEFAULT_BBOX = tuple(load_region()["bbox"]) if REGION_FILE.exists() else (43.25, -7.05, 43.75, -3.15)
COAST_THIN = 6  # 1 sommet sur N (~200 m) : suffisant pour un seuil de distance kilométrique
ENDPOINTS = ("https://overpass-api.de/api/interpreter",
             "https://overpass.private.coffee/api/interpreter",
             "https://overpass.kumi.systems/api/interpreter")
POI_QUERY = """[out:json][timeout:240];
(
  nwr["amenity"~"^(restaurant|bar|cafe|pub|ice_cream|biergarten|food_court)$"]["name"]({b});
  nwr["tourism"~"^(attraction|museum|viewpoint|gallery|artwork|aquarium|zoo|theme_park)$"]["name"]({b});
  nwr["historic"~"^(castle|monument|memorial|archaeological_site|ruins|fort|palace|tower|city_gate|church|monastery|manor)$"]["name"]({b});
  nwr["man_made"="lighthouse"]["name"]({b});
  nwr["natural"="cave_entrance"]["name"]["tourism"]({b});
);
out center tags;"""
POI_TAGS = ("cuisine", "website", "contact:website", "phone", "contact:phone", "opening_hours", "wikidata", "wikipedia",
            "description", "outdoor_seating", "wheelchair", "addr:city", "addr:street", "historic", "tourism", "amenity", "man_made")
KEEP_TAGS = ("surface", "wikipedia", "wikidata", "lifeguard", "nudism", "dog", "access", "description",
             "tidal", "wheelchair", "website", "alt_name", "name:es", "name:ast", "supervised")


def haversine_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371000.0 * math.asin(math.sqrt(a))


def overpass(query, timeout=300):
    last = None
    for ep in ENDPOINTS:
        for attempt in range(2):
            try:
                req = urllib.request.Request(ep, data=query.encode(), headers={"User-Agent": "costa-cantabrica-planner"})
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    data = json.loads(r.read().decode("utf-8"))
                if "elements" in data:
                    return data
            except Exception as exc:  # réponse tronquée, HTML de limitation de débit, délai…
                last = exc
                print(f"Overpass {ep} (essai {attempt + 1}) : {exc}", file=sys.stderr)
                time.sleep(10)
    raise SystemExit(f"Overpass injoignable : {last}")


def fetch_beaches(bbox, refresh):
    cache = RAW / "overpass_beaches.json"
    if cache.exists() and not refresh:
        return json.loads(cache.read_text(encoding="utf-8"))["elements"]
    s, w, n, e = bbox
    data = overpass(f'[out:json][timeout:90];nwr["natural"="beach"]["name"]({s},{w},{n},{e});out center tags bb;')
    cache.write_text(json.dumps({"elements": data["elements"]}, ensure_ascii=False), encoding="utf-8")
    return data["elements"]


def fetch_coast(bbox, refresh):
    out = RAW / "coastline_pts.geojson"
    if out.exists() and not refresh:
        return json.loads(out.read_text(encoding="utf-8"))
    s, w, n, e = bbox
    data = overpass(f'[out:json][timeout:180];way["natural"="coastline"]({s},{w},{n},{e});out skel geom;')
    feats = []
    for way in data["elements"]:
        geom = way.get("geometry", [])
        for i, g in enumerate(geom):
            if i % COAST_THIN == 0 or i == len(geom) - 1:
                feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(g["lon"], 4), round(g["lat"], 4)]}, "properties": {}})
    fc = {"type": "FeatureCollection", "features": feats}
    out.write_text(json.dumps(fc, separators=(",", ":")), encoding="utf-8")
    return fc


def beaches_geojson(elements):
    feats = []
    for el in elements:
        tags = el.get("tags", {})
        b = el.get("bounds")
        c = el.get("center")
        if el["type"] == "node":
            lat, lon = el["lat"], el["lon"]
        elif c:
            lat, lon = c["lat"], c["lon"]
        elif b:  # "out center ... bb" n'émet que bounds : centre = milieu de la bbox
            lat, lon = (b["minlat"] + b["maxlat"]) / 2, (b["minlon"] + b["maxlon"]) / 2
        else:
            continue
        size_m = round(haversine_m(b["minlat"], b["minlon"], b["maxlat"], b["maxlon"])) if b else 0
        props = {"id": f"{el['type'][0]}{el['id']}", "name": tags["name"], "lat": round(lat, 5), "lon": round(lon, 5),
                 "size_m": size_m, "osm": f"https://www.openstreetmap.org/{el['type']}/{el['id']}"}
        for k in KEEP_TAGS:
            if k in tags:
                props[k.replace(":", "_")] = tags[k]
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]}, "properties": props})
    return {"type": "FeatureCollection", "features": feats}


def fetch_areas(region, refresh):
    """Polygones des zones (provinces, comarcas…) déclarées dans la région, via Nominatim (1 req/s)."""
    out = RAW / "areas.geojson"
    if out.exists() and not refresh:
        return json.loads(out.read_text(encoding="utf-8"))
    feats = []
    for area in region.get("areas", []):
        q = urllib.parse.urlencode({"q": area["query"], "format": "geojson", "polygon_geojson": 1, "polygon_threshold": 0.002, "limit": 1})
        req = urllib.request.Request(NOMINATIM + "?" + q, headers={"User-Agent": "costa-cantabrica-planner"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.load(r)
        if not data.get("features"):
            raise SystemExit(f"Nominatim : zone introuvable « {area['query']} »")
        f = data["features"][0]
        feats.append({"type": "Feature", "geometry": f["geometry"], "properties": {"province": area["name"]}})
        time.sleep(1.1)
    fc = {"type": "FeatureCollection", "features": feats}
    out.write_text(json.dumps(fc, separators=(",", ":")), encoding="utf-8")
    return fc


def poi_kind(tags):
    """Classe de départ ; le pipeline gispulse promeut ensuite en « beach_bar » les bars/restos collés à une plage."""
    a = tags.get("amenity")
    if a in ("restaurant", "food_court"):
        return "restaurant"
    if a in ("bar", "pub", "biergarten"):
        return "bar"
    if a in ("cafe", "ice_cream"):
        return "cafe"
    if tags.get("tourism") in ("museum", "gallery", "artwork") or tags.get("historic"):
        return "culture"
    return "tourism"


def fetch_pois(bbox, refresh):
    cache = RAW / "overpass_pois.json"
    if cache.exists() and not refresh:
        elements = json.loads(cache.read_text(encoding="utf-8"))["elements"]
    else:
        s, w, n, e = bbox
        data = overpass(POI_QUERY.format(b=f"{s},{w},{n},{e}"))
        elements = data["elements"]
        cache.write_text(json.dumps({"elements": elements}, ensure_ascii=False), encoding="utf-8")
    feats = []
    for el in elements:
        tags = el.get("tags", {})
        c = el.get("center")
        lat, lon = (el["lat"], el["lon"]) if el["type"] == "node" else ((c["lat"], c["lon"]) if c else (None, None))
        if lat is None:
            continue
        name = tags.get("name")
        lname = name.lower()
        kind = poi_kind(tags)
        if kind in ("bar", "restaurant", "cafe") and ("chiringuito" in lname or "xiringuitu" in lname or "beach bar" in lname or tags.get("beach_bar") == "yes"):
            kind = "beach_bar"
        props = {"id": f"{el['type'][0]}{el['id']}", "name": name, "kind": kind, "lat": round(lat, 5), "lon": round(lon, 5),
                 "osm": f"https://www.openstreetmap.org/{el['type']}/{el['id']}"}
        for k in POI_TAGS:
            if k in tags:
                props[k.replace(":", "_")] = tags[k]
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]}, "properties": props})
    fc = {"type": "FeatureCollection", "features": feats}
    (RAW / "pois_osm.geojson").write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return fc


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region", default=str(REGION_FILE), help="fichier de configuration de la région")
    ap.add_argument("--bbox", default=None, help="S,W,N,E (défaut : bbox de la région)")
    ap.add_argument("--refresh", action="store_true", help="réinterroger Overpass au lieu des caches")
    ap.add_argument("--pois", action="store_true", help="extraire aussi les points d'intérêt (restos, bars, sites)")
    args = ap.parse_args(argv)
    region = load_region(args.region)
    bbox = tuple(float(x) for x in args.bbox.split(",")) if args.bbox else tuple(region["bbox"])
    RAW.mkdir(parents=True, exist_ok=True)
    areas = fetch_areas(region, args.refresh)
    print(f"Zones : {len(areas['features'])}", file=sys.stderr)

    elements = fetch_beaches(bbox, args.refresh)
    fc = beaches_geojson(elements)
    (RAW / "beaches_osm.geojson").write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    coast = fetch_coast(bbox, args.refresh)
    print(f"Plages OSM : {len(fc['features'])} · sommets de côte : {len(coast['features'])}", file=sys.stderr)
    if args.pois:
        pois = fetch_pois(bbox, args.refresh)
        print(f"Points d'intérêt OSM : {len(pois['features'])}", file=sys.stderr)


if __name__ == "__main__":
    main()
