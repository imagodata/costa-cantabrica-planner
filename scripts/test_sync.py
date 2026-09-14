"""Test du serveur de synchronisation : fusion partielle, 409, journal, prefs. Lancer depuis la racine : python3 scripts/test_sync.py"""
import json, os, subprocess, sys, time, urllib.request, tempfile
port = 8097
data = os.path.join(tempfile.mkdtemp(), 'state.json')
env = dict(os.environ, COSTA_DB=os.path.join(os.path.dirname(data), 'costa.db'), COSTA_DATA=data, COSTA_PORT=str(port), COSTA_USERS='simon:a,marie:b')
srv = subprocess.Popen([sys.executable, 'server/costa_sync.py'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.6)
def call(method, user, body=None, version=None, path='/api/state', token=None, headers=None):
    req = urllib.request.Request(f'http://127.0.0.1:{port}{path}', method=method, data=json.dumps(body).encode() if body is not None else None)
    if user: req.add_header('X-User', user)
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    if version is not None: req.add_header('If-Match', str(version))
    for k, v in (headers or {}).items(): req.add_header(k, v)
    try:
        with urllib.request.urlopen(req) as r: return r.status, (json.loads(r.read()) if r.status != 204 else {'_headers': dict(r.headers)})
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
    check(isinstance(st.get('workspace'), dict) and len(st['workspace'].get('invite', '')) == 8, 'séjour hérité : code d\'invitation exposé')
    # comptes et séjours partagés
    c, r = call('POST', None, {'email': 'ana@example.org', 'name': 'Ana', 'password': 'court'}, path='/api/auth/register')
    check(c == 400, 'inscription : mot de passe trop court refusé')
    c, r = call('POST', None, {'email': 'ana@example.org', 'name': 'Ana', 'password': 'motdepasse1'}, path='/api/auth/register')
    check(c == 201 and r['user']['name'] == 'Ana' and len(r['token']) > 20, 'inscription : jeton délivré'); ta = r['token']
    c, r = call('POST', None, {'email': 'ana@example.org', 'name': 'Ana', 'password': 'motdepasse1'}, path='/api/auth/register')
    check(c == 409, 'inscription : adresse déjà utilisée')
    c, r = call('POST', None, {'email': 'ana@example.org', 'password': 'faux'}, path='/api/auth/login')
    check(c == 401, 'connexion : mot de passe faux refusé')
    c, r = call('POST', None, {'email': 'ANA@example.org', 'password': 'motdepasse1'}, path='/api/auth/login')
    check(c == 200 and r['user']['id'], 'connexion : adresse insensible à la casse')
    c, r = call('POST', None, {'email': 'bo@example.org', 'name': 'Bo', 'password': 'motdepasse2'}, path='/api/auth/register'); tb = r['token']
    c, r = call('GET', None, path='/api/w/nope/state', token=ta)
    check(c == 403, 'séjour : accès refusé aux non-membres')
    c, r = call('POST', None, {'name': 'Asturies 2026'}, path='/api/workspaces', token=ta)
    check(c == 201 and r['workspace']['slot'] == 'a' and len(r['workspace']['invite']) == 8, 'séjour créé, créateur voyageur 1'); ws = r['workspace']
    c, r = call('POST', None, {'code': 'ZZZZZZZZ'}, path='/api/workspaces/join', token=tb)
    check(c == 404, 'rejoindre : code inconnu')
    c, r = call('POST', None, {'code': ws['invite'].lower()}, path='/api/workspaces/join', token=tb)
    check(c == 200 and r['workspace']['slot'] == 'b' and [m['name'] for m in r['workspace']['members']] == ['Ana', 'Bo'], 'rejoindre : voyageur 2, membres listés')
    c, r = call('POST', None, {'email': 'cy@example.org', 'name': 'Cy', 'password': 'motdepasse3'}, path='/api/auth/register'); tc = r['token']
    c, r = call('POST', None, {'code': ws['invite']}, path='/api/workspaces/join', token=tc)
    check(c == 409, 'rejoindre : séjour complet refusé')
    c, r = call('GET', None, path=f"/api/w/{ws['id']}/state", token=tb)
    check(c == 200 and r['me'] == 'b' and r['users']['a']['name'] == 'Ana' and r['users']['b']['name'] == 'Bo', 'état du séjour : prénoms des comptes, ma place')
    v = r['version']
    c, r = call('PUT', None, {'users': {'b': {'name': 'Bo', 'wish': ['n5']}}, 'log': [{'text': 'a ajouté X à ses envies'}]}, version=v, path=f"/api/w/{ws['id']}/state", token=tb)
    check(c == 200 and r['users']['b']['wish'] == ['n5'] and r['log'][-1]['name'] == 'Bo', 'écriture par jeton fusionnée et journalisée')
    c, r = call('PUT', None, {'users': {'a': {'wish': ['n9']}}}, version=r['version'], path=f"/api/w/{ws['id']}/state", token=tb)
    check(c == 200 and r['users']['a']['wish'] == [], 'un membre n\'écrit pas la liste de l\'autre')
    c, r = call('GET', None, path='/api/me', token=ta)
    check(c == 200 and [w['name'] for w in r['workspaces']] == ['Asturies 2026'] and r['workspaces'][0]['slot'] == 'a', '/api/me : séjours du compte')
    c, r = call('OPTIONS', None, path='/api/me', headers={'Origin': 'https://imagodata.github.io'})
    check(c == 204 and r['_headers'].get('Access-Control-Allow-Origin') == 'https://imagodata.github.io', 'CORS : origine GitHub Pages admise')
    c, r = call('GET', None, path='/api/me', token=ta, headers={'Origin': 'https://evil.example'})
    check(c == 200 and 'Access-Control-Allow-Origin' not in json.dumps(r), 'CORS : origine inconnue sans en-tête')
    c, r = call('POST', None, {}, path='/api/auth/logout', token=tb)
    c, r = call('GET', None, path='/api/me', token=tb)
    check(c == 401, 'déconnexion : jeton invalidé')
    c, r = call('GET', None, path=f"/api/w/{ws['id']}", token=ta)
    check(c == 200 and r['workspace']['members'][1]['name'] == 'Bo', 'fiche du séjour')
finally:
    srv.terminate()
print('ÉCHECS :', fails); sys.exit(1 if fails else 0)
