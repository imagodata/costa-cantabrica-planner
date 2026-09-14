#!/usr/bin/env python3
"""Service de synchronisation minimal (bibliothèque standard uniquement).

Derrière Caddy (basic_auth) qui transmet l'utilisateur authentifié dans l'en-tête X-User.
  GET  /api/state   → état partagé { version, users:{a,b}, plans, trip, prefs, log, updatedAt, by, me }
  PUT  /api/state   → écriture partielle au nom du profil connecté, fusionnée clé par clé :
                        - users[k] (k = voyageur de l'utilisateur) : name et wish remplacés s'ils sont présents ;
                          users[k].suggest ne peut que perdre des entrées (accepter, ignorer) ;
                          users[autre] : name accepté (les deux peuvent corriger un prénom) et suggest
                          (plages proposées PAR k À l'autre : c'est k qui l'écrit) ;
                        - plans : { id: programme | null } — chaque programme touché est fusionné :
                          ma note et mes compléments viennent du corps, la note et les compléments
                          de l'autre restent ceux du serveur ; null supprime ;
                        - trip : champs présents seulement (base, start, auto, autoBy, days) ;
                        - prefs : remplacées si présentes ;
                        - log : jusqu'à 6 résumés lisibles, horodatés, signés et numérotés (v) par le serveur (40 gardés).
                        If-Match: <version> obligatoire ; 409 + état courant si périmé.
Variables : COSTA_DATA (fichier JSON), COSTA_USERS ("simon:a,marie:b"), COSTA_PORT.
"""
import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DATA = Path(os.environ.get("COSTA_DATA", "/opt/costa-data/state.json"))
USERS = dict(p.split(":", 1) for p in os.environ.get("COSTA_USERS", "simon:a,marie:b").split(",") if ":" in p)
PORT = int(os.environ.get("COSTA_PORT", "8095"))
MAX_BODY = 512 * 1024
LOG_MAX = 40
LOCK = threading.Lock()
ID_RE = re.compile(r"^[nwr]\d+$")
EMPTY = {"version": 0, "users": {"a": {"name": "Simon", "wish": [], "suggest": []}, "b": {"name": "Marie", "wish": [], "suggest": []}},
         "plans": {}, "trip": {"base": None, "start": None, "days": [], "auto": False, "autoBy": None},
         "prefs": None, "log": [], "updatedAt": 0, "by": None}


def load():
    try:
        st = json.loads(DATA.read_text(encoding="utf-8"))
    except Exception:
        st = {}
    base = json.loads(json.dumps(EMPTY))
    base.update({k: v for k, v in st.items() if k in EMPTY})   # champs ajoutés au fil des versions
    for k in ("users", "plans", "trip"):
        if not isinstance(base.get(k), dict):
            base[k] = json.loads(json.dumps(EMPTY[k]))
    for k in ("a", "b"):
        if not isinstance(base["users"].get(k), dict):
            base["users"][k] = json.loads(json.dumps(EMPTY["users"][k]))
    if not isinstance(base.get("log"), list):
        base["log"] = []
    if not isinstance(base.get("version"), int):
        base["version"] = 0
    return base


def store(state):
    DATA.parent.mkdir(parents=True, exist_ok=True)
    tmp = DATA.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, DATA)


def clean_list(v, n=500):
    return [str(x)[:32] for x in v if isinstance(x, str)][:n] if isinstance(v, list) else []


def clean_item(it):
    if not isinstance(it, dict):
        return None
    by = "b" if it.get("by") == "b" else "a"
    if isinstance(it.get("poi"), str) and ID_RE.match(it["poi"]):
        return {"poi": it["poi"], "by": by}
    if isinstance(it.get("text"), str) and it["text"].strip():
        return {"text": it["text"].strip()[:82], "by": by}
    return None


def item_key(it):
    return it.get("poi") or ("t:" + it.get("text", ""))


def merge_plan(server, body, k):
    """Programme fusionné : la part de k vient du corps, la part de l'autre reste celle du serveur."""
    other = "b" if k == "a" else "a"
    s = server if isinstance(server, dict) else {"notes": {}, "items": []}
    s_notes = s.get("notes") if isinstance(s.get("notes"), dict) else {}
    b_notes = body.get("notes") if isinstance(body.get("notes"), dict) else {}
    notes = {k: str(b_notes.get(k) or "")[:500], other: str(s_notes.get(other) or "")[:500]}
    b_items = [x for x in (clean_item(it) for it in (body.get("items") if isinstance(body.get("items"), list) else [])[:60]) if x]
    s_items = [x for x in (clean_item(it) for it in (s.get("items") if isinstance(s.get("items"), list) else [])) if x]
    s_keys = {item_key(it) for it in s_items}
    b_keys = {item_key(it) for it in b_items}
    # mes compléments (ajouts et retraits) ; ceux de l'autre : tels que le serveur les connaît
    items = [it for it in b_items if it["by"] == k or item_key(it) in s_keys]
    items += [it for it in s_items if it["by"] != k and item_key(it) not in b_keys]
    return {"notes": notes, "items": items[:60]}


