#!/usr/bin/env bash
# Déploie la version protégée par mot de passe sur le VPS (Caddy, basic_auth).
#   scripts/deploy_vps.sh                    # déploiement (fichiers suivis par git + pages de partage)
#   scripts/deploy_vps.sh --open             # (re)crée le bloc Caddy SANS mot de passe : connexion par compte dans l'application
#   VPS=root@1.2.3.4 HOST=costa.example.com scripts/deploy_vps.sh
# Le bloc Caddy est (re)créé avec : scripts/deploy_vps.sh --init utilisateur:motdepasse [utilisateur2:motdepasse2 …]
# L'utilisateur connecté est exposé sur /whoami (l'application choisit le voyageur correspondant).
set -euo pipefail
VPS="${VPS:-root@188.245.235.42}"
HOST="${HOST:-costa.188-245-235-42.sslip.io}"
DIR="${DIR:-/opt/costa}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ "${1:-}" = "--init" ]; then
  shift; [ $# -ge 1 ] || { echo "usage : --init utilisateur:motdepasse [autre:motdepasse …]" >&2; exit 1; }
  USERS=""
  for pair in "$@"; do
    U="${pair%%:*}"; P="${pair#*:}"
    H=$(ssh "$VPS" "caddy hash-password --plaintext '$P'")
    USERS="$USERS		$U $H
"
  done
  # retire un éventuel bloc précédent (entre les marqueurs), sauvegarde, puis ajoute le nouveau
  ssh "$VPS" "mkdir -p $DIR && cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-costa-\$(date +%s) \
    && awk '/^# --- Costa Cantábrica \(version protégée\)/{skip=1} /^# --- \/Costa ---/{skip=0; next} !skip' /etc/caddy/Caddyfile > /etc/caddy/Caddyfile.new && mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile \
    && cat >> /etc/caddy/Caddyfile <<'CADDY'
# --- Costa Cantábrica (version protégée) : $HOST ---
$HOST {
	encode zstd gzip
	@site not path /api/auth/* /api/w/* /api/me /api/workspaces /api/workspaces/*
	basic_auth @site {
$USERS	}
	respond /whoami \"{http.auth.user.id}\" 200
	handle /api/* {
		reverse_proxy 127.0.0.1:8095 {
			header_up X-User {http.auth.user.id}
		}
	}
	root * $DIR
	file_server
	header Cache-Control \"no-cache\"
	handle_errors {
		@404 expression {http.error.status_code} == 404
		rewrite @404 /index.html
		file_server
	}
}
# --- /Costa ---
CADDY
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy && echo 'Caddy rechargé'"
fi

if [ "${1:-}" = "--open" ]; then
  # Site ouvert : plus de mot de passe Caddy, l'identité est celle des comptes de l'application ;
  # l'en-tête X-User d'un client est retiré (le mode hérité /api/state ne peut plus être usurpé).
  ssh "$VPS" "mkdir -p $DIR && cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-costa-\$(date +%s) \
    && awk '/^# --- Costa Cantábrica/{skip=1} /^# --- \/Costa ---/{skip=0; next} !skip' /etc/caddy/Caddyfile > /etc/caddy/Caddyfile.new && mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile \
    && cat >> /etc/caddy/Caddyfile <<'CADDY'
# --- Costa Cantábrica (comptes dans l'application) : $HOST ---
$HOST {
	encode zstd gzip
	handle /api/* {
		reverse_proxy 127.0.0.1:8095 {
			header_up -X-User
		}
	}
	root * $DIR
	file_server
	header Cache-Control \"no-cache\"
	handle_errors {
		@404 expression {http.error.status_code} == 404
		rewrite @404 /index.html
		file_server
	}
}
# --- /Costa ---
CADDY
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy && echo 'Caddy rechargé : site ouvert, connexion par compte'"
  shift
fi

# Caddy déjà en place : les routes à jeton (comptes, séjours) sortent de basic_auth pour être joignables
# depuis GitHub Pages ou une application mobile ; le reste du site garde le mot de passe.
ssh "$VPS" 'python3 - <<"PY"
import subprocess, sys
p = "/etc/caddy/Caddyfile"; s = open(p, encoding="utf-8").read()
MATCH = "\t@site not path /api/auth/* /api/w/* /api/me /api/workspaces /api/workspaces/*\n\tbasic_auth @site {"
a, b = s.find("# --- Costa Cant"), s.find("# --- /Costa ---")
if a >= 0 and b > a and "basic_auth @site" not in s[a:b] and "\tbasic_auth {" in s[a:b]:   # uniquement le bloc Costa, jamais un autre site
    s2 = s[:a] + s[a:b].replace("\tbasic_auth {", MATCH, 1) + s[b:]
    open(p + ".new", "w", encoding="utf-8").write(s2)
    if subprocess.call(["caddy", "validate", "--config", p + ".new", "--adapter", "caddyfile"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) == 0:
        subprocess.call(["cp", p, p + ".bak-costa-auth"]); subprocess.call(["mv", p + ".new", p]); subprocess.call(["systemctl", "reload", "caddy"]); print("Caddy : routes à jeton hors basic_auth (bloc Costa)")
    else:
        subprocess.call(["rm", "-f", p + ".new"]); print("Caddy : configuration modifiée invalide, inchangée", file=sys.stderr)
PY'

# Service de synchronisation (identité transmise par Caddy) : installation / mise à jour
rsync -az server/costa_sync.py server/costa-sync.service "$VPS:/tmp/costa-sync/"
ssh "$VPS" "id -u costa >/dev/null 2>&1 || useradd --system --home /opt/costa-data --shell /usr/sbin/nologin costa; \
  mkdir -p /opt/costa-sync /opt/costa-data && install -m 644 /tmp/costa-sync/costa_sync.py /opt/costa-sync/costa_sync.py \
  && chown -R costa:costa /opt/costa-data && install -m 644 /tmp/costa-sync/costa-sync.service /etc/systemd/system/costa-sync.service \
  && systemctl daemon-reload && systemctl enable --now costa-sync >/dev/null && systemctl restart costa-sync && sleep 1 && systemctl is-active costa-sync"

# Pages de partage avec l'URL du VPS, puis rsync des fichiers suivis + pages
TMP=$(mktemp -d)
python3 scripts/build_pages.py --base "https://$HOST/" --out "$TMP/s" >/dev/null
git ls-files > "$TMP/files.txt"
rsync -az --delete --files-from="$TMP/files.txt" --relative . "$VPS:$DIR/" \
  --exclude 'data/raw/' --exclude 'scripts/' --exclude 'server/' --exclude 'gispulse/' --exclude 'config/' --exclude '*.md' --exclude 'Makefile' --exclude '.gitignore' --exclude 'LICENSE'
rsync -az --delete "$TMP/s/" "$VPS:$DIR/s/"
ssh "$VPS" "chmod -R a+rX $DIR"
rm -rf "$TMP"
echo "Déployé : https://$HOST/  (rev $(git rev-parse --short HEAD))"
