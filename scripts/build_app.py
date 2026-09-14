#!/usr/bin/env python3
"""Assemble js/app.js à partir de js/src/*.js (ordre alphabétique) dans une fermeture unique.
Le fichier généré est suivi par git pour que le site reste statique ; `--check` vérifie qu'il est à jour."""
import glob
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
HEAD = "/* Application : carte, liste classée, fiche détail, filtres, deux voyageurs, partage.\n   FICHIER GÉNÉRÉ par scripts/build_app.py à partir de js/src/*.js : modifier les sources, puis `make build`. */\n(function () {\n"
TAIL = "})();\n"


def build():
    parts = []
    for f in sorted(glob.glob(os.path.join(ROOT, "js", "src", "*.js"))):
        parts.append(f"  /* ==================== {os.path.basename(f)} ==================== */\n")
        parts.append(open(f, encoding="utf-8").read().rstrip("\n") + "\n")
    return HEAD + "".join(parts) + TAIL


if __name__ == "__main__":
    out = build()
    target = os.path.join(ROOT, "js", "app.js")
    if "--check" in sys.argv:
        cur = open(target, encoding="utf-8").read() if os.path.exists(target) else ""
        if cur != out:
            sys.exit("js/app.js n'est pas à jour : lancer `make build`")
        print("js/app.js à jour")
    else:
        open(target, "w", encoding="utf-8").write(out)
        print(f"js/app.js généré ({len(out)} octets) depuis {len(glob.glob(os.path.join(ROOT, 'js', 'src', '*.js')))} fichiers")
