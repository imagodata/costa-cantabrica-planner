#!/usr/bin/env bash
# Déploie la version protégée par mot de passe sur le VPS (Caddy, basic_auth).
#   scripts/deploy_vps.sh                    # déploiement (fichiers suivis par git + pages de partage)
#   VPS=root@1.2.3.4 HOST=costa.example.com scripts/deploy_vps.sh
# Le bloc Caddy est créé au premier déploiement (scripts/deploy_vps.sh --init 'utilisateur' 'motdepasse').
set -euo pipefail
VPS="${VPS:-root@188.245.235.42}"
HOST="${HOST:-costa.188-245-235-42.sslip.io}"
DIR="${DIR:-/opt/costa}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ "${1:-}" = "--init" ]; then
  USER_="${2:?utilisateur}"; PASS="${3:?mot de passe}"
  HASH=$(ssh "$VPS" "caddy hash-password --plaintext '$PASS'")
  ssh "$VPS" "mkdir -p $DIR && cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-costa-\$(date +%s) && cat >> /etc/caddy/Caddyfile <<'CADDY'

# --- Costa Cantábrica (version protégée) : $HOST ---
$HOST {
	encode zstd gzip
	basic_auth {
		$USER_ $HASH
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
CADDY
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy && echo 'Caddy rechargé'"
fi

# Pages de partage avec l'URL du VPS, puis rsync des fichiers suivis + pages
TMP=$(mktemp -d)
python3 scripts/build_pages.py --base "https://$HOST/" --out "$TMP/s" >/dev/null
git ls-files > "$TMP/files.txt"
rsync -az --delete --files-from="$TMP/files.txt" --relative . "$VPS:$DIR/" \
  --exclude 'data/raw/' --exclude 'scripts/' --exclude 'gispulse/' --exclude 'config/' --exclude '*.md' --exclude 'Makefile' --exclude '.gitignore' --exclude 'LICENSE'
rsync -az --delete "$TMP/s/" "$VPS:$DIR/s/"
ssh "$VPS" "chmod -R a+rX $DIR"
rm -rf "$TMP"
echo "Déployé : https://$HOST/  (rev $(git rev-parse --short HEAD))"
