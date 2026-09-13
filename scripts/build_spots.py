#!/usr/bin/env python3
"""Construit data/spots.geojson avec gispulse.

  1. scripts/fetch_osm.py     → data/raw/beaches_osm.geojson + data/raw/coastline_pts.geojson
  2. gispulse run             → pipeline gispulse/spots_pipeline.json (distance à la côte,
                                typologie, province, filtre des plages fluviales)
  3. post-traitement          → libellés, tri par nom, colonnes finales → data/spots.geojson

Usage : python3 scripts/build_spots.py [--refresh] [--gispulse /chemin/vers/gispulse]
Le binaire gispulse est cherché dans $GISPULSE, puis dans le PATH.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import fetch_osm  # noqa: E402

RAW = ROOT / "data" / "raw"
PIPELINE = ROOT / "gispulse" / "spots_pipeline.json"
OUT = ROOT / "data" / "spots.geojson"
FINAL_COLS = ("id", "name", "slug", "type", "province", "size_m", "coast_km", "osm", "surface", "wikipedia", "wikidata",
              "lifeguard", "nudism", "dog", "access", "description", "tidal", "wheelchair", "website",
              "alt_name", "name_es", "name_ast", "supervised")


def slugify(text):
    import re
    import unicodedata
    t = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"[^a-z0-9]+", "-", t).strip("-")
    return t or "plage"


def assign_slugs(features):
    """Slug lisible et unique par spot : nom, puis -province, puis -2, -3… (ordre stable par id)."""
    by_slug = {}
    for f in sorted(features, key=lambda f: f["properties"]["id"]):
        by_slug.setdefault(slugify(f["properties"]["name"]), []).append(f)
    for base, group in by_slug.items():
        if len(group) == 1:
            group[0]["properties"]["slug"] = base
            continue
        seen = set()
        for f in group:
            cand = f"{base}-{f['properties']['province'].lower()}"
            n = 2
            while cand in seen:
                cand = f"{base}-{f['properties']['province'].lower()}-{n}"
                n += 1
            seen.add(cand)
            f["properties"]["slug"] = cand


def find_gispulse(explicit):
    for cand in (explicit, os.environ.get("GISPULSE"), shutil.which("gispulse")):
        if cand and Path(cand).exists():
            return cand
    raise SystemExit("gispulse introuvable : pip install gispulse, ou --gispulse /chemin, ou $GISPULSE")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refresh", action="store_true", help="réinterroger Overpass")
    ap.add_argument("--gispulse", default=None, help="binaire gispulse")
    ap.add_argument("--engine", default="python", choices=("python", "duckdb"))
    args = ap.parse_args(argv)

    fetch_osm.main(["--refresh"] if args.refresh else [])
    gp = find_gispulse(args.gispulse)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_out = Path(tmp) / "spots_gispulse.geojson"
        cmd = [gp, "run", str(RAW / "beaches_osm.geojson"), "--rules", str(PIPELINE), "-o", str(tmp_out),
               "--engine", args.engine]
        print("$", " ".join(cmd), file=sys.stderr)
        subprocess.run(cmd, check=True, cwd=ROOT)  # ref_layers relatifs à la racine du dépôt
        fc = json.loads(tmp_out.read_text(encoding="utf-8"))

    raw_n = len(json.loads((RAW / "beaches_osm.geojson").read_text(encoding="utf-8"))["features"])
    features = []
    seen = set()
    for f in fc["features"]:
        p = f["properties"]
        if p["id"] in seen:  # sjoin_nearest duplique une ligne quand deux sommets sont à égale distance
            continue
        seen.add(p["id"])
        props = {"id": p["id"], "name": p["name"], "type": p.get("type") or ("cala" if p.get("is_cala") else "playa"),
                 "province": p["province"], "size_m": int(p.get("size_m") or 0), "coast_km": p.get("coast_km")}
        for k in FINAL_COLS:
            if k not in props and p.get(k) not in (None, ""):
                props[k] = p[k]
        lon, lat = f["geometry"]["coordinates"][:2]
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
                         "properties": props})
    assign_slugs(features)
    features.sort(key=lambda f: f["properties"]["name"])

    out = {"type": "FeatureCollection",
           "meta": {"source": "OpenStreetMap contributors (ODbL)", "pipeline": "gispulse/spots_pipeline.json",
                    "bbox": list(fetch_osm.DEFAULT_BBOX)},
           "features": features}
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Spots : {len(features)} conservés sur {raw_n} → {OUT.relative_to(ROOT)}", file=sys.stderr)


if __name__ == "__main__":
    main()