def clean_days(days):
    out = []
    if not isinstance(days, list):
        return out
    for d in days[:14]:
        stops = []
        for st in ((d.get("stops") if isinstance(d, dict) and isinstance(d.get("stops"), list) else []))[:30]:
            if not isinstance(st, dict):
                continue
            t = st.get("t")
            if t in ("s", "p") and isinstance(st.get("id"), str):
                stops.append({"t": t, "id": st["id"][:32]})
            elif t == "x" and isinstance(st.get("text"), str) and st["text"].strip():
                stops.append({"t": "x", "text": st["text"].strip()[:80]})
        out.append({"stops": stops})
    return out


class H(BaseHTTPRequestHandler):
    server_version = "costa-sync/2"

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
            assert isinstance(body, dict)
        except Exception:
            return self._send(400, {"error": "JSON invalide"})
        try:
            expected = int(self.headers.get("If-Match") or -1)
        except ValueError:
            expected = -1
        other = "b" if k == "a" else "a"
        with LOCK:
            st = load()
            if expected != st["version"]:
                st["me"] = k
                return self._send(409, st)
            try:
                changed = self._apply(st, body, k, other)
            except Exception as e:   # corps inattendu : refus explicite, état intact
                return self._send(400, {"error": "corps invalide", "detail": str(e)[:120]})
            if changed:
                st["version"] += 1
                st["updatedAt"] = int(time.time())
                st["by"] = u
                store(st)
            st["me"] = k
            self._send(200, st)

    def _apply(self, st, body, k, other):
        """Fusionne un corps partiel dans st ; renvoie True si quelque chose a changé."""
        before = json.dumps({x: st[x] for x in ("users", "plans", "trip", "prefs")}, sort_keys=True)
        users = body.get("users") if isinstance(body.get("users"), dict) else {}
        me = users.get(k)
        if isinstance(me, dict):
            cur = st["users"][k]
            sugg = cur.get("suggest", [])
            if "suggest" in me:   # le destinataire peut retirer une proposition (accepter, ignorer), jamais en ajouter
                keep = set(clean_list(me.get("suggest"), 100))
                sugg = [x for x in sugg if x in keep]
            wish = clean_list(me.get("wish")) if "wish" in me else cur.get("wish", [])
            st["users"][k] = {"name": str(me.get("name") or cur["name"]).strip()[:14] or cur["name"], "wish": wish,
                              "suggest": [x for x in sugg if x not in wish]}
        oth = users.get(other) if isinstance(users.get(other), dict) else {}
        oname = oth.get("name")
        if isinstance(oname, str) and oname.strip():
            st["users"][other]["name"] = oname.strip()[:14]
        if "suggest" in oth:   # ce que k propose à l'autre ; jamais une plage déjà en envie chez lui
            st["users"][other]["suggest"] = [x for x in clean_list(oth.get("suggest"), 100) if ID_RE.match(x) and x not in st["users"][other].get("wish", [])]
        plans = body.get("plans")
        if isinstance(plans, dict):
            for pid, p in list(plans.items())[:400]:
                if not isinstance(pid, str) or not ID_RE.match(pid):
                    continue
                if p is None:
                    st["plans"].pop(pid, None)
                    continue
                if not isinstance(p, dict):
                    continue
                merged = merge_plan(st["plans"].get(pid), p, k)
                if merged["items"] or merged["notes"]["a"] or merged["notes"]["b"]:
                    st["plans"][pid] = merged
                else:
                    st["plans"].pop(pid, None)
        trip = body.get("trip")
        if isinstance(trip, dict):
            if "base" in trip:
                b = trip["base"]
                num = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)
                st["trip"]["base"] = ({"name": str(b.get("name") or "Hébergement")[:60], "lat": float(b["lat"]), "lon": float(b["lon"])}
                                      if isinstance(b, dict) and num(b.get("lat")) and num(b.get("lon")) else None)
            if "start" in trip:
                s = trip["start"]
                st["trip"]["start"] = s if isinstance(s, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", s) else None
            if "auto" in trip:
                st["trip"]["auto"] = bool(trip["auto"])
            if "autoBy" in trip:
                st["trip"]["autoBy"] = trip["autoBy"] if trip["autoBy"] in ("a", "b") else None
            if isinstance(trip.get("days"), list):   # une valeur d'un autre type est ignorée, jamais prise pour « aucun jour »
                st["trip"]["days"] = clean_days(trip["days"])
        if isinstance(body.get("prefs"), dict):
            st["prefs"] = {kk: v for kk, v in body["prefs"].items() if isinstance(kk, str) and isinstance(v, (int, float, bool, str))}
        now = int(time.time())
        logged = False
        for e in (body.get("log") if isinstance(body.get("log"), list) else [])[:6]:
            text = e.get("text") if isinstance(e, dict) else None
            if isinstance(text, str) and text.strip():
                st["log"].append({"by": k, "name": st["users"][k]["name"], "t": now, "v": st["version"] + 1, "text": text.strip()[:160]})
                logged = True
        st["log"] = st["log"][-LOG_MAX:]
        after = json.dumps({x: st[x] for x in ("users", "plans", "trip", "prefs")}, sort_keys=True)
        return logged or after != before

    def log_message(self, fmt, *args):  # journal concis
        print("%s %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    print(f"costa-sync sur 127.0.0.1:{PORT}, données {DATA}, utilisateurs {USERS}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
