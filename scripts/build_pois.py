#!/usr/bin/env python3
"""Construit data/pois.geojson (restaurants, bars, cafés, bars de plage, sites) avec gispulse.

  1. scripts/fetch_osm.py --pois  → data/raw/pois_osm.geojson
  2. gispulse run                 → gispulse/pois_pipeline.json (distance côte / plage, bar de plage, filtre)
  3. post-traitement              → colonnes finales, dédoublonnage, tri → data/pois.geojson

Usage : python3 scripts/build_pois.py [--refresh] [--gispulse /chemin/vers/gispulse]
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import fetch_osm  # noqa: E402
from build_spots import find_gispulse  # noqa: E402

RAW = ROOT / "data" / "raw"
PIPELINE = ROOT / "gispulse" / "pois_pipeline.json"
OUT = ROOT / "data" / "pois.geojson"
FINAL_COLS = ("id", "name", "kind", "sub", "beach_m", "coast_km", "osm", "cuisine", "website", "phone", "opening_hours",
              "wikidata", "wikipedia", "description", "outdoor_seating", "wheelchair", "addr_city")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--gispulse", default=None)
    ap.add_argument("--engine", default="python", choices=("python", "duckdb"))
    args = ap.parse_args(argv)

    fetch_osm.main(["--pois"] + (["--refresh"] if args.refresh else []))
    gp = find_gispulse(args.gispulse)
    with tempfile.TemporaryDirectory() as tmp:
        tmp_out = Path(tmp) / "pois_gispulse.geojson"
        cmd = [gp, "run", str(RAW / "pois_osm.geojson"), "--rules", str(PIPELINE), "-o", str(tmp_out), "--engine", args.engine]
        print("$", " ".join(cmd), file=sys.stderr)
        subprocess.run(cmd, check=True, cwd=ROOT)
        fc = json.loads(tmp_out.read_text(encoding="utf-8"))

    raw_n = len(json.loads((RAW / "pois_osm.geojson").read_text(encoding="utf-8"))["features"])
    features, seen = [], set()
    for f in fc["features"]:
        p = f["properties"]
        if p["id"] in seen:
            continue
        seen.add(p["id"])
        p["sub"] = p.get("amenity") or p.get("tourism") or p.get("historic") or p.get("man_made") or ""
        p["website"] = p.get("website") or p.get("contact_website")
        p["phone"] = p.get("phone") or p.get("contact_phone")
        props = {k: p[k] for k in FINAL_COLS if p.get(k) not in (None, "")}
        props["beach_m"] = int(p.get("beach_m") or 0)
        lon, lat = f["geometry"]["coordinates"][:2]
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]}, "properties": props})
    features.sort(key=lambda f: (f["properties"]["kind"], f["properties"]["name"]))
    out = {"type": "FeatureCollection",
           "meta": {"source": "OpenStreetMap contributors (ODbL)", "pipeline": "gispulse/pois_pipeline.json"},
           "features": features}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"POI : {len(features)} conservés sur {raw_n} → {OUT.relative_to(ROOT)}", file=sys.stderr)


if __name__ == "__main__":
    main()
