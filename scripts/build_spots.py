#!/usr/bin/env python3
"""Construit data/spots.geojson : plages et criques de la côte cantabrique
(Asturies + Cantabrie) à partir d'OpenStreetMap (Overpass API).

Usage :  python3 scripts/build_spots.py [--bbox S,W,N,E]

Étapes :
  1. requête Overpass sur natural=beach + name dans la bbox ;
  2. estimation de la taille (diagonale de la bbox OSM) → type "cala" / "playa" ;
  3. filtrage des plages fluviales / de lac : on ne garde que les points à
     moins de MAX_COAST_KM de la ligne de côte OSM (natural=coastline) ;
  4. écriture d'un GeoJSON (points) trié par nom.
"""
import argparse
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

OVERPASS = "https://overpass-api.de/api/interpreter"
# Sud, Ouest, Nord, Est : de la ría de Ribadeo (limite Galice) à Ontón (limite Biscaye)
DEFAULT_BBOX = (43.25, -7.05, 43.75, -3.15)
ASTURIAS_EAST_LON = -4.515   # ría de Tina Mayor : frontière Asturies / Cantabrie
MAX_COAST_KM = 2.5           # au-delà de la ligne de côte : plage fluviale / lac → exclue
COAST_THIN = 3               # on garde 1 sommet de côte sur N (≈ 100 m) pour le cache compact
CALA_DIAG_M = 220            # diagonale bbox sous ce seuil → "cala"

KEEP_TAGS = ("surface", "wikipedia", "wikidata", "lifeguard", "nudism", "dog",
             "access", "description", "tidal", "wheelchair", "website",
             "alt_name", "name:es", "name:ast", "supervised")


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def overpass(bbox):
    s, w, n, e = bbox
    q = f'[out:json][timeout:90];nwr["natural"="beach"]["name"]({s},{w},{n},{e});out center tags bb;'
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(OVERPASS, data=q.encode(),
                                         headers={"User-Agent": "costa-cantabrica-planner"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8"))["elements"]
        except Exception as exc:  # réseau instable, réponse tronquée…
            last = exc
            print(f"Overpass tentative {attempt + 1} échouée : {exc}", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise SystemExit(f"Overpass injoignable : {last}")


def overpass_post(query, timeout=300):
    last = None
    for ep in ("https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
               "https://overpass.kumi.systems/api/interpreter"):
        try:
            req = urllib.request.Request(ep, data=query.encode(), headers={"User-Agent": "costa-cantabrica-planner"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as exc:
            last = exc
            print(f"Overpass {ep} : {exc}", file=sys.stderr)
            time.sleep(10)
    raise SystemExit(f"Overpass injoignable : {last}")


def load_coast(bbox, cache: Path, refresh=False):
    """Sommets (lat, lon) de la ligne de côte OSM, amincis, mis en cache en JSON compact."""
    if cache.exists() and not refresh:
        return [tuple(x) for x in json.loads(cache.read_text(encoding="utf-8"))]
    s, w, n, e = bbox
    q = f'[out:json][timeout:180];way["natural"="coastline"]({s},{w},{n},{e});out skel geom;'
    data = overpass_post(q)
    pts = []
    for way in data["elements"]:
        geom = way.get("geometry", [])
        for i, g in enumerate(geom):
            if i % COAST_THIN == 0 or i == len(geom) - 1:
                pts.append((round(g["lat"], 4), round(g["lon"], 4)))
    cache.write_text(json.dumps(pts, separators=(",", ":")), encoding="utf-8")
    print(f"Ligne de côte : {len(pts)} sommets → {cache.name}", file=sys.stderr)
    return pts


def coast_distances(points, coast):
    """Distance (km) de chaque point au sommet de côte le plus proche, via un index en grille."""
    cell = 0.02
    grid = {}
    for lat, lon in coast:
        grid.setdefault((int(lat / cell), int(lon / cell)), []).append((lat, lon))
    out = []
    for lat, lon in points:
        ci, cj = int(lat / cell), int(lon / cell)
        best = float("inf")
        for r in (1, 3, 8):  # rayon croissant en cellules jusqu'à trouver des sommets
            cand = [p for i in range(ci - r, ci + r + 1) for j in range(cj - r, cj + r + 1)
                    for p in grid.get((i, j), ())]
            if cand:
                best = min(haversine_km(lat, lon, a, b) for a, b in cand)
                break
        out.append(best)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", default=",".join(map(str, DEFAULT_BBOX)))
    data_dir = Path(__file__).resolve().parent.parent / "data"
    ap.add_argument("--out", default=str(data_dir / "spots.geojson"))
    ap.add_argument("--raw", default=str(data_dir / "overpass_raw.json"),
                    help="cache de la réponse Overpass (réutilisé sauf --refresh)")
    ap.add_argument("--refresh", action="store_true", help="réinterroger Overpass")
    args = ap.parse_args()
    bbox = tuple(float(x) for x in args.bbox.split(","))

    raw = Path(args.raw)
    if raw.exists() and not args.refresh:
        elements = json.loads(raw.read_text(encoding="utf-8"))["elements"]
        print(f"Cache Overpass : {len(elements)} plages nommées ({raw.name})", file=sys.stderr)
    else:
        elements = overpass(bbox)
        raw.write_text(json.dumps({"elements": elements}, ensure_ascii=False), encoding="utf-8")
        print(f"Overpass : {len(elements)} plages nommées", file=sys.stderr)

    spots = []
    for el in elements:
        tags = el.get("tags", {})
        if el["type"] == "node":
            lat, lon = el["lat"], el["lon"]
            diag = 0.0
        else:
            b = el.get("bounds")
            c = el.get("center")
            if c:
                lat, lon = c["lat"], c["lon"]
            elif b:  # "out center ... bb" n'émet que bounds : centre = milieu de la bbox
                lat, lon = (b["minlat"] + b["maxlat"]) / 2, (b["minlon"] + b["maxlon"]) / 2
            else:
                continue
            diag = haversine_km(b["minlat"], b["minlon"], b["maxlat"], b["maxlon"]) * 1000 if b else 0.0
        name = tags["name"]
        lname = name.lower()
        is_cala = lname.startswith("cala") or " cala " in lname or (0 < diag < CALA_DIAG_M)
        props = {
            "id": f"{el['type'][0]}{el['id']}",
            "name": name,
            "type": "cala" if is_cala else "playa",
            "province": "Asturias" if lon < ASTURIAS_EAST_LON else "Cantabria",
            "size_m": round(diag),
            "osm": f"https://www.openstreetmap.org/{el['type']}/{el['id']}",
        }
        for k in KEEP_TAGS:
            if k in tags:
                props[k.replace(":", "_")] = tags[k]
        spots.append((lat, lon, props))

    coast = load_coast(bbox, data_dir / "coastline_pts.json", refresh=args.refresh)
    dists = coast_distances([(s[0], s[1]) for s in spots], coast)
    features = []
    dropped = []
    for (lat, lon, props), d in zip(spots, dists):
        if d > MAX_COAST_KM:
            dropped.append((props["name"], round(d, 1)))
            continue
        props["coast_km"] = round(d, 2)
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
            "properties": props,
        })
    features.sort(key=lambda f: f["properties"]["name"])
    print(f"Exclues (trop loin de la côte) : {len(dropped)} → {dropped}", file=sys.stderr)
    print(f"Conservées : {len(features)}", file=sys.stderr)

    fc = {"type": "FeatureCollection",
          "meta": {"source": "OpenStreetMap contributors (ODbL)", "bbox": bbox},
          "features": features}
    Path(args.out).write_text(json.dumps(fc, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Écrit : {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
