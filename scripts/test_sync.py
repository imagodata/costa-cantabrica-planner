"""Test du serveur de synchronisation : fusion partielle, 409, journal, prefs. Lancer depuis la racine : python3 scripts/test_sync.py"""
import json, os, subprocess, sys, time, urllib.request, tempfile
port = 8097
data = os.path.join(tempfile.mkdtemp(), 'state.json')
env = dict(os.environ, COSTA_DATA=data, COSTA_PORT=str(port), COSTA_USERS='simon:a,marie:b')
srv = subprocess.Popen([sys.executable, 'server/costa_sync.py'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.6)
def call(method, user, body=None, version=None):
    req = urllib.request.Request(f'http://127.0.0.1:{port}/api/state', method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header('X-User', user); req.add_header('Content-Type', 'application/json')
    if version is not None: req.add_header('If-Match', str(version))
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read())
fails = 0
def check(cond, msg):
    global fails
    print(('OK  ' if cond else 'FAIL') + ' ' + msg)
    if not cond: fails += 1
try:
    st = call('GET', 'simon')[1]
    check(st['version'] == 0 and st['me'] == 'a' and st['log'] == [], 'état vide, me=a')
    # simon : envies + programme + séjour partiel
    c, st = call('PUT', 'simon', {'users': {'a': {'name': 'Simon', 'wish': ['n1', 'n2']}}, 'plans': {'n1': {'notes': {'a': 'ma note', 'b': 'FAUX'}, 'items': [{'poi': 'n77', 'by': 'a'}]}},
                                   'trip': {'base': {'name': 'Llanes', 'lat': 43.4, 'lon': -4.7}}, 'prefs': {'perDay': 3}, 'log': [{'text': 'a ajouté X à ses envies'}]}, version=0)
    check(c == 200 and st['version'] == 1, 'écriture partielle acceptée')
    check(st['users']['a']['wish'] == ['n1', 'n2'] and st['plans']['n1']['notes'] == {'a': 'ma note', 'b': ''}, "note de l'autre non écrasable")
    check(st['trip']['base']['name'] == 'Llanes' and st['trip']['days'] == [] and st['prefs'] == {'perDay': 3}, 'séjour partiel : base seule modifiée')
    check(len(st['log']) == 1 and st['log'][0]['by'] == 'a' and st['log'][0]['name'] == 'Simon' and st['log'][0]['v'] == 1, 'journal signé et numéroté par le serveur')
    # marie : ne peut écrire que sa liste ; ajoute un complément et sa note au même programme
    c, st = call('PUT', 'marie', {'users': {'b': {'name': 'Marie', 'wish': ['n1']}, 'a': {'name': 'Pirate', 'wish': []}}, 'plans': {'n1': {'notes': {'a': 'VOL', 'b': 'note marie'}, 'items': [{'poi': 'n77', 'by': 'a'}, {'text': 'kayak', 'by': 'b'}]}}}, version=1)
    check(c == 200 and st['users']['a']['wish'] == ['n1', 'n2'] and st['users']['a']['name'] == 'Pirate', "liste de simon intacte, prénom corrigeable")
    p = st['plans']['n1']
    check(p['notes'] == {'a': 'ma note', 'b': 'note marie'} and [i.get('poi') or i.get('text') for i in p['items']] == ['n77', 'kayak'], 'programme fusionné : notes séparées, compléments réunis')
    # simon retire son complément sans connaître le kayak de marie (corps basé sur une ancienne vue) → 409 d'abord
    c, old = call('PUT', 'simon', {'plans': {'n1': {'notes': {'a': 'ma note'}, 'items': []}}}, version=1)
    check(c == 409 and old['version'] == 2, 'conflit de version signalé avec l\'état courant')
    c, st = call('PUT', 'simon', {'plans': {'n1': {'notes': {'a': 'ma note'}, 'items': []}}}, version=2)
    check(c == 200 and [i.get('text') for i in st['plans']['n1']['items']] == ['kayak'], 'retrait de mon complément, celui de marie conservé')
    # marie retire son kayak : simon ne l'avait pas → le programme vide disparaît (note a reste → conservé)
    c, st = call('PUT', 'marie', {'plans': {'n1': {'notes': {'b': ''}, 'items': []}}}, version=3)
    check(c == 200 and st['plans']['n1']['items'] == [] and st['plans']['n1']['notes']['a'] == 'ma note', 'retrait par son auteur ; note de simon conservée')
    c, st = call('PUT', 'simon', {'plans': {'n1': None}}, version=4)
    check(c == 200 and 'n1' not in st['plans'], 'suppression explicite')
    # jours : remplacement, validation
    c, st = call('PUT', 'marie', {'trip': {'days': [{'stops': [{'t': 's', 'id': 'n1'}, {'t': 'x', 'text': 'marché'}, {'t': 'zz'}]}], 'autoBy': 'b', 'auto': True}}, version=5)
    check(c == 200 and st['trip']['days'] == [{'stops': [{'t': 's', 'id': 'n1'}, {'t': 'x', 'text': 'marché'}]}] and st['trip']['autoBy'] == 'b' and st['trip']['base']['name'] == 'Llanes', 'jours validés, base conservée')
    c, st = call('PUT', 'inconnu', {'users': {}}, version=6)
    check(c == 403, 'utilisateur inconnu refusé')
    # corps malformés : 400 sans casser le service ; écriture vide : version inchangée ; prénom seul : envies conservées
    c, st = call('PUT', 'simon', {'plans': {'n1': {'notes': [1, 2], 'items': []}}}, version=6)
    check(c == 200 and st['version'] == 6, 'notes malformées tolérées sans changement')
    c, st = call('PUT', 'simon', {'trip': {'days': 'abc'}}, version=6)
    check(c == 200 and st['version'] == 6, 'jours non-liste ignorés, version inchangée')
    c, st = call('PUT', 'simon', {}, version=6)
    check(c == 200 and st['version'] == 6, 'écriture sans effet : pas de version incrémentée')
    c, st = call('PUT', 'simon', {'users': {'a': {'name': 'Simón'}}}, version=6)
    check(c == 200 and st['version'] == 7 and st['users']['a']['wish'] == ['n1', 'n2'] and st['users']['a']['name'] == 'Simón', 'prénom seul : liste d\'envies conservée')
    c, st = call('PUT', 'simon', {'trip': {'base': {'name': 'x', 'lat': True, 'lon': False}}}, version=7)
    check(c == 200 and st['trip']['base'] is None, 'booléens refusés comme coordonnées')
    c, st = call('PUT', 'simon', {'trip': {'days': [{'stops': [{'t': 's', 'id': 'n1', 'lock': True}, {'t': 'x', 'text': 'marché', 'lock': 'oui'}]}]}}, version=8)
    check(c == 200 and st['trip']['days'][0]['stops'][0].get('lock') is True and 'lock' not in st['trip']['days'][0]['stops'][1], 'verrou d\'étape conservé (booléen strict)')
    # propositions : simon propose à marie (écrit users.b.suggest) ; marie ne peut pas écrire sa propre liste suggest
    c, st = call('PUT', 'simon', {'users': {'b': {'suggest': ['n9']}}}, version=9)
    check(c == 200 and st['users']['b']['suggest'] == ['n9'] and st['users']['b']['wish'] == ['n1'], 'proposition écrite chez l\'autre, ses envies intactes')
    c, st = call('PUT', 'marie', {'users': {'b': {'name': 'Marie', 'wish': ['n1'], 'suggest': ['n9', 'zzz']}}}, version=10)
    check(c == 200 and st['users']['b']['suggest'] == ['n9'], 'le destinataire ne peut pas s\'ajouter de propositions')
    c, st = call('PUT', 'marie', {'users': {'b': {'name': 'Marie', 'wish': ['n1', 'n9'], 'suggest': ['n9']}}}, version=10)   # l'appel précédent n'a rien changé : version inchangée
    check(c == 200 and st['users']['b']['suggest'] == [] and 'n9' in st['users']['b']['wish'], 'accepter : une plage en envie sort des propositions')
    # persistance : relecture
    st = call('GET', 'marie')[1]
    check(st['version'] == 11 and st['me'] == 'b' and len(st['log']) == 1, 'état relu, journal persistant')
finally:
    srv.terminate()
print('ÉCHECS :', fails); sys.exit(1 if fails else 0)
