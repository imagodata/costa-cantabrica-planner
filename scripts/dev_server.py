"""Serveur de dev : fichiers statiques du projet + /whoami + relais /api/state vers costa_sync (X-User fixé par le port).
Reproduit en local ce que fait Caddy sur le VPS. Usage : dev_server.py PORT USER (ex. 8020 simon, 8021 marie) ;
le paramètre ?as=marie écrit au nom d'un autre voyageur (réservé aux tests).
À lancer depuis la racine du dépôt, avec `COSTA_PORT=8097 python3 server/costa_sync.py` à côté."""
import sys, os, json, urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
PORT, USER = int(sys.argv[1]), sys.argv[2]
SYNC = 'http://127.0.0.1:8097'
class H(SimpleHTTPRequestHandler):
    def _user(self):
        q = self.path.split('?', 1)[1] if '?' in self.path else ''
        for kv in q.split('&'):
            if kv.startswith('as='): return kv[3:]
        return USER
    def _relay(self, method):
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n) if n else None
        req = urllib.request.Request(SYNC + self.path.split('?')[0], method=method, data=body)
        req.add_header('X-User', self._user()); req.add_header('Content-Type', 'application/json')
        for h in ('If-Match', 'Authorization'):
            if self.headers.get(h): req.add_header(h, self.headers[h])
        try:
            with urllib.request.urlopen(req) as r: code, data = r.status, r.read()
        except urllib.error.HTTPError as e: code, data = e.code, e.read()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        p = self.path.split('?')[0]
        if p == '/whoami':
            d = USER.encode(); self.send_response(200); self.send_header('Content-Type', 'text/plain'); self.send_header('Content-Length', str(len(d))); self.end_headers(); self.wfile.write(d); return
        if p.startswith('/api/'): return self._relay('GET')
        return super().do_GET()
    def do_PUT(self):
        if self.path.split('?')[0].startswith('/api/'): return self._relay('PUT')
        self.send_response(404); self.end_headers()
    def do_POST(self):
        if self.path.split('?')[0].startswith('/api/'): return self._relay('POST')
        self.send_response(404); self.end_headers()
    def log_message(self, *a): pass
ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
