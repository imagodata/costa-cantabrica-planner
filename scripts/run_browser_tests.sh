#!/usr/bin/env bash
# Banc de test navigateur : lance costa_sync (port 8097, données temporaires) et dev_server (8020, simon),
# puis ouvre scripts/test_harness.html dans le Chromium sans tête de Playwright et affiche les résultats.
set -u
cd "$(dirname "$0")/.."
H=$(ls -d ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell 2>/dev/null | tail -1)
[ -x "$H" ] || { echo "Chromium sans tête introuvable (~/.cache/ms-playwright) : banc navigateur ignoré"; exit 0; }
D=$(mktemp -d)
COSTA_DB=$D/costa.db COSTA_DATA=$D/state.json COSTA_PORT=8097 COSTA_USERS=simon:a,marie:b python3 server/costa_sync.py >$D/sync.log 2>&1 & P1=$!
python3 scripts/dev_server.py 8020 simon >/dev/null 2>&1 & P2=$!
trap 'kill $P1 $P2 2>/dev/null' EXIT
sleep 0.8
timeout "${BROWSER_TIMEOUT:-540}" "$H" --headless --disable-gpu --no-sandbox --disable-dev-shm-usage --window-size=1000,900 --virtual-time-budget=300000 --dump-dom http://localhost:8020/scripts/test_harness.html 2>/dev/null \
  | python3 -c "
import sys, re, html
d = sys.stdin.read(); m = re.search(r'<pre id=\"out\">(.*?)</pre>', d, re.S)
out = html.unescape(m.group(1)) if m else 'pas de résultat (délai dépassé ou page non chargée)'
print(out); sys.exit(0 if 'ÉCHECS : 0' in out else 1)"
