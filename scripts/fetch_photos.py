#!/usr/bin/env python3
"""Associe une photo Wikimedia Commons (licence libre, crédit inclus) à chaque spot.

Ordre de recherche, pour chaque entrée de data/spots.geojson :
  1. tag OSM wikimedia_commons (File: ou Category:) ;
  2. Wikidata : propriété P18 (image) ;
  3. Wikipédia : image principale de l'article (API REST « summary ») ;
  4. Commons : recherche géographique (fichiers géolocalisés à moins de RADIUS_M du spot).
Puis « imageinfo » donne la vignette, l'auteur et la licence.

Sortie : data/photos.json  { id: {thumb, url, page, credit, license, source} }
Usage : python3 scripts/fetch_photos.py [--radius 400] [--width 800] [--force]
Les spots déjà résolus sont conservés (reprise) sauf --force.
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPOTS = ROOT / "data" / "spots.geojson"
OUT = ROOT / "data" / "photos.json"
UA = "costa-cantabrica-planner/1.0 (https://github.com/imagodata/costa-cantabrica-planner)"
COMMONS = "https://commons.wikimedia.org/w/api.php"
IMG_EXT = (".jpg", ".jpeg", ".png", ".webp")


class NetworkError(Exception):
    """Échec réseau (429, délai…) : à distinguer d'une absence réelle de photo."""


def get_json(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            wait = 15 * (i + 1) if exc.code == 429 else 3 * (i + 1)
            print(f"  ! HTTP {exc.code} {url[:80]} → attente {wait}s", file=sys.stderr)
            time.sleep(wait)
            last = exc
        except Exception as exc:
            time.sleep(3 * (i + 1))
            last = exc
    raise NetworkError(f"{url[:90]} : {last}")


def commons(params):
    params = {**params, "format": "json", "formatversion": 2}
    return get_json(COMMONS + "?" + urllib.parse.urlencode(params))


def is_image(title):
    return title.lower().endswith(IMG_EXT)


def from_commons_tag(tag):
    if tag.startswith("File:") and is_image(tag):
        return tag
    if tag.startswith("Category:"):
        r = commons({"action": "query", "list": "categorymembers", "cmtitle": tag, "cmtype": "file", "cmlimit": 20})
        for m in (r or {}).get("query", {}).get("categorymembers", []):
            if is_image(m["title"]):
                return m["title"]
    return None


def from_wikidata(qid):
    r = get_json(f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json")
    try:
        claims = r["entities"][qid]["claims"]
        name = claims["P18"][0]["mainsnak"]["datavalue"]["value"]
        return "File:" + name
    except (KeyError, TypeError, IndexError):
        return None


def from_wikipedia(tag):
    lang, _, title = tag.partition(":")
    if not title:
        return None
    r = get_json(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(title.replace(' ', '_'))}")
    try:
        # originalimage.source contient le nom de fichier Commons dans l'URL
        src = r["originalimage"]["source"]
        name = urllib.parse.unquote(src.rsplit("/", 1)[-1])
        if "/thumb/" in src:  # …/thumb/a/ab/File.jpg/800px-File.jpg → File.jpg
            name = urllib.parse.unquote(src.split("/thumb/")[1].split("/")[2])
        return "File:" + name if is_image(name) else None
    except (KeyError, TypeError):
        return None


def from_geosearch(lat, lon, radius):
    r = commons({"action": "query", "list": "geosearch", "gscoord": f"{lat}|{lon}", "gsradius": radius,
                 "gsnamespace": 6, "gslimit": 20, "gsprimary": "all"})
    for m in (r or {}).get("query", {}).get("geosearch", []):
        if is_image(m["title"]):
            return m["title"]
    return None


def imageinfo(title, width):
    r = commons({"action": "query", "titles": title, "prop": "imageinfo", "iiprop": "url|extmetadata",
                 "iiurlwidth": width, "iiextmetadatafilter": "Artist|LicenseShortName|Credit"})
    try:
        page = r["query"]["pages"][0]
        ii = page["imageinfo"][0]
        meta = ii.get("extmetadata", {})
        artist = strip_html(meta.get("Artist", {}).get("value", "")) or "auteur inconnu"
        lic = meta.get("LicenseShortName", {}).get("value", "")
        thumb = (ii.get("thumburl") or ii["url"]).split("?")[0]  # sans les paramètres utm_ ajoutés par l'API
        return {"thumb": thumb, "url": ii["url"], "page": ii["descriptionurl"],
                "credit": artist[:80], "license": lic}
    except (KeyError, TypeError, IndexError):
        return None


def strip_html(s):
    import re
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s)).strip()


def resolve(feature, radius, width):
    p = feature["properties"]
    lon, lat = feature["geometry"]["coordinates"]
    for source, finder in (("osm", lambda: from_commons_tag(p["wikimedia_commons"]) if p.get("wikimedia_commons") else None),
                           ("wikidata", lambda: from_wikidata(p["wikidata"]) if p.get("wikidata") else None),
                           ("wikipedia", lambda: from_wikipedia(p["wikipedia"]) if p.get("wikipedia") else None),
                           ("geosearch", lambda: from_geosearch(lat, lon, radius))):
        try:
            title = finder()
            if title:
                info = imageinfo(title, width)
                if info:
                    info["source"] = source
                    return p["id"], info
        except NetworkError as exc:
            print(f"  ! {p['name']} : {exc}", file=sys.stderr)
            return p["id"], "error"
    return p["id"], None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--radius", type=int, default=400, help="rayon de recherche Commons (m)")
    ap.add_argument("--width", type=int, default=800, help="largeur des vignettes (px)")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--retry-missing", action="store_true", help="retenter les spots sans photo")
    args = ap.parse_args()

    feats = json.loads(SPOTS.read_text(encoding="utf-8"))["features"]
    photos = {} if args.force or not OUT.exists() else json.loads(OUT.read_text(encoding="utf-8"))
    todo = [f for f in feats if f["properties"]["id"] not in photos
            or (args.retry_missing and not photos[f["properties"]["id"]])]
    print(f"{len(feats)} spots, {len(todo)} à résoudre", file=sys.stderr)

    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        for sid, info in ex.map(lambda f: resolve(f, args.radius, args.width), todo):
            if info == "error":
                continue  # non mémorisé : sera retenté au prochain lancement
            photos[sid] = info
            done += 1
            if done % 25 == 0:
                OUT.write_text(json.dumps(photos, ensure_ascii=False, indent=0), encoding="utf-8")
                print(f"  {done}/{len(todo)}", file=sys.stderr)
    OUT.write_text(json.dumps(photos, ensure_ascii=False, indent=0), encoding="utf-8")
    found = sum(1 for v in photos.values() if v)
    by_src = {}
    for v in photos.values():
        if v:
            by_src[v["source"]] = by_src.get(v["source"], 0) + 1
    print(f"Photos : {found}/{len(photos)} → {OUT.relative_to(ROOT)} {by_src}", file=sys.stderr)


if __name__ == "__main__":
    main()
