#!/usr/bin/env python3
"""Tests unitaires purs de la fusion d'état du service (sans serveur HTTP) : python3 scripts/test_merge.py"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))
os.environ.setdefault("COSTA_DB", "/tmp/costa-test-merge.db")
from costa_sync import apply_partial, clean_days, clean_text, fresh_state, merge_plan, normalize  # noqa: E402

fails = 0


def check(cond, msg):
    global fails
    print(("OK   " if cond else "FAIL ") + msg)
    if not cond:
        fails += 1


# merge_plan : ma part vient du corps, celle de l'autre du serveur
srv = {"notes": {"a": "note a", "b": "note b"}, "items": [{"poi": "n1", "by": "a"}, {"poi": "n2", "by": "b"}]}
m = merge_plan(srv, {"notes": {"a": "nouvelle", "b": "PIRATE"}, "items": [{"poi": "n1", "by": "a"}, {"poi": "n3", "by": "a"}]}, "a")
check(m["notes"] == {"a": "nouvelle", "b": "note b"}, "merge_plan : ma note remplacée, celle de l'autre conservée")
check([i["poi"] for i in m["items"]] == ["n1", "n3", "n2"], "merge_plan : mes compléments remplacés, ceux de l'autre gardés")
m = merge_plan(srv, {"notes": {"a": ""}, "items": []}, "a")
check([i["poi"] for i in m["items"]] == ["n2"], "merge_plan : je retire les miens, pas ceux de l'autre")
m = merge_plan(srv, {"notes": {"a": "x"}, "items": [{"poi": "n2", "by": "b"}, {"poi": "n1", "by": "a"}]}, "b")
check([i["poi"] for i in m["items"]] == ["n2", "n1"] and m["notes"]["a"] == "note a", "merge_plan : l'autre voyageur, symétrique")
m = merge_plan(None, {"notes": "pas un dict", "items": "pas une liste"}, "a")
check(m == {"notes": {"a": "", "b": ""}, "items": []}, "merge_plan : corps malformé toléré")
m = merge_plan(srv, {"notes": {"a": "x" * 900}, "items": [{"text": "  kayak  ", "by": "zz"}, {"poi": "pas-un-id", "by": "a"}, 42]}, "a")
check(len(m["notes"]["a"]) == 500 and m["items"][0] == {"text": "kayak", "by": "a"} and len(m["items"]) == 2, "merge_plan : bornes, auteur normalisé, entrées invalides ignorées")

# clean_days
d = clean_days([{"stops": [{"t": "s", "id": "n1", "lock": True}, {"t": "p", "id": "w2", "lock": "oui"}, {"t": "x", "text": " marché "}, {"t": "s", "id": "../x"}, "?"]}, "pas un jour"] + [{"stops": []}] * 20)
check(len(d) == 14, "clean_days : 14 jours au plus")
check(d[0]["stops"] == [{"t": "s", "id": "n1", "lock": True}, {"t": "p", "id": "w2"}, {"t": "x", "text": "marché"}], "clean_days : verrou booléen strict, identifiants validés, texte nettoyé")
check(d[1] == {"stops": []}, "clean_days : jour malformé vidé")
check(clean_days("abc") == [], "clean_days : non-liste → vide")

# clean_text
check(clean_text(" A\x00B\nC<i>b</i> ", 14) == "ABCib/i", "clean_text : contrôle et balises retirés, borné")
check(clean_text(None, 5) == "", "clean_text : None → chaîne vide")

# normalize
st = normalize({"users": {"a": {"wish": "non"}, "b": None}, "plans": [], "trip": {"days": "x"}, "log": {}})
check(st["users"]["a"]["name"] == "Voyageur 1" and st["users"]["a"]["wish"] == [] and st["users"]["b"]["suggest"] == [] and st["plans"] == {} and st["trip"]["days"] == [] and st["log"] == [], "normalize : état hérité abîmé remis d'aplomb")

# apply_partial : liste de l'autre protégée, suggest en décroissance seule, journal numéroté, changement détecté
st = fresh_state()
st["users"]["a"].update({"name": "Simon", "wish": ["n1"], "suggest": ["n5", "n6"]})
st["users"]["b"].update({"name": "Marie", "wish": ["n2"]})
changed = apply_partial(st, {"users": {"a": {"wish": ["n1", "n3"], "suggest": ["n6", "n9"]}, "b": {"wish": ["PIRATE"], "name": "Marie2", "suggest": ["n3", "n2", "<x>"]}}, "log": [{"text": "a ajouté X"}]}, "a", 7)
check(changed and st["users"]["a"]["wish"] == ["n1", "n3"], "apply_partial : ma liste remplacée")
check(st["users"]["a"]["suggest"] == ["n6"], "apply_partial : mes propositions reçues ne peuvent que diminuer")
check(st["users"]["b"]["wish"] == ["n2"] and st["users"]["b"]["name"] == "Marie2", "apply_partial : liste de l'autre intacte, prénom corrigeable")
check(st["users"]["b"]["suggest"] == ["n3"], "apply_partial : propositions à l'autre : identifiants validés, pas ses envies")
check(st["log"][-1]["v"] == 8 and st["log"][-1]["by"] == "a" and st["log"][-1]["name"] == "Simon", "apply_partial : journal numéroté et signé")
before = json.dumps(st, sort_keys=True)
check(apply_partial(st, {}, "a", 8) is False and json.dumps(st, sort_keys=True) == before, "apply_partial : corps vide → aucun changement")
apply_partial(st, {"plans": {"n1": {"notes": {"a": "note"}, "items": []}, "zz": {"notes": {"a": "x"}, "items": []}}}, "a", 8)
check("n1" in st["plans"] and "zz" not in st["plans"], "apply_partial : programme créé, identifiant invalide ignoré")
apply_partial(st, {"plans": {"n1": {"notes": {"a": ""}, "items": []}}}, "a", 9)
check("n1" not in st["plans"], "apply_partial : programme vide supprimé")
apply_partial(st, {"trip": {"base": {"name": "Llanes", "lat": 43.4, "lon": -4.7}, "start": "2026-09-20", "auto": 1, "autoBy": "zz", "days": [{"stops": [{"t": "s", "id": "n1"}]}]}, "prefs": {"perDay": 3, "bad": {"x": 1}}}, "a", 10)
check(st["trip"]["base"]["name"] == "Llanes" and st["trip"]["start"] == "2026-09-20" and st["trip"]["auto"] is True and st["trip"]["autoBy"] is None and len(st["trip"]["days"]) == 1 and st["prefs"] == {"perDay": 3}, "apply_partial : séjour et préférences validés")
apply_partial(st, {"trip": {"start": "hier", "base": {"lat": True, "lon": 1}}}, "a", 11)
check(st["trip"]["start"] is None and st["trip"]["base"] is None, "apply_partial : date et coordonnées invalides → vides")

print("ÉCHECS :", fails)
sys.exit(1 if fails else 0)
