#!/usr/bin/env python3
"""Réinitialise le mot de passe d'un compte (à lancer sur le serveur, en tant que root ou costa).
Usage : python3 scripts/reset_password.py adresse@exemple.org [nouveau-mot-de-passe]
Sans mot de passe fourni, un mot de passe est généré et affiché. Les sessions du compte sont fermées.
Variables : COSTA_DB (défaut /opt/costa-data/costa.db), COSTA_SERVER (défaut : dossier du service, /opt/costa-sync)."""
import os
import secrets
import sqlite3
import sys

sys.path.insert(0, os.environ.get("COSTA_SERVER", "/opt/costa-sync"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))
from costa_sync import hash_pw  # noqa: E402

if len(sys.argv) < 2:
    print(__doc__)
    sys.exit(1)
email = sys.argv[1].strip().lower()
pw = sys.argv[2] if len(sys.argv) > 2 else "-".join(secrets.choice(["plage", "crique", "maree", "houle", "sable", "falaise", "galet", "ecume", "vague", "phare"]) for _ in range(3)) + "-" + str(secrets.randbelow(90) + 10)
if len(pw) < 8:
    sys.exit("mot de passe : 8 caractères au moins")
con = sqlite3.connect(os.environ.get("COSTA_DB", "/opt/costa-data/costa.db"))
row = con.execute("SELECT id, name FROM users WHERE email = ?", (email,)).fetchone()
if not row:
    sys.exit(f"aucun compte pour {email}")
con.execute("UPDATE users SET pw = ? WHERE id = ?", (hash_pw(pw), row[0]))
con.execute("DELETE FROM sessions WHERE user_id = ?", (row[0],))
con.commit()
print(f"{row[1]} ({email}) : nouveau mot de passe {pw} ; sessions fermées")
