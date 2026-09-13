#!/usr/bin/env python3
"""Crée (ou met à jour) la carte sauvegardée du projet sur un portail gispulse.

Variables : GISPULSE_API (défaut http://localhost:8001), GISPULSE_TOKEN (optionnel, Bearer),
            GISPULSE_MAP_ID (optionnel : PUT au lieu de POST).
Usage : python3 scripts/publish_gispulse_map.py [gispulse/saved_map.json]
"""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    spec = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "gispulse" / "saved_map.json"
    body = json.loads(spec.read_text(encoding="utf-8"))
    api = os.environ.get("GISPULSE_API", "http://localhost:8001").rstrip("/")
    map_id = os.environ.get("GISPULSE_MAP_ID")
    url = f"{api}/maps/{map_id}" if map_id else f"{api}/maps"
    headers = {"Content-Type": "application/json"}
    if os.environ.get("GISPULSE_TOKEN"):
        headers["Authorization"] = "Bearer " + os.environ["GISPULSE_TOKEN"]
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="PUT" if map_id else "POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            res = json.load(r)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Portail gispulse : HTTP {e.code} — {e.read().decode(errors='replace')[:400]}")
    except urllib.error.URLError as e:
        raise SystemExit(f"Portail gispulse injoignable ({url}) : {e.reason}")
    print(f"Carte « {res['name']} » → {api}/maps/{res['id']}")
    print(f"(pour mettre à jour : GISPULSE_MAP_ID={res['id']})")


if __name__ == "__main__":
    main()
