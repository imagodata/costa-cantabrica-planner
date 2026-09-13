#!/usr/bin/env python3
"""Génère une page de partage par plage : s/<slug>.html (aperçu OpenGraph pour WhatsApp,
Signal, iMessage…), qui redirige vers l'application sur la fiche du spot (index.html#<slug>).

Usage : python3 scripts/build_pages.py [--base https://imagodata.github.io/costa-cantabrica-planner/]
"""
import argparse
import html
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "s"
REGION = ROOT / "data" / "region.json"
DEFAULT_BASE = json.loads(REGION.read_text(encoding="utf-8")).get("base_url", "./") if REGION.exists() else "./"
SURF = {"sand": "sable", "pebblestone": "galets", "gravel": "graviers", "fine_gravel": "gravier fin", "rocky": "rochers", "rock": "rochers", "stone": "pierres"}

TEMPLATE = """<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{site}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{page_url}">
{og_image}
<meta name="twitter:card" content="{card}">
<link rel="canonical" href="{app_url}">
<meta http-equiv="refresh" content="0; url={app_url}">
<script>location.replace({app_url_js});</script>
<style>body{{font:16px system-ui,sans-serif;margin:0;padding:24px;color:#1d2430;background:#f6f7f9}}a{{color:#0b6e99}}img{{max-width:100%;border-radius:12px}}</style>
</head>
<body>
<p><a href="{app_url}">Ouvrir {title_plain} dans l'application →</a></p>
{img_html}
<p>{desc}</p>
</body>
</html>
"""


def aerial_tile(lat, lon, z=15):
    import math
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    lat_r = math.radians(lat)
    y = int((1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n)
    return f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE)
    args = ap.parse_args()
    base = args.base.rstrip("/") + "/"
    region = json.loads(REGION.read_text(encoding="utf-8")) if REGION.exists() else {"name": "Plages"}
    spots = json.loads((ROOT / "data" / "spots.geojson").read_text(encoding="utf-8"))["features"]
    photos = json.loads((ROOT / "data" / "photos.json").read_text(encoding="utf-8")) if (ROOT / "data" / "photos.json").exists() else {}
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    for f in spots:
        p = f["properties"]
        slug = p["slug"]
        kind = "Crique" if p["type"] == "cala" else "Plage"
        bits = [kind, p["province"], SURF.get(p.get("surface"), None), f"~{p['size_m']} m" if p.get("size_m") else None,
                "surveillée" if p.get("lifeguard") == "yes" else None]
        desc = " · ".join(b for b in bits if b) + " · météo, houle et marées à 7 jours."
        ph = photos.get(p["id"]) or {}
        lon, lat = f["geometry"]["coordinates"]
        if not ph.get("thumb"):
            ph = {"thumb": aerial_tile(lat, lon)}
        title = f"{p['name']} · {region['name']}"
        app_url = f"{base}index.html#{slug}"
        ctx = dict(site=html.escape(region["name"] + " · plages & criques"), title=html.escape(title), title_plain=html.escape(p["name"]), desc=html.escape(desc),
                   page_url=f"{base}s/{slug}.html", app_url=html.escape(app_url), app_url_js=json.dumps(app_url),
                   og_image=f'<meta property="og:image" content="{html.escape(ph["thumb"])}">' if ph.get("thumb") else "",
                   card="summary_large_image" if ph.get("thumb") else "summary",
                   img_html=f'<img src="{html.escape(ph["thumb"])}" alt="">' if ph.get("thumb") else "")
        (OUT / f"{slug}.html").write_text(TEMPLATE.format(**ctx), encoding="utf-8")
    print(f"{len(spots)} pages → {OUT.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
