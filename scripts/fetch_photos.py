#!/usr/bin/env python3
"""Associe une photo Wikimedia Commons (licence libre, crédit inclus) à chaque spot.

Ordre de recherche, pour chaque entrée de data/spots.geojson :
  1. tag OSM wikimedia_commons (File: ou Category:) ;
  2. Wikidata : propriété P18 (image) ;
  3. Wikipédia : image principale de l'article (API REST « summary ») ;
  4. Commons : recherche géographique (fichiers géolocalisés à moins de RADIUS_M du spot).
Puis « imageinfo » donne la vignette, l'auteur et la licence.

Sortie : data/photos.json  { id: {thumb, url, page, credit, license, source, gallery: [ {thumb, page, credit, license}, … ]} }
Usage : python3 scripts/fetch_photos.py [--radius 400] [--width 800] [--force] [--gallery]
Les spots déjà résolus sont conservés (reprise) sauf --force. --gallery complète, pour chaque spot,
une galerie (jusqu'à GALLERY_MAX images) : catégorie Commons (tag OSM ou Wikidata P373), image Wikidata,
photos géolocalisées à moins de GALLERY_RADIUS m.
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
GALLERY_MAX = 10
GALLERY_RADIUS = 300


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


def wikidata_claims(qid):
    r = get_json(f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json")
    try:
        return r["entities"][qid]["claims"]
    except (KeyError, TypeError):
        return {}


def claim_value(claims, prop):
    try:
        return claims[prop][0]["mainsnak"]["datavalue"]["value"]
    except (KeyError, TypeError, IndexError):
        return None


def from_wikidata(qid):
    name = claim_value(wikidata_claims(qid), "P18")
    return "File:" + name if name else None


def category_files(cat, limit=GALLERY_MAX):
    r = commons({"action": "query", "list": "categorymembers", "cmtitle": cat, "cmtype": "file", "cmlimit": limit})
    return [m["title"] for m in (r or {}).get("query", {}).get("categorymembers", []) if is_image(m["title"])]


def geosearch_files(lat, lon, radius, limit=GALLERY_MAX):
    r = commons({"action": "query", "list": "geosearch", "gscoord": f"{lat}|{lon}", "gsradius": radius,
                 "gsnamespace": 6, "gslimit": limit, "gsprimary": "all"})
    return [m["title"] for m in (r or {}).get("query", {}).get("geosearch", []) if is_image(m["title"])]


def imageinfo_many(titles, width):
    """Une seule requête pour plusieurs fichiers (≤ 50)."""
    out = []
    r = commons({"action": "query", "titles": "|".join(titles), "prop": "imageinfo", "iiprop": "url|extmetadata",
                 "iiurlwidth": width, "iiextmetadatafilter": "Artist|LicenseShortName"})
    for page in (r or {}).get("query", {}).get("pages", []):
        try:
            ii = page["imageinfo"][0]
            meta = ii.get("extmetadata", {})
            out.append({"title": page["title"], "thumb": (ii.get("thumburl") or ii["url"]).split("?")[0], "page": ii["descriptionurl"],
                        "credit": (strip_html(meta.get("Artist", {}).get("value", "")) or "auteur inconnu")[:80],
                        "license": meta.get("LicenseShortName", {}).get("value", "")})
        except (KeyError, IndexError, TypeError):
            continue
    order = {t: i for i, t in enumerate(titles)}
    out.sort(key=lambda x: order.get(x["title"], 99))
    return out


def gallery_for(feature, width):
    """Liste de titres candidats (ordre de préférence), puis leurs vignettes."""
    p = feature["properties"]
    lon, lat = feature["geometry"]["coordinates"]
    titles = []
    tag = p.get("wikimedia_commons", "")
    if tag.startswith("Category:"):
        titles += category_files(tag)
    elif tag.startswith("File:") and is_image(tag):
        titles.append(tag)
    if p.get("wikidata"):
        claims = wikidata_claims(p["wikidata"])
        cat = claim_value(claims, "P373")
        if cat and not tag.startswith("Category:"):
            titles += category_files("Category:" + cat)
        img = claim_value(claims, "P18")
        if img:
            titles.insert(0, "File:" + img)
    titles += geosearch_files(lat, lon, GALLERY_RADIUS)
    seen, uniq = set(), []
    for t in titles:
        if t not in seen:
            seen.add(t); uniq.append(t)
    uniq = uniq[:GALLERY_MAX]
    if not uniq:
        return []
    infos = imageinfo_many(uniq, width)
    for i in infos:
        i.pop("title", None)
    return infos


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
    ap.add_argument("--gallery", action="store_true", help="compléter les galeries (plusieurs photos par spot)")
    args = ap.parse_args()

    feats = json.loads(SPOTS.read_text(encoding="utf-8"))["features"]
    photos = {} if args.force or not OUT.exists() else json.loads(OUT.read_text(encoding="utf-8"))
    if args.gallery:
        run_gallery(feats, photos, args)
        return
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


def run_gallery(feats, photos, args):
    todo = [f for f in feats if "gallery" not in (photos.get(f["properties"]["id"]) or {}) or args.force]
    print(f"Galeries : {len(todo)} spots à compléter", file=sys.stderr)
    done = 0
    for f in todo:
        sid = f["properties"]["id"]
        try:
            gal = gallery_for(f, args.width)
        except NetworkError as exc:
            print(f"  ! {f['properties']['name']} : {exc}", file=sys.stderr)
            continue
        cur = photos.get(sid) or {}
        if gal:
            main = cur if cur.get("thumb") else {**gal[0], "source": "gallery"}
            # la photo principale reste en tête de galerie
            rest = [g for g in gal if g["page"] != main.get("page")]
            main = {**main, "gallery": [{k: main[k] for k in ("thumb", "page", "credit", "license") if k in main}] + rest}
            photos[sid] = main
        elif cur:
            photos[sid] = {**cur, "gallery": [{k: cur[k] for k in ("thumb", "page", "credit", "license") if k in cur}]}
        else:
            photos[sid] = None
        done += 1
        if done % 10 == 0:
            OUT.write_text(json.dumps(photos, ensure_ascii=False, indent=0), encoding="utf-8")
            print(f"  {done}/{len(todo)}", file=sys.stderr)
        time.sleep(0.4)
    OUT.write_text(json.dumps(photos, ensure_ascii=False, indent=0), encoding="utf-8")
    n = sum(len(v.get("gallery", [])) for v in photos.values() if v)
    print(f"Galeries : {n} photos au total → {OUT.relative_to(ROOT)}", file=sys.stderr)


if __name__ == "__main__":
    main()
