#!/usr/bin/env python3
"""Service de synchronisation minimal (bibliothèque standard uniquement).

Derrière Caddy (basic_auth) qui transmet l'utilisateur authentifié dans l'en-tête X-User.
  GET  /api/state            → état partagé { version, users:{a,b}, plans, trip, updatedAt, by }
  PUT  /api/state            → écriture au nom du profil connecté :
                                 - users[k] (k = voyageur de l'utilisateur) remplacé par le corps,
                                 - plans et trip (partagés) remplacés, dernier écrivain gagnant,
                                 - If-Match: <version> obligatoire ; 409 + état courant si périmé.
Variables : COSTA_DATA (fichier JSON), COSTA_USERS ("simon:a,marie:b"), COSTA_PORT.
"""
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DATA = Path(os.environ.get("COSTA_DATA", "/opt/costa-data/state.json"))
USERS = dict(p.split(":") for p in os.environ.get("COSTA_USERS", "simon:a,marie:b").split(",") if ":" in p)
PORT = int(os.environ.get("COSTA_PORT", "8095"))
MAX_BODY = 512 * 1024
LOCK = threading.Lock()
EMPTY = {"version": 0, "users": {"a": {"name": "Simon", "wish": []}, "b": {"name": "Marie", "wish": []}},
         "plans": {}, "trip": {"base": None, "start": None, "days": [], "auto": False}, "updatedAt": 0, "by": None}


def load():
    try:
        return json.loads(DATA.read_text(encoding="utf-8"))
    except Exception:
        return json.loads(json.dumps(EMPTY))


def store(state):
    DATA.parent.mkdir(parents=True, exist_ok=True)
    tmp = DATA.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, DATA)


def clean_list(v, n=500):
    return [str(x)[:32] for x in v if isinstance(x, str)][:n] if isinstance(v, list) else []


class H(BaseHTTPRequestHandler):
    server_version = "costa-sync/1"

    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _who(self):
        u = (self.headers.get("X-User") or "").strip().lower()
        return u, USERS.get(u)

    def do_GET(self):
        if self.path.split("?")[0] != "/api/state":
            return self._send(404, {"error": "not found"})
        with LOCK:
            st = load()
        u, k = self._who()
        st["me"] = k
        self._send(200, st)

    def do_PUT(self):
        if self.path.split("?")[0] != "/api/state":
            return self._send(404, {"error": "not found"})
        u, k = self._who()
        if not k:
            return self._send(403, {"error": "utilisateur inconnu", "user": u})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            return self._send(413, {"error": "corps invalide"})
        try:
            body = json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return self._send(400, {"error": "JSON invalide"})
        try:
            expected = int(self.headers.get("If-Match") or -1)
        except ValueError:
            expected = -1
        with LOCK:
            st = load()
            if expected != st["version"]:
                st["me"] = k
                return self._send(409, st)
            me = body.get("users", {}).get(k) or {}
            st["users"][k] = {"name": str(me.get("name") or st["users"][k]["name"])[:14], "wish": clean_list(me.get("wish"))}
            other = "b" if k == "a" else "a"
            oname = body.get("users", {}).get(other, {}).get("name")  # le prénom de l'autre peut être corrigé par les deux
            if isinstance(oname, str) and oname.strip():
                st["users"][other]["name"] = oname.strip()[:14]
            if isinstance(body.get("plans"), dict):
                st["plans"] = {pid: p for pid, p in list(body["plans"].items())[:400] if isinstance(p, dict)}
            if isinstance(body.get("trip"), dict):
                st["trip"] = body["trip"]
            st["version"] += 1
            st["updatedAt"] = int(time.time())
            st["by"] = u
            store(st)
            st["me"] = k
            self._send(200, st)

    def log_message(self, fmt, *args):  # journal concis
        print("%s %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    print(f"costa-sync sur 127.0.0.1:{PORT}, données {DATA}, utilisateurs {USERS}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
