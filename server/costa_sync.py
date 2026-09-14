#!/usr/bin/env python3
"""Service Costa Cantábrica : comptes, séjours partagés (workspaces), état fusionné, journal.
Bibliothèque standard uniquement (http.server, sqlite3, hashlib.scrypt, secrets).

Deux modes d'identité, utilisables ensemble :
  - hérité : Caddy (basic_auth) transmet l'utilisateur dans X-User ; COSTA_USERS ("simon:a,marie:b")
    donne sa place (a/b) dans le séjour « legacy », migré depuis COSTA_DATA (state.json) au premier
    démarrage. Routes : GET/PUT /api/state.
  - comptes : jeton porteur (Authorization: Bearer …) obtenu par /api/auth/*. Un compte peut créer ou
    rejoindre des séjours (code d'invitation) ; chaque membre occupe une place a ou b.

Routes (JSON) :
  POST /api/auth/register {email,name,password} → {token,user}      POST /api/auth/login {email,password}
  POST /api/auth/logout                                              GET  /api/me → {user, workspaces}
  POST /api/workspaces {name} → {workspace}                          POST /api/workspaces/join {code} → {workspace}
  GET  /api/w/<id> → workspace   PUT /api/w/<id> {name}              POST /api/w/<id>/leave
  GET  /api/w/<id>/state  PUT /api/w/<id>/state (écriture partielle fusionnée, If-Match obligatoire ; 409 sinon)
  GET  /api/state  PUT /api/state (mode hérité, séjour « legacy »)

Écriture partielle (PUT …/state), fusionnée clé par clé :
  - users[k] (k = ma place) : name et wish remplacés s'ils sont présents ; users[k].suggest ne peut que
    perdre des entrées (accepter, ignorer) ;
  - users[autre] : name accepté (les deux peuvent corriger un prénom) et suggest (plages que je propose) ;
  - plans : { id: programme | null } — ma note et mes compléments viennent du corps, ceux de l'autre
    restent ceux du serveur ; null supprime ;
  - trip : champs présents seulement (base, start, auto, autoBy, days) ; prefs : remplacées ;
  - log : jusqu'à 6 résumés lisibles, horodatés, signés et numérotés (v) par le serveur (40 gardés).

CORS pour les origines de COSTA_ORIGINS (l'application sur GitHub Pages, une application mobile).
Variables : COSTA_DB, COSTA_DATA, COSTA_USERS, COSTA_PORT, COSTA_ORIGINS, COSTA_LEGACY_WS.
"""
import hashlib
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DB = Path(os.environ.get("COSTA_DB", "/opt/costa-data/costa.db"))
LEGACY_JSON = Path(os.environ.get("COSTA_DATA", "/opt/costa-data/state.json"))
USERS = dict(p.split(":", 1) for p in os.environ.get("COSTA_USERS", "simon:a,marie:b").split(",") if ":" in p)
PORT = int(os.environ.get("COSTA_PORT", "8095"))
LEGACY_WS = os.environ.get("COSTA_LEGACY_WS", "legacy")
ORIGINS = [o.strip() for o in os.environ.get("COSTA_ORIGINS", "https://imagodata.github.io,http://localhost:8000,http://localhost:8010,http://localhost:8020,http://127.0.0.1:8000").split(",") if o.strip()]
MAX_BODY = 512 * 1024
LOG_MAX = 40
SESSION_DAYS = 180
LOCK = threading.Lock()
ID_RE = re.compile(r"^[nwr]\d+$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
EMPTY = {"users": {"a": {"name": "Voyageur 1", "wish": [], "suggest": []}, "b": {"name": "Voyageur 2", "wish": [], "suggest": []}},
         "plans": {}, "trip": {"base": None, "start": None, "days": [], "auto": False, "autoBy": None}, "prefs": None, "log": []}
RATE = defaultdict(deque)   # limitation des tentatives par (type, adresse) et par compte
STATE_MAX = 256 * 1024      # taille sérialisée maximale d'un séjour
DUMMY_HASH = None           # hachage factice pour égaliser le temps de réponse d'une connexion sur compte inconnu
CTRL_RE = re.compile(r"[<>\x00-\x1f\x7f]")


# ------------------------------------------------------------------ base de données
def db():
    con = sqlite3.connect(DB, timeout=10, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    DB.parent.mkdir(parents=True, exist_ok=True)
    with db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pw TEXT NOT NULL, created INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, invite TEXT UNIQUE NOT NULL, created INTEGER NOT NULL,
            state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0, by TEXT);
        CREATE TABLE IF NOT EXISTS members (ws_id TEXT NOT NULL, user_id TEXT NOT NULL, slot TEXT NOT NULL, joined INTEGER NOT NULL, PRIMARY KEY (ws_id, user_id));
        CREATE INDEX IF NOT EXISTS members_user ON members(user_id);
        """)
        if not con.execute("SELECT 1 FROM workspaces WHERE id = ?", (LEGACY_WS,)).fetchone():
            st = fresh_state()
            version = 0
            if LEGACY_JSON.exists():   # migration de l'état hérité : un fichier illisible fait refuser le démarrage, jamais un état vide
                old = json.loads(LEGACY_JSON.read_text(encoding="utf-8"))
                if not isinstance(old, dict) or not isinstance(old.get("users"), dict):
                    raise SystemExit(f"{LEGACY_JSON} : état hérité inattendu, migration refusée")
                for k in ("users", "plans", "trip", "prefs", "log"):
                    if k in old:
                        st[k] = old[k]
                version = int(old.get("version") or 0)
                print(f"état hérité migré depuis {LEGACY_JSON} (version {version})", flush=True)
            else:
                for u, slot in USERS.items():   # sans état hérité : prénoms des comptes Caddy
                    if slot in ("a", "b"):
                        st["users"][slot]["name"] = u[:1].upper() + u[1:14]
            st = normalize(st)
            con.execute("INSERT INTO workspaces (id, name, invite, created, state, version, updated, by) VALUES (?,?,?,?,?,?,?,?)",
                        (LEGACY_WS, "Costa Cantábrica", new_invite(con), int(time.time()), json.dumps(st, ensure_ascii=False), version, int(time.time()), None))
            con.commit()
            if LEGACY_JSON.exists():
                try:
                    LEGACY_JSON.rename(LEGACY_JSON.with_suffix(".json.migre"))   # la base fait foi désormais
                except OSError:
                    pass
        print(f"séjour hérité « {LEGACY_WS} » prêt (code d'invitation dans Réglages)", flush=True)


def fresh_state():
    return json.loads(json.dumps(EMPTY))


def normalize(st):
    base = fresh_state()
    base.update({k: v for k, v in st.items() if k in EMPTY})
    for k in ("users", "plans", "trip"):
        if not isinstance(base.get(k), dict):
            base[k] = fresh_state()[k]
    for k in ("a", "b"):
        if not isinstance(base["users"].get(k), dict):
            base["users"][k] = fresh_state()["users"][k]
        u = base["users"][k]
        if not isinstance(u.get("name"), str) or not u["name"].strip():
            u["name"] = fresh_state()["users"][k]["name"]
        for f in ("wish", "suggest"):
            if not isinstance(u.get(f), list):
                u[f] = []
    if not isinstance(base["trip"].get("days"), list):
        base["trip"]["days"] = []
    if not isinstance(base.get("log"), list):
        base["log"] = []
    return base


def new_invite(con):
    while True:
        code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(8))
        if not con.execute("SELECT 1 FROM workspaces WHERE invite = ?", (code,)).fetchone():
            return code


def hash_pw(pw):
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode("utf-8"), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${h.hex()}"


def dummy_hash():
    global DUMMY_HASH
    if DUMMY_HASH is None:
        DUMMY_HASH = hash_pw(secrets.token_hex(8))
    return DUMMY_HASH


def check_pw(pw, stored):
    try:
        _, salt, h = stored.split("$")
        got = hashlib.scrypt(pw.encode("utf-8"), salt=bytes.fromhex(salt), n=2 ** 14, r=8, p=1, dklen=32)
        return secrets.compare_digest(got.hex(), h)
    except Exception:
        return False


def clean_text(v, n):
    """Texte affiché (prénom, nom de séjour, journal) : sans balises ni caractères de contrôle."""
    return CTRL_RE.sub("", str(v or "")).strip()[:n]


def rate_ok(key, limit=20, window=600):
    if len(RATE) > 5000:   # purge des files vides ou anciennes
        for k in [k for k, q in RATE.items() if not q or q[-1] < time.time() - window]:
            RATE.pop(k, None)
    q = RATE[key]
    now = time.time()
    while q and q[0] < now - window:
        q.popleft()
    if len(q) >= limit:
        return False
    q.append(now)
    return True


# ------------------------------------------------------------------ fusion de l'état
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
            lock = {"lock": True} if st.get("lock") is True else {}
            if t in ("s", "p") and isinstance(st.get("id"), str):
                stops.append({"t": t, "id": st["id"][:32], **lock})
            elif t == "x" and isinstance(st.get("text"), str) and st["text"].strip():
                stops.append({"t": "x", "text": st["text"].strip()[:80], **lock})
        out.append({"stops": stops})
    return out


def apply_partial(st, body, k, version):
    """Fusionne un corps partiel dans st ; renvoie True si quelque chose a changé."""
    other = "b" if k == "a" else "a"
    before = json.dumps({x: st[x] for x in ("users", "plans", "trip", "prefs")}, sort_keys=True)
    users = body.get("users") if isinstance(body.get("users"), dict) else {}
    me = users.get(k)
    if isinstance(me, dict):
        cur = st["users"][k]
        sugg = cur.get("suggest", [])
        if "suggest" in me:
            keep = set(clean_list(me.get("suggest"), 100))
            sugg = [x for x in sugg if x in keep]
        wish = clean_list(me.get("wish")) if "wish" in me else cur.get("wish", [])
        st["users"][k] = {"name": clean_text(me.get("name"), 14) or cur["name"], "wish": wish,
                          "suggest": [x for x in sugg if x not in wish]}
    oth = users.get(other) if isinstance(users.get(other), dict) else {}
    oname = oth.get("name")
    if isinstance(oname, str) and clean_text(oname, 14):
        st["users"][other]["name"] = clean_text(oname, 14)
    if "suggest" in oth:
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
        if isinstance(trip.get("days"), list):
            st["trip"]["days"] = clean_days(trip["days"])
    if isinstance(body.get("prefs"), dict):
        st["prefs"] = {kk: v for kk, v in body["prefs"].items() if isinstance(kk, str) and isinstance(v, (int, float, bool, str))}
    now = int(time.time())
    logged = False
    for e in (body.get("log") if isinstance(body.get("log"), list) else [])[:6]:
        text = e.get("text") if isinstance(e, dict) else None
        if isinstance(text, str) and text.strip():
            st["log"].append({"by": k, "name": st["users"][k]["name"], "t": now, "v": version + 1, "text": clean_text(text, 160)})
            logged = True
    st["log"] = st["log"][-LOG_MAX:]
    after = json.dumps({x: st[x] for x in ("users", "plans", "trip", "prefs")}, sort_keys=True)
    return logged or after != before


# ------------------------------------------------------------------ requêtes
class Http(Exception):
    def __init__(self, code, obj):
        self.code, self.obj = code, obj


def ws_meta(con, ws_id):
    w = con.execute("SELECT id, name, invite, version, updated, by FROM workspaces WHERE id = ?", (ws_id,)).fetchone()
    if not w:
        return None
    ms = con.execute("SELECT m.slot, u.name FROM members m JOIN users u ON u.id = m.user_id WHERE m.ws_id = ? ORDER BY m.slot", (ws_id,)).fetchall()
    return {"id": w["id"], "name": w["name"], "invite": w["invite"], "version": w["version"], "updatedAt": w["updated"],
            "members": [{"slot": m["slot"], "name": m["name"]} for m in ms], "full": len(ms) >= 2}


class H(BaseHTTPRequestHandler):
    server_version = "costa-sync/3"
    protocol_version = "HTTP/1.1"
    timeout = 20   # délai socket : un client muet ne retient rien

    # --- réponses
    def _cors(self):
        origin = self.headers.get("Origin")
        self.send_header("Vary", "Origin")
        if origin and origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match")
            self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Max-Age", "600")

    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise Http(400, {"error": "Content-Length invalide"})
        if n <= 0:
            raise Http(400, {"error": "corps requis"})
        if n > MAX_BODY:   # on consomme (borné) avant de refuser, pour que le client reçoive bien le 413
            left = min(n, 4 * MAX_BODY)
            while left > 0:
                chunk = self.rfile.read(min(65536, left))
                if not chunk:
                    break
                left -= len(chunk)
            raise Http(413, {"error": "corps trop volumineux"})
        try:
            body = json.loads(self.rfile.read(n).decode("utf-8"))
            assert isinstance(body, dict)
            return body
        except Exception:
            raise Http(400, {"error": "JSON invalide"})

    def _ip(self):
        xff = self.headers.get("X-Forwarded-For")   # Caddy ajoute l'adresse réelle en dernier ; le début est contrôlé par le client
        return xff.split(",")[-1].strip() if xff else self.address_string()

    # --- identité
    def _account(self, con):
        auth = self.headers.get("Authorization") or ""
        if not auth.lower().startswith("bearer "):
            return None
        token = auth[7:].strip()
        row = con.execute("SELECT u.id, u.email, u.name, s.created, s.seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?", (token,)).fetchone()
        if not row or row["created"] < time.time() - SESSION_DAYS * 86400:
            raise Http(401, {"error": "session expirée"})
        if row["seen"] < time.time() - 3600:
            con.execute("UPDATE sessions SET seen = ? WHERE token = ?", (int(time.time()), token))
        return {"id": row["id"], "email": row["email"], "name": row["name"]}

    def _legacy(self):
        u = (self.headers.get("X-User") or "").strip().lower()
        return u, USERS.get(u)

    def _member_slot(self, con, ws_id, user):
        m = con.execute("SELECT slot FROM members WHERE ws_id = ? AND user_id = ?", (ws_id, user["id"])).fetchone()
        if not m:
            raise Http(403, {"error": "pas membre de ce séjour"})
        return m["slot"]

    # --- routage
    def do_GET(self):
        self._route("GET")

    def do_PUT(self):
        self._route("PUT")

    def do_POST(self):
        self._route("POST")

    def do_DELETE(self):
        self._route("DELETE")

    def _route(self, method):
        path = self.path.split("?")[0].rstrip("/") or "/"
        try:
            body = self._body() if method in ("PUT", "POST") and path not in ("/api/auth/logout",) else None   # lu hors verrou
            if path in ("/api/auth/register", "/api/auth/login") and method == "POST":   # hachage scrypt hors verrou global
                return self._register(body) if path.endswith("register") else self._login(body)
            with LOCK, db() as con:
                m = re.match(r"^/api/w/([A-Za-z0-9_-]{1,32})(/state|/leave)?$", path)
                if path == "/api/state":
                    return self._state_legacy(con, method, body)
                if m:
                    return self._workspace(con, method, m.group(1), m.group(2) or "", body)
                if path == "/api/auth/logout" and method == "POST":
                    return self._logout(con)
                if path == "/api/me" and method == "GET":
                    return self._me(con)
                if path == "/api/workspaces" and method == "POST":
                    return self._create_ws(con, body)
                if path == "/api/workspaces/join" and method == "POST":
                    return self._join_ws(con, body)
                raise Http(404, {"error": "not found"})
        except Http as e:
            self._send(e.code, e.obj)
        except Exception as e:   # jamais de connexion coupée sans réponse ; le détail reste dans le journal
            print(f"erreur interne {method} {path} : {e!r}", flush=True)
            self._send(500, {"error": "erreur interne"})

    # --- comptes
    def _register(self, b):
        if not rate_ok(("register", self._ip())):
            raise Http(429, {"error": "trop de tentatives, réessayez plus tard"})
        email = str(b.get("email") or "").strip().lower()
        name = clean_text(b.get("name"), 14)
        pw = str(b.get("password") or "")
        if not EMAIL_RE.match(email) or len(email) > 120:
            raise Http(400, {"error": "adresse e-mail invalide"})
        if not name:
            raise Http(400, {"error": "prénom requis"})
        if len(pw) < 8 or len(pw) > 200:
            raise Http(400, {"error": "mot de passe : 8 caractères au moins"})
        pw_hash = hash_pw(pw)   # coûteux : hors verrou
        with LOCK, db() as con:
            if con.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
                raise Http(409, {"error": "inscription impossible avec cette adresse"})
            uid = secrets.token_urlsafe(9)
            con.execute("INSERT INTO users (id, email, name, pw, created) VALUES (?,?,?,?,?)", (uid, email, name, pw_hash, int(time.time())))
            token = self._session(con, uid)
        self._send(201, {"token": token, "user": {"id": uid, "email": email, "name": name}})

    def _login(self, b):
        if not rate_ok(("login", self._ip())):
            raise Http(429, {"error": "trop de tentatives, réessayez plus tard"})
        email = str(b.get("email") or "").strip().lower()
        with LOCK, db() as con:
            row = con.execute("SELECT id, email, name, pw FROM users WHERE email = ?", (email,)).fetchone()
        if row and not rate_ok(("account", row["id"]), limit=10, window=900):   # verrouillage temporaire du compte visé
            raise Http(429, {"error": "trop de tentatives, réessayez plus tard"})
        ok = check_pw(str(b.get("password") or ""), row["pw"] if row else dummy_hash())   # même coût qu'un compte existe ou non
        if not row or not ok:
            raise Http(401, {"error": "adresse ou mot de passe incorrect"})
        with LOCK, db() as con:
            RATE.pop(("account", row["id"]), None)
            token = self._session(con, row["id"])
        self._send(200, {"token": token, "user": {"id": row["id"], "email": row["email"], "name": row["name"]}})

    def _session(self, con, uid):
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        con.execute("INSERT INTO sessions (token, user_id, created, seen) VALUES (?,?,?,?)", (token, uid, now, now))
        con.execute("DELETE FROM sessions WHERE created < ?", (now - SESSION_DAYS * 86400,))
        return token

    def _logout(self, con):
        auth = self.headers.get("Authorization") or ""
        if auth.lower().startswith("bearer "):
            con.execute("DELETE FROM sessions WHERE token = ?", (auth[7:].strip(),))
        self._send(200, {"ok": True})

    def _me(self, con):
        user = self._account(con)
        if not user:
            raise Http(401, {"error": "connexion requise"})
        rows = con.execute("SELECT ws_id, slot FROM members WHERE user_id = ? ORDER BY joined", (user["id"],)).fetchall()
        wss = []
        for r in rows:
            w = ws_meta(con, r["ws_id"])
            if w:
                w["slot"] = r["slot"]
                wss.append(w)
        self._send(200, {"user": user, "workspaces": wss})

    # --- séjours
    def _create_ws(self, con, b):
        user = self._account(con)
        if not user:
            raise Http(401, {"error": "connexion requise"})
        name = clean_text(b.get("name"), 40) or "Notre séjour"
        if con.execute("SELECT COUNT(*) FROM members WHERE user_id = ?", (user["id"],)).fetchone()[0] >= 20:
            raise Http(400, {"error": "20 séjours au plus par compte"})
        while True:
            ws_id = secrets.token_hex(6)
            if not con.execute("SELECT 1 FROM workspaces WHERE id = ?", (ws_id,)).fetchone():
                break
        st = fresh_state()
        st["users"]["a"]["name"] = user["name"][:14]
        now = int(time.time())
        con.execute("INSERT INTO workspaces (id, name, invite, created, state, version, updated, by) VALUES (?,?,?,?,?,?,?,?)",
                    (ws_id, name, new_invite(con), now, json.dumps(st, ensure_ascii=False), 0, now, user["name"]))
        con.execute("INSERT INTO members (ws_id, user_id, slot, joined) VALUES (?,?,?,?)", (ws_id, user["id"], "a", now))
        w = ws_meta(con, ws_id)
        w["slot"] = "a"
        self._send(201, {"workspace": w})

    def _join_ws(self, con, b):
        user = self._account(con)
        if not user:
            raise Http(401, {"error": "connexion requise"})
        if not rate_ok(("join", self._ip()), limit=30):
            raise Http(429, {"error": "trop de tentatives, réessayez plus tard"})
        code = re.sub(r"[^A-Z0-9]", "", str(b.get("code") or "").upper())
        w = con.execute("SELECT id, state FROM workspaces WHERE invite = ?", (code,)).fetchone()
        if not w:
            raise Http(404, {"error": "code d'invitation inconnu"})
        ws_id = w["id"]
        existing = con.execute("SELECT slot FROM members WHERE ws_id = ? AND user_id = ?", (ws_id, user["id"])).fetchone()
        if existing:
            slot = existing["slot"]
        else:
            taken = {m["slot"] for m in con.execute("SELECT slot FROM members WHERE ws_id = ?", (ws_id,)).fetchall()}
            if ws_id == LEGACY_WS:   # séjour hérité : la place est celle du compte Caddy du même prénom (simon → a, marie → b)
                slot = USERS.get(user["name"].lower()) or USERS.get(user["email"].split("@")[0].lower())
                if slot not in ("a", "b"):
                    raise Http(409, {"error": "pour ce séjour, le prénom du compte doit être " + " ou ".join(u.capitalize() for u in USERS)})
                if slot in taken:
                    raise Http(409, {"error": "cette place est déjà occupée par un autre compte"})
            else:
                slot = "a" if "a" not in taken else "b" if "b" not in taken else None
            if not slot:
                raise Http(409, {"error": "ce séjour a déjà deux voyageurs"})
            now = int(time.time())
            con.execute("INSERT INTO members (ws_id, user_id, slot, joined) VALUES (?,?,?,?)", (ws_id, user["id"], slot, now))
            st = normalize(json.loads(w["state"]))
            if st["users"][slot]["name"] in ("Voyageur 1", "Voyageur 2", "") or ws_id != LEGACY_WS:
                st["users"][slot]["name"] = user["name"][:14]
            con.execute("UPDATE workspaces SET state = ?, version = version + 1, updated = ?, by = ? WHERE id = ?",
                        (json.dumps(st, ensure_ascii=False), now, user["name"], ws_id))
        meta = ws_meta(con, ws_id)
        meta["slot"] = slot
        self._send(200, {"workspace": meta})

    def _workspace(self, con, method, ws_id, sub, body):
        user = self._account(con)
        if not user:
            raise Http(401, {"error": "connexion requise"})
        slot = self._member_slot(con, ws_id, user)
        if sub == "/state":
            return self._state(con, method, ws_id, slot, user["name"], body)
        if sub == "/leave" and method == "POST":
            con.execute("DELETE FROM members WHERE ws_id = ? AND user_id = ?", (ws_id, user["id"]))
            con.execute("UPDATE workspaces SET invite = ? WHERE id = ?", (new_invite(con), ws_id))   # l'ancien code ne rouvre pas la porte
            return self._send(200, {"ok": True})
        if sub == "" and method == "GET":
            meta = ws_meta(con, ws_id)
            meta["slot"] = slot
            return self._send(200, {"workspace": meta})
        if sub == "" and method == "PUT":
            name = clean_text(body.get("name"), 40)
            if name:
                con.execute("UPDATE workspaces SET name = ? WHERE id = ?", (name, ws_id))
            if body.get("newInvite") is True:
                con.execute("UPDATE workspaces SET invite = ? WHERE id = ?", (new_invite(con), ws_id))
            meta = ws_meta(con, ws_id)
            meta["slot"] = slot
            return self._send(200, {"workspace": meta})
        raise Http(404, {"error": "not found"})

    def _state_legacy(self, con, method, body):
        u, k = self._legacy()
        if not k:
            raise Http(403, {"error": "utilisateur inconnu", "user": u})
        return self._state(con, method, LEGACY_WS, k, u, body)

    # --- état partagé
    def _state(self, con, method, ws_id, k, by_name, body=None):
        w = con.execute("SELECT state, version, updated, by FROM workspaces WHERE id = ?", (ws_id,)).fetchone()
        if not w:
            raise Http(404, {"error": "séjour inconnu"})
        st = normalize(json.loads(w["state"]))
        meta = ws_meta(con, ws_id)

        def payload(version, updated, by):
            return {**st, "version": version, "updatedAt": updated, "by": by, "me": k,
                    "workspace": {"id": meta["id"], "name": meta["name"], "invite": meta["invite"], "members": meta["members"]}}

        if method == "GET":
            return self._send(200, payload(w["version"], w["updated"], w["by"]))
        if method != "PUT":
            raise Http(405, {"error": "méthode non permise"})
        if body is None:
            raise Http(400, {"error": "corps requis"})
        try:
            expected = int(self.headers.get("If-Match") or -1)
        except ValueError:
            expected = -1
        if expected != w["version"]:
            return self._send(409, payload(w["version"], w["updated"], w["by"]))
        try:
            changed = apply_partial(st, body, k, w["version"])
        except Exception as e:
            raise Http(400, {"error": "corps invalide"})
        version, updated, by = w["version"], w["updated"], w["by"]
        if changed:
            data = json.dumps(st, ensure_ascii=False)
            if len(data.encode("utf-8")) > STATE_MAX:
                raise Http(413, {"error": "séjour trop volumineux : retirez des programmes ou des notes"})
            version, updated, by = w["version"] + 1, int(time.time()), by_name
            con.execute("UPDATE workspaces SET state = ?, version = ?, updated = ?, by = ? WHERE id = ?",
                        (data, version, updated, by, ws_id))
        self._send(200, payload(version, updated, by))

    def log_message(self, fmt, *args):  # journal concis
        print("%s %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    init_db()
    print(f"costa-sync sur 127.0.0.1:{PORT}, base {DB}, utilisateurs hérités {USERS}, origines {ORIGINS}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
