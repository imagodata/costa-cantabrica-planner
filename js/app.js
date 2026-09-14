/* Application : carte, liste classée, fiche détail, filtres, deux voyageurs, partage.
   FICHIER GÉNÉRÉ par scripts/build_app.py à partir de js/src/*.js : modifier les sources, puis `make build`. */
(function () {
  /* ==================== 00-state.js ==================== */
  const C = CCP.CONFIG, F = CCP.forecast, I = CCP.icon;
  let LS_STATE = 'ccp:state:v' + C.version;   // suffixé par le séjour quand un compte est connecté
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEFAULT_NAMES = ['Simon', 'Marie'];

  let assetVer = '', poisLoading = null;
  /* Les lieux (1,3 Mo) ne sont chargés qu'au premier besoin : zoom suffisant, fiche, séjour. */
  function ensurePois() {
    if (state.pois.length || poisLoading) return poisLoading || Promise.resolve();
    poisLoading = fetch('data/pois.geojson?v=' + assetVer).then((r) => (r.ok ? r.json() : { features: [] })).catch(() => ({ features: [] }))
      .then((pois) => { state.pois = (pois.features || []).map((f) => ({ id: f.properties.id, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], p: f.properties })); poisLoading = null; });
    return poisLoading;
  }
  const state = {
    region: null,
    spots: [], photos: {}, pois: [], bulk: null, day: 0, profile: 'plage', selected: null, userPos: null,
    poiOn: { food: true, visit: true },
    view: 'explore', wishWho: 'all', wishSort: 'coast', plans: {},
    trip: { base: null, start: null, days: [], auto: false }, pickBase: false,
    prefs: { perDay: 2, radiusKm: 60, lunch: true, roundTrip: true, startHour: 10 },
    mapFilter: true,   // liste Explorer calée sur l'emprise visible de la carte
    filters: { province: 'all', type: 'all', surface: 'all', lifeguard: false, dog: false, minScore: 0, wish: 'all', q: '' },
    sort: 'score',
    users: { a: { name: DEFAULT_NAMES[0], wish: [], suggest: [] }, b: { name: DEFAULT_NAMES[1], wish: [], suggest: [] } },   // suggest : plages proposées à ce voyageur par l'autre
    me: 'a',
    fresh: new Set(),   // envies de l'autre reçues depuis la dernière consultation de l'onglet Envies
  };
  const scoreCache = new Map();
  let baseLayers = null;
  let map, userMarker = null, sheet, detailData = null, detailDay = 0, detailReq = 0, listScroll = 0;
  const markers = new Map(), poiMarkers = new Map();
  let poiLayer = null, wishLayer = null, tripLayer = null, planLayer = null;
  const DAY_COLORS = ['#0b6e99', '#b45309', '#7c3aed', '#0a9396', '#d64545', '#4361ee', '#f0a202'];
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  /* Disposition : panneau latéral sur grand écran, en paysage bas et sur tablette (même requête que le CSS). */
  const SIDE_MQ = matchMedia('(min-width: 900px), (orientation: landscape) and (max-height: 500px) and (min-width: 640px)');
  const isMobile = () => !SIDE_MQ.matches;
  /* ==================== 10-utils.js ==================== */
  /* ------------------------------------------------------------------ utilitaires */
  const dayNames = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  function fmtDay(iso, i) {
    const d = new Date(iso + 'T12:00:00');
    return { lbl: i === 0 ? 'Auj.' : i === 1 ? 'Dem.' : dayNames[d.getDay()], sub: d.getDate() + '/' + (d.getMonth() + 1) };
  }
  const hmIso = (iso) => iso.slice(11, 16);
  const compass = (deg) => deg == null ? '' : ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(deg / 45) % 8];
  const arrow = (deg, size = 13) => deg == null ? '' : I('arrow', { size, rotate: deg });
  const wc = (code) => C.weatherCodes[code] || ['cloud', 'Inconnu'];
  const wIcon = (code, size = 16, cls = '') => I(wc(code)[0], { size, cls: cls || (code <= 2 ? 'sun' : 'mu') });
  const n1 = (v, u = '') => v == null ? '—' : (Math.round(v * 10) / 10).toLocaleString('fr-FR') + u;
  const n0 = (v, u = '') => v == null ? '—' : Math.round(v) + u;
  function distKm(a, b) {
    const R = 6371, p = Math.PI / 180, x = (b[0] - a[0]) * p, y = (b[1] - a[1]) * p;
    const h = Math.sin(x / 2) ** 2 + Math.cos(a[0] * p) * Math.cos(b[0] * p) * Math.sin(y / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const latlng = (s) => [s.geometry.coordinates[1], s.geometry.coordinates[0]];
  const photoOf = (id) => state.photos[id] || null;
  const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null);
  const surfaceLbl = (p) => p.surface ? (C.surfaces[p.surface] || p.surface) : null;
  /* Vue aérienne : mosaïque de tuiles satellite centrée sur le point (aucune bibliothèque). */
  const AERIAL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
  const AERIAL_CREDIT = 'Vue aérienne · Imagerie © Esri, Maxar, Earthstar Geographics';
  const PNOA_URL = 'https://www.ign.es/wmts/pnoa-ma?request=GetTile&service=WMTS&version=1.0.0&layer=OI.OrthoimageCoverage&style=default&format=image/jpeg&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}';
  const TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  function tilePx(lat, lon, z) {
    const n = 2 ** z, x = (lon + 180) / 360 * n, latR = lat * Math.PI / 180;
    const y = (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n;
    return { tx: Math.floor(x), ty: Math.floor(y), px: (x - Math.floor(x)) * 256, py: (y - Math.floor(y)) * 256 };
  }
  /* Mètres par pixel CSS au zoom z (Web Mercator). */
  const mpp = (lat, z) => 156543.03 * Math.cos(lat * Math.PI / 180) / 2 ** z;
  /* Zoom qui fait tenir la plage (diagonale size_m) dans environ 60 % de la largeur affichée, borné. */
  function aerialZoom(s, w, zmin, zmax, fill = 0.6) {
    const size = Math.max(60, s.properties.size_m || 200), lat = latlng(s)[0];
    const z = Math.log2(156543.03 * Math.cos(lat * Math.PI / 180) * fill * w / size);
    return Math.max(zmin, Math.min(zmax, Math.round(z)));
  }
  /* Sur écran haute densité, les tuiles sont demandées un niveau plus loin et affichées à moitié : image nette.
     Option scale : barre d'échelle. Les tuiles apparaissent en fondu une fois chargées. */
  function aerialHtml(lat, lon, z, w, h, cls = '', extra = '', { scale = false } = {}) {
    const hi = (window.devicePixelRatio || 1) >= 1.5, tz = hi ? z + 1 : z, ts = hi ? 128 : 256;
    const t = tilePx(lat, lon, tz), k = ts / 256, cx = w / 2 - t.px * k, cy = h / 2 - t.py * k;
    const r = Math.ceil(Math.max(w, h) / ts) + 1;
    let imgs = '';
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const left = cx + dx * ts, top = cy + dy * ts;
      if (left > w || top > h || left + ts < 0 || top + ts < 0) continue;
      imgs += `<img src="${AERIAL}/${tz}/${t.ty + dy}/${t.tx + dx}" alt="" loading="lazy" decoding="async" onload="this.classList.add('ld')" style="left:${Math.round(left)}px;top:${Math.round(top)}px;width:${ts}px;height:${ts}px">`;
    }
    let bar = '';
    if (scale) { const m = mpp(lat, z), len = [50, 100, 200, 500, 1000, 2000].find((L0) => L0 / m >= 44) || 2000; bar = `<span class="scalebar" style="width:${Math.round(len / m)}px">${len >= 1000 ? len / 1000 + ' km' : len + ' m'}</span>`; }
    return `<div class="aerial ${cls}" style="width:${w}px;height:${h}px" ${extra}>${imgs}<i class="pinpt"></i>${bar}</div>`;
  }
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }

  function persistLocal() {
    try { localStorage.setItem(LS_STATE, JSON.stringify({ users: state.users, me: state.me, profile: state.profile, filters: state.filters, sort: state.sort,
      poiOn: state.poiOn, plans: state.plans, trip: state.trip, wishWho: state.wishWho, wishSort: state.wishSort, prefs: state.prefs, mapFilter: state.mapFilter })); } catch (e) { }
  }
  function save() { persistLocal(); syncPush(); }
  function restore() {
    try {
      const j = JSON.parse(localStorage.getItem(LS_STATE) || 'null'); if (!j) return;
      if (j.users) for (const k of ['a', 'b']) if (j.users[k]) state.users[k] = { name: String(j.users[k].name || DEFAULT_NAMES[k === 'a' ? 0 : 1]).slice(0, 14) || DEFAULT_NAMES[k === 'a' ? 0 : 1], wish: Array.isArray(j.users[k].wish) ? j.users[k].wish.filter((x) => typeof x === 'string') : [], suggest: Array.isArray(j.users[k].suggest) ? j.users[k].suggest.filter((x) => typeof x === 'string') : [] };
      if (j.me) state.me = j.me;
      if (j.profile && C.profiles[j.profile]) state.profile = j.profile;
      if (j.filters) Object.assign(state.filters, j.filters);
      if (j.sort) state.sort = j.sort === 'dist' ? 'score' : j.sort;   // la position n'est pas mémorisée : ce tri n'a de sens qu'après « Ma position »
      if (j.poiOn) Object.assign(state.poiOn, j.poiOn);
      if (j.plans) state.plans = j.plans;
      if (j.wishWho) state.wishWho = j.wishWho;
      if (j.wishSort) state.wishSort = j.wishSort;
      if (j.trip && Array.isArray(j.trip.days)) state.trip = { auto: false, ...j.trip };
      if (j.prefs) Object.assign(state.prefs, j.prefs);
      if (typeof j.mapFilter === 'boolean') state.mapFilter = j.mapFilter;
    } catch (e) { }
  }
  /* ==================== 15-share.js ==================== */
  /* ------------------------------------------------------------------ partage (lien) */
  const b64e = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64d = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
  function shareUrl() {
    const pl = {};
    for (const [id, pn] of Object.entries(state.plans)) if (pn.items.length || pn.notes.a || pn.notes.b) pl[id] = { n: pn.notes, i: pn.items.map((it) => [it.poi || ('t:' + it.text), it.by]) };
    const tr = state.trip.days.some((d) => d.stops.length) || state.trip.base
      ? { b: state.trip.base, s: state.trip.start, a: state.trip.auto ? 1 : 0, d: state.trip.days.map((d) => d.stops.map((st) => st.lock ? [st.t, st.id || st.text, 1] : [st.t, st.id || st.text])) } : undefined;
    const p = { na: state.users.a.name, nb: state.users.b.name, a: state.users.a.wish, b: state.users.b.wish, sa: state.users.a.suggest, sb: state.users.b.suggest, d: state.day, p: state.profile, s: state.selected, pl, tr };
    return location.origin + location.pathname + '#share=' + b64e(JSON.stringify(p));
  }
  const spotBySlug = (slug) => state.spots.find((s) => s.properties.slug === slug);
  const APP_DIR = location.pathname.replace(/[^/]*$/, '');
  const spotUrl = (s) => location.origin + APP_DIR + 's/' + s.properties.slug + '.html';
  async function shareSpot(s) {
    const url = spotUrl(s), p = s.properties, r = state.bulk ? scoreOf(s) : null;
    const text = `${p.name} (${p.type === 'cala' ? 'crique' : 'plage'}, ${p.province})${r && r.score != null ? ` · ${r.score}/100 ${r.label} ${fmtDay(state.bulk.dates[state.day], state.day).lbl.toLowerCase()}` : ''}`;
    try { if (navigator.share) { await navigator.share({ title: p.name, text, url }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast('Lien de la plage copié'); } catch (e) { prompt('Copiez ce lien :', url); }
  }
  function applyRoute() {
    const mp = location.hash.match(/^#poi=([nwr]\d+)$/);
    if (mp) { ensurePois().then(() => { const x = poiById(mp[1]); if (x && currentPoi !== x.id) showPoi(x, { fromHistory: true }); }); return 'poi'; }
    const m = location.hash.match(/^#([a-z0-9-]+)$/);
    if (!m) return false;
    const s = spotBySlug(m[1]); if (!s) return false;
    state.selected = s.properties.id; return true;
  }
  /* ==================== 20-sync.js ==================== */
  /* ------------------------------------------------------------------ synchronisation serveur (version connectée)
     Le client garde le dernier état serveur connu (base) et n'envoie que la différence : sa liste
     d'envies, les programmes touchés, les champs du séjour modifiés, les préférences. Le serveur fusionne
     clé par clé (voir server/costa_sync.py). En cas de conflit de version (409), la différence locale
     est rejouée sur l'état reçu puis renvoyée : rien n'est perdu. Hors ligne, la différence attend
     (persistée) et repart au retour du réseau ou au lancement suivant. */
  let LS_SYNC = 'ccp:sync:v' + C.version;
  /* ------------------------------------------------------------------ compte et séjour partagé (jeton porteur)
     auth = { token, user:{id,name,email}, ws:{id,name,slot,invite,members} } dans localStorage ; la page de
     connexion l'écrit. Sans compte, le mode hérité (Caddy, /whoami) ou le mode local s'appliquent. */
  const LS_AUTH = 'ccp:auth:v1';
  let auth = null;
  const api = (p) => (C.apiBase ? C.apiBase.replace(/\/$/, '') + '/' + p : p);
  const authHeaders = () => (auth && auth.token ? { Authorization: 'Bearer ' + auth.token } : {});
  function restoreAuth() {
    try { const j = JSON.parse(localStorage.getItem(LS_AUTH) || 'null'); if (j && typeof j.token === 'string' && j.user && j.ws && j.ws.id) auth = j; else if (j && typeof j.token === 'string' && j.user && !/[#&]reset\b/.test(location.hash)) { location.replace('login.html'); return; } } catch (e) { }   // connecté sans séjour choisi : retour au choix
    const suffix = auth ? ':' + auth.ws.id : '';
    LS_STATE = 'ccp:state:v' + C.version + suffix; LS_SYNC = 'ccp:sync:v' + C.version + suffix;
  }
  const saveAuth = () => { try { if (auth) localStorage.setItem(LS_AUTH, JSON.stringify(auth)); else localStorage.removeItem(LS_AUTH); } catch (e) { } };
  async function logout() {
    try { if (auth) await fetch(api('api/auth/logout'), { method: 'POST', headers: authHeaders() }); } catch (e) { }
    try { localStorage.removeItem(LS_STATE); localStorage.removeItem(LS_SYNC); } catch (e) { }   // l'état du séjour ne reste pas sur un appareil partagé
    auth = null; saveAuth(); location.href = 'login.html';
  }
  const sync = { on: false, version: null, timer: null, pushing: false, dirty: false, poll: null, base: null, err: false, at: 0, log: [], pending: 0 };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const stable = (o) => Array.isArray(o) ? o.map(stable) : (o && typeof o === 'object') ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, stable(o[k])])) : o;
  const same = (a, b) => JSON.stringify(stable(a ?? null)) === JSON.stringify(stable(b ?? null));
  const EMPTY_BASE = () => ({ users: { a: { name: DEFAULT_NAMES[0], wish: [], suggest: [] }, b: { name: DEFAULT_NAMES[1], wish: [], suggest: [] } }, plans: {}, trip: { base: null, start: null, days: [], auto: false }, prefs: clone(state.prefs) });
  const snapshot = () => clone({ users: { a: { name: state.users.a.name, wish: state.users.a.wish, suggest: state.users.a.suggest || [] }, b: { name: state.users.b.name, wish: state.users.b.wish, suggest: state.users.b.suggest || [] } }, plans: state.plans, trip: state.trip, prefs: state.prefs });
  const saveSyncMeta = () => { try { localStorage.setItem(LS_SYNC, JSON.stringify({ version: sync.version, base: sync.base, fresh: [...state.fresh] })); } catch (e) { } };
  const validBase = (b) => !!(b && b.users && b.users.a && b.users.b && Array.isArray(b.users.a.wish) && Array.isArray(b.users.b.wish) && b.plans && typeof b.plans === 'object' && b.trip && Array.isArray(b.trip.days));
  const restoreSyncMeta = () => {
    try {
      const j = JSON.parse(localStorage.getItem(LS_SYNC) || 'null'); if (!j) return;
      const hasState = !!localStorage.getItem(LS_STATE);   // état local effacé (remise à zéro) : la base ne doit pas être rejouée comme une suppression
      if (hasState && typeof j.version === 'number' && validBase(j.base)) { sync.version = j.version; sync.base = j.base; }
      if (Array.isArray(j.fresh)) state.fresh = new Set(j.fresh.filter((x) => typeof x === 'string'));
    } catch (e) { }
  };
  const nameOf = (id) => spotById(id)?.properties.name || 'une plage';
  const itemName = (it) => it.text || poiById(it.poi)?.p.name || 'un lieu';
  const emptyPlan = () => ({ notes: { a: '', b: '' }, items: [] });
  /* Différence entre l'état local et la base, avec un résumé lisible de chaque changement (journal). */
  function syncDiff(base) {
    base = base || EMPTY_BASE();
    const cur = snapshot(), me = state.me, other = me === 'a' ? 'b' : 'a', body = {}, log = [];
    let n = 0;
    if (cur.users[me].name !== base.users[me].name || !same(cur.users[me].wish, base.users[me].wish) || !same(cur.users[me].suggest, base.users[me].suggest || [])) {
      body.users = { [me]: { name: cur.users[me].name, wish: cur.users[me].wish, suggest: cur.users[me].suggest } }; n++;
      const was = new Set(base.users[me].wish || []), now = new Set(cur.users[me].wish);
      for (const id of cur.users[me].wish) if (!was.has(id)) log.push(`a ajouté ${nameOf(id)} à ses envies`);
      for (const id of base.users[me].wish || []) if (!now.has(id)) log.push(`a retiré ${nameOf(id)} de ses envies`);
      if (cur.users[me].name !== base.users[me].name) log.push(`s'appelle désormais ${cur.users[me].name}`);
    }
    if (cur.users[other].name !== base.users[other].name) { body.users = { ...(body.users || {}), [other]: { name: cur.users[other].name } }; n++; }
    if (!same(cur.users[other].suggest, base.users[other].suggest || [])) {   // ce que je propose à l'autre
      body.users = { ...(body.users || {}), [other]: { ...((body.users || {})[other] || {}), suggest: cur.users[other].suggest } }; n++;
      const was = new Set(base.users[other].suggest || []);
      for (const id of cur.users[other].suggest) if (!was.has(id)) log.push(`a proposé ${nameOf(id)} à ${cur.users[other].name}`);
    }
    const plans = {};
    const emptyP = (p) => !p || (!p.items.length && !p.notes.a && !p.notes.b);
    for (const id of new Set([...Object.keys(cur.plans), ...Object.keys(base.plans || {})])) {
      if (same(cur.plans[id], (base.plans || {})[id]) || (emptyP(cur.plans[id]) && emptyP((base.plans || {})[id]))) continue;
      plans[id] = cur.plans[id] || null; n++;
      const c = cur.plans[id] || emptyPlan(), b = (base.plans || {})[id] || emptyPlan(), key = (it) => it.poi || 't:' + it.text;
      const bk = new Set(b.items.map(key)), ck = new Set(c.items.map(key));
      for (const it of c.items) if (!bk.has(key(it))) log.push(`a ajouté ${itemName(it)} au programme de ${nameOf(id)}`);
      for (const it of b.items) if (!ck.has(key(it))) log.push(`a retiré ${itemName(it)} du programme de ${nameOf(id)}`);
      if ((c.notes[me] || '') !== (b.notes[me] || '')) log.push(`a ${c.notes[me] ? 'modifié' : 'effacé'} sa note sur ${nameOf(id)}`);
    }
    if (Object.keys(plans).length) body.plans = plans;
    const tr = {}, bt = base.trip || {};
    for (const f of ['base', 'start', 'auto', 'autoBy']) if (!same(cur.trip[f], bt[f])) { tr[f] = cur.trip[f] ?? null; n++; }
    if (!same(cur.trip.days, bt.days)) {
      tr.days = cur.trip.days; n++;
      const bd = bt.days || [];
      cur.trip.days.forEach((d, i) => { if (!same(d, bd[i])) log.push(`a modifié le jour ${i + 1} du séjour`); });
      if (cur.trip.days.length < bd.length) log.push(`a retiré ${bd.length - cur.trip.days.length} jour${bd.length - cur.trip.days.length > 1 ? 's' : ''} du séjour`);
    }
    if ('base' in tr) log.push(tr.base ? `a placé l'hébergement : ${tr.base.name}` : `a retiré l'hébergement`);
    if ('start' in tr && tr.start) log.push(`a fixé l'arrivée au ${tr.start.split('-').reverse().join('/')}`);
    if ('auto' in tr) log.push(tr.auto ? 'a activé le planning dynamique' : 'a figé le planning');
    if (Object.keys(tr).length) body.trip = tr;
    if (!same(cur.prefs, base.prefs)) { body.prefs = cur.prefs; n++; }
    return { body, log, n, cur, base };
  }
  /* Fusion d'un programme : ma note et mes compléments, la note et les compléments de l'autre tels que le serveur les connaît. */
  function mergePlan(local, server, me) {
    const other = me === 'a' ? 'b' : 'a', l = local || emptyPlan(), s = server || emptyPlan(), key = (it) => it.poi || 't:' + it.text;
    const sk = new Set(s.items.map(key)), lk = new Set(l.items.map(key));
    const items = [...l.items.filter((it) => it.by === me || sk.has(key(it))), ...s.items.filter((it) => it.by !== me && !lk.has(key(it)))];
    return { notes: { [me]: l.notes[me] || '', [other]: s.notes[other] || '' }, items };
  }
  /* Rejoue une différence locale sur l'état courant (après réception d'un état serveur). */
  function applyDiff({ body, cur, base }) {
    const me = state.me, other = me === 'a' ? 'b' : 'a', srv = sync.base || EMPTY_BASE(), bs = base || EMPTY_BASE();
    const delta = (k) => { const b = bs.users[k].suggest || [], c = cur.users[k].suggest || []; return { add: c.filter((x) => !b.includes(x)), rem: new Set(b.filter((x) => !c.includes(x))) }; };
    if (body.users && body.users[me]) {
      state.users[me].name = cur.users[me].name; state.users[me].wish = clone(cur.users[me].wish);
      const d = delta(me); state.users[me].suggest = (state.users[me].suggest || []).filter((x) => !d.rem.has(x));   // mes retraits seulement : une proposition reçue entre-temps reste
    }
    if (body.users && body.users[other] && body.users[other].name) state.users[other].name = body.users[other].name;
    if (body.users && body.users[other] && body.users[other].suggest) {   // mes ajouts et retraits ; les retraits de l'autre (accepté, ignoré) sont respectés
      const d = delta(other); state.users[other].suggest = [...new Set([...(state.users[other].suggest || []).filter((x) => !d.rem.has(x)), ...d.add])].filter((x) => !state.users[other].wish.includes(x)).slice(0, 100);
    }
    for (const [id, p] of Object.entries(body.plans || {})) { if (p) state.plans[id] = mergePlan(p, srv.plans[id], me); else delete state.plans[id]; }
    if (body.trip) for (const [f, v] of Object.entries(body.trip)) state.trip[f] = clone(v);
    if (body.prefs) Object.assign(state.prefs, clone(body.prefs));
  }
  const syncUrl = () => (auth ? api('api/w/' + auth.ws.id + '/state') : api('api/state'));
  const fetchSync = (opts = {}) => fetch(syncUrl(), { cache: 'no-store', ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) }, ...(typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(15000) } : {}) });
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const cleanUser = (u, fallback) => ({ name: String((u && u.name) || fallback.name).slice(0, 14), wish: arr(u && u.wish), suggest: arr(u && u.suggest) });
  const syncApply = (st) => {
    const me = state.me, other = me === 'a' ? 'b' : 'a';
    const known = new Set(sync.base ? (sync.base.users[other].wish || []) : (st.users[other].wish || []));   // sans base connue : rien n'est « nouveau »
    for (const id of st.users[other].wish || []) if (!known.has(id)) state.fresh.add(id);
    const knownS = new Set(sync.base ? (sync.base.users[me].suggest || []) : (st.users[me].suggest || []));   // propositions reçues
    for (const id of st.users[me].suggest || []) if (!knownS.has(id)) state.fresh.add(id);
    state.users[other] = cleanUser(st.users[other], state.users[other]);
    state.users[me] = cleanUser(st.users[me], state.users[me]);
    if (st.plans && typeof st.plans === 'object') state.plans = st.plans;
    if (st.trip && Array.isArray(st.trip.days)) state.trip = { auto: false, ...st.trip };
    if (st.prefs && typeof st.prefs === 'object') Object.assign(state.prefs, st.prefs);
    if (Array.isArray(st.log)) sync.log = st.log;
    if (st.workspace) { sync.ws = st.workspace; if (auth) { auth.ws = { ...auth.ws, ...st.workspace, slot: st.me || auth.ws.slot }; saveAuth(); } }
    sync.version = st.version; sync.at = Date.now();
    sync.base = clone({ users: { a: state.users.a, b: state.users.b }, plans: state.plans, trip: state.trip, prefs: state.prefs });
    saveSyncMeta();
  };
  async function syncLoad() {
    try {
      const r = await fetchSync(); if (!r.ok) return false;
      const st = await r.json(); if (!st || typeof st.version !== 'number') return false;
      if (st.me === 'a' || st.me === 'b') state.me = st.me;
      const local = sync.base ? syncDiff(sync.base) : null;   // modifications faites hors ligne ou avant une coupure : rejouées
      const first = sync.base ? null : snapshot();             // première connexion de cet appareil : son travail local est ajouté, jamais écrasé
      syncApply(st); sync.on = true; sync.err = false;
      if (local && local.n) { applyDiff(local); persistLocal(); syncPush(); }
      else if (first) mergeFirst(first);
      return true;
    } catch (e) { return false; }
  }
  function mergeFirst(loc) {
    const me = state.me, other = me === 'a' ? 'b' : 'a';
    state.users[me].wish = [...new Set([...state.users[me].wish, ...loc.users[me].wish])].slice(0, 500);
    if (!state.users[other].wish.length && loc.users[other].wish.length) state.users[other].wish = loc.users[other].wish.slice(0, 500);   // séjour partagé encore vide côté autre : ses envies saisies en mode local
    state.users[other].suggest = [...new Set([...(state.users[other].suggest || []), ...(loc.users[other].suggest || [])])].filter((id) => !state.users[other].wish.includes(id)).slice(0, 100);
    for (const [id, p] of Object.entries(loc.plans)) if (p && (p.items.length || p.notes[me])) state.plans[id] = mergePlan(p, state.plans[id], me);
    if (!state.trip.days.some((d) => d.stops.length) && loc.trip.days.some((d) => d.stops.length)) state.trip = { ...state.trip, start: loc.trip.start, days: loc.trip.days };
    if (!state.trip.base && loc.trip.base) state.trip.base = loc.trip.base;
    if (syncDiff(sync.base).n) { persistLocal(); syncPush(); toast('Vos envies et programmes locaux ont été ajoutés au séjour partagé'); }
  }
  function syncPush() {
    if (!sync.on) return;
    sync.dirty = true; clearTimeout(sync.timer); sync.timer = setTimeout(syncFlush, 700);
  }
  let flushWaits = 0;
  async function syncFlush() {
    if (!sync.on || sync.pushing) return;
    if (!state.spots.length && flushWaits++ < 20) { clearTimeout(sync.timer); sync.timer = setTimeout(syncFlush, 800); return; }   // les noms de plages servent au journal
    const diff = syncDiff(sync.base);
    if (!diff.n) { sync.dirty = false; sync.pending = 0; renderSyncDot(); return; }
    sync.pushing = true; sync.dirty = false;
    try {
      const body = { ...diff.body, log: diff.log.slice(0, 6).map((text) => ({ text })) };
      const r = await fetchSync({ method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': String(sync.version) }, body: JSON.stringify(body) });
      if (r.status === 409) {   // l'autre a écrit entre-temps : son état, puis ma différence (y compris ce qui a été saisi pendant l'envoi), puis renvoi
        const st = await r.json(); sync.pushing = false;
        const late = syncDiff(sync.base);
        syncApply(st); applyDiff(late); persistLocal(); rerenderAll({ soft: true }); syncPush(); return;
      }
      if (r.status === 401) { sync.on = false; sync.err = true; sync.dirty = true; if (auth) { auth = null; saveAuth(); toast('Session expirée : reconnectez-vous'); setTimeout(() => { location.href = 'login.html'; }, 1500); } return; }   // rien n'est perdu : la différence attend
      if (r.status === 429) { sync.err = true; sync.dirty = true; return; }   // réessai au prochain sondage
      if (r.status === 403) { sync.on = false; sync.err = true; toast(auth ? 'Vous ne faites plus partie de ce séjour' : 'Ce compte n\'est pas connu du serveur de synchronisation'); return; }
      if (r.status === 413) { sync.err = true; sync.dirty = false; sync.pending = diff.n; toast('Séjour trop volumineux : retirez des programmes ou des notes'); return; }   // réessai à la prochaine modification seulement
      if (r.status >= 400 && r.status < 500) { sync.base = diff.cur; toast('Modification refusée par le serveur'); return; }   // définitif : on n'insiste pas
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const st = await r.json();
      const late = syncDiff(diff.cur), before = snapshot();   // saisi pendant l'envoi
      syncApply(st); applyDiff(late); sync.err = false;   // la base reflète les normalisations du serveur (troncatures, programmes vides retirés)
      if (!same(before, snapshot())) { persistLocal(); rerenderAll({ soft: true }); }
    } catch (e) { sync.err = true; sync.dirty = true; }
    finally { sync.pushing = false; }
    sync.pending = sync.dirty ? syncDiff(sync.base).n : 0; renderSyncDot();
    if (sync.dirty && !sync.err) syncPush();
  }
  const isTyping = () => { const a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.closest('#sheet')); };
  async function syncPoll() {
    if (document.hidden) return;
    if (!sync.on) { if (state.serverUser && await syncLoad()) { rerenderAll(); renderWho(); } return; }
    if (sync.pushing) return;
    if (sync.dirty) { syncFlush(); return; }
    try {
      const r = await fetchSync();
      if (r.status === 401 && auth) { sync.on = false; auth = null; saveAuth(); toast('Session expirée : reconnectez-vous'); setTimeout(() => { location.href = 'login.html'; }, 1500); return; }
      if (r.status === 403 && auth) { sync.on = false; sync.err = true; renderSyncDot(); toast('Vous ne faites plus partie de ce séjour'); return; }
      if (!r.ok) { sync.err = true; renderSyncDot(); return; }
      const st = await r.json(); sync.err = false; sync.at = Date.now();
      if (st.version !== sync.version) {
        if (isTyping() || sync.dirty || sync.pushing) { renderSyncDot(); return; }   // saisie en cours ou envoi en attente : au prochain sondage
        const seen = sync.version;
        syncApply(st); persistLocal(); rerenderAll();
        const news = sync.log.filter((e) => (e.v || 0) > seen && e.by !== state.me);
        if (news.length) { const last = news[news.length - 1]; toast(`${last.name} ${last.text}${news.length > 1 ? ` (+${news.length - 1})` : ''}`); }
        else toast(`Mis à jour par ${st.by === state.serverUser ? 'vous' : (st.by || 'l\'autre voyageur')}`);
      }
      renderSyncDot();
    } catch (e) { sync.err = true; renderSyncDot(); }
  }
  function syncOnline() { if (!state.serverUser) return; if (sync.dirty) syncFlush(); else syncPoll(); }
  const ago = (ms) => { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); if (s < 60) return `il y a ${s} s`; if (s < 3600) return `il y a ${Math.round(s / 60)} min`; if (s < 86400) return `il y a ${Math.round(s / 3600)} h`; const d = new Date(ms); return `le ${d.getDate()}/${d.getMonth() + 1} à ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  function syncStatusText() {
    if (!sync.on) return state.serverUser ? (auth ? 'Séjour inaccessible ou serveur injoignable : les modifications restent sur cet appareil' : 'Serveur injoignable : les modifications restent sur cet appareil') : 'Version sans serveur';
    const pend = sync.pending ? ` · ${sync.pending} modification${sync.pending > 1 ? 's' : ''} en attente` : '';
    if (sync.err) return (navigator.onLine === false ? 'Hors ligne' : 'Serveur injoignable') + pend;
    if (sync.pending) return `${sync.pending} modification${sync.pending > 1 ? 's' : ''} à envoyer`;
    return `Synchronisé ${sync.at ? ago(sync.at) : ''}`.trim();
  }
  function renderSyncDot() {
    const d = $('#sync-dot'); if (!d) return;
    d.classList.toggle('err', !sync.on || sync.err); d.classList.toggle('pending', sync.on && !sync.err && (sync.dirty || sync.pending > 0));
    d.parentElement.title = syncStatusText();
  }
  function rerenderAll({ soft = false } = {}) {
    renderTabs(); renderWho();
    if (soft && isTyping()) { paintMarkers(); return; }
    if (state.selected && !$('#panel-detail').hidden) { renderDetailHead(); renderDetailDay(detailDay); }
    else if (state.view === 'wishes') renderWishes(); else if (state.view === 'trip') renderTrip(); else if (state.view === 'config') renderConfig(); else renderList({ keep: true });
    paintMarkers();
  }
  const canEdit = (who) => !state.serverUser || who === state.me;
  /* Version protégée (VPS) : l'utilisateur authentifié (/whoami) devient le voyageur actif ; le serveur
     renvoie le voyageur correspondant (me) dans l'état. Le sondage reprend aussi la synchro si le serveur
     était injoignable au lancement. */
  async function applyServerIdentity() {
    if (auth) {   // compte : la session est vérifiée, puis l'état du séjour chargé
      try {
        const r = await fetch(api('api/me'), { cache: 'no-store', headers: authHeaders() });
        if (r.status === 401) { auth = null; saveAuth(); toast('Session expirée : reconnectez-vous'); setTimeout(() => { location.href = 'login.html'; }, 1200); return; }
        if (r.ok) {
          const me = await r.json(); auth.user = me.user;
          const w = (me.workspaces || []).find((x) => x.id === auth.ws.id);
          if (!w) { auth.ws = null; saveAuth(); toast('Ce séjour n\'est plus accessible : choisissez-en un autre'); setTimeout(() => { location.href = 'login.html'; }, 1500); return; }
          auth.ws = { ...auth.ws, ...w }; saveAuth();
        }
      } catch (e) { /* hors ligne : on continue avec la session mémorisée */ }
      state.serverUser = auth.user.name; state.me = auth.ws.slot === 'b' ? 'b' : 'a';
      restoreSyncMeta();
      await syncLoad();
      sync.poll = setInterval(syncPoll, 20000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) syncPoll(); });
      return;
    }
    try {   // mode hérité : Caddy transmet l'utilisateur authentifié
      const r = await fetch('whoami', { cache: 'no-store' });
      if (!r.ok) return;
      const id = (await r.text()).trim().toLowerCase();
      if (!id || id.includes('<')) return;
      state.serverUser = id;
      restoreSyncMeta();
      await syncLoad();
      if (!sync.on) { const k = id === 'marie' ? 'b' : id === 'simon' ? 'a' : id === state.users.b.name.toLowerCase() ? 'b' : id === state.users.a.name.toLowerCase() ? 'a' : null; if (k) state.me = k; }
      sync.poll = setInterval(syncPoll, 20000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) syncPoll(); });
    } catch (e) { /* version publique : pas de serveur */ }
  }
  /* #view=explore|wishes|trip|config ouvre directement une vue (combinable : #share=…&view=explore). */
  function applyViewParam() {
    const m = location.hash.match(/[#&]view=(explore|wishes|trip|config)/);
    if (m) { state.view = m[1]; return true; }
    return false;
  }
  function applyShare() {
    const m = location.hash.match(/#share=([A-Za-z0-9_-]+)/); if (!m) return false;
    try {
      const p = JSON.parse(b64d(m[1]));
      const merge = (k, list) => { state.users[k].wish = [...new Set([...(state.users[k].wish || []), ...(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [])])].slice(0, 500); };
      merge('a', p.a); merge('b', p.b);
      for (const k of ['a', 'b']) state.users[k].suggest = [...new Set([...(state.users[k].suggest || []), ...(Array.isArray(p['s' + k]) ? p['s' + k].filter((x) => typeof x === 'string') : [])])].filter((id) => !state.users[k].wish.includes(id)).slice(0, 100);
      const cleanName = (v) => String(v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14);
      if (p.na && DEFAULT_NAMES.includes(state.users.a.name) && cleanName(p.na)) state.users.a.name = cleanName(p.na);
      if (p.nb && DEFAULT_NAMES.includes(state.users.b.name) && cleanName(p.nb)) state.users.b.name = cleanName(p.nb);
      if (Number.isInteger(p.d)) state.day = Math.max(0, Math.min(C.forecastDays - 1, p.d));
      if (p.p && C.profiles[p.p]) state.profile = p.p;
      if (typeof p.s === 'string') state.selected = p.s.slice(0, 20);
      for (const [id, v] of Object.entries(p.pl || {}).slice(0, 300)) {
        if (!v || typeof v !== 'object' || !/^[nwr]\d+$/.test(id)) continue;
        const pn = planOf(id);
        for (const k of ['a', 'b']) if (v.n && v.n[k] && !pn.notes[k]) pn.notes[k] = String(v.n[k]).slice(0, 500);
        for (const [ref, byRaw] of (Array.isArray(v.i) ? v.i : []).slice(0, 40)) {
          const by = byRaw === 'b' ? 'b' : 'a';
          const it = String(ref).startsWith('t:') ? { text: String(ref).slice(2, 82), by } : (/^[nwr]\d+$/.test(String(ref)) ? { poi: String(ref), by } : null);
          if (!it) continue;
          if (!pn.items.some((x) => (x.poi && x.poi === it.poi) || (x.text && x.text === it.text))) pn.items.push(it);
        }
      }
      if (p.tr && Array.isArray(p.tr.d) && !state.trip.days.some((d) => d.stops.length)) {
        state.trip = { base: p.tr.b && Number.isFinite(p.tr.b.lat) && Number.isFinite(p.tr.b.lon) ? { name: String(p.tr.b.name || 'Hébergement').slice(0, 60), lat: p.tr.b.lat, lon: p.tr.b.lon } : state.trip.base,
          start: typeof p.tr.s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.tr.s) ? p.tr.s : null,
          auto: p.tr.a === 1,
          days: p.tr.d.slice(0, 14).map((stops) => ({ stops: (stops || []).slice(0, 30).map(([t, v, lk]) => ({ ...(t === 'x' ? { t: 'x', text: String(v).slice(0, 80) } : { t: t === 'p' ? 'p' : 's', id: String(v) }), ...(lk === 1 ? { lock: true } : {}) })) })) };
      }
      if ((p.a && p.a.length) || (p.b && p.b.length)) state.view = 'wishes';
      if (p.tr && Array.isArray(p.tr.d) && p.tr.d.some((d) => d && d.length)) state.view = 'trip';
      applyViewParam();
      history.replaceState(null, '', location.pathname + location.search);
      save(); toast('Sélection partagée importée'); return true;
    } catch (e) { return false; }
  }
  async function copyCode() {
    const url = shareUrl();
    try { await navigator.clipboard.writeText(url); toast('Code séjour copié : à coller dans « Code séjour » sur l\'autre téléphone'); } catch (e) { prompt('Copiez ce code :', url); }
  }
  async function share() {
    const url = shareUrl(), title = 'Costa Cantábrica – nos envies de plages';
    try { if (navigator.share) { await navigator.share({ title, url }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast('Lien copié dans le presse-papiers'); } catch (e) { prompt('Copiez ce lien :', url); }
  }
  /* ==================== 30-data.js ==================== */
  /* ------------------------------------------------------------------ données */
  function scoreOf(s, day = state.day) {
    const k = s.properties.id + ':' + day + ':' + state.profile;
    let r = scoreCache.get(k);
    if (!r) { r = F.score(F.dayOf(state.bulk, s, day), state.profile); scoreCache.set(k, r); }
    return r;
  }
  const wishOf = (id) => ({ a: state.users.a.wish.includes(id), b: state.users.b.wish.includes(id) });
  const wishedIds = () => [...new Set([...state.users.a.wish, ...state.users.b.wish])].filter(spotById);
  function planOf(id) { return state.plans[id] || (state.plans[id] = { notes: { a: '', b: '' }, items: [] }); }
  function planAdd(spotId, item, { wish = true } = {}) {
    const pn = planOf(spotId);
    if (pn.items.some((x) => (item.poi && x.poi === item.poi) || (item.text && x.text === item.text))) return false;
    pn.items.push({ ...item, by: state.me });
    if (wish && !state.users[state.me].wish.includes(spotId)) state.users[state.me].wish.push(spotId);
    save(); return true;
  }
  function planRemove(spotId, idx) { const pn = planOf(spotId); pn.items.splice(idx, 1); save(); }
  const poiById = (id) => state.pois.find((x) => x.id === id);
  const buzz = (ms = 12) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { } };
  function toggleWish(id, who) {
    if (!canEdit(who)) { toast(`Seul·e ${state.users[who].name} peut modifier ses envies`); return; }
    buzz();
    const list = state.users[who].wish, i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else { list.push(id); const sg = state.users[who].suggest || [], k = sg.indexOf(id); if (k >= 0) { sg.splice(k, 1); state.fresh.delete(id); saveSyncMeta(); } }   // accepter une proposition = la marquer
    save(); renderTabs(); if (state.view === 'wishes') renderWishes(); else renderList({ keep: true }); paintMarkers();
    if (state.selected === id) renderDetailHead();
  }
  /* Proposer une plage à l'autre voyageur (écrit dans sa liste « suggest ») ; ignorer une proposition reçue. */
  const suggestedTo = (who, id) => (state.users[who].suggest || []).includes(id);
  function toggleSuggest(id) {
    const other = state.me === 'a' ? 'b' : 'a', sg = state.users[other].suggest || (state.users[other].suggest = []), i = sg.indexOf(id);
    if (i >= 0) { sg.splice(i, 1); toast(`Proposition retirée`); } else { if (state.users[other].wish.includes(id)) { toast(`${state.users[other].name} l'a déjà en envie`); return; } if (sg.length >= 100) { toast('100 propositions au plus'); return; } sg.push(id); buzz(); toast(`Proposé à ${state.users[other].name}`); }
    save(); renderTabs(); if (state.selected === id) renderDetailHead(); if (state.view === 'wishes') renderWishes();
  }
  function ignoreSuggest(id) {
    const sg = state.users[state.me].suggest || [], i = sg.indexOf(id); if (i >= 0) sg.splice(i, 1);
    state.fresh.delete(id); saveSyncMeta(); save(); renderTabs(); renderWishes(); paintMarkers(); toast('Proposition ignorée');
  }
  /* Liste Explorer calée sur la carte : seule l'emprise laissée par un geste de l'utilisateur compte
     (glisser, pincer, molette). Les recadrages automatiques (fiche, envies, séjour, « Toute la côte »)
     ne la rétrécissent pas. Sur téléphone, l'emprise est la partie visible au-dessus du panneau. */
  let viewBounds = null, progAt = 0;
  const progMove = (fn) => { progAt = performance.now(); fn(); };   // déplacement programmé : les moveend qui suivent de près sont ignorés
  function liveBounds() {
    if (is3d()) {   // partie de l'écran au-dessus du panneau, projetée au sol
      const w = gl.getContainer().clientWidth, hAll = gl.getContainer().clientHeight;
      const h = isMobile() && !sheet.classList.contains('full') ? Math.max(60, sheet.getBoundingClientRect().top - gl.getContainer().getBoundingClientRect().top) : hAll;
      const pts = [[0, h * 0.35], [w, h * 0.35], [0, h], [w, h], [w / 2, h * 0.35]].map((p) => { try { return gl.unproject(p); } catch (e) { return null; } }).filter(Boolean);
      if (pts.length) return L.latLngBounds(pts.map((p) => [p.lat, p.lng]));
    }
    const size = map.getSize(); let h = size.y;
    if (isMobile() && !sheet.classList.contains('full')) h = Math.max(60, sheet.getBoundingClientRect().top - map.getContainer().getBoundingClientRect().top);
    return L.latLngBounds(map.containerPointToLatLng([0, h]), map.containerPointToLatLng([size.x, 0]));
  }
  function mapBounds() {
    if (!map || !state.mapFilter || !viewBounds) return null;
    return state.spots.every((s) => viewBounds.contains(latlng(s))) ? null : viewBounds;
  }
  function filtered({ ignoreScore = false, inView = false } = {}) {
    const f = state.filters, q = f.q.trim().toLowerCase(), b = inView && !q ? mapBounds() : null;   // une recherche par nom vise toute la côte
    return state.spots.filter((s) => {
      const p = s.properties;
      if (b && !b.contains(latlng(s))) return false;
      if (f.province !== 'all' && p.province !== f.province) return false;
      if (f.type !== 'all' && p.type !== f.type) return false;
      if (f.surface === 'sand' && p.surface !== 'sand') return false;
      if (f.surface === 'other' && (p.surface === 'sand' || !p.surface)) return false;
      if (f.lifeguard && p.lifeguard !== 'yes') return false;
      if (f.dog && p.dog !== 'yes') return false;
      if (q && !(p.name.toLowerCase().includes(q) || (p.alt_name || '').toLowerCase().includes(q))) return false;
      const w = wishOf(p.id);
      if (f.wish === 'a' && !w.a) return false;
      if (f.wish === 'b' && !w.b) return false;
      if (f.wish === 'both' && !(w.a && w.b)) return false;
      if (f.wish === 'any' && !(w.a || w.b)) return false;
      if (!ignoreScore && state.bulk && f.minScore > 0) { const sc = scoreOf(s).score; if (sc == null || sc < f.minScore) return false; }
      return true;
    });
  }
  function sorted(list) {
    const by = state.sort, arr = list.slice();
    if (by === 'name') arr.sort((a, b) => a.properties.name.localeCompare(b.properties.name, 'es'));
    else if (by === 'size') arr.sort((a, b) => b.properties.size_m - a.properties.size_m);
    else if (by === 'dist' && state.userPos) arr.sort((a, b) => distKm(state.userPos, latlng(a)) - distKm(state.userPos, latlng(b)));
    else if (state.bulk) arr.sort((a, b) => (scoreOf(b).score ?? -1) - (scoreOf(a).score ?? -1) || a.properties.name.localeCompare(b.properties.name, 'es'));
    return arr;
  }
  const filtersCount = () => { const f = state.filters; return [f.province !== 'all', f.type !== 'all', f.surface !== 'all', f.lifeguard, f.dog, f.wish !== 'all', f.minScore > 0].filter(Boolean).length; };
  const filtersActive = () => filtersCount() > 0;
  function renderFiltersBtn() { const n = filtersCount(); $('#btn-filters').classList.toggle('on', n > 0); $('#btn-filters').innerHTML = I('sliders', { size: 20 }) + (n ? `<b class="cnt">${n}</b>` : ''); }
  /* ==================== 40-map2d.js ==================== */
  /* ------------------------------------------------------------------ carte */
  function initMap() {
    map = L.map('map', { zoomControl: true, attributionControl: true, tapTolerance: 20, zoomSnap: 0.5, wheelPxPerZoomLevel: 90, preferCanvas: true }).setView(C.center, C.zoom);
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · prévisions <a href="https://open-meteo.com/">Open-Meteo</a>' });
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagerie © <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics · <a href="https://www.openstreetmap.org/copyright">OSM</a>' });
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: 'Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM · © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' });
    // Orthophoto officielle espagnole (PNOA, 25 cm, CC BY 4.0 IGN) : plus fine qu'Esri sur la côte
    const pnoa = L.tileLayer(PNOA_URL, { maxZoom: 19, attribution: 'PNOA © <a href="https://www.ign.es/">IGN</a> (CC BY 4.0) · <a href="https://www.openstreetmap.org/copyright">OSM</a>' });
    // Étiquettes (villes, villages) et ombrage du relief, superposables au satellite
    const labels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, pane: 'overlayPane', zIndex: 3 });
    const hill = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, opacity: .55, className: 'hill-tiles', pane: 'overlayPane', zIndex: 2 });
    baseLayers = { osm, sat, pnoa, topo, labels, hill };
    let base = 'sat'; const ov = { labels: true, hill: true };
    try { base = localStorage.getItem('ccp:base') || 'sat'; Object.assign(ov, JSON.parse(localStorage.getItem('ccp:overlays') || '{}')); } catch (e) { }   // vue aérienne par défaut, choix mémorisés
    (baseLayers[base] || sat).addTo(map); if (ov.hill) hill.addTo(map); if (ov.labels) labels.addTo(map); CCP.map = map;   // exposé pour le banc de test et le débogage
    const NAMES = { Plan: 'osm', Satellite: 'sat', 'Ortho IGN (PNOA)': 'pnoa', Relief: 'topo' };
    map.on('baselayerchange', (e) => { const k = NAMES[e.name]; if (k) try { localStorage.setItem('ccp:base', k); } catch (x) { } });
    const saveOv = () => { try { localStorage.setItem('ccp:overlays', JSON.stringify({ labels: map.hasLayer(labels), hill: map.hasLayer(hill) })); } catch (x) { } };
    map.on('overlayadd overlayremove', saveOv);
    L.control.layers({ 'Plan': osm, 'Satellite': sat, 'Ortho IGN (PNOA)': pnoa, 'Relief': topo }, { 'Noms de lieux': labels, 'Relief (ombrage)': hill }, { position: 'bottomright' }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    map.attributionControl.setPrefix(false);   // place gagnée sur téléphone
    for (const s of state.spots) {
      const m = L.circleMarker(latlng(s), { radius: 7, weight: 2, color: '#fff', fillColor: '#9aa0a6', fillOpacity: .95 })
        .bindTooltip(s.properties.name, { className: 'spot-tip', direction: 'top', offset: [0, -6] })
        .on('click', () => select(s.properties.id, { pan: false }));
      m.addTo(map); markers.set(s.properties.id, m);
    }
    map.on('dragstart', () => { if (isMobile() && !sheet.classList.contains('peek')) setSheet('peek'); });
    map.on('moveend', () => { if (gl && !glOn) { const c = map.getCenter(); gl.jumpTo({ center: [c.lng, c.lat], zoom: Math.max(0, map.getZoom() - 1) }); } });   // la 3D suit la 2D, prête à s'afficher au même endroit
    map.on('click', (e) => {
      if (!state.pickBase) return;
      state.pickBase = false; ensureTrip();
      state.trip.base = { name: `Hébergement (${e.latlng.lat.toFixed(3)}, ${e.latlng.lng.toFixed(3)})`, lat: +e.latlng.lat.toFixed(5), lon: +e.latlng.lng.toFixed(5) };
      save(); if (state.view === 'config') renderConfig(); else renderTrip(); paintMarkers(); if (isMobile()) setSheet('half'); toast('Résidence placée');
    });
    fitAll();
    $('#legend').innerHTML = C.scoreClasses.map((c) => `<span><i style="background:var(--${c.key})"></i>${c.label}</span>`).join('');
  }
  /* ------------------------------------------------------------------ points d'intérêt */
  const poiGroupOf = (kind) => C.poiGroups.food.includes(kind) ? 'food' : 'visit';
  const osmUrl = (id) => `https://www.openstreetmap.org/${{ n: 'node', w: 'way', r: 'relation' }[id[0]]}/${id.slice(1)}`;
  function poiIcon(x, small) {
    const k = C.poiKinds[x.p.kind] || C.poiKinds.tourism;
    return L.divIcon({ className: '', html: `<div class="poi-pin ${small ? 'small' : ''}" style="background:${k.color}">${I(k.icon, { size: 13 })}</div>`, iconSize: small ? [12, 12] : [24, 24], iconAnchor: small ? [6, 6] : [12, 12], popupAnchor: [0, small ? -6 : -12] });
  }
  function poiMarker(x, small) {
    return L.marker([x.lat, x.lon], { icon: poiIcon(x, small), title: x.p.name }).on('click', () => showPoi(x, { pan: false }));
  }
  function renderPois() {
    if (!poiLayer) return;
    const z = map.getZoom(), on = state.poiOn;
    const anyOn = on.food || on.visit;
    if (z < C.poiMinZoom || !anyOn) { poiLayer.clearLayers(); poiMarkers.clear(); return; }
    if (!state.pois.length) { ensurePois().then(() => renderPois()); return; }
    const b = map.getBounds().pad(0.2), small = z < C.poiMinZoom + 1, keep = new Set();
    let n = 0;
    for (const x of state.pois) {
      if (!on[poiGroupOf(x.p.kind)] || !b.contains([x.lat, x.lon])) continue;
      if (++n > 900) break;
      keep.add(x.id);
      const m = poiMarkers.get(x.id);
      if (m && m._small === small) continue;
      if (m) { m.setIcon(poiIcon(x, small)); m._small = small; continue; }
      const nm = poiMarker(x, small); nm._small = small; nm.addTo(poiLayer); poiMarkers.set(x.id, nm);
    }
    for (const [id, m] of poiMarkers) if (!keep.has(id)) { poiLayer.removeLayer(m); poiMarkers.delete(id); }
  }
  function renderLayerChips() {
    const z = map.getZoom(), zoomHint = z < C.poiMinZoom;
    const chip = (g, label, colors) => `<button type="button" data-g="${g}" class="${state.poiOn[g] ? 'on' : ''}" title="${zoomHint ? 'Zoomez pour voir les lieux' : ''}">${colors.map((c) => `<i class="sw" style="background:${c}"></i>`).join('')}${label}</button>`;
    $('#layer-chips').innerHTML = chip('food', 'Restos & bars', [C.poiKinds.restaurant.color, C.poiKinds.beach_bar.color]) + chip('visit', 'Visites', [C.poiKinds.culture.color, C.poiKinds.tourism.color]);
    $('#layer-chips').querySelectorAll('button').forEach((b) => b.onclick = () => { state.poiOn[b.dataset.g] = !state.poiOn[b.dataset.g]; save(); renderLayerChips(); renderPois(); paint3dPois(); if (state.poiOn[b.dataset.g] && map.getZoom() < C.poiMinZoom) toast('Zoomez sur la carte pour voir les lieux'); });
  }
  function initPois() {
    poiLayer = L.layerGroup().addTo(map);
    map.on('moveend zoomend', () => { if (!glOn) renderPois(); });   // inutile tant que la 3D couvre la carte
    let mvT = null;   // la liste Explorer suit l'emprise laissée par un geste
    for (const ev of ['pointerdown', 'wheel', 'touchstart']) map.getContainer().addEventListener(ev, () => { progAt = 0; }, { passive: true });
    map.on('moveend', () => { if (performance.now() - progAt < 700) return; clearTimeout(mvT); mvT = setTimeout(() => { viewBounds = liveBounds(); if (state.mapFilter && state.view === 'explore' && $('#panel-detail').hidden && $('#panel-poi').hidden) { renderDays(); renderList({ keep: true }); } }, 150); });
    renderLayerChips(); renderPois();
  }
  let poiReturn = null, currentPoi = null;
  function showPoi(x, { pan = true, fromHistory = false } = {}) {
    state.poiOn[poiGroupOf(x.p.kind)] = true;
    const mobile = isMobile();
    if (pan) {
      const z = Math.max(map.getZoom(), C.poiMinZoom + 2), p = map.project([x.lat, x.lon], z);
      if (mobile) p.y += (sheet.classList.contains('full') ? 0 : sheetVisible() / 2);
      progMove(() => map.setView(map.unproject(p, z), z, { animate: false }));
      if (is3d()) progMove(() => gl.easeTo({ center: [x.lon, x.lat], zoom: Math.max(gl.getZoom(), 14), offset: glOffset(), duration: 0 }));
    }
    renderPois();
    map.closePopup();
    // mémorise d'où l'on vient pour le bouton retour
    const openPanel = ['panel-detail', 'panel-list', 'panel-wishes', 'panel-trip', 'panel-config'].find((id) => !$('#' + id).hidden);
    if (openPanel) poiReturn = { panel: openPanel, scroll: $('#panels').scrollTop };
    for (const id of ['panel-list', 'panel-wishes', 'panel-trip', 'panel-config', 'panel-detail']) $('#' + id).hidden = true;
    $('#panel-poi').hidden = false; $('#panels').scrollTop = 0;
    renderPoiPanel(x); currentPoi = x.id;
    if (!fromHistory && !(history.state && history.state.poi === x.id)) history.pushState({ poi: x.id, spot: state.selected }, '', location.pathname + location.search + '#poi=' + x.id);
    if (mobile && sheet.classList.contains('peek')) setSheet('half');
    buzz(8);
  }
  function closePoi(fromHistory = false) {
    if (!fromHistory && history.state && history.state.poi) { history.back(); return; }   // le bouton retour du navigateur fait le reste
    $('#panel-poi').hidden = true; currentPoi = null;
    const back = poiReturn || { panel: 'panel-list', scroll: 0 }; poiReturn = null;
    if (!fromHistory && /^#poi=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + (back.panel === 'panel-detail' && state.selected && spotById(state.selected)?.properties.slug ? '#' + spotById(state.selected).properties.slug : ''));
    if (back.panel === 'panel-detail' && state.selected) { $('#panel-detail').hidden = false; renderDetailHead(); renderDetailDay(detailDay); }
    else { const v = { 'panel-wishes': 'wishes', 'panel-trip': 'trip', 'panel-config': 'config' }[back.panel] || 'explore'; if (state.selected && back.panel !== 'panel-detail') state.selected = null; state.view = v; setView(v); }
    $('#panels').scrollTop = back.scroll || 0;
  }
  /* Plage à laquelle rattacher un lieu : la fiche ouverte, sinon la plage la plus proche (2 km). */
  function poiBeach(x) {
    if (state.selected) return spotById(state.selected);
    let best = null, bd = 2;
    for (const s of state.spots) { const d = distKm([x.lat, x.lon], latlng(s)); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  function renderPoiPanel(x) {
    const p = x.p, k = C.poiKinds[p.kind] || C.poiKinds.tourism, beach = poiBeach(x);
    const inPlan = beach && (state.plans[beach.properties.id]?.items || []).some((it) => it.poi === x.id);
    const inTrip = state.trip.days.some((d) => d.stops.some((st) => st.t === 'p' && st.id === x.id));
    const dist = beach ? distKm([x.lat, x.lon], latlng(beach)) : null;
    const tel = p.phone && /^[+\d][\d\s().-]{5,20}$/.test(p.phone) ? p.phone.replace(/[^+\d]/g, '') : null;
    $('#panel-poi').innerHTML = `
      <div class="poi-head"><button type="button" class="iconbtn" id="poi-back" aria-label="Retour">${I('back', { size: 20 })}</button>
        <span class="poi-pin" style="background:${k.color}">${I(k.icon, { size: 20 })}</span>
        <div style="flex:1;min-width:0"><h2>${esc(p.name)}</h2><span class="k" style="color:${k.color}">${esc(k.label)}${p.cuisine ? ' · ' + esc(p.cuisine.split(';').join(', ')) : ''}${p.sub && p.kind !== p.sub && poiGroupOf(p.kind) === 'visit' ? ' · ' + esc(p.sub.replace(/_/g, ' ')) : ''}</span></div>
        <button type="button" class="iconbtn" id="poi-zoom" title="Zoomer sur le lieu" aria-label="Zoomer sur le lieu">${I('frame', { size: 20 })}</button></div>
      <div class="poi-meta">
        ${beach ? `<span>${I('wave', { size: 14 })}${esc(beach.properties.name)} à ${dist < 1 ? Math.round(dist * 1000) + ' m' : dist.toFixed(1) + ' km'}</span>` : ''}
        ${p.opening_hours ? `<span>${I('clock', { size: 14 })}${esc(p.opening_hours)}</span>` : ''}
        ${p.addr_city ? `<span>${I('pin', { size: 14 })}${esc([p.addr_street, p.addr_city].filter(Boolean).join(', '))}</span>` : ''}
        ${p.outdoor_seating === 'yes' ? `<span>${I('sun', { size: 14 })}Terrasse</span>` : ''}
      </div>
      <div class="poi-actions">
        ${beach ? `<button type="button" class="btn ghost wide ${inPlan ? 'on' : ''}" id="poi-plan">${I(inPlan ? 'check' : 'plus', { size: 16 })}${inPlan ? 'Dans le programme de ' : 'Ajouter au programme de '}${esc(beach.properties.name)}</button>` : ''}
        <button type="button" class="btn ghost wide" id="poi-plan-other">${I('note', { size: 16 })}${beach ? 'Rattacher à une autre plage' : 'Rattacher au programme d\'une plage'}</button>
        <button type="button" class="btn ghost wide ${inTrip ? 'on' : ''}" id="poi-trip">${I('calendar', { size: 16 })}${inTrip ? 'Dans le séjour · ajouter à un autre jour' : 'Ajouter à un jour du séjour'}</button>
        <a class="btn primary" href="https://www.google.com/maps/dir/?api=1&destination=${x.lat},${x.lon}" target="_blank" rel="noopener">${I('navigation', { size: 16 })}Itinéraire</a>
        ${tel ? `<a class="btn ghost" href="tel:${esc(tel)}">${I('users', { size: 16 })}Appeler</a>` : `<a class="btn ghost" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ' ' + (p.addr_city || ''))}" target="_blank" rel="noopener">${I('pin', { size: 16 })}Google Maps</a>`}
        ${safeUrl(p.website) ? `<a class="btn ghost" href="${esc(safeUrl(p.website))}" target="_blank" rel="noopener">${I('link', { size: 16 })}Site web</a>` : ''}
        <a class="btn ghost" href="${osmUrl(p.id)}" target="_blank" rel="noopener">${I('map', { size: 16 })}OSM</a>
      </div>`;
    $('#poi-back').onclick = closePoi;
    $('#poi-zoom').onclick = () => zoomTo({ poi: x });
    if (beach) $('#poi-plan').onclick = () => {
      const sid = beach.properties.id, pn = planOf(sid), i = pn.items.findIndex((it) => it.poi === x.id);
      if (i >= 0) { if (!canEdit(pn.items[i].by)) return toast(`Ajouté par ${state.users[pn.items[i].by].name}`); planRemove(sid, i); toast('Retiré du programme'); }
      else { planAdd(sid, { poi: x.id }); toast(`Ajouté au programme de ${beach.properties.name}`); buzz(); }
      renderTabs(); paintMarkers(); renderPoiPanel(x);
    };
    $('#poi-trip').onclick = () => pickDayFor({ t: 'p', id: x.id }, x.p.name, () => renderPoiPanel(x));
    $('#poi-plan-other').onclick = () => pickBeachFor(x, () => renderPoiPanel(x));
  }
  /* Choisir la plage au programme de laquelle rattacher un lieu : plages proches (10 km), envies d'abord. */
  function pickBeachFor(x, after) {
    const dlg = $('#dlg-pick');
    const near = state.spots.map((s) => ({ s, d: distKm([x.lat, x.lon], latlng(s)) })).filter((o) => o.d <= 10).sort((a, b) => a.d - b.d);
    const wished = near.filter((o) => { const w = wishOf(o.s.properties.id); return w.a || w.b; }), others = near.filter((o) => !wished.includes(o)).slice(0, 8);
    const row = (o) => { const sid = o.s.properties.id, w = wishOf(sid), has = (state.plans[sid]?.items || []).some((it) => it.poi === x.id);
      return `<button type="button" data-id="${esc(sid)}" ${has ? 'disabled style="opacity:.5"' : ''}>${I('wave', { size: 14 })}<span>${esc(o.s.properties.name)}${w.a || w.b ? ` <i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--${w.a && w.b ? 'both' : w.a ? 'a' : 'b'})"></i>` : ''}</span><span class="sub">${has ? 'déjà' : (o.d < 1 ? Math.round(o.d * 1000) + ' m' : o.d.toFixed(1) + ' km')}</span></button>`; };
    $('#pick-title').textContent = `${x.p.name} · au programme de quelle plage ?`;
    $('#pick-list').innerHTML = (wished.length ? `<h4>Plages en envie</h4>${wished.map(row).join('')}` : '') + (others.length ? `<h4>Plages proches</h4>${others.map(row).join('')}` : '') + (!near.length ? '<span class="hint">Aucune plage à moins de 10 km.</span>' : '');
    $('#pick-list').querySelectorAll('button[data-id]').forEach((b) => b.onclick = () => { const sid = b.dataset.id; dlg.close(); if (planAdd(sid, { poi: x.id }, { wish: false })) { toast(`Ajouté au programme de ${spotById(sid).properties.name}`); buzz(); } renderTabs(); paintMarkers(); if (after) after(); });
    dlg.showModal();
  }
  function nearbyOf(s, km = C.nearbyKm) {
    const c = latlng(s), sname = s.properties.name.toLowerCase();
    return state.pois.map((x) => ({ x, d: distKm(c, [x.lat, x.lon]) }))
      .filter((o) => o.d <= km && !(o.d < 0.12 && poiGroupOf(o.x.p.kind) === 'visit' && (sname.includes(o.x.p.name.toLowerCase()) || o.x.p.name.toLowerCase().includes(sname))))
      .sort((a, b) => a.d - b.d);
  }

  /* Fond satellite centré sur la plage : accès, parking, rochers se lisent mieux qu'en vue fixe. */
  function showSatellite(s) {
    if (!baseLayers) return;
    if (glOn && !glUnsupported) { open3d({ lat: latlng(s)[0], lon: latlng(s)[1] }); return; }
    if (!map.hasLayer(baseLayers.pnoa)) { for (const k of ['osm', 'topo', 'sat']) if (map.hasLayer(baseLayers[k])) map.removeLayer(baseLayers[k]); baseLayers.sat.addTo(map); }
    progMove(() => map.setView(latlng(s), Math.max(16, aerialZoom(s, map.getSize().x, 14, 17)), { animate: false }));
    if (isMobile()) setSheet('peek');
    toast('Fond satellite · le contrôle des couches (en bas à droite) ramène au plan');
  }
  /* ==================== 45-map3d.js ==================== */
  /* ------------------------------------------------------------------ carte 3D (MapLibre GL, chargé à la demande)
     Mode principal de la carte, activé par défaut et mémorisé (ccp:3d) : terrain Terrarium (Mapzen / AWS Open Data),
     orthophoto drapée (PNOA © IGN, ou Esri si c'est le fond 2D choisi), ombrage, étiquettes, plages colorées par
     score, parcours du séjour, hébergement. La carte 2D Leaflet reste montée dessous (lieux, fonds, hors ligne). */
  const ESRI_IMG = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const LABELS_IMG = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
  let gl = null, glReady = null, glOn = false, glUnsupported = false, glMarkers = [], glLoaded = false, glCreating = null;
  let glMode = 'auto';   // 'auto' : 2D sur la côte entière, 3D dès qu'on zoome (≥ 12,5) ; '1' / '0' : fixé par le bouton
  const GL_IN = 12, GL_OUT = 11;   // seuils de zoom Leaflet (entrée en 3D, retour en 2D)
  const saveGlMode = (m) => { glMode = m; try { localStorage.setItem('ccp:3d', m); localStorage.setItem('ccp:3dv', '2'); } catch (e) { } };
  const is3d = () => glOn && !!gl && glLoaded;
  CCP.is3d = () => glOn && !!gl; CCP.gl3d = () => gl;   // exposés pour le banc de test
  function loadMaplibre() {
    if (window.maplibregl) return Promise.resolve();
    if (glReady) return glReady;
    glReady = new Promise((res, rej) => {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'vendor/maplibre/maplibre-gl.css?v=' + assetVer; document.head.appendChild(l);
      const s = document.createElement('script'); s.src = 'vendor/maplibre/maplibre-gl.js?v=' + assetVer; s.onload = res; s.onerror = () => { glReady = null; rej(new Error('MapLibre introuvable')); }; document.head.appendChild(s);
    });
    return glReady;
  }
  const glImagery = () => (map && baseLayers && map.hasLayer(baseLayers.sat) ? ESRI_IMG : (C.orthoUrl || PNOA_URL));
  const glOffset = () => (isMobile() && !sheet.classList.contains('full') ? [0, -sheetVisible() / 2] : [0, 0]);
  const glPadding = () => ({ top: 70, left: 16, right: 16, bottom: (isMobile() ? Math.round(window.innerHeight * 0.58) : 0) + 24 });
  function glStyle() {
    return { version: 8,
      sources: {
        sat: { type: 'raster', tiles: [glImagery()], tileSize: 256, maxzoom: 18, attribution: map && baseLayers && map.hasLayer(baseLayers.sat) ? 'Imagerie © Esri' : 'PNOA © IGN' },
        labels: { type: 'raster', tiles: [LABELS_IMG], tileSize: 256, maxzoom: 17 },
        dem: { type: 'raster-dem', tiles: [TERRAIN_URL], tileSize: 256, maxzoom: 15, encoding: 'terrarium', attribution: 'Terrain Tiles · Mapzen, AWS Open Data' },
        dem2: { type: 'raster-dem', tiles: [TERRAIN_URL], tileSize: 256, maxzoom: 15, encoding: 'terrarium' },   // source distincte pour l'ombrage (qualité de rendu)
        routes: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        spots: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        pois: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      },
      layers: [
        { id: 'sat', type: 'raster', source: 'sat' },
        { id: 'hill', type: 'hillshade', source: 'dem2', paint: { 'hillshade-exaggeration': .3, 'hillshade-shadow-color': '#1b2a3a', 'hillshade-highlight-color': '#ffffff', 'hillshade-illumination-direction': 315 } },
        { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': .9 } },
        { id: 'routes', type: 'line', source: 'routes', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'w'], 'line-opacity': ['get', 'op'], 'line-dasharray': [2, 1.5] } },
        { id: 'pois', type: 'circle', source: 'pois', paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['get', 'r'], 'circle-opacity': .95, 'circle-stroke-color': ['get', 'stroke'], 'circle-stroke-width': ['get', 'sw'], 'circle-pitch-alignment': 'viewport', 'circle-pitch-scale': 'viewport' } },
        { id: 'spots', type: 'circle', source: 'spots', paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['get', 'r'], 'circle-opacity': ['get', 'op'], 'circle-stroke-color': ['get', 'stroke'], 'circle-stroke-width': ['get', 'sw'], 'circle-pitch-alignment': 'viewport', 'circle-pitch-scale': 'viewport' } },
      ],
      terrain: { source: 'dem', exaggeration: 1.3 },
      sky: { 'sky-color': '#8fc1e3', 'horizon-color': '#dbe9f3', 'fog-color': '#c7d8e4', 'fog-ground-blend': .6, 'horizon-fog-blend': .7, 'sky-horizon-blend': .6, 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0] },
    };
  }
  /* Bascule 2D/3D du mode principal ; la vue (centre, zoom) passe d'une carte à l'autre. */
  async function set3d(on, { silent = false } = {}) {
    if (on && glUnsupported) { if (!silent) toast('La 3D n\'est pas disponible sur cet appareil'); return false; }
    if (!on) {
      if (itin.on) itinStop();
      if (gl && glOn) { const c = gl.getCenter(); progMove(() => map.setView([c.lat, c.lng], Math.min(19, Math.round((gl.getZoom() + 1) * 2) / 2), { animate: false })); }
      glOn = false; $('#view3d').hidden = true; renderBtn3d(); renderPois();
      return true;
    }
    $('#view3d').hidden = false; glOn = true; renderBtn3d();
    if (!gl) $('#gl').innerHTML = '<div class="loading" style="color:#fff">Chargement de la vue 3D…</div>';
    try { await loadMaplibre(); } catch (e) { glOn = false; $('#view3d').hidden = true; renderBtn3d(); if (!silent) toast('Vue 3D indisponible hors ligne'); return false; }
    if (glCreating) { await glCreating; }   // un seul MapLibre, même si deux bascules se croisent
    if (!gl) {
      const probe = document.createElement('canvas'), ctx = probe.getContext('webgl2') || probe.getContext('webgl');   // MapLibre ≥ 3 n'expose plus supported()
      if (!ctx) { glUnsupported = true; glOn = false; $('#view3d').hidden = true; renderBtn3d(); if (!silent) toast('La 3D (WebGL) n\'est pas disponible sur cet appareil'); return false; }
      $('#gl').innerHTML = '';
      const c = map.getCenter();
      let resolveCreate; glCreating = new Promise((r) => { resolveCreate = r; });
      try {
        gl = new maplibregl.Map({ container: 'gl', center: [c.lng, c.lat], zoom: Math.max(6, map.getZoom() - 1), pitch: 50, bearing: 0, maxPitch: 80, attributionControl: false, style: glStyle() });
      } catch (e) { glUnsupported = true; glOn = false; gl = null; $('#view3d').hidden = true; renderBtn3d(); resolveCreate(); glCreating = null; if (!silent) toast('La 3D n\'est pas disponible sur cet appareil'); return false; }
      gl.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: !isMobile() }), 'bottom-right');
      gl.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      gl.touchZoomRotate.enableRotation(); gl.dragRotate.enable();
      gl.on('load', () => { glLoaded = true; paint3d(); paint3dPois(); viewBounds = viewBounds && liveBounds(); try { if (!localStorage.getItem('ccp:3dhint')) { localStorage.setItem('ccp:3dhint', '1'); toast('Relief 3D · deux doigts pour incliner, bouton 2D pour la carte plate'); } } catch (e) { } });
      resolveCreate(); glCreating = null;
      gl.on('moveend', (e) => { paint3dPois(); if (glOn && e.originalEvent) { const c = gl.getCenter(); progMove(() => map.setView([c.lat, c.lng], Math.max(3, Math.min(19, gl.getZoom() + 1)), { animate: false })); } });   // la 2D suit les gestes faits en 3D (pas les recentrages dus au terrain)
      gl.on('click', 'pois', (e) => { const f = e.features && e.features[0]; const x = f && poiById(f.properties.id); if (x) showPoi(x, { pan: false }); });
      gl.on('mouseenter', 'pois', (e) => { gl.getCanvas().style.cursor = 'pointer'; const f = e.features && e.features[0]; if (f && !isMobile()) { glPopup.setLngLat(f.geometry.coordinates).setText(f.properties.name).addTo(gl); } });
      gl.on('mouseleave', 'pois', () => { gl.getCanvas().style.cursor = ''; glPopup.remove(); });
      gl.on('mouseenter', 'spots', (e) => { const f = e.features && e.features[0], s = f && spotById(f.properties.id); if (s && !isMobile()) glPopup.setLngLat(f.geometry.coordinates).setText(s.properties.name).addTo(gl); });
      gl.on('mouseleave', 'spots', () => glPopup.remove());
      gl.on('error', (e) => { const m = String((e && e.error && e.error.message) || ''); if (/WebGL|context lost/i.test(m)) { glUnsupported = true; set3d(false); try { gl.remove(); } catch (x) { } gl = null; glLoaded = false; glMarkers = []; toast('La 3D s\'est arrêtée : carte 2D'); } });
      gl.on('click', 'spots', (e) => { const f = e.features && e.features[0]; if (f) select(f.properties.id, { pan: false }); });
      gl.on('mouseenter', 'spots', () => { gl.getCanvas().style.cursor = 'pointer'; }); gl.on('mouseleave', 'spots', () => { gl.getCanvas().style.cursor = ''; });
      gl.on('dragstart', (e) => { if (e.originalEvent && isMobile() && !sheet.classList.contains('peek')) setSheet('peek'); if (e.originalEvent && itin.playing) itinPlay(false); });
      gl.on('zoomend', (e) => { if (e.originalEvent && glMode === 'auto' && gl.getZoom() + 1 < GL_OUT) set3d(false, { silent: true }); });   // dézoom manuel : retour à la vue d'ensemble 2D
      gl.on('moveend', (e) => { if (!e.originalEvent && performance.now() - progAt < 700) return; if (!e.originalEvent) return; clearTimeout(mvT3); mvT3 = setTimeout(() => { viewBounds = liveBounds(); if (state.mapFilter && state.view === 'explore' && $('#panel-detail').hidden && $('#panel-poi').hidden) { renderDays(); renderList({ keep: true }); } }, 150); });
      gl.once('pointerdown', () => $('#v3-hint').classList.add('off')); setTimeout(() => $('#v3-hint').classList.add('off'), 7000);
    } else {
      const c = map.getCenter(); gl.resize(); gl.jumpTo({ center: [c.lng, c.lat], zoom: Math.max(6, map.getZoom() - 1) }); paint3d(); if (viewBounds) viewBounds = liveBounds();
    }
    return true;
  }
  let mvT3 = null;
  const glPopup = { _p: null, get p() { if (!this._p) this._p = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'gl-tip' }); return this._p; }, setLngLat(c) { this.p.setLngLat(c); return this; }, setText(t) { this.p.setText(t); return this; }, addTo(m) { this.p.addTo(m); return this; }, remove() { if (this._p) this._p.remove(); } };
  /* Lieux (restos, bars, visites) dans la scène 3D : mêmes règles que la couche 2D (zoom, puces, 900 au plus). */
  function paint3dPois() {
    if (!gl || !glLoaded || !gl.getSource('pois')) return;
    const on = state.poiOn, z = gl.getZoom() + 1;
    if (z < C.poiMinZoom || !(on.food || on.visit)) { gl.getSource('pois').setData({ type: 'FeatureCollection', features: [] }); return; }
    if (!state.pois.length) { ensurePois().then(() => paint3dPois()); return; }
    const b = gl.getBounds(), colBoth = cssVar('--both'), inPlan = new Set();
    for (const pn of Object.values(state.plans)) for (const it of pn.items) if (it.poi) inPlan.add(it.poi);
    const feats = []; let n = 0;
    for (const x of state.pois) {
      if (!on[poiGroupOf(x.p.kind)] || !b.contains([x.lon, x.lat])) continue;
      if (++n > 900) break;
      const k = C.poiKinds[x.p.kind] || C.poiKinds.tourism, kept = inPlan.has(x.id);
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [x.lon, x.lat] }, properties: { id: x.id, name: x.p.name, color: k.color, r: kept ? 7 : (z < C.poiMinZoom + 1 ? 3.5 : 5), stroke: kept ? colBoth : '#fff', sw: kept ? 2.5 : 1.2 } });
    }
    gl.getSource('pois').setData({ type: 'FeatureCollection', features: feats });
  }
  function renderBtn3d() { const b = $('#btn-3d'); if (!b) return; b.textContent = glOn ? '2D' : '3D'; b.classList.toggle('on', glOn); b.title = (glOn ? 'Revenir à la carte 2D' : 'Relief 3D') + (glMode === 'auto' ? ' (bascule automatique selon le zoom)' : ''); }
  /* Fiche : caméra au-dessus de la mer, tournée vers la plage et ses falaises. */
  async function open3d({ lat, lon, zoom = 14.5, bearing = C.coastBearing ?? 180 } = {}) {
    if (!(await set3d(true))) return;
    if (isMobile()) setSheet('peek');
    const go = () => { gl.flyTo({ center: [lon, lat], zoom, pitch: 65, bearing, offset: glOffset(), duration: 1200, essential: true }); progMove(() => map.setView([lat, lon], zoom + 1, { animate: false })); };
    if (glLoaded) go(); else gl.once('load', go);
  }
  /* Plages, parcours et hébergement : reflet des couches Leaflet dans la scène 3D. */
  function paint3d() {
    if (!gl || !glLoaded) return;
    const vis = new Set(filtered().map((s) => s.properties.id));
    const colA = cssVar('--a'), colB = cssVar('--b'), colBoth = cssVar('--both');
    const cols = { none: cssVar('--none') }; for (const c of C.scoreClasses) cols[c.key] = cssVar('--' + c.key);
    const feats = [];
    for (const s of state.spots) {
      const id = s.properties.id; if (!vis.has(id)) continue;
      const r = state.bulk ? scoreOf(s) : { cls: 'none' }, w = wishOf(id), sel = state.selected === id;
      let f;
      if ((state.view === 'wishes' && (w.a || w.b || suggestedTo(state.me, id))) || ((state.view === 'trip' || itin.on) && tripHasSpot(id))) continue;   // épingles HTML numérotées
      if (state.view === 'wishes' || state.view === 'trip') f = { color: cols[r.cls], r: 4, op: .5, stroke: '#fff', sw: 1 };
      else f = { color: cols[r.cls], r: sel ? 10 : (w.a || w.b ? 8 : 6), op: .95, stroke: sel ? '#111' : w.a && w.b ? colBoth : w.a ? colA : w.b ? colB : '#fff', sw: sel ? 3 : (w.a || w.b ? 3 : 1.5) };
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [latlng(s)[1], latlng(s)[0]] }, properties: { id, ...f } });
    }
    gl.getSource('spots').setData({ type: 'FeatureCollection', features: feats });
    const lines = [];
    const toLine = (seq) => seq.map(([la, lo]) => [lo, la]);
    if (state.view === 'wishes') { const list = wishList(); if (list.length > 1) lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: toLine(list.map(latlng)) }, properties: { color: colBoth, w: 2.5, op: .8 } }); }
    state.trip.days.forEach((d, i) => { const route = dayRoute(d); if (route.seq.length > 1) { const focus = itin.on ? (i === itin.day ? 1 : 0) : (state.view === 'trip' ? 1 : .5); if (itin.on && i !== itin.day) return; lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: toLine(route.seq) }, properties: { color: dayColor(i), w: focus === 1 ? (itin.on ? 5 : 3.5) : 2, op: focus === 1 ? .95 : .4 } }); } });
    for (const [sid, pn] of Object.entries(state.plans)) { const s = spotById(sid); if (!s) continue; for (const it of pn.items) { const x = it.poi && poiById(it.poi); if (!x) continue; const k = C.poiKinds[x.p.kind] || C.poiKinds.tourism; lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[latlng(s)[1], latlng(s)[0]], [x.lon, x.lat]] }, properties: { color: k.color, w: 1.5, op: .8 } }); } }
    paint3dPois();
    gl.getSource('routes').setData({ type: 'FeatureCollection', features: lines });
    for (const m of glMarkers) m.remove(); glMarkers = [];
    const pin = (html, lat, lon, onClick) => { const el = document.createElement('div'); el.innerHTML = html; const node = el.firstElementChild; if (onClick) node.addEventListener('click', (e) => { e.stopPropagation(); onClick(); }); const mk = new maplibregl.Marker({ element: node, anchor: 'center' }).setLngLat([lon, lat]).addTo(gl); glMarkers.push(mk); };
    if (state.trip.base) pin(`<div class="home-pin" style="${state.view === 'trip' ? '' : 'opacity:.75'}">${I('home', { size: 15 })}</div>`, state.trip.base.lat, state.trip.base.lon);
    if (state.view === 'wishes') wishList().forEach((s, i) => { const p = s.properties, r = state.bulk ? scoreOf(s) : { cls: 'none' }, w = wishOf(p.id), who = w.a && w.b ? 'both' : w.a ? 'a' : w.b ? 'b' : (state.me === 'a' ? 'b' : 'a'); pin(`<div class="num-pin ${who}" style="background:var(--${r.cls})">${i + 1}</div>`, latlng(s)[0], latlng(s)[1], () => select(p.id, { pan: false })); });
    if (state.view === 'trip' || itin.on) state.trip.days.filter((d, i) => !itin.on || i === itin.day).forEach((d) => { const i = state.trip.days.indexOf(d); let n = 0; d.stops.forEach((st) => { const x = stopInfo(st); if (!x || x.lat == null) return; const isSpot = x.kind === 'spot'; if (isSpot) n++; pin(`<div class="day-pin ${isSpot ? '' : 'poi'}" style="background:${isSpot ? dayColor(i) : x.color}">${isSpot ? n : I(x.icon, { size: 10 })}</div>`, x.lat, x.lon, () => { if (isSpot) select(st.id, { pan: false }); else showPoi(x.poi); }); }); });
    if (state.selected && state.view !== 'wishes' && state.view !== 'trip' && !itin.on) { const s = spotById(state.selected); if (s) pin(`<div class="poi-pin sel" style="background:var(--accent);width:16px;height:16px;border-color:#111"></div>`, latlng(s)[0], latlng(s)[1]); }
  }
  /* ------------------------------------------------------------------ itinéraire jour par jour en 3D
     La caméra survole les étapes du jour dans l'ordre (départ de l'hébergement, plages, lieux, retour),
     orientée dans le sens du trajet ; carte d'étape avec horaire estimé et tronçon ; lecture automatique. */
  const itin = { on: false, day: 0, step: 0, playing: false, timer: null, steps: [] };
  const bearingTo = (a, b) => { const p = Math.PI / 180, la1 = a[0] * p, la2 = b[0] * p, dl = (b[1] - a[1]) * p; const y = Math.sin(dl) * Math.cos(la2), x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; };
  function itinSteps(di) {
    const d = state.trip.days[di]; if (!d) return [];
    const tl = dayTimeline(d), base = state.trip.base, steps = [];
    if (base) steps.push({ kind: 'base', name: base.name, sub: 'départ', lat: base.lat, lon: base.lon, time: tl.start, km: 0 });
    d.stops.forEach((st, k) => { const info = stopInfo(st), slot = tl.slots[k]; if (!info || info.lat == null) return; steps.push({ kind: info.kind, name: info.name, sub: info.sub, lat: info.lat, lon: info.lon, time: slot ? slot.start : null, end: slot ? slot.end : null, km: slot ? slot.km : 0, st, info }); });
    if (base && state.prefs.roundTrip && steps.length > 1) steps.push({ kind: 'base', name: base.name, sub: 'retour', lat: base.lat, lon: base.lon, time: tl.end, km: 0 });
    return steps;
  }
  async function itinStart(di) {
    if (!(await set3d(true))) return;
    itin.on = true; itin.day = di; itin.step = 0; itin.playing = false; clearTimeout(itin.timer);
    itin.steps = itinSteps(di);
    $('#itin').hidden = false; if (isMobile()) setSheet('peek');
    paint3d();
    if (!itin.steps.length) { renderItin(); toast('Aucune étape localisée ce jour-là'); return; }
    const b = L.latLngBounds(itin.steps.map((s) => [s.lat, s.lon])).pad(0.25), bottom = isMobile() ? Math.round(window.innerHeight * 0.30) : 0;
    const fly = () => progMove(() => gl.fitBounds([[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]], { padding: { top: 70, left: 16, right: 16, bottom: bottom + 120 }, maxZoom: 13.5, pitch: 55, bearing: 0, duration: 1000 }));
    if (glLoaded) fly(); else gl.once('load', fly);
    itin.step = -1; renderItin();   // vue d'ensemble d'abord ; ▶ ou « suivant » démarre
  }
  function itinGo(k) {
    if (!itin.on || !itin.steps.length) return;
    k = Math.max(-1, Math.min(itin.steps.length - 1, k)); itin.step = k; renderItin();
    if (k < 0) return;
    const s = itin.steps[k], prev = itin.steps[k - 1];
    const bearing = prev ? bearingTo([prev.lat, prev.lon], [s.lat, s.lon]) : (C.coastBearing ?? 180);
    const zoom = s.kind === 'base' ? 14 : s.kind === 'spot' ? 14.3 : 15.3;
    progMove(() => gl.flyTo({ center: [s.lon, s.lat], zoom, pitch: 62, bearing, offset: glOffset(), duration: 1800, essential: true }));
    progMove(() => map.setView([s.lat, s.lon], zoom + 1, { animate: false }));
    if (itin.playing) { clearTimeout(itin.timer); itin.timer = setTimeout(() => { if (itin.playing && itin.step < itin.steps.length - 1) itinGo(itin.step + 1); else { itin.playing = false; renderItin(); } }, 5200); }
  }
  function itinPlay(on) { itin.playing = on; clearTimeout(itin.timer); if (on) itinGo(itin.step < 0 ? 0 : (itin.step >= itin.steps.length - 1 ? 0 : itin.step + 1)); else renderItin(); }
  function itinStop() { itin.on = false; itin.playing = false; clearTimeout(itin.timer); $('#itin').hidden = true; paint3d(); }
  function renderItin() {
    const el = $('#itin'); if (!el || el.hidden) return;
    if (!state.trip.days[itin.day]) { itinStop(); return; }   // jour supprimé pendant le suivi
    itin.steps = itinSteps(itin.day); if (itin.step >= itin.steps.length) itin.step = itin.steps.length - 1;
    const t = state.trip, days = t.days.map((d, i) => `<button type="button" class="chip ${i === itin.day ? 'on' : ''}" data-i="${i}" style="--dc:${dayColor(i)}"><i></i>J${i + 1}<small>${esc(dayLabel(i).split(' ')[1] || '')}</small></button>`).join('');
    const s = itin.step >= 0 ? itin.steps[itin.step] : null, n = itin.steps.length;
    const body = !n ? `<div class="it-card"><b>Aucune étape localisée</b><span class="hint">Ajoutez une plage ou un lieu à ce jour.</span></div>`
      : !s ? `<div class="it-card"><b>Jour ${itin.day + 1} · ${esc(dayLabel(itin.day))}</b><span>${n} étape${n > 1 ? 's' : ''} · ${I('clock', { size: 12 })} ${hm(itin.steps[0].time ?? 0)} → ${hm(itin.steps[n - 1].end ?? itin.steps[n - 1].time ?? 0)} · ${I('car', { size: 12 })} ~${Math.round(dayRoute(t.days[itin.day]).km)} km</span></div>`
      : `<div class="it-card"><span class="it-n" style="background:${s.kind === 'base' ? 'var(--text)' : s.kind === 'spot' ? dayColor(itin.day) : (s.info && s.info.color) || 'var(--muted)'}">${s.kind === 'base' ? I('home', { size: 13 }) : s.kind === 'spot' ? itin.steps.slice(0, itin.step + 1).filter((x) => x.kind === 'spot').length : I(s.info && s.info.icon || 'compass', { size: 12 })}</span>
          <div class="it-t"><b class="${s.kind !== 'base' ? 'link' : ''}" id="it-name">${esc(s.name)}</b><span>${esc(s.sub)}${s.time != null ? ` · ${hm(s.time)}${s.end != null ? '–' + hm(s.end) : ''}` : ''}${s.km ? ` · ${s.km.toFixed(0)} km` : ''}</span></div>
          <span class="it-k">${itin.step + 1}/${n}</span></div>`;
    el.innerHTML = `<div class="it-days">${days}<button type="button" class="iconbtn it-close" id="it-close" aria-label="Quitter l'itinéraire">${I('x', { size: 18 })}</button></div>${body}
      <div class="it-nav"><button type="button" class="iconbtn" id="it-prev" ${itin.step <= -1 || !n ? 'disabled' : ''} aria-label="Étape précédente">${I('chevronL', { size: 20 })}</button>
        <button type="button" class="btn ${itin.playing ? 'ghost' : 'primary'}" id="it-play" ${!n ? 'disabled' : ''}>${itin.playing ? I('minus', { size: 16 }) + ' Pause' : I('route', { size: 16 }) + (itin.step < 0 ? ' Suivre la journée' : ' Lecture')}</button>
        <button type="button" class="iconbtn" id="it-next" ${itin.step >= n - 1 || !n ? 'disabled' : ''} aria-label="Étape suivante">${I('chevronR', { size: 20 })}</button></div>`;
    el.querySelectorAll('.it-days .chip').forEach((b) => b.onclick = () => itinStart(+b.dataset.i));
    $('#it-close').onclick = itinStop;
    $('#it-prev').onclick = () => { itin.playing = false; itinGo(itin.step - 1); };
    $('#it-next').onclick = () => { itin.playing = false; itinGo(itin.step + 1); };
    $('#it-play').onclick = () => itinPlay(!itin.playing);
    const nm = $('#it-name'); if (nm && s && s.st) nm.onclick = () => { if (s.st.t === 's') select(s.st.id, { pan: false, full: true }); else if (s.st.t === 'p' && s.info.poi) showPoi(s.info.poi, { pan: false }); };
  }
  function init3d() {
    try { const m = localStorage.getItem('ccp:3d'); if (localStorage.getItem('ccp:3dv') === '2' && (m === '1' || m === '0')) glMode = m; else glMode = 'auto'; } catch (e) { }   // un mode mémorisé avant la bascule automatique repasse en auto
    renderBtn3d();
    $('#btn-3d').onclick = () => { if (itin.on) itinStop(); saveGlMode(glOn ? '0' : '1'); set3d(!glOn); };
    document.addEventListener('keydown', (e) => { if (!itin.on || document.querySelector('dialog[open]') || isTyping()) return; if (e.key === 'ArrowRight') { itin.playing = false; itinGo(itin.step + 1); } else if (e.key === 'ArrowLeft') { itin.playing = false; itinGo(itin.step - 1); } else if (e.key === 'Escape') itinStop(); });
    if (glMode === '1') set3d(true, { silent: true });
    // bascule automatique : zoomer sur l'orthophoto (geste) fait passer en 3D
    map.on('zoomend', () => { if (glMode !== 'auto' || glOn || glUnsupported) return; if (map.getZoom() > GL_IN) set3d(true, { silent: true }); });   // geste, fiche ouverte, zoom sur entité : au-delà du seuil, 3D
    if (glMode === 'auto' && map.getZoom() > GL_IN) set3d(true, { silent: true });
  }
  /* Zoom sur une entité : plage (cadrée sur sa taille), lieu, hébergement ou journée (parcours), en 2D comme en 3D.
     Sur téléphone, le panneau se replie pour laisser voir la carte. */
  function zoomTo(target) {
    if (!map) return;
    const mobile = isMobile();
    const go = (lat, lon, z) => {
      const p = map.project([lat, lon], z); if (mobile) p.y += sheetVisible() / 2 * 0.5;
      progMove(() => map.setView(map.unproject(p, z), z, { animate: true }));
      if (is3d()) progMove(() => gl.flyTo({ center: [lon, lat], zoom: z - 1, offset: glOffset(), duration: 900 }));
    };
    if (target.spot) { const s = target.spot; go(latlng(s)[0], latlng(s)[1], aerialZoom(s, map.getSize().x, 15, 18)); }
    else if (target.poi) go(target.poi.lat, target.poi.lon, 17);
    else if (target.base) go(target.base.lat, target.base.lon, 15);
    else if (target.day) {
      const route = dayRoute(target.day), pts = route.seq.length ? route.seq : [];
      if (!pts.length) { toast('Aucune étape localisée'); return; }
      const b = L.latLngBounds(pts).pad(0.2), bottom = mobile ? Math.round(window.innerHeight * 0.30) : 0;
      progMove(() => map.fitBounds(b, { paddingTopLeft: [16, 60], paddingBottomRight: [16, bottom + 16], maxZoom: 15 }));
      if (is3d()) progMove(() => gl.fitBounds([[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]], { padding: { top: 70, left: 16, right: 16, bottom: bottom + 24 }, maxZoom: 14, duration: 800 }));
    }
    if (mobile) setSheet('peek');
    buzz(6);
  }
  /* Bouton cible de la carte : la sélection, sinon ce que montre l'onglet courant. */
  function zoomContext() {
    if (!$('#panel-poi').hidden && currentPoi && poiById(currentPoi)) return zoomTo({ poi: poiById(currentPoi) });
    if (state.selected && spotById(state.selected)) return zoomTo({ spot: spotById(state.selected) });
    if (state.view === 'wishes') { if (wishList().length) { fitWishes(); if (isMobile()) setSheet('peek'); } else toast('Aucune envie à cadrer'); return; }
    if (state.view === 'trip') { if (state.trip.days.some((d) => d.stops.length) || state.trip.base) { fitTrip(); if (isMobile()) setSheet('peek'); } else toast('Aucune étape à cadrer'); return; }
    fitAll(); if (isMobile()) setSheet('peek'); toast('Toute la côte');
  }
  function fitAll() {
    if (!state.spots.length) return;
    viewBounds = null;
    const b = L.latLngBounds(state.spots.map(latlng)), mobile = isMobile();
    const bottom = mobile ? Math.round(window.innerHeight * 0.58) : 0;
    progMove(() => map.fitBounds(b, { paddingTopLeft: [16, 16], paddingBottomRight: [16, bottom + 16], animate: false }));
    if (is3d()) progMove(() => gl.fitBounds([[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]], { padding: glPadding(), pitch: 45, bearing: 0, duration: 0 }));
  }
  function paintMarkers() {
    const vis = new Set(filtered().map((s) => s.properties.id));
    const colA = cssVar('--a'), colB = cssVar('--b'), colBoth = cssVar('--both');
    const cols = { none: cssVar('--none') }; for (const c of C.scoreClasses) cols[c.key] = cssVar('--' + c.key);
    for (const s of state.spots) {
      const id = s.properties.id, m = markers.get(id);
      if (!vis.has(id)) { if (map.hasLayer(m)) map.removeLayer(m); continue; }
      if (!map.hasLayer(m)) m.addTo(map);
      const r = state.bulk ? scoreOf(s) : { cls: 'none' }, w = wishOf(id), sel = state.selected === id;
      if (state.view === 'wishes' || state.view === 'trip') {
        if (state.view === 'wishes' && (w.a || w.b || suggestedTo(state.me, id))) { map.removeLayer(m); continue; }
        if (state.view === 'trip' && tripHasSpot(id)) { map.removeLayer(m); continue; }
        m.setStyle({ fillColor: cols[r.cls], radius: 4, color: '#fff', weight: 1, fillOpacity: .45 });
        continue;
      }
      m.setStyle({ fillColor: cols[r.cls], radius: sel ? 11 : (w.a || w.b ? 9 : 7), fillOpacity: .95,
        color: sel ? '#111' : w.a && w.b ? colBoth : w.a ? colA : w.b ? colB : '#fff', weight: sel ? 3 : (w.a || w.b ? 3 : 2) });
      if (sel) m.bringToFront();
    }
    paintWishLayer(); paintTripLayer(); paintPlanLayer(); paint3d();
  }
  /* Lieux secondaires retenus (programmes) et parcours du séjour : visibles dans toutes les vues. */
  function paintPlanLayer() {
    if (!planLayer) planLayer = L.layerGroup().addTo(map);
    planLayer.clearLayers();
    const colBoth = cssVar('--both');
    for (const [sid, pn] of Object.entries(state.plans)) {
      const s = spotById(sid); if (!s || !pn.items.length) continue;
      const from = latlng(s);
      for (const it of pn.items) {
        const x = it.poi && poiById(it.poi); if (!x) continue;
        const k = C.poiKinds[x.p.kind] || C.poiKinds.tourism;
        L.polyline([from, [x.lat, x.lon]], { color: k.color, weight: 1.5, dashArray: '3 4', opacity: .8, interactive: false }).addTo(planLayer);
        const icon = L.divIcon({ className: '', html: `<div class="poi-pin sel" style="background:${k.color};box-shadow:0 0 0 3px ${colBoth},0 1px 4px rgba(0,0,0,.4)">${I(k.icon, { size: 13 })}</div>`, iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12] });
        L.marker([x.lat, x.lon], { icon, title: x.p.name, zIndexOffset: 900 }).bindTooltip(`${x.p.name} · programme de ${s.properties.name}`, { className: 'spot-tip', direction: 'top', offset: [0, -12] })
          .on('click', () => showPoi(x, { pan: false })).addTo(planLayer);
      }
    }
    if (state.view !== 'trip') state.trip.days.forEach((d, i) => {
      const route = dayRoute(d);
      if (route.seq.length > 1) L.polyline(route.seq, { color: dayColor(i), weight: 2.5, opacity: .35, dashArray: '6 6', interactive: false }).addTo(planLayer);
    });
    if (state.view !== 'trip' && state.trip.base) L.marker([state.trip.base.lat, state.trip.base.lon], { icon: L.divIcon({ className: '', html: `<div class="home-pin" style="opacity:.75">${I('home', { size: 15 })}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }), title: state.trip.base.name, zIndexOffset: 800, interactive: false }).addTo(planLayer);
  }
  function panTo(s) {
    const z = Math.max(map.getZoom(), C.poiMinZoom + 1), mobile = isMobile(), p = map.project(latlng(s), z);
    if (mobile) p.y += (sheet.classList.contains('full') ? 0 : sheetVisible() / 2);
    progMove(() => map.setView(map.unproject(p, z), z, { animate: true }));
    if (is3d()) progMove(() => gl.flyTo({ center: [latlng(s)[1], latlng(s)[0]], zoom: Math.max(gl.getZoom(), 13.5), offset: glOffset(), duration: 900 }));
  }
  /* ==================== 50-chrome.js ==================== */
  /* ------------------------------------------------------------------ en-tête, jours, profil */
  function renderChrome() {
    $('#btn-settings').classList.toggle('on', state.view === 'config');
    $('#brand-mark').innerHTML = I('wave', { size: 18 });
    $('#brand-name').textContent = state.region.short || state.region.name;
    $('#brand-sub').textContent = state.region.subtitle || 'plages & criques';
    renderFiltersBtn();
    $('#btn-settings').innerHTML = I('gear', { size: 20 });
    $('#btn-locate').innerHTML = I('locate', { size: 20 });
    $('#btn-target').innerHTML = I('frame', { size: 20 });
    $('#btn-share').innerHTML = I('share', { size: 20 });
    $('#search-ic').innerHTML = I('search', { size: 18 });
    $('.close', $('#dlg-pick')).innerHTML = I('x', { size: 18 });
  }
  function renderWho() {
    const me = state.me, other = me === 'a' ? 'b' : 'a', ini = (k) => esc(String(state.users[k].name || '?')[0].toUpperCase());
    $('#who').innerHTML = (state.serverUser ? `<button type="button" class="sync-btn" id="sync-btn" aria-label="État de la synchronisation"><span class="sync-dot" id="sync-dot"></span></button>` : '')
      + `<button type="button" class="me" data-k="${me}" title="Sur cet appareil, je suis ${esc(state.users[me].name)}" aria-label="Je suis ${esc(state.users[me].name)}"><span class="avatar ${me} on"><span>${ini(me)}</span></span><span class="n">${esc(state.users[me].name)}</span></button>`
      + `<button type="button" class="avatar ${other} other" data-k="${other}" title="${sync.on ? esc(state.users[other].name) : 'Passer à ' + esc(state.users[other].name)}" aria-label="${sync.on ? esc(state.users[other].name) : 'Passer à ' + esc(state.users[other].name)}"><span>${ini(other)}</span></button>`;
    if ($('#sync-btn')) { $('#sync-btn').onclick = () => { toast(syncStatusText()); if (sync.dirty && !sync.pushing) syncFlush(); else if (!sync.on) syncPoll(); }; renderSyncDot(); }
    $('#who').querySelectorAll('button[data-k]').forEach((b) => b.onclick = () => {
      if (sync.on) { toast(b.dataset.k === me ? `Connecté·e en tant que ${state.users[me].name}` : `${state.users[other].name} : envies et notes en lecture seule ici`); return; }
      if (b.dataset.k === me) { toast(`Envies et notes de ${state.users[me].name}`); return; }
      state.me = b.dataset.k; save(); renderWho(); if (state.selected) renderPlanCard(state.selected); renderList({ keep: true }); toast(`Sur cet appareil : ${state.users[state.me].name}`);
    });
  }
  function bestDot(i) {
    if (!state.bulk) return 'none';
    let best = -1;
    for (const s of filtered({ ignoreScore: true, inView: true })) { const sc = scoreOf(s, i).score; if (sc != null && sc > best) best = sc; }
    if (best < 0) return 'none';
    return C.scoreClasses.find((c) => best >= c.min).key;
  }
  function renderDays() {
    const el = $('#days'); el.innerHTML = '';
    const dates = state.bulk ? state.bulk.dates : Array.from({ length: C.forecastDays }, (_, i) => addDays(F.todayLocal(), i));
    dates.forEach((iso, i) => {
      const { lbl, sub } = fmtDay(iso, i), b = document.createElement('button');
      b.className = 'day' + (i === state.day ? ' on' : ''); b.type = 'button'; b.setAttribute('aria-pressed', String(i === state.day));
      b.innerHTML = `<b>${lbl}</b><small>${sub}</small><i style="background:var(--${bestDot(i)})"></i>`;
      b.onclick = () => { state.day = i; renderDays(); renderList(); paintMarkers(); if (state.selected) renderDetailDay(i); };
      el.appendChild(b);
    });
    const onDay = el.children[state.day];
    if (onDay) el.scrollLeft = onDay.offsetLeft - (el.clientWidth - onDay.clientWidth) / 2;
  }
  function renderProfiles() {
    $('#profile-seg').innerHTML = Object.entries(C.profiles).map(([k, p]) => `<button type="button" role="tab" data-k="${k}" class="${k === state.profile ? 'on' : ''}" title="${esc(p.label)}">${k === state.profile ? I(p.icon, { size: 15 }) : ''}${esc(p.short)}</button>`).join('');
    $('#profile-seg').querySelectorAll('button').forEach((b) => b.onclick = () => { state.profile = b.dataset.k; save(); renderProfiles(); renderDays(); renderList(); paintMarkers(); if (state.selected) renderDetailDay(detailDay); });
  }
  /* ==================== 55-wishes.js ==================== */
  /* ------------------------------------------------------------------ onglets & vue Envies */
  function renderTabs() {
    $('#btn-settings').classList.toggle('on', state.view === 'config');
    const n = wishedIds().length, nt = state.trip.days.reduce((k, d) => k + d.stops.length, 0), nf = [...state.fresh].filter((id) => { const w = wishOf(id); return (w.a || w.b || suggestedTo(state.me, id)) && spotById(id); }).length;
    $('#tabs').innerHTML = `<button type="button" role="tab" aria-selected="${state.view === 'explore'}" data-v="explore" class="${state.view === 'explore' ? 'on' : ''}">${I('compass', { size: 16 })}Explorer</button>
      <button type="button" role="tab" aria-selected="${state.view === 'wishes'}" data-v="wishes" class="${state.view === 'wishes' ? 'on' : ''}">${I('heart', { size: 16, fill: state.view === 'wishes' })}Envies${nf ? `<b class="new" title="${nf} nouvelle${nf > 1 ? 's' : ''} envie${nf > 1 ? 's' : ''} de ${esc(state.users[state.me === 'a' ? 'b' : 'a'].name)}">+${nf}</b>` : n ? `<b>${n}</b>` : ''}</button>
      <button type="button" role="tab" aria-selected="${state.view === 'trip'}" data-v="trip" class="${state.view === 'trip' ? 'on' : ''}">${I('calendar', { size: 16 })}Séjour${nt ? `<b>${nt}</b>` : ''}</button>`;
    $('#tabs').querySelectorAll('button').forEach((b) => b.onclick = () => setView(b.dataset.v));
  }
  let skipPop = false;   // retour d'historique provoqué par un changement d'onglet : ne rien rouvrir
  function setView(v) {
    if (state.view === 'wishes' && v !== 'wishes' && state.fresh.size) { state.fresh.clear(); saveSyncMeta(); }
    state.view = v;
    if (state.selected && !$('#panel-detail').hidden) {   // fermer la fiche tout de suite ; l'historique est dépilé sans nouveau rendu
      state.selected = null; $('#panel-detail').hidden = true; $('#panels').scrollTop = 0;
      if (history.state && history.state.spot) { skipPop = true; history.back(); } else if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    }
    $('#panel-list').hidden = v !== 'explore'; $('#panel-wishes').hidden = v !== 'wishes'; $('#panel-trip').hidden = v !== 'trip'; $('#panel-config').hidden = v !== 'config'; $('#panel-poi').hidden = true; currentPoi = null;
    if (/^#poi=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    renderTabs(); paintMarkers();
    if (v === 'wishes') { renderWishes(); fitWishes(); } else if (v === 'trip') { renderTrip(); fitTrip(); } else if (v === 'config') { renderConfig(); } else { renderDays(); renderList(); }
    if (v === 'config' && isMobile()) setSheet('full');
    if (v !== 'explore' && !state.pois.length) ensurePois().then(() => { if (state.view === v) { (v === 'wishes' ? renderWishes : v === 'config' ? renderConfig : renderTrip)(); paintMarkers(); } });
  }
  function wishList() {
    const who = state.wishWho, sugg = (state.users[state.me].suggest || []).filter((id) => spotById(id) && !state.users[state.me].wish.includes(id));
    let ids = wishedIds().filter((id) => { const w = wishOf(id); return who === 'all' ? true : who === 'both' ? w.a && w.b : w[who]; });
    if (who === 'all' || who === state.me) ids = [...new Set([...ids, ...sugg])];
    const arr = ids.map(spotById);
    if (state.wishSort === 'score' && state.bulk) arr.sort((a, b) => (scoreOf(b).score ?? -1) - (scoreOf(a).score ?? -1));
    else arr.sort((a, b) => a.geometry.coordinates[0] - b.geometry.coordinates[0]);
    return arr;
  }
  function planSummary(id) {
    const pn = state.plans[id]; if (!pn || !pn.items.length) return '';
    return pn.items.map((it) => it.text || (poiById(it.poi)?.p.name ?? '…')).slice(0, 3).join(', ') + (pn.items.length > 3 ? ` +${pn.items.length - 3}` : '');
  }
  /* Notes des deux voyageurs, chacune avec son initiale (liste des envies). */
  function notesHtml(id) {
    const pn = state.plans[id]; if (!pn) return '';
    const rows = ['a', 'b'].filter((k) => pn.notes[k]).map((k) => `<span><i style="background:var(--${k})">${esc(String(state.users[k].name || '?')[0].toUpperCase())}</i>${esc(pn.notes[k].slice(0, 70))}${pn.notes[k].length > 70 ? '…' : ''}</span>`);
    return rows.length ? `<div class="notes">${rows.join('')}</div>` : '';
  }
  function renderWishes() {
    const dot = (k) => `<i style="width:10px;height:10px;border-radius:50%;background:var(--${k});display:inline-block"></i>`;
    seg($('#w-who'), [['all', 'Tous'], ['a', dot('a') + esc(state.users.a.name)], ['b', dot('b') + esc(state.users.b.name)], ['both', 'Communes']], state.wishWho, (v) => { state.wishWho = v; save(); renderWishes(); paintMarkers(); fitWishes(); }, { a: 'a', b: 'b', both: 'both' });
    seg($('#w-sort'), [['coast', "D'ouest en est"], ['score', 'Meilleur score']], state.wishSort, (v) => { state.wishSort = v; save(); renderWishes(); paintMarkers(); });
    const act = $('#w-activity'), entries = (sync.log || []).slice(-6).reverse();
    act.hidden = !sync.on || !entries.length;
    if (!act.hidden) act.innerHTML = `<div class="h"><span>${I('bell', { size: 14 })} Activité</span><span style="font-weight:400;color:var(--muted)">${syncStatusText()}</span></div><ul>${entries.map((e) => `<li><span>${e.text.startsWith('a ') ? (e.by === state.me ? 'Vous avez ' : esc(e.name) + ' a ') + esc(e.text.slice(2)) : (e.by === state.me ? 'Vous ' : esc(e.name) + ' ') + esc(e.text)}</span><small>${ago(e.t * 1000)}</small></li>`).join('')}</ul>`;
    const list = wishList(), ul = $('#w-list');
    const wa = state.users.a.wish.length, wb = state.users.b.wish.length, both = state.users.a.wish.filter((id) => state.users.b.wish.includes(id)).length;
    const ns = state.wishWho === 'all' || state.wishWho === state.me ? (state.users[state.me].suggest || []).filter((id) => spotById(id) && !state.users[state.me].wish.includes(id)).length : 0;
    $('#w-summary').innerHTML = `<span>${dot('a')} ${wa} · ${dot('b')} ${wb} · ${dot('both')} ${both} commune${both > 1 ? 's' : ''}${ns ? ` · ${ns} proposée${ns > 1 ? 's' : ''}` : ''}</span><span>${list.length} plage${list.length > 1 ? 's' : ''}</span>`;
    if (!list.length) {
      ul.innerHTML = `<li class="empty-state"><span>Aucune envie pour l'instant.</span><span>Marquez des plages avec ${I('heart', { size: 14 })} dans l'onglet Explorer, chacun avec son prénom. Les envies communes ressortent ici.</span></li>`;
      $('#w-foot').innerHTML = ''; return;
    }
    const frag = document.createDocumentFragment();
    list.forEach((s, i) => {
      const p = s.properties, r = state.bulk ? scoreOf(s) : null, w = wishOf(p.id), d = state.bulk ? F.dayOf(state.bulk, s, state.day) : null;
      const sug = !w.a && !w.b && suggestedTo(state.me, p.id), who = w.a && w.b ? 'both' : w.a ? 'a' : w.b ? 'b' : (state.me === 'a' ? 'b' : 'a');
      const li = document.createElement('li'); li.className = 'item' + (state.selected === p.id ? ' sel' : ''); li.dataset.id = p.id;
      li.style.gridTemplateColumns = '44px 64px minmax(0, 1fr) 36px';
      const cond = d && d.tmax != null ? `<span>${wIcon(d.code, 14)}${n0(d.tmax, '°')}</span><span class="mu">${I('drop', { size: 14 })}${n0(d.pprob, ' %')}</span><span class="sea">${I('wave', { size: 14 })}${n1(d.wave, ' m')}</span>` : '';
      li.innerHTML = `
        <div class="num c-${r ? r.cls : 'none'}">${i + 1}<small style="background:var(--${who})">${who === 'both' ? '2' : esc(state.users[who].name[0].toUpperCase())}</small></div>
        ${aerialHtml(latlng(s)[0], latlng(s)[1], aerialZoom(s, 64, 13, 17, 0.85), 64, 64, 'thumb')}
        <div class="body">
          <div class="name"><span>${esc(p.name)}</span><span class="tag">${p.type}</span>${state.fresh.has(p.id) ? '<span class="tag new">nouveau</span>' : ''}</div>
          <div class="meta">${esc([p.province, surfaceLbl(p)].filter(Boolean).join(' · '))}${r && r.score != null ? ` · <b style="color:var(--${r.cls})">${r.score}</b> ${esc(r.label)}` : ''}</div>
          ${sug ? `<div class="sugg-row">${I('bell', { size: 13 })}Proposé par ${esc(state.users[state.me === 'a' ? 'b' : 'a'].name)}<button type="button" class="linkbtn ignore">Ignorer</button></div>` : planSummary(p.id) ? `<div class="plan">${I('note', { size: 13 })}${esc(planSummary(p.id))}</div>` : `<div class="cond">${cond}</div>`}${notesHtml(p.id)}
        </div>
        <div class="hearts">
          <button type="button" class="heart a ${w.a ? 'on' : ''} ${canEdit('a') ? '' : 'ro'}" data-who="a" aria-label="Envie de ${esc(state.users.a.name)}" aria-pressed="${w.a}">${I('heart', { size: 15, fill: w.a })}</button>
          <button type="button" class="heart b ${w.b ? 'on' : ''} ${canEdit('b') ? '' : 'ro'}" data-who="b" aria-label="Envie de ${esc(state.users.b.name)}" aria-pressed="${w.b}">${I('heart', { size: 15, fill: w.b })}</button>
        </div>`;
      li.querySelectorAll('.heart').forEach((h) => h.onclick = (e) => { e.stopPropagation(); toggleWish(p.id, h.dataset.who); });
      const ig = li.querySelector('.ignore'); if (ig) ig.onclick = (e) => { e.stopPropagation(); ignoreSuggest(p.id); };
      li.onclick = () => select(p.id, { pan: true, full: true });
      frag.appendChild(li);
    });
    ul.innerHTML = ''; ul.appendChild(frag);
    const pts = list.map(latlng);
    let gmaps = null;
    if (pts.length === 1) gmaps = `https://www.google.com/maps/dir/?api=1&destination=${pts[0].join(',')}`;
    else if (pts.length > 1) { const mid = pts.slice(1, -1).slice(0, 9); gmaps = `https://www.google.com/maps/dir/?api=1&origin=${pts[0].join(',')}&destination=${pts[pts.length - 1].join(',')}${mid.length ? '&waypoints=' + mid.map((x) => x.join(',')).join('|') : ''}`; }
    $('#w-foot').innerHTML = `<a class="btn primary big" style="display:flex;align-items:center;justify-content:center;gap:8px" href="${gmaps}" target="_blank" rel="noopener">${I('route', { size: 18 })}Itinéraire Google Maps · ${Math.min(pts.length, 11)} étape${pts.length > 1 ? 's' : ''}</a>
      ${pts.length > 11 ? '<span class="hint">Google Maps accepte 11 étapes au plus : les premières d\'ouest en est sont retenues.</span>' : ''}
      <div class="row"><button type="button" class="btn ghost" id="w-share" style="flex:1">Partager le lien</button>${sync.on ? '' : `<button type="button" class="btn ghost" id="w-code" style="flex:1">${I('copy', { size: 14 })} Copier le code</button>`}<button type="button" class="btn ghost" id="w-export" style="flex:1">Exporter (GeoJSON)</button></div>
      ${sync.on ? '' : '<span class="hint">Le lien est un instantané : il ajoute les envies, programmes et séjour sur l\'autre téléphone, sans jamais en retirer. Sur iPhone, si le lien s\'ouvre hors de l\'application installée, collez plutôt le code dans « Code séjour » à la connexion.</span>'}`;
    $('#w-share').onclick = share; $('#w-export').onclick = exportSelection; $('#w-code') && ($('#w-code').onclick = copyCode);
  }
  function fitWishes() {
    const list = wishList(); if (!list.length) return;
    viewBounds = null;
    const b = L.latLngBounds(list.map(latlng)), mobile = isMobile(), bottom = mobile ? Math.round(window.innerHeight * 0.58) : 0;
    progMove(() => map.fitBounds(b.pad(0.15), { paddingTopLeft: [16, 60], paddingBottomRight: [16, bottom + 16], maxZoom: 12 }));
    if (is3d()) { const p = b.pad(0.15); progMove(() => gl.fitBounds([[p.getWest(), p.getSouth()], [p.getEast(), p.getNorth()]], { padding: glPadding(), maxZoom: 12, pitch: 50, duration: 700 })); }
  }
  function paintWishLayer() {
    if (!wishLayer) wishLayer = L.layerGroup().addTo(map);
    wishLayer.clearLayers();
    if (state.view !== 'wishes') return;
    const list = wishList();
    if (list.length > 1) L.polyline(list.map(latlng), { color: cssVar('--both'), weight: 2, dashArray: '4 6', opacity: .7 }).addTo(wishLayer);
    list.forEach((s, i) => {
      const p = s.properties, r = state.bulk ? scoreOf(s) : { cls: 'none' }, w = wishOf(p.id), who = w.a && w.b ? 'both' : w.a ? 'a' : w.b ? 'b' : (state.me === 'a' ? 'b' : 'a');
      const icon = L.divIcon({ className: '', html: `<div class="num-pin ${who}" style="background:var(--${r.cls})">${i + 1}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      L.marker(latlng(s), { icon, title: p.name, zIndexOffset: 1000 }).on('click', () => select(p.id, { pan: false })).addTo(wishLayer);
    });
  }
  /* ==================== 60-trip.js ==================== */
  /* ------------------------------------------------------------------ séjour (jours, étapes, hébergement) */
  const todayIso = () => (state.bulk ? state.bulk.dates[0] : F.todayLocal());
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  function ensureTrip() {
    const t = state.trip;
    if (!t.start) t.start = todayIso();
    if (!t.days.length) t.days = [{ stops: [] }, { stops: [] }, { stops: [] }];
  }
  const dayIso = (i) => addDays(state.trip.start, i);
  const dayColor = (i) => DAY_COLORS[i % DAY_COLORS.length];
  const dayLabel = (i) => { const d = new Date(dayIso(i) + 'T12:00:00'); return `${dayNames[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };
  const forecastIdx = (iso) => (state.bulk ? state.bulk.dates.indexOf(iso) : -1);
  const tripHasSpot = (id) => state.trip.days.some((d) => d.stops.some((st) => st.t === 's' && st.id === id));
  function stopInfo(st) {
    if (st.t === 's') { const s = spotById(st.id); if (!s) return null; const [lat, lon] = latlng(s); return { name: s.properties.name, lat, lon, kind: 'spot', sub: s.properties.type === 'cala' ? 'crique' : 'plage', spot: s }; }
    if (st.t === 'p') { const x = poiById(st.id); if (!x) return null; const k = C.poiKinds[x.p.kind] || C.poiKinds.tourism; return { name: x.p.name, lat: x.lat, lon: x.lon, kind: 'poi', icon: k.icon, color: k.color, sub: k.label, poi: x }; }
    return { name: st.text, kind: 'text', sub: 'activité' };
  }
  function addStop(di, st, { withPlan = true } = {}) {
    ensureTrip();
    const day = state.trip.days[di]; if (!day) return;
    const key = (x) => x.t + ':' + (x.id || x.text);
    if (day.stops.some((x) => key(x) === key(st))) return false;
    day.stops.push(st);
    if (withPlan && st.t === 's') for (const it of (state.plans[st.id]?.items || [])) {
      const extra = it.poi ? { t: 'p', id: it.poi } : { t: 'x', text: it.text };
      if (!day.stops.some((x) => key(x) === key(extra))) day.stops.push(extra);
    }
    save(); return true;
  }
  function dayRoute(day) {
    const pts = day.stops.map(stopInfo).filter((x) => x && x.lat != null).map((x) => [x.lat, x.lon]);
    const b = state.trip.base ? [state.trip.base.lat, state.trip.base.lon] : null;
    const seq = b ? (state.prefs.roundTrip ? [b, ...pts, b] : [b, ...pts]) : pts;
    let km = 0; for (let i = 1; i < seq.length; i++) km += distKm(seq[i - 1], seq[i]);
    let url = null;
    if (seq.length >= 2) {
      const o = seq[0], d = seq[seq.length - 1], mid = seq.slice(1, -1).slice(0, 9);
      url = `https://www.google.com/maps/dir/?api=1&origin=${o.join(',')}&destination=${d.join(',')}${mid.length ? '&waypoints=' + mid.map((x) => x.join(',')).join('|') : ''}`;
    } else if (seq.length === 1) url = `https://www.google.com/maps/dir/?api=1&destination=${seq[0].join(',')}`;
    return { km: km * 1.3, url, pts, seq };
  }
  /* Déroulé horaire estimé d'une journée : départ à l'heure choisie, trajets à 45 km/h sur la distance
     corrigée, durées par type d'étape ; le déjeuner attend 12 h 30 s'il arrive trop tôt. */
  const DUR = { playa: 150, cala: 90, restaurant: 75, beach_bar: 75, bar: 45, cafe: 30, culture: 60, tourism: 60, text: 45 };
  const hm = (min) => { const m = Math.max(0, Math.round(min)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
  const isMeal = (info) => info.kind === 'poi' && ['restaurant', 'beach_bar'].includes(info.poi.p.kind);
  function dayTimeline(day) {
    const start = (state.prefs.startHour || 10) * 60, base = state.trip.base ? { lat: state.trip.base.lat, lon: state.trip.base.lon } : null;
    let t = start, prev = base, meals = 0; const slots = [], warns = [];
    const unresolved = day.stops.some((st) => !stopInfo(st));   // lieux pas encore chargés : pas d'alerte hâtive
    day.stops.forEach((st) => {
      const info = stopInfo(st); if (!info) { slots.push(null); return; }
      let km = 0;
      if (info.lat != null && prev && prev.lat != null) { km = distKm([prev.lat, prev.lon], [info.lat, info.lon]) * 1.3; t += km / 45 * 60; }
      let late = false;
      if (isMeal(info) && meals++ === 0) { if (t < 12 * 60 + 30) t = 12 * 60 + 30; if (t > 14 * 60 + 30) { late = true; warns.push(`Déjeuner à ${hm(t)} chez ${info.name} : tard. Avancer l'étape ?`); } }
      const d = info.kind === 'spot' ? DUR[info.spot.properties.type] || DUR.playa : info.kind === 'poi' ? DUR[info.poi.p.kind] || 60 : DUR.text;
      slots.push({ start: t, end: t + d, late, km }); t += d;
      if (info.kind === 'spot' && info.spot.properties.tidal === 'yes') warns.push(`${info.name} dépend de la marée : vérifier l'heure de pleine mer dans sa fiche.`);
      if (info.lat != null) prev = info;
    });
    if (base && state.prefs.roundTrip && prev && prev.lat != null && prev !== base) t += distKm([prev.lat, prev.lon], [base.lat, base.lon]) * 1.3 / 45 * 60;
    if (slots.some(Boolean) && t > 19 * 60 + 30) warns.push(`Retour vers ${hm(t)} : journée chargée, retirer une étape ?`);
    if (state.prefs.lunch && day.stops.length && !meals && !unresolved) warns.push('Pas de déjeuner prévu : « Ajouter une étape » propose les restos possibles.');
    return { slots, end: t, start, warns: unresolved ? [] : warns };
  }
  function proposeTrip({ silent = false } = {}) {
    ensureTrip();
    const t = state.trip, n = t.days.length;
    let cands = wishedIds().map(spotById);
    if (!cands.length) cands = state.spots.slice();
    if (!state.bulk) { if (!silent) toast('Prévisions nécessaires pour proposer un planning'); return; }
    const base = t.base ? [t.base.lat, t.base.lon] : null;
    if (base && state.prefs.radiusKm) cands = cands.filter((s) => distKm(base, latlng(s)) <= state.prefs.radiusKm) .length ? cands.filter((s) => distKm(base, latlng(s)) <= state.prefs.radiusKm) : cands;
    const lockedIds = new Set(t.days.flatMap((d) => d.stops.filter((st) => st.lock && st.t === 's').map((st) => st.id)));
    cands = cands.filter((s) => !lockedIds.has(s.properties.id));
    const perDay = Math.max(1, Math.min(state.prefs.perDay || 2, Math.ceil((cands.length + lockedIds.size) / n)));
    // score jour × spot ; pénalité de distance à l'hébergement ; 2 à 3 plages par jour maximum ; les étapes verrouillées restent
    const scored = [];
    for (const s of cands) for (let i = 0; i < n; i++) {
      const fi = forecastIdx(dayIso(i)); if (fi < 0) continue;
      const sc = scoreOf(s, fi).score; if (sc == null) continue;
      const pen = base ? Math.min(20, distKm(base, latlng(s)) / 5) : 0;
      scored.push({ s, i, v: sc - pen });
    }
    scored.sort((a, b) => b.v - a.v);
    const used = new Set(), counts = t.days.map((d) => d.stops.filter((st) => st.lock && st.t === 's').length), picked = t.days.map(() => []);
    const wished = wishedIds().length > 0;
    for (const { s, i } of scored) {
      if (used.has(s.properties.id) || counts[i] >= perDay) continue;
      if (!wished && counts.reduce((a, b) => a + b, 0) >= n * 2) break;
      used.add(s.properties.id); counts[i]++;
      picked[i].push({ t: 's', id: s.properties.id });
    }
    t.days.forEach((d, i) => {
      const locked = d.stops.filter((st) => st.lock), lon = (st) => spotById(st.id)?.geometry.coordinates[0] ?? 0;
      const beachesAll = [...locked.filter((st) => st.t === 's'), ...picked[i]].sort((x, y) => lon(x) - lon(y));   // d'ouest en est, verrous compris
      d.stops = [...beachesAll.filter((st) => st.lock), ...locked.filter((st) => st.t !== 's')];
      beachesAll.filter((st) => !st.lock).forEach((st) => addStop(i, st));
      { const idx = d.stops.map((st, k) => (st.t === 's' ? k : -1)).filter((k) => k >= 0), sortedSpots = idx.map((k) => d.stops[k]).sort((x, y) => lon(x) - lon(y)); idx.forEach((k, j) => { d.stops[k] = sortedSpots[j]; }); }
      const firstBeach = d.stops.findIndex((x) => x.t === 's');
      if (state.prefs.lunch && firstBeach >= 0 && !d.stops.some((x) => x.t === 'p' && ['restaurant', 'beach_bar'].includes(poiById(x.id)?.p.kind))) {
        const c = latlng(spotById(d.stops[firstBeach].id));   // resto retenu dans un programme du jour, sinon le plus proche de la première plage
        const r = state.pois.filter((x) => ['restaurant', 'beach_bar'].includes(x.p.kind)).map((x) => ({ x, dd: distKm(c, [x.lat, x.lon]) })).filter((o) => o.dd < 1.5).sort((a, b) => a.dd - b.dd)[0];
        if (r) { addStop(i, { t: 'p', id: r.x.id }); const k = d.stops.findIndex((x) => x.t === 'p' && x.id === r.x.id); if (k > firstBeach + 1) { const [m] = d.stops.splice(k, 1); d.stops.splice(firstBeach + 1, 0, m); } }
      }
    });
    save(); renderTabs(); if (state.view === 'trip') { renderTrip(); paintMarkers(); if (!silent) fitTrip(); }
    if (!silent) toast(!scored.length ? 'Aucune prévision pour ces dates : rapprochez le séjour des 7 prochains jours' : !cands.length && lockedIds.size ? 'Toutes vos envies sont déjà verrouillées : rien à ajouter' : wished ? 'Planning proposé à partir de vos envies' : 'Planning proposé avec les meilleures plages');
  }
  /* Séjour dynamique : à chaque mise à jour des prévisions, le planning est recalculé (mode auto). */
  function autoReplan() {
    if (!state.trip.auto || !state.bulk) return;
    if (sync.on && state.trip.autoBy && state.trip.autoBy !== state.me) return;   // l'appareil qui a activé le mode dynamique recalcule, pas les deux
    ensurePois().then(() => { proposeTrip({ silent: true }); });
  }
  function manualEdit() { if (state.trip.auto) { state.trip.auto = false; state.trip.autoBy = null; save(); toast('Planning figé : modifications manuelles conservées'); } }
  function renderTrip() {
    ensureTrip();
    const t = state.trip, el = $('#trip');
    const baseHtml = t.base
      ? `<div class="base-name"><span class="home">${I('home', { size: 16 })}</span><span>${esc(t.base.name)}</span><button type="button" class="linkbtn" id="base-zoom" style="margin-left:auto" title="Voir sur la carte">${I('frame', { size: 14 })}</button><button type="button" class="linkbtn" id="base-clear">Changer</button></div>`
      : `<span class="hint">Définissez votre hébergement : chaque journée part de là et y revient.</span>
         <div class="base-search"><input type="search" id="base-q" placeholder="Rechercher un lieu, un village, une plage…" autocomplete="off"><button type="button" class="iconbtn" id="base-geo" title="Ma position" aria-label="Ma position">${I('locate', { size: 18 })}</button><button type="button" class="iconbtn ${state.pickBase ? 'on' : ''}" id="base-map" title="Choisir sur la carte" aria-label="Choisir sur la carte">${I('pin', { size: 18 })}</button></div>
         <div class="sugg" id="base-sugg" hidden></div>`;
    const daysHtml = t.days.map((d, i) => {
      const fi = forecastIdx(dayIso(i)), route = dayRoute(d), tl = dayTimeline(d);
      const stops = d.stops.map((st, k) => {
        const info = stopInfo(st); if (!info) return '';
        const slot = tl.slots[k], tm = slot ? `<em class="tm ${slot.late ? 'late' : ''}">${hm(slot.start)}</em>` : '';
        const leg = slot && slot.km ? `${slot.km.toFixed(0)} km` : '';
        let sc = '';
        if (info.kind === 'spot' && fi >= 0) { const r = scoreOf(info.spot, fi); sc = `<span class="sc"><i style="background:var(--${r.cls})"></i>${r.score ?? '—'}</span>`; }
        const badge = info.kind === 'spot' ? `<span class="n">${k + 1}</span>` : info.kind === 'poi' ? `<span class="n poi" style="background:${info.color}">${I(info.icon, { size: 12 })}</span>` : `<span class="n poi">${I('compass', { size: 12 })}</span>`;
        return `<li data-k="${k}">${badge}<span class="t">${st.lock ? `<span class="lk" title="Étape conservée par le planificateur">${I('lock', { size: 12 })}</span>` : ''}${esc(info.name)}${info.kind === 'spot' && info.spot.properties.tidal === 'yes' ? `<span class="tide" title="Dépend de la marée">${I('clock', { size: 12 })}</span>` : ''} <small>· ${esc(info.sub)}</small></span><span class="d">${tm}<span>${sc} ${leg}</span></span>
          <span class="grip" title="Glisser pour réordonner" aria-hidden="true">${I('grip', { size: 16 })}</span><button type="button" class="ib menu-btn" data-k="${k}" aria-label="Actions">${I('sliders', { size: 16 })}</button></li>`;
      }).join('');
      let wx = '';
      if (fi >= 0 && d.stops.some((st) => st.t === 's')) { const s0 = spotById(d.stops.find((st) => st.t === 's').id); const dd = F.dayOf(state.bulk, s0, fi); wx = `${wIcon(dd.code, 16)} ${n0(dd.tmax, '°')}`; }
      return `<div class="card day-card" style="--dc:${dayColor(i)}" data-i="${i}">
        <div class="h"><div><b>Jour ${i + 1}</b> <small>· ${dayLabel(i)}</small></div><span style="display:flex;align-items:center;gap:6px">${wx}</span></div>
        ${stops ? `<ul class="stops">${stops}</ul>` : '<span class="hint">Aucune étape. Ajoutez une plage : son programme (resto, visite…) suit automatiquement.</span>'}
        ${tl.warns.map((w) => `<div class="day-warn">${I('info', { size: 14 })}<span>${esc(w)}</span></div>`).join('')}
        <div class="day-foot">
          <button type="button" class="linkbtn add-stop" data-i="${i}">${I('plus', { size: 14 })} Ajouter une étape</button>
          ${d.stops.length ? `<button type="button" class="linkbtn zoom-day" data-i="${i}" title="Voir la journée sur la carte">${I('frame', { size: 14 })} Carte</button><button type="button" class="linkbtn itin-day" data-i="${i}" title="Suivre cette journée en 3D">${I('route', { size: 14 })} 3D</button>` : ''}
          ${route.url ? `${tl.slots.some(Boolean) ? `<span class="tl">${I('clock', { size: 14 })} ${hm(tl.start)} → ${hm(tl.end)}</span>` : ''}<span>${I('car', { size: 14 })} ~${Math.round(route.km)} km${t.base && state.prefs.roundTrip ? ' A/R' : ''}</span><a href="${route.url}" target="_blank" rel="noopener">${I('route', { size: 14 })}Google Maps</a>` : ''}
        </div></div>`;
    }).join('');
    el.innerHTML = `
      <div class="card"><div class="h"><h3>${I('home', { size: 13 })} Hébergement</h3></div>${baseHtml}</div>
      <div class="card"><div class="h"><h3>${I('calendar', { size: 13 })} ${t.days.length} jour${t.days.length > 1 ? 's' : ''} · du ${dayLabel(0)} au ${dayLabel(t.days.length - 1)}</h3>
        <div class="stepper"><button type="button" id="days-minus" aria-label="Un jour de moins">${I('minus', { size: 16 })}</button><button type="button" id="days-plus" aria-label="Un jour de plus">${I('plus', { size: 16 })}</button></div></div>
        <div class="row" style="align-items:center;gap:8px;flex-wrap:wrap">
          <button type="button" class="auto-chip ${t.auto ? 'on' : ''}" id="trip-auto" title="Recalculer le planning à chaque mise à jour des prévisions">${I('refresh', { size: 13 })}${t.auto ? 'Dynamique' : 'Manuel'}</button>
          <button type="button" class="auto-chip" id="trip-config">${I('sliders', { size: 13 })}Réglages</button>
          <span class="hint" style="flex-basis:100%">${t.auto ? 'Le planning suit les prévisions : il est recalculé à chaque rafraîchissement, sauf si vous modifiez une étape. Les étapes verrouillées (menu d\'une étape) sont toujours conservées.' : 'Vos étapes sont conservées telles quelles. Horaires estimés : départ ' + (state.prefs.startHour || 10) + ' h, trajets à 45 km/h, environ 2 h 30 par plage, 1 h 15 au resto.'}</span>
        </div>
        <button type="button" class="btn ghost" id="trip-propose" style="display:flex;align-items:center;justify-content:center;gap:8px">${I('wand', { size: 16 })}Proposer un planning selon la météo</button>
        ${t.days.some((d) => d.stops.length) ? `<button type="button" class="btn ghost" id="trip-itin" style="display:flex;align-items:center;justify-content:center;gap:8px">${I('route', { size: 16 })}Suivre l'itinéraire en 3D, jour par jour</button>` : ''}</div>
      ${daysHtml}
      <div class="row"><button type="button" class="btn ghost" id="trip-share" style="flex:1">Partager le séjour</button><button type="button" class="btn ghost" id="trip-clear" style="flex:1">Tout effacer</button></div>`;
    // hébergement
    $('#base-clear') && ($('#base-clear').onclick = () => { t.base = null; save(); renderTrip(); paintMarkers(); });
    $('#base-zoom') && ($('#base-zoom').onclick = () => zoomTo({ base: t.base }));
    const q = $('#base-q');
    if (q) {
      q.oninput = () => {
        const v = q.value.trim().toLowerCase(), box = $('#base-sugg');
        if (v.length < 2) { box.hidden = true; return; }
        const hits = [...state.spots.filter((s) => s.properties.name.toLowerCase().includes(v)).slice(0, 4).map((s) => ({ name: s.properties.name, sub: s.properties.type === 'cala' ? 'crique' : 'plage', lat: latlng(s)[0], lon: latlng(s)[1], icon: 'wave' })),
          ...state.pois.filter((x) => x.p.name.toLowerCase().includes(v)).slice(0, 6).map((x) => ({ name: x.p.name, sub: (C.poiKinds[x.p.kind] || C.poiKinds.tourism).label + (x.p.addr_city ? ' · ' + x.p.addr_city : ''), lat: x.lat, lon: x.lon, icon: (C.poiKinds[x.p.kind] || C.poiKinds.tourism).icon }))];
        box.hidden = !hits.length;
        box.innerHTML = hits.map((h, k) => `<button type="button" data-k="${k}">${I(h.icon, { size: 14 })}<span>${esc(h.name)}</span><small>${esc(h.sub)}</small></button>`).join('');
        box.querySelectorAll('button').forEach((b) => b.onclick = () => { const h = hits[+b.dataset.k]; t.base = { name: h.name, lat: h.lat, lon: h.lon }; save(); renderTrip(); paintMarkers(); fitTrip(); });
      };
      $('#base-geo').onclick = () => navigator.geolocation?.getCurrentPosition((pos) => { t.base = { name: 'Ma position', lat: +pos.coords.latitude.toFixed(5), lon: +pos.coords.longitude.toFixed(5) }; save(); renderTrip(); paintMarkers(); fitTrip(); }, () => toast('Position introuvable'));
      $('#base-map').onclick = () => { state.pickBase = !state.pickBase; renderTrip(); toast(state.pickBase ? 'Touchez la carte pour placer l\'hébergement' : 'Sélection annulée'); if (state.pickBase && isMobile()) setSheet('peek'); };
    }
    // jours
    $('#days-minus').onclick = () => { if (t.days.length > 1) { t.days.pop(); save(); renderTabs(); renderTrip(); paintMarkers(); } };
    $('#days-plus').onclick = () => { if (t.days.length < 14) { t.days.push({ stops: [] }); save(); renderTrip(); } };
    $('#trip-propose').onclick = async () => { if (!t.days.some((d) => d.stops.length) || await confirmDlg('Remplacer les étapes actuelles par une proposition ?', { ok: 'Remplacer', hint: 'Les étapes non verrouillées (plages, restos, visites) sont remplacées ; le planning reste manuel ensuite, sauf si vous activez « Dynamique ».' })) ensurePois().then(() => proposeTrip()); };
    $('#trip-auto').onclick = () => { t.auto = !t.auto; t.autoBy = t.auto ? state.me : null; save(); renderTrip(); if (t.auto) { toast('Planning dynamique : recalculé à chaque mise à jour des prévisions'); ensurePois().then(() => proposeTrip({ silent: true })); } };
    $('#trip-config').onclick = () => setView('config');
    $('#trip-share').onclick = share;
    $('#trip-clear').onclick = async () => { if (await confirmDlg('Effacer hébergement et étapes ?', { ok: 'Tout effacer', danger: true })) { state.trip = { base: null, start: null, days: [], auto: false }; save(); renderTabs(); renderTrip(); paintMarkers(); } };
    el.querySelectorAll('.add-stop').forEach((b) => b.onclick = () => pickStop(+b.dataset.i));
    el.querySelectorAll('.zoom-day').forEach((b) => b.onclick = () => zoomTo({ day: t.days[+b.dataset.i] }));
    el.querySelectorAll('.itin-day').forEach((b) => b.onclick = () => itinStart(+b.dataset.i));
    $('#trip-itin') && ($('#trip-itin').onclick = () => itinStart(t.days.findIndex((d) => d.stops.length)));
    el.querySelectorAll('.day-card').forEach((card) => {
      const i = +card.dataset.i, d = t.days[i];
      card.querySelectorAll('.menu-btn').forEach((b) => b.onclick = (e) => { e.stopPropagation(); stepMenu(i, +b.dataset.k); });
      card.querySelectorAll('.stops li').forEach((li) => li.onclick = () => {
        const st = d.stops[+li.dataset.k]; if (!st) return;
        if (st.t === 's') select(st.id, { pan: true, full: true }); else if (st.t === 'p' && poiById(st.id)) showPoi(poiById(st.id)); else stepMenu(i, +li.dataset.k);
      });
      const ul = card.querySelector('.stops'); if (ul) bindStopDrag(ul, i);
    });
  }
  /* Réordonner les étapes au doigt : la poignée (touch-action: none) démarre le glissement sans appui long. */
  function bindStopDrag(ul, di) {
    let drag = null;
    const unbind = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', end); };
    const move = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        for (const other of [...ul.children]) {
          if (other === drag.li) continue;
          const r = other.getBoundingClientRect(), mid = r.top + r.height / 2, after = !!(other.compareDocumentPosition(drag.li) & Node.DOCUMENT_POSITION_FOLLOWING);
          if (after && e.clientY < mid) { ul.insertBefore(drag.li, other); buzz(4); break; }
          if (!after && e.clientY > mid) { ul.insertBefore(drag.li, other.nextSibling); buzz(4); break; }
        }
      };
    const end = (e) => {
        if (!drag) { unbind(); return; }
        if (e.pointerId !== drag.id) return;
        unbind();
        drag.li.classList.remove('dragging');
        const order = [...ul.children].map((li) => +li.dataset.k), d = state.trip.days[di]; drag = null;
        const complete = order.length === d.stops.length && new Set(order).size === order.length && order.every((k) => k >= 0 && k < d.stops.length);
        if (!complete || order.every((k, i) => k === i)) { if (!complete) renderTrip(); return; }   // étapes non rendues (lieux pas encore chargés) : on ne réordonne pas à l'aveugle
        d.stops = order.map((k) => d.stops[k]); manualEdit(); save(); renderTabs(); renderTrip(); paintMarkers();
    };
    ul.querySelectorAll('.grip').forEach((g) => {
      g.addEventListener('click', (e) => e.stopPropagation());
      g.addEventListener('pointerdown', (e) => {
        const li = g.closest('li'); if (!li || drag) return;
        e.preventDefault(); e.stopPropagation(); g.setPointerCapture?.(e.pointerId);
        drag = { li, from: +li.dataset.k, id: e.pointerId }; li.classList.add('dragging'); buzz(8);
        document.addEventListener('pointermove', move); document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);   // suivi même sans capture de pointeur
      });
    });
  }
  function pickStop(di) {
    const dlg = $('#dlg-pick'); if (dlg.open) dlg.close();
    const day = state.trip.days[di], fi = forecastIdx(dayIso(di));
    const inDay = new Set(day.stops.map((st) => st.t + ':' + (st.id || st.text)));
    $('#pick-title').textContent = `Ajouter au jour ${di + 1} · ${dayLabel(di)}`;
    const scoreTag = (s) => { if (fi < 0 || !state.bulk) return ''; const r = scoreOf(s, fi); return `<span class="sub" style="color:var(--${r.cls});font-weight:700">${r.score ?? '—'}</span>`; };
    const wish = wishedIds().map(spotById).filter((s) => !inDay.has('s:' + s.properties.id));
    const best = state.bulk && fi >= 0 ? state.spots.filter((s) => !inDay.has('s:' + s.properties.id) && !wish.includes(s)).sort((a, b) => (scoreOf(b, fi).score ?? -1) - (scoreOf(a, fi).score ?? -1)).slice(0, 8) : [];
    const beaches = day.stops.filter((st) => st.t === 's').map((st) => spotById(st.id)).filter(Boolean);
    const last = [...day.stops].reverse().map(stopInfo).find((x) => x && x.lat != null);
    const anchors = beaches.length ? beaches.map((s) => ({ name: s.properties.name, lat: latlng(s)[0], lon: latlng(s)[1] })) : (last ? [last] : []);
    const seen = new Set();
    // retenus : compléments des programmes des plages du jour (puis des autres programmes), pas encore dans la journée
    let kept = [];
    for (const s of [...beaches, ...wishedIds().map(spotById).filter((s) => s && !beaches.includes(s))]) for (const it of (state.plans[s.properties.id]?.items || [])) {
      const x = it.poi && poiById(it.poi), key = x ? 'p:' + x.id : 'x:' + it.text; if ((it.poi && !x) || inDay.has(key) || seen.has(key)) continue;
      seen.add(key); kept.push({ x, text: it.text, by: it.by, beach: s.properties.name, mine: beaches.includes(s) });
    }
    kept = [...kept.filter((o) => o.mine), ...kept.filter((o) => !o.mine)].slice(0, 10);   // les programmes des plages du jour d'abord
    // possibles : restos et bars de plage à moins de 1,5 km, visites à moins de 3 km des plages du jour
    const around = (kinds, km, n) => { const best = new Map(); for (const a of anchors) for (const x of state.pois) { if (!kinds.includes(x.p.kind) || inDay.has('p:' + x.id) || seen.has('p:' + x.id)) continue; const d = distKm([a.lat, a.lon], [x.lat, x.lon]); if (d <= km && (!best.has(x.id) || best.get(x.id).d > d)) best.set(x.id, { x, d, beach: a.name }); } const out = [...best.values()].sort((p, q) => p.d - q.d).slice(0, n); out.forEach((o) => seen.add('p:' + o.x.id)); return out; };
    const restos = around(['restaurant', 'beach_bar'], 1.5, 6), visits = around(['culture', 'tourism'], 3, 5);
    const row = (s) => `<button type="button" data-t="s" data-id="${esc(s.properties.id)}">${I('wave', { size: 14 })}<span>${esc(s.properties.name)}</span>${scoreTag(s)}</button>`;
    const prow = (o, sub) => { if (!o.x) return `<button type="button" data-t="x" data-text="${esc(o.text)}"><span class="poi-pin" style="background:var(--accent);width:22px;height:22px">${I('compass', { size: 12 })}</span><span>${esc(o.text)}</span><span class="sub by">${sub}</span></button>`; const k = C.poiKinds[o.x.p.kind] || C.poiKinds.tourism; return `<button type="button" data-t="p" data-id="${esc(o.x.id)}"><span class="poi-pin" style="background:${k.color};width:22px;height:22px">${I(k.icon, { size: 12 })}</span><span>${esc(o.x.p.name)}</span><span class="sub ${o.by ? 'by' : ''}">${sub}</span></button>`; };
    $('#pick-list').innerHTML = (kept.length ? `<h4>Retenus dans vos programmes</h4>${kept.map((o) => prow(o, `${esc(state.users[o.by === 'b' ? 'b' : 'a'].name)} · ${esc(o.beach)}`)).join('')}` : '') +
      (restos.length ? `<h4>Restos possibles ${anchors.length ? 'autour de ' + esc(anchors.map((a) => a.name).join(', ')) : ''}</h4>${restos.map((o) => prow(o, `${esc((C.poiKinds[o.x.p.kind] || C.poiKinds.tourism).label)} · ${Math.round(o.d * 1000)} m`)).join('')}` : '') +
      (visits.length ? `<h4>Visites possibles</h4>${visits.map((o) => prow(o, `${esc((C.poiKinds[o.x.p.kind] || C.poiKinds.tourism).label)} · ${o.d < 1 ? Math.round(o.d * 1000) + ' m' : o.d.toFixed(1) + ' km'}`)).join('')}` : '') +
      (wish.length ? `<h4>Vos envies</h4>${wish.map(row).join('')}` : '') +
      (best.length ? `<h4>Meilleures plages ce jour-là</h4>${best.map(row).join('')}` : '') +
      `<h4>Autre</h4><div class="plan-add"><input type="text" id="pick-text" maxlength="80" placeholder="Étape libre : marché, pause café…"><button type="button" id="pick-text-add" aria-label="Ajouter">${I('plus', { size: 18 })}</button></div>`;
    const done = () => { dlg.close(); save(); renderTabs(); renderTrip(); paintMarkers(); };
    $('#pick-list').querySelectorAll('button[data-t]').forEach((b) => b.onclick = () => { manualEdit(); addStop(di, b.dataset.t === 'x' ? { t: 'x', text: b.dataset.text } : { t: b.dataset.t, id: b.dataset.id }); done(); });
    $('#pick-text-add').onclick = () => { const v = $('#pick-text').value.trim(); if (v) { manualEdit(); addStop(di, { t: 'x', text: v }); done(); } };
    dlg.showModal();
  }
  /* Confirmation dans le dialogue de l'application (remplace confirm()). */
  function confirmDlg(title, { ok = 'Confirmer', danger = false, hint = '' } = {}) {
    return new Promise((resolve) => {
      const dlg = $('#dlg-pick'); if (dlg.open) dlg.close();
      $('#pick-title').textContent = title;
      $('#pick-list').innerHTML = `${hint ? `<span class="hint">${esc(hint)}</span>` : ''}<div class="menu"><button type="button" data-a="ok" class="${danger ? 'danger' : ''}">${I(danger ? 'trash' : 'check', { size: 16 })}${esc(ok)}</button><button type="button" data-a="no">${I('x', { size: 16 })}Annuler</button></div>`;
      let res = false;
      $('#pick-list').querySelectorAll('button').forEach((b) => b.onclick = () => { res = b.dataset.a === 'ok'; dlg.close(); });
      dlg.addEventListener('close', () => resolve(res), { once: true });
      dlg.showModal();
    });
  }
  function pickDayFor(stopOrId, label, after) {
    ensureTrip();
    const stop = typeof stopOrId === 'string' ? { t: 's', id: stopOrId } : stopOrId;
    const dlg = $('#dlg-pick'); if (dlg.open) dlg.close();
    $('#pick-title').textContent = `${label ? label + ' · ' : ''}Ajouter à quel jour ?`;
    $('#pick-list').innerHTML = `<div class="menu">` + state.trip.days.map((d, i) => { const fi = forecastIdx(dayIso(i)); const s = stop.t === 's' ? spotById(stop.id) : null; const r = s && fi >= 0 && state.bulk ? scoreOf(s, fi) : null;
      const has = d.stops.some((x) => x.t === stop.t && x.id === stop.id);
      return `<button type="button" data-i="${i}" ${has ? 'disabled style="opacity:.5"' : ''}><span class="n" style="width:26px;height:26px;border-radius:50%;background:${dayColor(i)};color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center">${i + 1}</span><span>Jour ${i + 1} · ${dayLabel(i)}</span><span class="sub">${has ? 'déjà' : d.stops.length + ' étape' + (d.stops.length > 1 ? 's' : '')}${r ? ` · <b style="color:var(--${r.cls})">${r.score ?? '—'}</b>` : ''}</span></button>`; }).join('') +
      `<button type="button" data-i="new"><span class="n" style="width:26px;height:26px;border-radius:50%;background:var(--line);display:grid;place-items:center">${I('plus', { size: 14 })}</span><span>Nouveau jour</span></button></div>`;
    $('#pick-list').querySelectorAll('button').forEach((b) => b.onclick = () => {
      if (b.dataset.i === 'new' && state.trip.days.length >= 14) { toast('14 jours au plus'); return; }
      const i = b.dataset.i === 'new' ? (state.trip.days.push({ stops: [] }), state.trip.days.length - 1) : +b.dataset.i;
      manualEdit(); const ok = addStop(i, stop); dlg.close(); renderTabs(); paintMarkers(); buzz();
      toast(ok ? `Ajouté au jour ${i + 1}` : 'Déjà dans ce jour');
      if (stop.t === 's' && state.selected === stop.id) renderDetailHead();
      if (state.view === 'trip') renderTrip();
      if (after) after();
    });
    dlg.showModal();
  }
  /* Menu d'actions d'une étape (mobile) : voir, monter, descendre, déplacer, retirer. */
  function stepMenu(di, k) {
    const t = state.trip, d = t.days[di], st = d.stops[k], info = stopInfo(st); if (!info) return;
    const dlg = $('#dlg-pick'); if (dlg.open) dlg.close();
    $('#pick-title').textContent = info.name;
    const others = t.days.map((_, i) => i).filter((i) => i !== di);
    $('#pick-list').innerHTML = `<div class="menu">
      ${info.kind !== 'text' ? `<button type="button" data-a="view">${I(info.kind === 'spot' ? 'wave' : 'pin', { size: 16 })}Voir ${info.kind === 'spot' ? 'la plage' : 'le lieu'}</button>` : ''}
      <button type="button" data-a="lock">${I('lock', { size: 16 })}${st.lock ? 'Libérer cette étape' : 'Garder cette étape'}<span class="sub">${st.lock ? 'le planificateur peut la remplacer' : 'conservée par le planificateur'}</span></button>
      <button type="button" data-a="up" ${k === 0 ? 'disabled style="opacity:.4"' : ''}>${I('up2', { size: 16 })}Monter</button>
      <button type="button" data-a="down" ${k === d.stops.length - 1 ? 'disabled style="opacity:.4"' : ''}>${I('down', { size: 16 })}Descendre</button>
      ${others.map((i) => `<button type="button" data-a="move" data-i="${i}"><span class="n" style="width:22px;height:22px;border-radius:50%;background:${dayColor(i)};color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center">${i + 1}</span>Déplacer vers le jour ${i + 1}<span class="sub">${dayLabel(i)}</span></button>`).join('')}
      <button type="button" data-a="rm" class="danger">${I('trash', { size: 16 })}Retirer de ce jour</button></div>`;
    $('#pick-list').querySelectorAll('button').forEach((b) => b.onclick = () => {
      const act = b.dataset.a; dlg.close();
      if (act === 'view') { if (st.t === 's') select(st.id, { pan: true, full: true }); else showPoi(poiById(st.id)); return; }
      if (act === 'lock') { if (st.lock) delete st.lock; else st.lock = true; save(); renderTrip(); buzz(); toast(st.lock ? 'Étape conservée par le planificateur' : 'Étape libérée'); return; }
      manualEdit();
      if (act === 'up') [d.stops[k - 1], d.stops[k]] = [d.stops[k], d.stops[k - 1]];
      else if (act === 'down') [d.stops[k + 1], d.stops[k]] = [d.stops[k], d.stops[k + 1]];
      else if (act === 'move') { const key = (x) => x.t + ':' + (x.id || x.text); if (t.days[+b.dataset.i].stops.some((x) => key(x) === key(st))) { toast('Déjà dans ce jour'); return; } d.stops.splice(k, 1); t.days[+b.dataset.i].stops.push(st); }
      else if (act === 'rm') d.stops.splice(k, 1);
      save(); renderTabs(); renderTrip(); paintMarkers(); buzz();
    });
    dlg.showModal();
  }
  function fitTrip() {
    viewBounds = null;
    const pts = [];
    if (state.trip.base) pts.push([state.trip.base.lat, state.trip.base.lon]);
    for (const d of state.trip.days) for (const st of d.stops) { const x = stopInfo(st); if (x && x.lat != null) pts.push([x.lat, x.lon]); }
    if (!pts.length) return;
    const mobile = isMobile(), bottom = mobile ? Math.round(window.innerHeight * 0.58) : 0;
    progMove(() => map.fitBounds(L.latLngBounds(pts).pad(0.15), { paddingTopLeft: [16, 60], paddingBottomRight: [16, bottom + 16], maxZoom: 12 }));
    if (is3d()) { const p = L.latLngBounds(pts).pad(0.15); progMove(() => gl.fitBounds([[p.getWest(), p.getSouth()], [p.getEast(), p.getNorth()]], { padding: glPadding(), maxZoom: 12, pitch: 50, duration: 700 })); }
  }
  function paintTripLayer() {
    if (!tripLayer) tripLayer = L.layerGroup().addTo(map);
    tripLayer.clearLayers();
    if (state.view !== 'trip') return;
    const t = state.trip;
    if (t.base) L.marker([t.base.lat, t.base.lon], { icon: L.divIcon({ className: '', html: `<div class="home-pin">${I('home', { size: 15 })}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }), title: t.base.name, zIndexOffset: 1200 }).bindTooltip(t.base.name, { className: 'spot-tip', direction: 'top', offset: [0, -14] }).addTo(tripLayer);
    t.days.forEach((d, i) => {
      const route = dayRoute(d);
      if (route.seq.length > 1) L.polyline(route.seq, { color: dayColor(i), weight: 3, opacity: .75, dashArray: t.base ? null : '4 6' }).addTo(tripLayer);
      let n = 0;
      d.stops.forEach((st) => { const x = stopInfo(st); if (!x || x.lat == null) return;
        const isSpot = x.kind === 'spot'; if (isSpot) n++;
        const icon = L.divIcon({ className: '', html: `<div class="day-pin ${isSpot ? '' : 'poi'}" style="background:${isSpot ? dayColor(i) : x.color}">${isSpot ? n : I(x.icon, { size: 10 })}</div>`, iconSize: isSpot ? [26, 26] : [18, 18], iconAnchor: isSpot ? [13, 13] : [9, 9] });
        L.marker([x.lat, x.lon], { icon, title: x.name, zIndexOffset: 1000 }).bindTooltip(`J${i + 1} · ${x.name}`, { className: 'spot-tip', direction: 'top', offset: [0, -12] })
          .on('click', () => { if (isSpot) select(st.id, { pan: false }); else showPoi(x.poi); }).addTo(tripLayer);
      });
    });
  }
  /* ==================== 65-config.js ==================== */
  /* ------------------------------------------------------------------ page de configuration */
  function renderConfig() {
    ensureTrip();
    const t = state.trip, pr = state.prefs, el = $('#config');
    const sw = (id, on, label, hint) => `<div class="switch"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span><button type="button" class="tg ${on ? 'on' : ''}" id="${id}" role="switch" aria-checked="${on}" aria-label="${label}"></button></div>`;
    const endIso = dayIso(t.days.length - 1);
    el.innerHTML = `
      <h2>Configuration</h2>
      <div class="card"><div class="h"><h3>${I('users', { size: 13 })} Voyageurs</h3></div>
        <div class="two"><label class="f"><span style="color:var(--a)">Voyageur 1</span><input type="text" id="c-a" maxlength="14" value="${esc(state.users.a.name)}"></label>
        <label class="f"><span style="color:var(--b)">Voyageur 2</span><input type="text" id="c-b" maxlength="14" value="${esc(state.users.b.name)}"></label></div>
        <label class="f">Sur cet appareil, je suis<div class="seg" id="c-me"></div></label>
        ${auth ? `<div class="acct"><span>${I('users', { size: 14 })} Compte <b>${esc(auth.user.name)}</b> <small>${esc(auth.user.email || '')}</small></span>
          <span>${I('calendar', { size: 14 })} Séjour <b>${esc((sync.ws || auth.ws).name || '')}</b> · ${((sync.ws || auth.ws).members || []).map((m) => `<i class="dot ${m.slot}" style="display:inline-block;width:10px;height:10px;vertical-align:-1px"></i> ${esc(m.name)}`).join(' · ') || 'vous seul pour l\'instant'}</span>
          <span>${I('copy', { size: 14 })} Code d'invitation <b id="c-invite">${esc((sync.ws || auth.ws).invite || '…')}</b> <button type="button" class="linkbtn" id="c-invite-copy">Copier</button></span>
          <span class="hint">L'autre voyageur crée un compte sur la page de connexion et saisit ce code : il rejoint ce séjour avec sa couleur.</span></div>
          <div class="btns"><a class="btn ghost" href="login.html" style="display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none">${I('calendar', { size: 14 })} Changer de séjour</a><button type="button" class="btn ghost" id="c-newcode">${I('refresh', { size: 14 })} Nouveau code</button><button type="button" class="btn ghost" id="c-pw">${I('lock', { size: 14 })} Mot de passe</button><button type="button" class="btn ghost" id="c-leave" style="color:var(--bad)">${I('trash', { size: 14 })} Quitter ce séjour</button><button type="button" class="btn ghost" id="c-logout">${I('x', { size: 14 })} Se déconnecter</button></div>`
        : state.serverUser && sync.ws && sync.ws.invite ? `<div class="acct"><span>${I('copy', { size: 14 })} Code d'invitation de ce séjour <b id="c-invite">${esc(sync.ws.invite)}</b> <button type="button" class="linkbtn" id="c-invite-copy">Copier</button></span><span class="hint">Avec un compte (page de connexion), ce code ouvre le même séjour depuis n'importe quel appareil, y compris la version publique.</span></div>
          <div class="btns"><a class="btn ghost" href="login.html" style="display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none">${I('users', { size: 14 })} Créer un compte / changer de séjour</a></div>`
        : `<div class="btns"><a class="btn ghost" href="login.html" style="display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none">${I('users', { size: 14 })} Se connecter / changer de voyageur</a></div>`}</div>
      <div class="card"><div class="h"><h3>${I('home', { size: 13 })} Résidence / hébergement</h3></div>
        ${t.base ? `<div class="base-name"><span class="home">${I('home', { size: 16 })}</span><span>${esc(t.base.name)}</span></div><span class="coords">${t.base.lat.toFixed(5)}, ${t.base.lon.toFixed(5)} · <a href="https://www.google.com/maps/search/?api=1&query=${t.base.lat},${t.base.lon}" target="_blank" rel="noopener">voir</a></span>` : '<span class="hint">Aucune résidence définie. Les journées partent et reviennent de ce point.</span>'}
        <div class="base-search"><input type="search" id="c-base-q" placeholder="Rechercher un village, un lieu, une plage…" autocomplete="off"></div>
        <div class="sugg" id="c-base-sugg" hidden></div>
        <div class="btns"><button type="button" class="btn ghost" id="c-base-geo">${I('locate', { size: 14 })} Ma position GPS</button><button type="button" class="btn ghost ${state.pickBase ? 'primary' : ''}" id="c-base-map">${I('pin', { size: 14 })} Point sur la carte</button>${t.base ? `<button type="button" class="btn ghost" id="c-base-clear">${I('trash', { size: 14 })} Effacer</button>` : ''}</div>
        <label class="f">Nom de la résidence<input type="text" id="c-base-name" maxlength="60" value="${esc(t.base ? t.base.name : '')}" placeholder="Ex. : appartement à Llanes" ${t.base ? '' : 'disabled'}></label></div>
      <div class="card"><div class="h"><h3>${I('calendar', { size: 13 })} Séjour</h3></div>
        <div class="two"><label class="f">Arrivée<input type="date" id="c-start" value="${t.start}"></label><label class="f">Départ<input type="date" id="c-end" value="${endIso}" min="${t.start}"></label></div>
        <span class="hint">${t.days.length} jour${t.days.length > 1 ? 's' : ''} · les prévisions couvrent 7 jours ; au-delà, les journées attendent leur météo.</span>
        ${sw('c-auto', t.auto, 'Planning dynamique', 'Recalculé à chaque mise à jour des prévisions, à partir de vos envies')}
        ${sw('c-round', pr.roundTrip, 'Retour quotidien à la résidence', 'Chaque journée part et revient à la résidence')}
        ${sw('c-lunch', pr.lunch, 'Déjeuner proposé', 'Ajoute le resto ou bar de plage le plus proche de la première plage du jour')}
        <label class="f">Départ le matin<select id="c-start-h">${[8, 9, 10, 11].map((h) => `<option value="${h}" ${(pr.startHour || 10) === h ? 'selected' : ''}>${h} h</option>`).join('')}</select></label>
        <div class="two"><label class="f">Plages par jour (max.)<select id="c-perday">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${pr.perDay === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="f">Rayon depuis la résidence<select id="c-radius">${[20, 40, 60, 100, 200].map((n) => `<option value="${n}" ${pr.radiusKm === n ? 'selected' : ''}>${n} km</option>`).join('')}</select></label></div></div>
      <div class="card"><div class="h"><h3>${I('sliders', { size: 13 })} Affichage</h3></div>
        <label class="f">Profil d'activité par défaut<div class="seg" id="c-profile"></div></label>
        ${sw('c-food', state.poiOn.food, 'Restos & bars sur la carte')}${sw('c-visit', state.poiOn.visit, 'Sites et visites sur la carte')}
        ${sw('c-3d', glMode === 'auto', 'Carte 3D automatique', 'Vue d\'ensemble en 2D, relief 3D dès qu\'on zoome ; le bouton 3D/2D fixe un mode')}</div>
      <div class="card"><div class="h"><h3>${I('download', { size: 13 })} Données</h3></div>
        ${sync.on ? `<span class="hint">Connecté au serveur : envies, programmes et séjour se synchronisent entre vos appareils (${esc(syncStatusText().toLowerCase())}).</span>` : '<span class="hint">Sans serveur, le lien de partage est un instantané fusionné sur l\'autre téléphone (ajouts seulement). « Copier le code » donne le même contenu à coller dans « Code séjour » à la connexion.</span>'}
        <div class="btns"><button type="button" class="btn ghost" id="c-share">${I('share', { size: 14 })} Partager le lien</button>${sync.on ? '' : `<button type="button" class="btn ghost" id="c-code">${I('copy', { size: 14 })} Copier le code</button>`}<button type="button" class="btn ghost" id="c-export">${I('download', { size: 14 })} Exporter (GeoJSON)</button><button type="button" class="btn ghost" id="c-refresh">${I('refresh', { size: 14 })} Rafraîchir les prévisions</button><button type="button" class="btn ghost" id="c-intro">${I('info', { size: 14 })} Revoir le guide</button><button type="button" class="btn ghost" id="c-reset" style="color:var(--bad)">${I('trash', { size: 14 })} Tout effacer</button></div></div>
      <div class="card"><div class="h"><h3>${I('info', { size: 13 })} À propos</h3></div>
        <span class="hint">${esc(state.region.name)} · ${state.spots.length} plages et criques · ${state.pois.length ? state.pois.length + ' lieux' : 'lieux chargés à la demande'} · version ${esc(assetVer || '—')}</span>
        <span class="hint">Données © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (ODbL) · prévisions <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0) · photos Wikimedia Commons, Flickr, Openverse (licences indiquées) · imagerie Esri · <a href="https://github.com/imagodata/costa-cantabrica-planner" target="_blank" rel="noopener">code source</a>.</span></div>`;
    if (state.serverUser) { const hint = document.createElement('span'); hint.className = 'hint'; hint.textContent = `Connecté en tant que « ${state.serverUser} » : votre place (${state.me === 'a' ? 'voyageur 1' : 'voyageur 2'}) est fixée par le séjour.`; $('#c-me').closest('.card').appendChild(hint); }
    $('#c-invite-copy') && ($('#c-invite-copy').onclick = async () => { const code = $('#c-invite').textContent; try { await navigator.clipboard.writeText(code); toast('Code d\'invitation copié'); } catch (e) { prompt('Code d\'invitation :', code); } });
    $('#c-logout') && ($('#c-logout').onclick = logout);
    $('#c-pw') && ($('#c-pw').onclick = () => {
      const dlg = $('#dlg-pick'); $('#pick-title').textContent = 'Changer le mot de passe';
      $('#pick-list').innerHTML = `<div class="config" style="padding:0"><label class="f">Mot de passe actuel<input type="password" id="pw-old" autocomplete="current-password"></label><label class="f">Nouveau mot de passe (8 caractères au moins)<input type="password" id="pw-new" autocomplete="new-password" minlength="8"></label><p class="err hint" id="pw-err" hidden style="color:var(--bad)"></p><button type="button" class="btn primary big" id="pw-go">Enregistrer</button></div>`;
      $('#pw-go').onclick = async () => {
        $('#pw-err').hidden = true;
        try { const r = await fetch(api('api/auth/password'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ password: $('#pw-old').value, newPassword: $('#pw-new').value }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); dlg.close(); toast('Mot de passe changé ; les autres appareils devront se reconnecter'); }
        catch (e) { $('#pw-err').textContent = e.message; $('#pw-err').hidden = false; }
      };
      dlg.showModal();
    });
    $('#c-newcode') && ($('#c-newcode').onclick = async () => { try { const r = await fetch(api('api/w/' + auth.ws.id), { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ newInvite: true }) }); if (!r.ok) throw new Error(); const j = await r.json(); auth.ws = { ...auth.ws, ...j.workspace }; sync.ws = j.workspace; saveAuth(); renderConfig(); toast('Nouveau code d\'invitation : l\'ancien ne fonctionne plus'); } catch (e) { toast('Impossible de changer le code pour le moment'); } });
    $('#c-leave') && ($('#c-leave').onclick = async () => { if (!await confirmDlg('Quitter ce séjour ?', { ok: 'Quitter', danger: true, hint: 'Vos envies et notes y restent pour l\'autre voyageur ; le code d\'invitation est renouvelé.' })) return; try { const r = await fetch(api('api/w/' + auth.ws.id + '/leave'), { method: 'POST', headers: authHeaders() }); if (!r.ok) throw new Error(); try { localStorage.removeItem(LS_STATE); localStorage.removeItem(LS_SYNC); } catch (e) { } auth.ws = null; saveAuth(); location.href = 'login.html'; } catch (e) { toast('Impossible de quitter le séjour pour le moment'); } });
    const commit = () => { save(); renderTabs(); renderWho(); };
    $('#c-a').onchange = (e) => { state.users.a.name = e.target.value.trim().slice(0, 14) || DEFAULT_NAMES[0]; commit(); renderConfig(); };
    $('#c-b').onchange = (e) => { state.users.b.name = e.target.value.trim().slice(0, 14) || DEFAULT_NAMES[1]; commit(); renderConfig(); };
    seg($('#c-me'), [['a', esc(state.users.a.name)], ['b', esc(state.users.b.name)]], state.me, (v) => { if (state.serverUser) { toast('Votre place est fixée par le séjour'); renderConfig(); return; } state.me = v; commit(); }, { a: 'a', b: 'b' });
    seg($('#c-profile'), Object.entries(C.profiles).map(([k, p]) => [k, esc(p.short)]), state.profile, (v) => { state.profile = v; save(); renderProfiles(); renderDays(); });
    const setBase = (b) => { t.base = b; state.pickBase = false; save(); renderConfig(); paintMarkers(); };
    const q = $('#c-base-q');
    q.oninput = () => {
      const v = q.value.trim().toLowerCase(), box = $('#c-base-sugg');
      if (v.length < 2) { box.hidden = true; return; }
      const hits = [...state.spots.filter((s) => s.properties.name.toLowerCase().includes(v)).slice(0, 4).map((s) => ({ name: s.properties.name, sub: s.properties.type === 'cala' ? 'crique' : 'plage', lat: latlng(s)[0], lon: latlng(s)[1], icon: 'wave' })),
        ...state.pois.filter((x) => x.p.name.toLowerCase().includes(v)).slice(0, 6).map((x) => ({ name: x.p.name, sub: (C.poiKinds[x.p.kind] || C.poiKinds.tourism).label + (x.p.addr_city ? ' · ' + x.p.addr_city : ''), lat: x.lat, lon: x.lon, icon: (C.poiKinds[x.p.kind] || C.poiKinds.tourism).icon }))];
      box.hidden = !hits.length;
      box.innerHTML = hits.map((h, k) => `<button type="button" data-k="${k}">${I(h.icon, { size: 14 })}<span>${esc(h.name)}</span><small>${esc(h.sub)}</small></button>`).join('');
      box.querySelectorAll('button').forEach((b) => b.onclick = () => { const h = hits[+b.dataset.k]; setBase({ name: h.name, lat: h.lat, lon: h.lon }); });
    };
    if (!state.pois.length) ensurePois();
    $('#c-base-geo').onclick = () => { if (!navigator.geolocation) return toast('Géolocalisation indisponible'); toast('Recherche de la position…');
      navigator.geolocation.getCurrentPosition((pos) => setBase({ name: t.base?.name && !/^Ma position|^Hébergement \(/.test(t.base.name) ? t.base.name : 'Ma position', lat: +pos.coords.latitude.toFixed(5), lon: +pos.coords.longitude.toFixed(5) }), () => toast('Position introuvable'), { enableHighAccuracy: true, timeout: 12000 }); };
    $('#c-base-map').onclick = () => { state.pickBase = !state.pickBase; renderConfig(); if (state.pickBase) { toast('Touchez la carte pour placer la résidence'); if (isMobile()) setSheet('peek'); } };
    $('#c-base-clear') && ($('#c-base-clear').onclick = () => setBase(null));
    $('#c-base-name').onchange = (e) => { if (t.base) { t.base.name = e.target.value.trim().slice(0, 60) || 'Résidence'; save(); renderConfig(); paintMarkers(); } };
    const setDays = (n) => { n = Math.max(1, Math.min(14, n)); while (t.days.length < n) t.days.push({ stops: [] }); t.days.length = n; };
    $('#c-start').onchange = (e) => { if (e.target.value) { const n = t.days.length; t.start = e.target.value; setDays(n); save(); renderConfig(); autoReplan(); } };
    $('#c-end').onchange = (e) => { if (e.target.value) { const n = Math.round((new Date(e.target.value) - new Date(t.start)) / 86400000) + 1; if (n < 1) { toast('Le départ précède l\'arrivée'); renderConfig(); return; } setDays(n); save(); renderTabs(); renderConfig(); autoReplan(); } };
    $('#c-auto').onclick = () => { t.auto = !t.auto; t.autoBy = t.auto ? state.me : null; save(); renderConfig(); if (t.auto) ensurePois().then(() => proposeTrip({ silent: true })); };
    $('#c-round').onclick = () => { pr.roundTrip = !pr.roundTrip; save(); renderConfig(); };
    $('#c-lunch').onclick = () => { pr.lunch = !pr.lunch; save(); renderConfig(); autoReplan(); };
    $('#c-perday').onchange = (e) => { pr.perDay = +e.target.value; save(); autoReplan(); };
    $('#c-start-h').onchange = (e) => { pr.startHour = +e.target.value; save(); renderConfig(); };
    $('#c-radius').onchange = (e) => { pr.radiusKm = +e.target.value; save(); autoReplan(); };
    $('#c-food').onclick = () => { state.poiOn.food = !state.poiOn.food; save(); renderLayerChips(); renderPois(); renderConfig(); };
    $('#c-visit').onclick = () => { state.poiOn.visit = !state.poiOn.visit; save(); renderLayerChips(); renderPois(); renderConfig(); };
    $('#c-3d').onclick = () => { if (glMode === 'auto') saveGlMode(glOn ? '1' : '0'); else { saveGlMode('auto'); if (!glOn && map.getZoom() >= GL_IN) set3d(true, { silent: true }); else if (glOn && gl && gl.getZoom() + 1 < GL_OUT) set3d(false, { silent: true }); } renderBtn3d(); renderConfig(); };
    $('#c-share').onclick = share; $('#c-code') && ($('#c-code').onclick = copyCode); $('#c-export').onclick = exportSelection; $('#c-refresh').onclick = () => loadForecast(true);
    $('#c-intro').onclick = () => { try { localStorage.removeItem('ccp:intro'); } catch (e) { } showIntro(); };
    $('#c-reset').onclick = async () => { if (await confirmDlg('Effacer envies, programmes, séjour et préférences sur cet appareil ?', { ok: 'Tout effacer', danger: true })) { try { localStorage.removeItem(LS_STATE); localStorage.removeItem(LS_SYNC); } catch (e) { } location.hash = ''; location.reload(); } };
  }
  /* ==================== 70-list.js ==================== */
  /* ------------------------------------------------------------------ liste */
  const LIST_CHUNK = 60;
  let listShown = LIST_CHUNK, listObserver = null, listKey = '';
  function renderList({ more = false, keep = false } = {}) {
    if (!more && !keep) listShown = LIST_CHUNK;
    const ul = $('#list'), list = sorted(filtered({ inView: true })), inView = !state.filters.q.trim() && !!mapBounds();
    let ideal = 0, good = 0;
    if (state.bulk) for (const s of list) { const c = scoreOf(s).cls; if (c === 'ideal') ideal++; else if (c === 'good') good++; }
    const fetched = state.bulk ? new Date(state.bulk.fetchedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null;
    $('#summary').innerHTML = (state.bulk ? `<span><b>${ideal} idéale${ideal > 1 ? 's' : ''}</b> · ${good} bonne${good > 1 ? 's' : ''} · ${list.length} plage${list.length > 1 ? 's' : ''}${inView ? ' dans la vue' : ''}</span>` : `<span>${list.length} plage${list.length > 1 ? 's' : ''}${inView ? ' dans la vue' : ''}</span>`) +
      `<span class="right"><button type="button" class="chip-mini ${state.mapFilter ? 'on' : ''}" id="sum-view" title="${state.mapFilter ? 'La liste suit la carte : touchez pour afficher toute la côte' : 'Caler la liste sur la carte'}" aria-pressed="${state.mapFilter}">${I('frame', { size: 13 })}Vue carte</button>` +
      (fetched ? `<button type="button" class="linkbtn" id="sum-refresh" title="Rafraîchir les prévisions (Open-Meteo)" style="min-height:28px;color:inherit;font-weight:500">${I('refresh', { size: 12 })}${fetched}</button>` : `<span class="warn">prévisions indisponibles</span>`) + '</span>';
    $('#sum-refresh') && ($('#sum-refresh').onclick = () => loadForecast(true));
    $('#sum-view').onclick = () => { state.mapFilter = !state.mapFilter; persistLocal(); renderDays(); renderList(); toast(state.mapFilter ? 'Liste calée sur la carte' : 'Toute la côte'); };
    // même contenu que le rendu précédent (déplacement de carte sans changement d'emprise utile, sondage sans nouveauté) : le DOM et ses vignettes restent
    const key = [list.slice(0, listShown).map((s) => s.properties.id).join(','), state.day, state.profile, state.selected, state.me, state.users.a.wish.join(','), state.users.b.wish.join(','), [...state.fresh].join(','), state.bulk && state.bulk.fetchedAt, state.userPos && state.userPos.join(','), !!state.serverUser, list.length > listShown].join('|');
    if (key === listKey && ul.querySelector('.item')) return;
    listKey = key;
    const frag = document.createDocumentFragment();
    for (const s of list.slice(0, listShown)) {
      const p = s.properties, r = state.bulk ? scoreOf(s) : null, d = state.bulk ? F.dayOf(state.bulk, s, state.day) : null, w = wishOf(p.id);
      const li = document.createElement('li');
      li.className = 'item' + (state.selected === p.id ? ' sel' : ''); li.dataset.id = p.id;
      const meta = [p.province, surfaceLbl(p), p.size_m ? `~${p.size_m.toLocaleString('fr-FR')} m` : null,
        state.userPos ? `${distKm(state.userPos, latlng(s)).toFixed(0)} km` : null].filter(Boolean).join(' · ');
      const cond = d && d.tmax != null ? `<span>${wIcon(d.code, 14)}${n0(d.tmax, '°')}</span><span class="mu">${I('drop', { size: 14 })}${n0(d.pprob, ' %')}</span><span class="mu">${I('wind', { size: 14 })}${n0(d.wind)} ${compass(d.wdir)}</span><span class="sea">${I('wave', { size: 14 })}${n1(d.wave, ' m')}</span>` : '';
      li.innerHTML = `
        <div class="score c-${r ? r.cls : 'none'}"><b>${r && r.score != null ? r.score : '—'}</b><small>${r ? esc(r.label) : ''}</small></div>
        ${aerialHtml(latlng(s)[0], latlng(s)[1], aerialZoom(s, 64, 13, 17, 0.85), 64, 64, 'thumb')}
        <div class="body">
          <div class="name"><span>${esc(p.name)}</span><span class="tag">${p.type}</span>${state.fresh.has(p.id) ? '<span class="tag new">nouveau</span>' : ''}${p.lifeguard === 'yes' ? '<span class="tag">surveillée</span>' : ''}${p.nudism === 'yes' ? '<span class="tag">naturiste</span>' : ''}</div>
          <div class="meta">${esc(meta)}</div>
          <div class="cond">${cond}</div>
        </div>
        <div class="hearts">
          <button type="button" class="heart a ${w.a ? 'on' : ''} ${canEdit('a') ? '' : 'ro'}" data-who="a" aria-label="Envie de ${esc(state.users.a.name)}">${I('heart', { size: 15, fill: w.a })}</button>
          <button type="button" class="heart b ${w.b ? 'on' : ''} ${canEdit('b') ? '' : 'ro'}" data-who="b" aria-label="Envie de ${esc(state.users.b.name)}">${I('heart', { size: 15, fill: w.b })}</button>
        </div>`;
      li.querySelectorAll('.heart').forEach((h) => h.onclick = (e) => { e.stopPropagation(); toggleWish(p.id, h.dataset.who); });
      li.onclick = () => select(p.id, { pan: true, full: true });
      frag.appendChild(li);
    }
    ul.innerHTML = ''; ul.appendChild(frag);
    if (!list.length) { ul.innerHTML = `<li class="empty-state"><span>Aucune plage ${inView ? 'dans cette partie de la carte' : `ne correspond${state.filters.q ? ` à « ${esc(state.filters.q)} »` : ' aux filtres'}`}.</span>${inView ? `<button type="button" class="btn ghost" id="list-all">Toute la côte</button>` : ''}${filtersActive() || state.filters.q ? `<button type="button" class="btn ghost" id="list-reset">Réinitialiser les filtres</button>` : ''}</li>`;
      $('#list-all') && ($('#list-all').onclick = () => { fitAll(); renderDays(); renderList(); });
      $('#list-reset') && ($('#list-reset').onclick = () => { Object.assign(state.filters, { province: 'all', type: 'all', surface: 'all', lifeguard: false, dog: false, minScore: 0, wish: 'all', q: '' }); $('#q').value = ''; save(); renderFiltersBtn(); renderDays(); renderList(); paintMarkers(); }); }
    if (list.length > listShown) {
      const li = document.createElement('li'); li.innerHTML = `<button type="button" class="more">Afficher ${Math.min(LIST_CHUNK, list.length - listShown)} de plus (${list.length - listShown} restants)</button>`;
      li.querySelector('button').onclick = () => { listShown += LIST_CHUNK; renderList({ more: true }); };
      ul.appendChild(li);
      // chargement automatique quand le bouton entre dans la vue
      if (!listObserver) listObserver = new IntersectionObserver((es) => { es.forEach((e) => { if (e.isIntersecting) { listShown += LIST_CHUNK; renderList({ more: true }); } }); }, { root: $('#panels'), rootMargin: '200px' });
      listObserver.disconnect(); listObserver.observe(li);
    } else if (listObserver) listObserver.disconnect();
  }
  /* ==================== 75-detail.js ==================== */
  /* ------------------------------------------------------------------ détail */
  const spotById = (id) => state.spots.find((s) => s.properties.id === id);
  async function select(id, { pan = true, full = false } = {}) {
    const s = spotById(id); if (!s) return;
    if (!$('#panel-detail').hidden === false) listScroll = $('#panels').scrollTop;
    state.selected = id; detailDay = state.day; detailData = null;
    const token = ++detailReq;
    if (s.properties.slug && location.hash !== '#' + s.properties.slug) {
      const url = location.pathname + location.search + '#' + s.properties.slug;
      if (history.state && history.state.spot) history.replaceState({ spot: id }, '', url); else history.pushState({ spot: id }, '', url);
    }
    nearbyTab = 'all'; currentPoi = null;
    paintMarkers();
    $('#panel-list').hidden = true; $('#panel-wishes').hidden = true; $('#panel-trip').hidden = true; $('#panel-config').hidden = true; $('#panel-poi').hidden = true; $('#panel-detail').hidden = false; $('#panels').scrollTop = 0;
    if (isMobile()) { if (full) setSheet('full'); else if (sheet.classList.contains('peek')) setSheet('half'); }
    buzz(8);
    renderDetailHead();
    $('#detail-body').innerHTML = '<div class="loading">Chargement des prévisions horaires…</div>';
    if (pan) panTo(s);
    if (!state.pois.length) ensurePois().then(() => { if (state.selected === id) { renderPlanCard(id); renderDetailDay(detailDay); } });
    try { const d = await F.loadDetail(s); if (token !== detailReq) return; detailData = d; renderDetailDay(detailDay); }
    catch (e) { if (token !== detailReq) return; renderDetailDay(detailDay, `Prévisions horaires indisponibles (${esc(e.message)}).`); }
  }
  function closeDetail(fromHistory = false) {
    if (!fromHistory && history.state && history.state.spot) { history.back(); return; }
    state.selected = null; paintMarkers();
    if (location.hash && !fromHistory) history.replaceState(null, '', location.pathname + location.search);
    $('#panel-detail').hidden = true;
    if (state.view === 'wishes') { $('#panel-wishes').hidden = false; renderWishes(); } else if (state.view === 'trip') { $('#panel-trip').hidden = false; renderTrip(); } else if (state.view === 'config') { $('#panel-config').hidden = false; renderConfig(); } else { $('#panel-list').hidden = false; renderDays(); renderList({ keep: true }); }
    $('#panels').scrollTop = listScroll;
  }
  function creditHtml(g, ph) {
    if (!g) return '';
    if (g.aerial) return esc(g.credit);
    const src = ph && String(ph.source || '').startsWith('openverse') ? (ph.source.split(':')[1] === 'flickr' ? 'Flickr' : 'Openverse') : 'Wikimedia Commons';
    return `${esc(g.credit)}${g.license ? ' · ' + esc(g.license) : ''}${safeUrl(g.page) ? ` · <a href="${esc(g.page)}" target="_blank" rel="noopener">${src}</a>` : ''}${ph && ph.source === 'geosearch' && g === (ph.gallery || [])[0] ? ' · photo prise à proximité' : ''}`;
  }
  function renderDetailHead() {
    const s = spotById(state.selected), p = s.properties, w = wishOf(p.id), ph = photoOf(p.id), [lat, lon] = latlng(s);
    const r = state.bulk ? scoreOf(s, detailDay) : null;
    const tags = [p.type, p.province, surfaceLbl(p), p.size_m ? `~${p.size_m.toLocaleString('fr-FR')} m` : null, p.nudism === 'yes' ? 'naturiste' : null,
      p.lifeguard === 'yes' ? 'surveillée' : null, p.dog === 'yes' ? 'chiens OK' : p.dog === 'no' ? 'chiens interdits' : null,
      p.tidal === 'yes' ? 'dépend de la marée' : null, p.access && p.access !== 'yes' ? `accès : ${p.access}` : null].filter(Boolean);
    const wiki = p.wikipedia ? `https://${p.wikipedia.split(':')[0]}.wikipedia.org/wiki/${encodeURIComponent(p.wikipedia.split(':').slice(1).join(':'))}` : null;
    const commons = `https://commons.wikimedia.org/w/index.php?search=${encodeURIComponent(p.name)}&ns6=1`;
    const photosList = ph ? (ph.gallery && ph.gallery.length ? ph.gallery : [{ thumb: ph.thumb, page: ph.page, credit: ph.credit, license: ph.license }]) : [];
    const gal = [{ aerial: true, credit: AERIAL_CREDIT, license: '', page: '' }, ...photosList];   // la vue aérienne ouvre la galerie
    const heroW = isMobile() ? window.innerWidth : $('#sheet').clientWidth || 440;
    $('#detail-head').innerHTML = `
      <div class="hero ${ph ? '' : 'nophoto'}">
        <div class="slides" id="slides">${gal.map((g, i) => g.aerial
          ? aerialHtml(lat, lon, aerialZoom(s, heroW, 14, 17), heroW, 250, 'slide', '', { scale: true })
          : `<img src="${esc(g.thumb)}" alt="${esc(p.name)} (${i + 1})" ${i ? 'loading="lazy"' : ''} decoding="async" onerror="this.style.visibility='hidden'">`).join('')}</div>
        <div class="shade"></div>
        ${gal.length > 1 ? `<div class="dots" id="dots">${gal.map((g, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div><span class="count" id="gcount">1 / ${gal.length}</span>
          <button type="button" class="nav l" id="gprev" aria-label="Photo précédente">${I('chevronL', { size: 24 })}</button><button type="button" class="nav r" id="gnext" aria-label="Photo suivante">${I('chevronR', { size: 24 })}</button>` : ''}
        <div class="tl"><button type="button" class="iconbtn" id="btn-close" aria-label="Retour à la liste">${I('back', { size: 20 })}</button></div>
        <div class="tr"><button type="button" class="iconbtn" id="btn-zoom-spot" title="Zoomer sur la plage" aria-label="Zoomer sur la plage">${I('frame', { size: 20 })}</button><button type="button" class="iconbtn" id="btn-share-spot" aria-label="Partager ce spot">${I('share', { size: 20 })}</button></div>
        <div class="cap">
          <div class="row"><h2>${esc(p.name)}</h2>${r ? `<div class="score c-${r.cls}"><b>${r.score ?? '—'}</b><small>${esc(r.label)}</small></div>` : ''}</div>
          <span class="sub">${esc(tags.join(' · '))}</span>
          <span class="credit" id="gcredit">${creditHtml(gal[0], ph)}</span>
        </div>
      </div>
      <div class="dbody" id="dhead-body">
        ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
        <div class="actions">
          <button type="button" class="pill a ${w.a ? 'on' : ''} ${canEdit('a') ? '' : 'ro'}" data-who="a">${I('heart', { size: 15, fill: w.a })}${esc(state.users.a.name)}</button>
          <button type="button" class="pill b ${w.b ? 'on' : ''} ${canEdit('b') ? '' : 'ro'}" data-who="b">${I('heart', { size: 15, fill: w.b })}${esc(state.users.b.name)}</button>
          ${(() => { const o = state.me === 'a' ? 'b' : 'a'; return w[o] ? '' : `<button type="button" class="pill propose ${suggestedTo(o, p.id) ? 'on' : ''}" id="btn-suggest" title="Proposer cette plage à ${esc(state.users[o].name)}">${I('bell', { size: 15 })}${suggestedTo(o, p.id) ? 'Proposé à ' : 'Proposer à '}${esc(state.users[o].name)}</button>`; })()}
          <span class="spacer"></span>
          <button type="button" class="pill ${tripHasSpot(p.id) ? 'primary' : ''}" id="btn-trip-add" title="Ajouter à un jour du séjour">${I('calendar', { size: 15 })}${tripHasSpot(p.id) ? 'Au séjour' : 'Séjour'}</button>
          <a class="pill primary" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving" target="_blank" rel="noopener">${I('navigation', { size: 16 })}Itinéraire</a>
        </div>
        <div id="plan-slot"></div>
        <div class="links">
          <button type="button" id="btn-sat" title="Voir la plage en satellite sur la carte">${I('layers', { size: 14 })}Satellite</button>
          <button type="button" id="btn-3d-spot" title="Voir le relief en 3D, depuis la mer">${I('boot', { size: 14 })}Relief 3D</button>
          ${wiki ? `<a href="${wiki}" target="_blank" rel="noopener">${I('book', { size: 14 })}Wikipédia</a>` : ''}
          <button type="button" id="btn-more" title="Autres liens : GPS, photos, Google Maps, OSM, site">${I('sliders', { size: 14 })}Plus</button>
        </div>
      </div>`;
    $('#btn-close').onclick = () => closeDetail();
    $('#btn-sat').onclick = () => showSatellite(s);
    $('#btn-zoom-spot').onclick = () => zoomTo({ spot: s });
    $('#btn-more').onclick = () => {   // liens externes, hors de la fiche pour la garder lisible
      const dlg = $('#dlg-pick'); if (dlg.open) dlg.close();
      $('#pick-title').textContent = p.name;
      const row = (href, icon, label, sub) => `<a class="menu-link" href="${href}" target="_blank" rel="noopener">${I(icon, { size: 16 })}${label}${sub ? `<span class="sub">${sub}</span>` : ''}</a>`;
      $('#pick-list').innerHTML = `<div class="menu">${row(`geo:${lat},${lon}?q=${lat},${lon}(${encodeURIComponent(p.name)})`, 'pin', 'Ouvrir dans le GPS', 'application du téléphone')}${row(commons, 'camera', 'Photos sur Wikimedia Commons')}${row(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ' ' + p.province)}`, 'pin', 'Google Maps', 'avis, horaires')}${row(esc(p.osm), 'map', 'OpenStreetMap', 'source des données')}${safeUrl(p.website) ? row(esc(safeUrl(p.website)), 'link', 'Site web') : ''}</div>`;
      dlg.showModal();
    };
    $('#btn-3d-spot').onclick = () => open3d({ lat, lon, zoom: 14.5 });
    $('#btn-share-spot').onclick = () => shareSpot(s);
    $('#btn-trip-add').onclick = () => pickDayFor(p.id);
    $('#btn-suggest') && ($('#btn-suggest').onclick = () => toggleSuggest(p.id));
    if (gal.length > 1) {
      const slides = $('#slides'), dots = $('#dots').children;
      const sw = CCP.swipeable(slides);
      const go = (i) => sw.go(i);
      const cur = () => Math.round(slides.scrollLeft / slides.clientWidth);
      slides.addEventListener('scroll', () => {
        const i = Math.max(0, Math.min(gal.length - 1, cur()));
        [...dots].forEach((d, k) => d.classList.toggle('on', k === i));
        $('#gcount').textContent = `${i + 1} / ${gal.length}`;
        $('#gcredit').innerHTML = creditHtml(gal[i], ph);
      }, { passive: true });
      $('#gprev').onclick = () => go(Math.max(0, cur() - 1));
      $('#gnext').onclick = () => go(Math.min(gal.length - 1, cur() + 1));
    }
    $('#detail-head').querySelectorAll('.pill[data-who]').forEach((h) => h.onclick = () => toggleWish(p.id, h.dataset.who));
    renderPlanCard(p.id);
  }
  let noteTimer = null;
  function renderPlanCard(spotId) {
    const slot = $('#plan-slot'); if (!slot) return;
    const pn = state.plans[spotId], me = state.me, other = me === 'a' ? 'b' : 'a';
    const items = pn ? pn.items : [];
    slot.innerHTML = `<div class="plan-card">
      <div class="h"><h3>${I('note', { size: 13 })} Programme autour de cette plage</h3></div>
      ${items.length ? `<ul class="plan-items">${items.map((it, k) => { const x = it.poi && poiById(it.poi); const kd = x ? (C.poiKinds[x.p.kind] || C.poiKinds.tourism) : null;
        return `<li>${kd ? `<span class="poi-pin" style="background:${kd.color}">${I(kd.icon, { size: 12 })}</span>` : `<span class="poi-pin" style="background:var(--accent)">${I('compass', { size: 12 })}</span>`}
          <span class="t">${esc(x ? x.p.name : it.text)}${x ? ` <small>· ${esc(kd.label)}${x.p.cuisine ? ', ' + esc(x.p.cuisine.split(';')[0]) : ''}</small>` : ' <small>· activité</small>'}</span>
          <span class="who ${it.by === 'b' ? 'b' : 'a'}" title="${esc(state.users[it.by === 'b' ? 'b' : 'a'].name)}">${esc(String(state.users[it.by === 'b' ? 'b' : 'a'].name || '?')[0].toUpperCase())}</span>
          <button type="button" class="rm" data-k="${k}" aria-label="Retirer">${I('trash', { size: 15 })}</button></li>`; }).join('')}</ul>`
        : `<span class="hint">Ajoutez un resto, un monument ou une activité : bouton ${I('plus', { size: 12 })} dans « À proximité » ci-dessous, ou une activité libre ici.</span>`}
      <div class="plan-add"><input type="text" id="plan-text" maxlength="80" placeholder="Activité libre : surf, kayak, coucher de soleil…"><button type="button" id="plan-add-btn" aria-label="Ajouter">${I('plus', { size: 18 })}</button></div>
      <div class="plan-note"><label><span class="who ${me}" style="width:18px;height:18px;border-radius:50%;background:var(--${me});color:#fff;font-size:10px;display:grid;place-items:center">${esc(state.users[me].name[0].toUpperCase())}</span>Note de ${esc(state.users[me].name)}</label>
        <textarea id="plan-note" maxlength="500" placeholder="Ex. : y aller à marée haute, pique-nique, parking étroit…">${esc(pn ? pn.notes[me] : '')}</textarea></div>
      ${pn && pn.notes[other] ? `<div class="plan-note"><label><span style="width:18px;height:18px;border-radius:50%;background:var(--${other});color:#fff;font-size:10px;display:grid;place-items:center">${esc(state.users[other].name[0].toUpperCase())}</span>Note de ${esc(state.users[other].name)}</label><div class="ro">${esc(pn.notes[other])}</div></div>` : ''}
    </div>`;
    slot.querySelectorAll('.rm').forEach((b) => b.onclick = () => { const it = planOf(spotId).items[+b.dataset.k]; if (it && !canEdit(it.by)) { toast(`Ajouté par ${state.users[it.by === 'b' ? 'b' : 'a'].name} : seul·e cette personne peut le retirer`); return; } planRemove(spotId, +b.dataset.k); renderPlanCard(spotId); renderDetailDay(detailDay); renderTabs(); paintMarkers(); });
    const addText = () => { const v = $('#plan-text').value.trim(); if (!v) return; if (planAdd(spotId, { text: v })) { renderPlanCard(spotId); renderTabs(); paintMarkers(); toast('Ajouté au programme'); } };
    $('#plan-add-btn').onclick = addText;
    $('#plan-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addText(); } });
    $('#plan-note').addEventListener('input', (e) => { planOf(spotId).notes[me] = e.target.value; clearTimeout(noteTimer); noteTimer = setTimeout(() => { save(); renderTabs(); }, 400); });
  }
  function renderDetailDay(i, hourlyError = null) {
    detailDay = i;
    const s = spotById(state.selected);
    if (!s || !state.bulk) { $('#detail-body').innerHTML = '<div class="loading">Prévisions indisponibles.</div>'; return; }
    const p = s.properties;
    const cards = state.bulk.dates.map((iso, j) => {
      const d = F.dayOf(state.bulk, s, j), r = scoreOf(s, j), { lbl, sub } = fmtDay(iso, j);
      return `<button type="button" class="daycard ${j === i ? 'on' : ''}" data-i="${j}"><b>${lbl} ${sub}</b>${wIcon(d.code, 20)}<span>${n0(d.tmax, '°')} / ${n0(d.tmin, '°')}</span><span class="sc c-${r.cls}">${r.score ?? '—'}</span></button>`;
    }).join('');
    const d = F.dayOf(state.bulk, s, i), r = scoreOf(s, i);
    let body = `<div class="dbody">
      <div class="daycards">${cards}</div>
      <div class="reasons"><b>${esc(C.profiles[state.profile].label)} : ${r.score ?? '—'}/100 (${esc(r.label)})</b>${r.reasons.length ? ' · ' + esc(r.reasons.join(', ')) : ''}</div>
      <div class="kv">
        <div><b>Ciel</b><span>${wIcon(d.code, 15)}${esc(wc(d.code)[1])}</span></div>
        <div><b>Pluie</b><span class="mu">${I('drop', { size: 15 })}${n0(d.pprob, ' %')} · ${n1(d.psum, ' mm')}</span></div>
        <div><b>UV max</b><span>${I('sun', { size: 15, cls: 'sun' })}${n1(d.uv)}</span></div>
        <div><b>Vent</b><span class="mu">${I('wind', { size: 15 })}${n0(d.wind, ' km/h')} ${arrow(d.wdir)}${compass(d.wdir)}</span></div>
        <div><b>Houle</b><span class="sea">${I('wave', { size: 15 })}${n1(d.wave, ' m')} · ${n0(d.period, ' s')} ${arrow(d.wavedir)}</span></div>
        <div><b>Température</b><span>${I('thermo', { size: 15 })}${n0(d.tmax, '°')} / ${n0(d.tmin, '°')}</span></div>
        <div><b>Rafales</b><span class="mu">${I('wind', { size: 15 })}${n0(d.gust, ' km/h')}</span></div>
        <div><b>Swell</b><span class="sea">${I('wave', { size: 15 })}${n1(d.swell, ' m')} · ${n0(d.swellPeriod, ' s')}</span></div>
        <div><b>Soleil</b><span>${I('sunrise', { size: 15, cls: 'sun' })}${d.sun != null ? (d.sun / 3600).toFixed(1) + ' h' : '—'}</span></div>
      </div>`;
    body += renderTides(d, p, hourlyError);
    body += renderNearby(s);
    if (detailData) body += renderHourly(d.date);
    body += '</div>';
    $('#detail-body').innerHTML = body;
    bindNearby(s);
    $('#detail-body').querySelectorAll('.daycard').forEach((b) => b.onclick = () => renderDetailDay(+b.dataset.i));
    const on = $('#detail-body').querySelector('.daycard.on');
    if (on) { const c = on.parentElement; c.scrollLeft = on.offsetLeft - (c.clientWidth - on.clientWidth) / 2; }
    const hd = $('#detail-head .score'); if (hd) { hd.className = `score c-${r.cls}`; hd.innerHTML = `<b>${r.score ?? '—'}</b><small>${esc(r.label)}</small>`; }
  }
  function renderTides(d, p, hourlyError) {
    const sun = `${d.sunrise ? hmIso(d.sunrise) : '—'} → ${d.sunset ? hmIso(d.sunset) : '—'}`;
    let html = `<div class="sect"><div class="h"><h3>Marées</h3><span>${I('sunrise', { size: 13 })} ${sun}</span></div>`;
    if (!detailData) { return html + `<div class="loading" style="padding:8px">${hourlyError ? esc(hourlyError) : 'Chargement…'}</div></div>`; }
    const M = detailData.marine, date = d.date;
    const mIdx = M.time.map((t, k) => t.startsWith(date) ? k : -1).filter((k) => k >= 0);
    const tides = detailData.tides.filter((t) => t.iso.slice(0, 10) === date);
    const sst = mIdx.map((k) => M.sea_surface_temperature?.[k]).filter((v) => v != null);
    if (M.sea_level_height_msl) html += spark(mIdx.map((k) => M.sea_level_height_msl[k]), tides, date);
    html += `<div class="cond" style="flex-wrap:wrap;font-size:12.5px">` + (tides.length
      ? tides.map((t) => `<span class="${t.type === 'PM' ? 'sea' : 'mu'}">${I(t.type === 'PM' ? 'up' : 'down', { size: 14 })}${t.type} ${hmIso(t.iso)} · ${t.height >= 0 ? '+' : ''}${t.height.toFixed(1)} m</span>`).join('')
      : '<span class="mu">niveau de mer indisponible</span>') +
      (sst.length ? `<span>${I('thermo', { size: 14 })}eau ${n1(sst.reduce((a, b) => a + b, 0) / sst.length, ' °C')}</span>` : '') + '</div>';
    if (p.tidal === 'yes' && tides.some((t) => t.type === 'PM')) {
      const win = tides.filter((t) => t.type === 'PM').map((t) => `${hmIso(F.shiftIso(t.iso, -90))}–${hmIso(F.shiftIso(t.iso, 90))}`);
      html += `<div class="advice">${I('clock', { size: 16 })}<span><b>Ce spot dépend de la marée haute</b> : viser ${win.join(' ou ')}.</span></div>`;
    }
    return html + '</div>';
  }
  let nearbyTab = 'all';
  function renderNearby(s) {
    const all = nearbyOf(s);
    if (!all.length) return '';
    const tabs = [['all', 'Tous', null], ['restaurant', 'Restos', 'fork'], ['bar', 'Bars', 'glass'], ['beach_bar', 'Plage', 'umbrella'], ['cafe', 'Cafés', 'cup'], ['visit', 'Visites', 'landmark']];
    const count = (k) => k === 'all' ? all.length : k === 'visit' ? all.filter((o) => poiGroupOf(o.x.p.kind) === 'visit').length : all.filter((o) => o.x.p.kind === k).length;
    const list = (nearbyTab === 'all' ? all : nearbyTab === 'visit' ? all.filter((o) => poiGroupOf(o.x.p.kind) === 'visit') : all.filter((o) => o.x.p.kind === nearbyTab)).slice(0, 15);
    return `<div class="sect"><div class="h"><h3>À proximité</h3><span>${all.length} lieu${all.length > 1 ? 'x' : ''} à moins de ${C.nearbyKm.toLocaleString('fr-FR')} km</span></div>
      <div class="nearby-tabs">${tabs.filter((t) => count(t[0]) > 0).map((t) => `<button type="button" data-t="${t[0]}" class="${nearbyTab === t[0] ? 'on' : ''}">${t[2] ? I(t[2], { size: 12 }) : ''}${t[1]} ${count(t[0])}</button>`).join('')}</div>
      <ul class="nearby">${list.map((o) => { const k = C.poiKinds[o.x.p.kind] || C.poiKinds.tourism, p = o.x.p;
        const meta = [k.label, p.cuisine ? p.cuisine.split(';')[0] : null, p.sub && p.kind !== p.sub && poiGroupOf(p.kind) === 'visit' ? p.sub.replace(/_/g, ' ') : null].filter(Boolean).join(' · ');
        const inPlan = (state.plans[s.properties.id]?.items || []).some((it) => it.poi === o.x.id);
        return `<li data-id="${esc(o.x.id)}"><span class="poi-pin" style="background:${k.color}">${I(k.icon, { size: 13 })}</span><div><div class="name">${esc(p.name)}</div><div class="m">${esc(meta)}</div></div><span class="d">${o.d < 1 ? Math.round(o.d * 1000) + ' m' : o.d.toFixed(1) + ' km'}</span><button type="button" class="add ${inPlan ? 'on' : ''}" data-id="${esc(o.x.id)}" aria-label="${inPlan ? 'Retirer du programme' : 'Ajouter au programme'}">${I(inPlan ? 'check' : 'plus', { size: 16 })}</button></li>`; }).join('')}</ul>
      ${list.length < count(nearbyTab) ? `<span class="hint">… et ${count(nearbyTab) - list.length} autres sur la carte.</span>` : ''}</div>`;
  }
  function bindNearby(s) {
    $('#detail-body').querySelectorAll('.nearby-tabs button').forEach((b) => b.onclick = () => { nearbyTab = b.dataset.t; renderDetailDay(detailDay); $('#detail-body .nearby-tabs')?.scrollIntoView({ block: 'nearest' }); });
    $('#detail-body').querySelectorAll('.nearby li').forEach((li) => li.onclick = () => { const x = state.pois.find((o) => o.id === li.dataset.id); if (x) showPoi(x); });
    $('#detail-body').querySelectorAll('.nearby .add').forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const sid = s.properties.id, pn = planOf(sid), k = pn.items.findIndex((it) => it.poi === b.dataset.id);
      if (k >= 0) { planRemove(sid, k); toast('Retiré du programme'); } else { planAdd(sid, { poi: b.dataset.id }); toast(`Ajouté au programme (${state.users[state.me].name})`); }
      renderPlanCard(sid); renderDetailDay(detailDay); renderTabs(); paintMarkers();
      $('#detail-body .nearby-tabs')?.scrollIntoView({ block: 'nearest' });
    });
  }
  function renderHourly(date) {
    const H = detailData.hourly, M = detailData.marine;
    const idx = H.time.map((t, i) => t.startsWith(date) ? i : -1).filter((i) => i >= 0);
    let html = `<div class="sect"><h3>Heure par heure</h3><div style="overflow-x:auto"><table class="hours"><thead><tr><th>h</th><th></th><th>T°</th><th>pluie</th><th>vent</th><th>houle</th><th>UV</th></tr></thead><tbody>`;
    for (const i of idx) {
      const h = +H.time[i].slice(11, 13); if (h < 6 || h > 22) continue;
      const mi = M.time.indexOf(H.time[i]), night = h < 8 || h > 20;
      html += `<tr class="${night ? 'night' : ''}"><td>${String(h).padStart(2, '0')}h</td><td>${wIcon(H.weather_code[i], 15)}</td><td>${n0(H.temperature_2m[i], '°')}</td>
        <td>${n0(H.precipitation_probability?.[i], ' %')}</td><td>${n0(H.wind_speed_10m[i])} ${arrow(H.wind_direction_10m[i], 12)}</td>
        <td>${mi >= 0 && M.wave_height ? n1(M.wave_height[mi], ' m') + ' · ' + n0(M.wave_period?.[mi], ' s') : '—'}</td><td>${n1(H.uv_index?.[i])}</td></tr>`;
    }
    return html + '</tbody></table></div></div>';
  }
  function spark(vals, tides, date) {
    const known = vals.filter((x) => x != null); if (!known.length) return '';
    const min = Math.min(...known), max = Math.max(...known), W = 366, Hh = 64, pad = 4, top = 8;
    const x = (h) => pad + (h / 24) * (W - 2 * pad), y = (val) => Hh - 14 - ((val - min) / ((max - min) || 1)) * (Hh - 14 - top);
    const pts = vals.map((val, i) => val == null ? null : `${x(i).toFixed(1)},${y(val).toFixed(1)}`).filter(Boolean).join(' ');
    const isToday = F.todayLocal() === date;
    const nowParts = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: C.timezone }).split(':');
    const hNow = +nowParts[0] + (+nowParts[1] || 0) / 60;
    const labels = tides.map((t) => { const h = +t.iso.slice(11, 13) + (+t.iso.slice(14, 16)) / 60; return `<text x="${x(h).toFixed(1)}" y="${Hh - 2}" font-size="10" text-anchor="middle" fill="currentColor" opacity=".7">${hmIso(t.iso)}</text>`; }).join('');
    return `<svg class="spark" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2"/>
      ${isToday ? `<line x1="${x(hNow)}" x2="${x(hNow)}" y1="${top}" y2="${Hh - 14}" stroke="currentColor" opacity=".3" stroke-dasharray="3 3"/>` : ''}${labels}</svg>`;
  }
  /* ==================== 80-sheet.js ==================== */
  /* ------------------------------------------------------------------ panneau glissant */
  const sheetVisible = () => Math.max(0, window.innerHeight - sheet.getBoundingClientRect().top);   // hauteur visible (le panneau est translaté, pas redimensionné)
  let sheetT = null;
  function setSheet(mode) {
    const was = [...sheet.classList].find((c) => ['peek', 'half', 'full'].includes(c));
    sheet.classList.remove('peek', 'half', 'full'); sheet.classList.add(mode);
    document.documentElement.style.setProperty('--sheet-h', mode === 'peek' ? '30vh' : mode === 'half' ? '58vh' : '100vh');
    if (was !== mode && viewBounds && state.mapFilter && isMobile()) {   // la surface de carte visible a changé : l'emprise suivie aussi
      clearTimeout(sheetT); sheetT = setTimeout(() => { if (!map) return; viewBounds = liveBounds(); if (state.view === 'explore' && $('#panel-detail').hidden && $('#panel-poi').hidden) { renderDays(); renderList({ keep: true }); } }, 300);
    }
  }
  function initSheet() {
    sheet = $('#sheet'); setSheet('half');
    const order = ['peek', 'half', 'full'], cur = () => order.find((m) => sheet.classList.contains(m));
    const move = (dir) => { const i = order.indexOf(cur()); setSheet(order[Math.max(0, Math.min(2, i + dir))]); };
    /* Glisser : le panneau suit le doigt ; au relâcher, aimantation vers la hauteur la plus proche
       en tenant compte de la vitesse (un geste vif suffit à changer d'état). */
    let drag = null;
    const start = (y) => { if (!isMobile()) return; drag = { y0: y, h0: sheetVisible(), full: sheet.offsetHeight, t0: performance.now(), y: y, t: performance.now(), moved: false }; sheet.classList.add('dragging'); };
    const update = (y) => {
      if (!drag) return;
      const H = window.innerHeight, hs = { peek: H * 0.30, half: H * 0.58, full: drag.full };
      let h = drag.h0 + (drag.y0 - y);
      if (h > hs.full) h = hs.full + (h - hs.full) * 0.2; if (h < hs.peek) h = hs.peek - (hs.peek - h) * 0.2;
      if (Math.abs(y - drag.y0) > 4) drag.moved = true;
      drag.vy = (y - drag.y) / Math.max(1, performance.now() - drag.t); drag.y = y; drag.t = performance.now();
      sheet.style.transform = `translateY(${Math.max(0, drag.full - h)}px)`;
    };
    const end = () => {
      if (!drag) return;
      const H = window.innerHeight, hs = { peek: H * 0.30, half: H * 0.58, full: drag.full };
      const h = sheetVisible(), vy = drag.vy || 0, moved = drag.moved;
      sheet.classList.remove('dragging'); sheet.style.transform = '';
      if (!moved) { move(cur() === 'full' ? -1 : 1); drag = null; return; }
      let target;
      if (Math.abs(vy) > 0.6) target = vy < 0 ? order[Math.min(2, order.indexOf(cur()) + 1)] : order[Math.max(0, order.indexOf(cur()) - 1)];
      else target = Object.entries(hs).sort((a, b) => Math.abs(a[1] - h) - Math.abs(b[1] - h))[0][0];
      setSheet(target); drag = null;
    };
    for (const zone of [$('#handle'), $('#tabs')]) {
      zone.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && zone !== $('#handle')) return; if (e.target.closest('button') && zone !== $('#handle') && e.pointerType === 'mouse') return; start(e.clientY); zone.setPointerCapture?.(e.pointerId); });
      zone.addEventListener('pointermove', (e) => update(e.clientY));
      zone.addEventListener('pointerup', (e) => { const wasDrag = drag && drag.moved; end(); if (wasDrag && e.target.closest('button')) e.preventDefault(); });
      zone.addEventListener('pointercancel', end);
    }
    document.addEventListener('pointerup', () => { if (drag) end(); }); document.addEventListener('pointercancel', () => { if (drag) end(); });   // relâcher hors de la zone termine le geste
    $('#tabs').addEventListener('click', (e) => { if (drag) e.stopPropagation(); }, true);
    // Tirer vers le bas depuis le haut de la liste replie le panneau (tactile uniquement)
    const panel = $('#panels'); let y0 = null;
    panel.addEventListener('touchstart', (e) => { y0 = panel.scrollTop === 0 ? e.touches[0].clientY : null; }, { passive: true });
    panel.addEventListener('touchend', (e) => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; if (dy > 70 && panel.scrollTop === 0) move(-1); y0 = null; }, { passive: true });
    // Clavier : la recherche déploie le panneau pour rester visible au-dessus du clavier
    sheet.addEventListener('focusin', (e) => {
      const t = e.target; if (!isMobile() || !t.matches('input, textarea, select')) return;
      if (!sheet.classList.contains('full')) setSheet('full');
      setTimeout(() => { try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (x) { } }, 320);
    });
  }
  /* ==================== 85-dialogs.js ==================== */
  /* ------------------------------------------------------------------ filtres & réglages */
  function seg(el, options, value, onPick, tone) {
    el.innerHTML = options.map(([v, lbl]) => `<button type="button" data-v="${v}" aria-pressed="${v === value}" class="${v === value ? 'on' : ''} ${tone && tone[v] ? 'tone-' + tone[v] : ''}">${lbl}</button>`).join('');
    el.querySelectorAll('button').forEach((b) => b.onclick = () => { onPick(b.dataset.v); seg(el, options, b.dataset.v, onPick, tone); });
  }
  function initDialogs() {
    const dlg = $('#dlg-filters');
    let draft = null;
    const dotLbl = (k) => `<i style="width:10px;height:10px;border-radius:50%;background:var(--${k});display:inline-block"></i>${esc(state.users[k].name)}`;
    const renderFilters = () => {
      const areas = (state.region.areas || []).map((z) => [z.name, z.label || z.name]);
      $('#f-province').closest('.field').hidden = areas.length < 2;
      seg($('#f-province'), [['all', 'Toutes'], ...areas], draft.province, (v) => draft.province = v);
      seg($('#f-type'), [['all', 'Tout'], ['playa', 'Plages'], ['cala', 'Criques']], draft.type, (v) => draft.type = v);
      seg($('#f-wish'), [['all', 'Tous'], ['a', dotLbl('a')], ['b', dotLbl('b')], ['both', 'Communes']], draft.wish, (v) => draft.wish = v, { a: 'a', b: 'b', both: 'both' });
      seg($('#f-sort'), [['score', 'Score'], ['dist', 'Distance'], ['name', 'Nom'], ['size', 'Taille']], draft.sort, (v) => draft.sort = v);
      const chips = [['sand', 'Sable', () => draft.surface === 'sand', () => draft.surface = draft.surface === 'sand' ? 'all' : 'sand'],
        ['other', 'Galets / rochers', () => draft.surface === 'other', () => draft.surface = draft.surface === 'other' ? 'all' : 'other'],
        ['lifeguard', 'Surveillée', () => draft.lifeguard, () => draft.lifeguard = !draft.lifeguard],
        ['dog', 'Chiens OK', () => draft.dog, () => draft.dog = !draft.dog]];
      const renderChips = () => { $('#f-chips').innerHTML = chips.map(([k, l, on]) => `<button type="button" data-k="${k}" class="${on() ? 'on' : ''}">${l}</button>`).join('');
        $('#f-chips').querySelectorAll('button').forEach((b) => b.onclick = () => { chips.find((c) => c[0] === b.dataset.k)[3](); renderChips(); }); };
      renderChips();
      $('#f-min').value = draft.minScore; minOut();
    };
    const minOut = () => { const v = +$('#f-min').value; const c = C.scoreClasses.find((x) => v >= x.min); $('#f-min-out').textContent = v ? `${v} · ${c.label}` : 'aucun'; };
    $('#f-min').oninput = () => { draft.minScore = +$('#f-min').value; minOut(); };
    $('#btn-filters').onclick = () => { draft = { ...state.filters, sort: state.sort }; renderFilters(); dlg.showModal(); };
    $('#f-apply').onclick = () => { state.sort = draft.sort; delete draft.sort; Object.assign(state.filters, draft); save(); dlg.close(); afterFilter(); };
    $('#f-reset').onclick = () => { draft = { province: 'all', type: 'all', surface: 'all', lifeguard: false, dog: false, minScore: 0, wish: 'all', q: draft.q, sort: 'score' }; renderFilters(); };
    const afterFilter = () => { renderDays(); renderList(); paintMarkers(); renderFiltersBtn(); if (state.sort === 'dist' && !state.userPos) locate(); };

    $('#btn-settings').onclick = () => { if (state.selected && !$('#panel-detail').hidden) closeDetail(); setView(state.view === 'config' ? 'explore' : 'config'); };
    document.querySelectorAll('dialog .close').forEach((b) => b.onclick = () => b.closest('dialog').close());
    document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

    let qTimer = null;
    $('#q').oninput = (e) => { state.filters.q = e.target.value; clearTimeout(qTimer); qTimer = setTimeout(() => { renderDays(); renderList(); paintMarkers(); }, 150); };
    $('#btn-search').innerHTML = I('search', { size: 20 });
    const showSearch = (on) => { $('#search-box').hidden = !on; $('#btn-search').classList.toggle('on', on); $('#btn-search').setAttribute('aria-expanded', String(on)); };
    $('#btn-search').onclick = () => { const on = $('#search-box').hidden; showSearch(on); if (on) $('#q').focus(); else if (state.filters.q) { state.filters.q = ''; $('#q').value = ''; renderList(); paintMarkers(); } };
    $('#q-clear').onclick = () => { $('#q').value = ''; state.filters.q = ''; renderList(); paintMarkers(); $('#q').focus(); };
    if (state.filters.q) showSearch(true);
    $('#btn-share').onclick = share;
    $('#btn-locate').onclick = locate;
    $('#btn-target').onclick = zoomContext;
    renderFiltersBtn();
  }
  function exportSelection() {
    const feats = state.spots.filter((s) => { const w = wishOf(s.properties.id); return w.a || w.b; })
      .map((s) => { const w = wishOf(s.properties.id), pn = state.plans[s.properties.id];
        const plan = pn ? { notes: pn.notes, items: pn.items.map((it) => ({ by: state.users[it.by]?.name, name: it.text || poiById(it.poi)?.p.name, kind: it.poi ? poiById(it.poi)?.p.kind : 'activity', osm: it.poi ? osmUrl(it.poi) : undefined })) } : undefined;
        return { ...s, properties: { ...s.properties, wish: { [state.users.a.name === state.users.b.name ? 'a' : state.users.a.name]: w.a, [state.users.a.name === state.users.b.name ? 'b' : state.users.b.name]: w.b }, plan } }; });
    if (!feats.length) return toast('Aucune envie marquée');
    const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features: feats }, null, 1)], { type: 'application/geo+json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'envies-costa-cantabrica.geojson'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function locate() {
    if (!navigator.geolocation) return toast('Géolocalisation indisponible');
    navigator.geolocation.getCurrentPosition((pos) => {
      state.userPos = [pos.coords.latitude, pos.coords.longitude];
      if (!userMarker) userMarker = L.marker(state.userPos, { icon: L.divIcon({ className: '', html: '<div class="user-dot"></div>', iconSize: [16, 16] }) }).addTo(map);
      else userMarker.setLatLng(state.userPos);
      progMove(() => map.setView(state.userPos, Math.max(map.getZoom(), 10), { animate: false })); viewBounds = null;   // la liste reste complète, triée par distance
      state.sort = 'dist'; save(); renderDays(); renderList(); toast('Liste triée par distance');
    }, () => toast('Position introuvable'), { enableHighAccuracy: true, timeout: 10000 });
  }
  /* ==================== 90-intro.js ==================== */
  /* ------------------------------------------------------------------ premier lancement */
  function showIntro() {
    let seen = false; try { seen = localStorage.getItem('ccp:intro') === '1'; } catch (e) { }
    if (seen || wishedIds().length) return;
    const steps = [
      { icon: 'compass', title: 'Explorer', text: `Choisissez le jour et votre profil (plage, famille, surf, balade) : chaque plage reçoit un score selon la météo, le vent et la houle. Touchez un point de la carte ou la liste pour la fiche complète : marées, heure par heure, photos, lieux à proximité.` },
      { icon: 'heart', title: 'À deux', text: `${esc(state.users.a.name)} et ${esc(state.users.b.name)} marquent chacun leurs envies avec le cœur de leur couleur, se proposent des plages et notent chaque programme. L'onglet « Envies » réunit les listes, numérote les plages d'ouest en est et prépare l'itinéraire.` },
      { icon: 'calendar', title: 'Programmer', text: `Dans une fiche, ajoutez un resto, un monument ou une activité au programme de la plage. L'onglet « Séjour » place votre hébergement, répartit les plages sur les jours selon la météo, estime les horaires et prépare chaque trajet dans Google Maps.` },
      { icon: 'boot', title: 'Relief 3D', text: `Zoomez : la carte passe en 3D sur l'orthophoto et le relief (bouton 2D pour revenir). « Suivre l'itinéraire en 3D » survole chaque journée étape par étape. Avec un compte (page de connexion), le séjour est partagé à deux sur tous vos appareils ; sans compte, tout se partage par lien.` },
    ];
    const dlg = $('#dlg-intro'); let i = 0;
    const render = () => {
      const st = steps[i];
      $('#intro-steps').innerHTML = `<div class="intro-step"><span class="ic-box">${I(st.icon, { size: 22 })}</span><div><h2>${st.title}</h2><p>${st.text}</p></div></div>
        <div class="intro-dots">${steps.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>`;
      $('#intro-next').textContent = i === steps.length - 1 ? "C'est parti" : 'Suivant';
    };
    const done = () => { try { localStorage.setItem('ccp:intro', '1'); } catch (e) { } dlg.close(); };
    $('#intro-next').onclick = () => { if (i < steps.length - 1) { i++; render(); } else done(); };
    $('#intro-skip').onclick = done;
    dlg.addEventListener('close', () => { try { localStorage.setItem('ccp:intro', '1'); } catch (e) { } }, { once: true });
    render(); dlg.showModal();
  }
  /* ==================== 95-init.js ==================== */
  /* ------------------------------------------------------------------ chargement */
  function showBanner(text, retry) {
    const b = $('#banner'); $('#banner-text').textContent = text; b.hidden = false;
    $('#banner-retry').hidden = !retry; $('#banner-retry').onclick = () => { b.hidden = true; retry && retry(); };
    $('#banner-close').onclick = () => { b.hidden = true; };
  }
  async function loadForecast(force) {
    $('#summary').innerHTML = '<span>Chargement des prévisions…</span>';
    if (!state.bulk) $('#list').innerHTML = `<ul class="skeleton">${'<li><i class="sq"></i><i class="ph"></i><div><i class="ln m"></i><i class="ln s"></i></div></li>'.repeat(6)}</ul>`;
    try { state.bulk = await F.loadBulk(state.spots, { force }); scoreCache.clear(); $('#banner').hidden = true; }
    catch (e) { console.error(e); showBanner(navigator.onLine === false ? 'Hors ligne : prévisions indisponibles, la liste reste consultable.' : 'Prévisions indisponibles pour le moment (' + e.message + ').', () => loadForecast(true)); }
    renderDays(); if (state.view === 'wishes') renderWishes(); else if (state.view === 'trip') renderTrip(); else if (state.view === 'config') renderConfig(); else renderList(); paintMarkers();
    if (state.selected) renderDetailDay(detailDay);
    autoReplan();
  }
  async function init() {
    if (/[#&]reset\b/.test(location.hash)) {          // app.html#reset : repartir de zéro (version de test publique), compte compris
      try { for (const k of Object.keys(localStorage)) if (/^ccp:/.test(k)) localStorage.removeItem(k); } catch (e) { }
      history.replaceState(null, '', location.pathname + location.search + location.hash.replace(/[#&]reset\b/, '').replace(/^&/, '#'));
    }
    restoreAuth();
    restore();
    const ver = (document.querySelector('script[src*="app.js"]')?.src.match(/v=(\w+)/) || [])[1] || '';
    assetVer = ver;
    const dataP = Promise.all([
      fetch('data/spots.geojson?v=' + ver).then((r) => r.json()),
      fetch('data/photos.json?v=' + ver).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
      fetch('data/region.json?v=' + ver).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    await applyServerIdentity();   // en parallèle des données
    const shared = applyShare();
    let routed = false;
    if (!shared && applyViewParam()) history.replaceState(null, '', location.pathname + location.search);
    const [fc, photos, region] = await dataP;
    state.region = region || { name: 'Plages', short: 'Plages', subtitle: '', areas: [] };
    if (state.region.center) { C.center = state.region.center; C.zoom = state.region.zoom || C.zoom; }
    if (state.region.timezone) C.timezone = state.region.timezone;
    document.title = `${state.region.name} · plages & criques`;
    state.spots = fc.features; state.photos = photos || {};
    setTimeout(() => { if (navigator.onLine !== false) ensurePois(); }, 8000);   // les 1,3 Mo de lieux arrivent en tâche de fond, ou dès le premier besoin (fiche, séjour, zoom)
    routed = !shared && applyRoute();
    renderChrome(); initSheet(); initMap(); initPois(); init3d(); initDialogs(); renderWho(); renderProfiles(); renderTabs(); renderDays(); renderList();
    if (state.view !== 'explore') setView(state.view);
    $('#q').value = state.filters.q;
    if (!shared && !routed) showIntro();
    await loadForecast(false);
    if ((shared || routed) && state.selected) select(state.selected, { pan: true }); else state.selected = null;
    window.addEventListener('hashchange', () => { if (/^#share=/.test(location.hash)) return; const r = applyRoute(); if (r === true && state.selected !== (history.state && history.state.spot)) select(state.selected, { pan: true }); });
    window.addEventListener('popstate', () => {
      if (skipPop) { skipPop = false; if (location.hash) history.replaceState(null, '', location.pathname + location.search); return; }
      const r = applyRoute();
      if (r === 'poi') return;
      if (!$('#panel-poi').hidden) { closePoi(true); return; }
      if (r === true) select(state.selected, { pan: true });
      else if (state.selected && !$('#panel-detail').hidden) closeDetail(true);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('dialog[open]')) return;
      if (!$('#panel-poi').hidden) { closePoi(); return; }
      if (state.selected && !$('#panel-detail').hidden) closeDetail();
    });
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) navigator.serviceWorker.register('sw.js').catch(() => {});
    window.addEventListener('online', () => { if (!state.bulk) loadForecast(false); syncOnline(); });
  }
  document.addEventListener('DOMContentLoaded', init);
})();
