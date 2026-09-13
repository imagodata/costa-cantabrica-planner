/* Application : carte, liste classée, fiche détail, filtres, deux voyageurs, partage. */
(function () {
  const C = CCP.CONFIG, F = CCP.forecast, I = CCP.icon;
  const LS_STATE = 'ccp:state:v' + C.version;
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
    prefs: { perDay: 2, radiusKm: 60, lunch: true, roundTrip: true },
    filters: { province: 'all', type: 'all', surface: 'all', lifeguard: false, dog: false, minScore: 0, wish: 'all', q: '' },
    sort: 'score',
    users: { a: { name: DEFAULT_NAMES[0], wish: [] }, b: { name: DEFAULT_NAMES[1], wish: [] } },
    me: 'a',
  };
  const scoreCache = new Map();
  let map, markers = new Map(), userMarker = null, sheet, detailData = null, detailDay = 0, detailReq = 0, listScroll = 0;
  let poiLayer = null, poiMarkers = new Map(), wishLayer = null, tripLayer = null, planLayer = null;
  const DAY_COLORS = ['#0b6e99', '#b45309', '#7c3aed', '#0a9396', '#d64545', '#4361ee', '#f0a202'];
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

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
  const dur = (min) => min == null ? '—' : `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`;
  function distKm(a, b) {
    const R = 6371, p = Math.PI / 180, x = (b[0] - a[0]) * p, y = (b[1] - a[1]) * p;
    const h = Math.sin(x / 2) ** 2 + Math.cos(a[0] * p) * Math.cos(b[0] * p) * Math.sin(y / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const latlng = (s) => [s.geometry.coordinates[1], s.geometry.coordinates[0]];
  const photoOf = (id) => state.photos[id] || null;
  const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null);
  const thumbAt = (ph, w) => ph.thumb.includes('/thumb/') ? ph.thumb.replace(/\/\d+px-/, `/${w}px-`)
    : /staticflickr\.com/.test(ph.thumb) ? ph.thumb.replace(/_[bcz]\.jpg$/i, w <= 320 ? '_n.jpg' : '_c.jpg') : ph.thumb;
  const surfaceLbl = (p) => p.surface ? (C.surfaces[p.surface] || p.surface) : null;
  /* Vue aérienne : mosaïque de tuiles satellite centrée sur le point (aucune bibliothèque). */
  const AERIAL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
  const AERIAL_CREDIT = 'Vue aérienne · Imagerie © Esri, Maxar, Earthstar Geographics';
  function tilePx(lat, lon, z) {
    const n = 2 ** z, x = (lon + 180) / 360 * n, latR = lat * Math.PI / 180;
    const y = (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n;
    return { tx: Math.floor(x), ty: Math.floor(y), px: (x - Math.floor(x)) * 256, py: (y - Math.floor(y)) * 256 };
  }
  function aerialHtml(lat, lon, z, w, h, cls = '', extra = '') {
    const t = tilePx(lat, lon, z), cx = w / 2 - t.px, cy = h / 2 - t.py;
    const r = Math.ceil(Math.max(w, h) / 256) + 1;
    let imgs = '';
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const left = cx + dx * 256, top = cy + dy * 256;
      if (left > w || top > h || left + 256 < 0 || top + 256 < 0) continue;
      imgs += `<img src="${AERIAL}/${z}/${t.ty + dy}/${t.tx + dx}" alt="" loading="lazy" decoding="async" style="left:${Math.round(left)}px;top:${Math.round(top)}px">`;
    }
    return `<div class="aerial ${cls}" style="width:${w}px;height:${h}px" ${extra}>${imgs}<i class="pinpt"></i></div>`;
  }
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }

  function save() {
    syncPush();
    try { localStorage.setItem(LS_STATE, JSON.stringify({ users: state.users, me: state.me, profile: state.profile, filters: state.filters, sort: state.sort,
      poiOn: state.poiOn, plans: state.plans, trip: state.trip, wishWho: state.wishWho, wishSort: state.wishSort, prefs: state.prefs })); } catch (e) { }
  }
  function restore() {
    try {
      const j = JSON.parse(localStorage.getItem(LS_STATE) || 'null'); if (!j) return;
      if (j.users) for (const k of ['a', 'b']) if (j.users[k]) state.users[k] = { name: String(j.users[k].name || DEFAULT_NAMES[k === 'a' ? 0 : 1]).slice(0, 14) || DEFAULT_NAMES[k === 'a' ? 0 : 1], wish: Array.isArray(j.users[k].wish) ? j.users[k].wish.filter((x) => typeof x === 'string') : [] };
      if (j.me) state.me = j.me;
      if (j.profile && C.profiles[j.profile]) state.profile = j.profile;
      if (j.filters) Object.assign(state.filters, j.filters);
      if (j.sort) state.sort = j.sort;
      if (j.poiOn) Object.assign(state.poiOn, j.poiOn);
      if (j.plans) state.plans = j.plans;
      if (j.wishWho) state.wishWho = j.wishWho;
      if (j.wishSort) state.wishSort = j.wishSort;
      if (j.trip && Array.isArray(j.trip.days)) state.trip = { auto: false, ...j.trip };
      if (j.prefs) Object.assign(state.prefs, j.prefs);
    } catch (e) { }
  }

  /* ------------------------------------------------------------------ partage (lien) */
  const b64e = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64d = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
  function shareUrl() {
    const pl = {};
    for (const [id, pn] of Object.entries(state.plans)) if (pn.items.length || pn.notes.a || pn.notes.b) pl[id] = { n: pn.notes, i: pn.items.map((it) => [it.poi || ('t:' + it.text), it.by]) };
    const tr = state.trip.days.some((d) => d.stops.length) || state.trip.base
      ? { b: state.trip.base, s: state.trip.start, a: state.trip.auto ? 1 : 0, d: state.trip.days.map((d) => d.stops.map((st) => [st.t, st.id || st.text])) } : undefined;
    const p = { na: state.users.a.name, nb: state.users.b.name, a: state.users.a.wish, b: state.users.b.wish, d: state.day, p: state.profile, s: state.selected, pl, tr };
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
    const m = location.hash.match(/^#([a-z0-9-]+)$/);
    if (!m) return false;
    const s = spotBySlug(m[1]); if (!s) return false;
    state.selected = s.properties.id; return true;
  }
  /* ------------------------------------------------------------------ synchronisation serveur (version connectée)
     Chaque écriture part au nom du profil authentifié : le serveur ne remplace que la liste de ce
     voyageur ; programmes et séjour sont partagés (dernier écrivain gagnant, versionné). */
  const sync = { on: false, version: null, timer: null, pushing: false, dirty: false, poll: null };
  const syncApply = (st) => {
    const other = state.me === 'a' ? 'b' : 'a';
    state.users[other] = { name: String(st.users[other].name || state.users[other].name).slice(0, 14), wish: (st.users[other].wish || []).filter((x) => typeof x === 'string') };
    state.users[state.me] = { name: String(st.users[state.me].name || state.users[state.me].name).slice(0, 14), wish: (st.users[state.me].wish || []).filter((x) => typeof x === 'string') };
    if (st.plans && typeof st.plans === 'object') state.plans = st.plans;
    if (st.trip && Array.isArray(st.trip.days)) state.trip = { auto: false, ...st.trip };
    sync.version = st.version;
  };
  async function syncLoad() {
    try {
      const r = await fetch('api/state', { cache: 'no-store' }); if (!r.ok) return false;
      const st = await r.json(); if (!st || typeof st.version !== 'number') return false;
      syncApply(st); sync.on = true; return true;
    } catch (e) { return false; }
  }
  function syncPush() {
    if (!sync.on) return;
    sync.dirty = true; clearTimeout(sync.timer); sync.timer = setTimeout(syncFlush, 700);
  }
  async function syncFlush() {
    if (!sync.on || sync.pushing) return;
    sync.pushing = true; sync.dirty = false;
    try {
      const body = { users: { a: { name: state.users.a.name, wish: state.users.a.wish }, b: { name: state.users.b.name, wish: state.users.b.wish } }, plans: state.plans, trip: state.trip };
      const r = await fetch('api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': String(sync.version) }, body: JSON.stringify(body) });
      if (r.status === 409) { const st = await r.json(); const mine = state.users[state.me]; syncApply(st); state.users[state.me] = mine; sync.pushing = false; syncPush(); rerenderAll(); return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const st = await r.json(); sync.version = st.version; $('#sync-dot')?.classList.remove('err');
    } catch (e) { $('#sync-dot')?.classList.add('err'); toast('Synchronisation impossible pour le moment'); }
    sync.pushing = false;
    if (sync.dirty) syncPush();
  }
  async function syncPoll() {
    if (!sync.on || document.hidden || sync.pushing || sync.dirty) return;
    try {
      const r = await fetch('api/state', { cache: 'no-store' }); if (!r.ok) return;
      const st = await r.json();
      if (st.version !== sync.version) { syncApply(st); try { localStorage.setItem(LS_STATE, JSON.stringify({ users: state.users, me: state.me, profile: state.profile, filters: state.filters, sort: state.sort, poiOn: state.poiOn, plans: state.plans, trip: state.trip, wishWho: state.wishWho, wishSort: state.wishSort, prefs: state.prefs })); } catch (e) { } rerenderAll(); toast(`Mis à jour par ${esc(st.by === state.serverUser ? 'vous' : (st.by || 'l\'autre voyageur'))}`); }
    } catch (e) { }
  }
  function rerenderAll() {
    renderTabs(); renderWho();
    if (state.selected && !$('#panel-detail').hidden) { renderDetailHead(); renderDetailDay(detailDay); }
    else if (state.view === 'wishes') renderWishes(); else if (state.view === 'trip') renderTrip(); else if (state.view === 'config') renderConfig(); else renderList();
    paintMarkers();
  }
  const canEdit = (who) => !sync.on || who === state.me;
  /* Version protégée (VPS) : l'utilisateur authentifié (/whoami) devient le voyageur actif. */
  async function applyServerIdentity() {
    try {
      const r = await fetch('whoami', { cache: 'no-store' });
      if (!r.ok) return;
      const id = (await r.text()).trim().toLowerCase();
      if (!id || id.includes('<')) return;
      const k = id === state.users.b.name.toLowerCase() ? 'b' : id === state.users.a.name.toLowerCase() ? 'a' : (id === 'marie' ? 'b' : id === 'simon' ? 'a' : null);
      if (!k) return;
      if (state.me !== k) { state.me = k; }
      state.serverUser = id;
      await syncLoad();
      if (sync.on) { sync.poll = setInterval(syncPoll, 20000); document.addEventListener('visibilitychange', () => { if (!document.hidden) syncPoll(); }); }
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
          days: p.tr.d.slice(0, 14).map((stops) => ({ stops: (stops || []).slice(0, 30).map(([t, v]) => t === 'x' ? { t: 'x', text: String(v).slice(0, 80) } : { t: t === 'p' ? 'p' : 's', id: String(v) }) })) };
      }
      if ((p.a && p.a.length) || (p.b && p.b.length)) state.view = 'wishes';
      if (p.tr && Array.isArray(p.tr.d) && p.tr.d.some((d) => d && d.length)) state.view = 'trip';
      applyViewParam();
      history.replaceState(null, '', location.pathname + location.search);
      save(); toast('Sélection partagée importée'); return true;
    } catch (e) { return false; }
  }
  async function share() {
    const url = shareUrl(), title = 'Costa Cantábrica – nos envies de plages';
    try { if (navigator.share) { await navigator.share({ title, url }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast('Lien copié dans le presse-papiers'); } catch (e) { prompt('Copiez ce lien :', url); }
  }

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
  const hasPlan = (id) => { const pn = state.plans[id]; return !!(pn && (pn.items.length || pn.notes.a || pn.notes.b)); };
  function planAdd(spotId, item) {
    const pn = planOf(spotId);
    if (pn.items.some((x) => (item.poi && x.poi === item.poi) || (item.text && x.text === item.text))) return false;
    pn.items.push({ ...item, by: state.me });
    if (!state.users[state.me].wish.includes(spotId)) state.users[state.me].wish.push(spotId);
    save(); return true;
  }
  function planRemove(spotId, idx) { const pn = planOf(spotId); pn.items.splice(idx, 1); save(); }
  const poiById = (id) => state.pois.find((x) => x.id === id);
  const buzz = (ms = 12) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { } };
  function toggleWish(id, who) {
    if (!canEdit(who)) { toast(`Seul·e ${state.users[who].name} peut modifier ses envies`); return; }
    buzz();
    const list = state.users[who].wish, i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else list.push(id);
    save(); renderTabs(); if (state.view === 'wishes') renderWishes(); else renderList(); paintMarkers();
    if (state.selected === id) renderDetailHead();
  }
  function filtered({ ignoreScore = false } = {}) {
    const f = state.filters, q = f.q.trim().toLowerCase();
    return state.spots.filter((s) => {
      const p = s.properties;
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
  const filtersActive = () => { const f = state.filters; return f.province !== 'all' || f.type !== 'all' || f.surface !== 'all' || f.lifeguard || f.dog || f.wish !== 'all' || f.minScore > 0; };

  /* ------------------------------------------------------------------ carte */
  function initMap() {
    map = L.map('map', { zoomControl: true, attributionControl: true, tapTolerance: 20, zoomSnap: 0.5, wheelPxPerZoomLevel: 90 }).setView(C.center, C.zoom);
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · prévisions <a href="https://open-meteo.com/">Open-Meteo</a>' });
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagerie © Esri, Maxar, Earthstar Geographics, and the GIS User Community · <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: 'Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM · © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' });
    osm.addTo(map);
    L.control.layers({ 'Plan': osm, 'Satellite': sat, 'Relief': topo }, null, { position: 'bottomright' }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    for (const s of state.spots) {
      const m = L.circleMarker(latlng(s), { radius: 7, weight: 2, color: '#fff', fillColor: '#9aa0a6', fillOpacity: .95 })
        .bindTooltip(s.properties.name, { className: 'spot-tip', direction: 'top', offset: [0, -6] })
        .on('click', () => select(s.properties.id, { pan: false }));
      m.addTo(map); markers.set(s.properties.id, m);
    }
    map.on('dragstart', () => { if (window.innerWidth < 900 && !sheet.classList.contains('peek')) setSheet('peek'); });
    map.on('click', (e) => {
      if (!state.pickBase) return;
      state.pickBase = false; ensureTrip();
      state.trip.base = { name: `Hébergement (${e.latlng.lat.toFixed(3)}, ${e.latlng.lng.toFixed(3)})`, lat: +e.latlng.lat.toFixed(5), lon: +e.latlng.lng.toFixed(5) };
      save(); if (state.view === 'config') renderConfig(); else renderTrip(); paintMarkers(); if (window.innerWidth < 900) setSheet('half'); toast('Résidence placée');
    });
    fitAll();
    $('#legend').innerHTML = C.scoreClasses.map((c) => `<span><i style="background:var(--${c.key})"></i>${c.label}</span>`).join('');
  }
  /* ------------------------------------------------------------------ points d'intérêt */
  const poiGroupOf = (kind) => C.poiGroups.food.includes(kind) ? 'food' : 'visit';
  const osmUrl = (id) => `https://www.openstreetmap.org/${{ n: 'node', w: 'way', r: 'relation' }[id[0]]}/${id.slice(1)}`;
  function poiPopup(x) {
    const p = x.p, k = C.poiKinds[p.kind] || C.poiKinds.tourism;
    const meta = [p.cuisine ? p.cuisine.split(';').join(', ') : null, p.sub && p.kind !== p.sub ? p.sub.replace(/_/g, ' ') : null,
      p.beach_m && p.beach_m < 400 ? `plage à ${p.beach_m} m` : null, p.addr_city].filter(Boolean).join(' · ');
    return `<div class="poi-pop"><b>${esc(p.name)}</b><span class="k" style="color:${k.color}">${I(k.icon, { size: 13 })}${esc(k.label)}</span>
      ${meta ? `<div class="m">${esc(meta)}</div>` : ''}${p.opening_hours ? `<div class="m">${I('clock', { size: 12 })} ${esc(p.opening_hours)}</div>` : ''}
      <div class="l"><a href="https://www.google.com/maps/dir/?api=1&destination=${x.lat},${x.lon}" target="_blank" rel="noopener">${I('navigation', { size: 12 })}Itinéraire</a>
      ${safeUrl(p.website) ? `<a href="${esc(safeUrl(p.website))}" target="_blank" rel="noopener">${I('link', { size: 12 })}Site</a>` : ''}
      ${p.phone && /^[+\d][\d\s().-]{5,20}$/.test(p.phone) ? `<a href="tel:${esc(p.phone.replace(/[^+\d]/g, ''))}">${esc(p.phone)}</a>` : ''}
      <a href="${osmUrl(p.id)}" target="_blank" rel="noopener">${I('map', { size: 12 })}OSM</a></div></div>`;
  }
  function poiIcon(x, small) {
    const k = C.poiKinds[x.p.kind] || C.poiKinds.tourism;
    return L.divIcon({ className: '', html: `<div class="poi-pin ${small ? 'small' : ''}" style="background:${k.color}">${I(k.icon, { size: 13 })}</div>`, iconSize: small ? [12, 12] : [24, 24], iconAnchor: small ? [6, 6] : [12, 12], popupAnchor: [0, small ? -6 : -12] });
  }
  function poiMarker(x, small) {
    return L.marker([x.lat, x.lon], { icon: poiIcon(x, small), title: x.p.name }).bindPopup(() => poiPopup(x), { maxWidth: 280 });
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
    $('#layer-chips').querySelectorAll('button').forEach((b) => b.onclick = () => { state.poiOn[b.dataset.g] = !state.poiOn[b.dataset.g]; save(); renderLayerChips(); renderPois(); if (state.poiOn[b.dataset.g] && map.getZoom() < C.poiMinZoom) toast('Zoomez sur la carte pour voir les lieux'); });
  }
  function initPois() {
    poiLayer = L.layerGroup().addTo(map);
    map.on('moveend zoomend', renderPois);
    renderLayerChips(); renderPois();
  }
  function showPoi(x) {
    state.poiOn[poiGroupOf(x.p.kind)] = true;
    const z = Math.max(map.getZoom(), C.poiMinZoom + 2), mobile = window.innerWidth < 900, p = map.project([x.lat, x.lon], z);
    if (mobile) p.y += (sheet.classList.contains('full') ? 0 : sheet.getBoundingClientRect().height / 2);
    map.setView(map.unproject(p, z), z, { animate: false });
    renderPois();
    const m = poiMarkers.get(x.id) || poiMarker(x, false).addTo(poiLayer);
    if (!poiMarkers.has(x.id)) poiMarkers.set(x.id, m);
    m.openPopup();
    if (mobile && sheet.classList.contains('full')) setSheet('half');
  }
  function nearbyOf(s, km = C.nearbyKm) {
    const c = latlng(s), sname = s.properties.name.toLowerCase();
    return state.pois.map((x) => ({ x, d: distKm(c, [x.lat, x.lon]) }))
      .filter((o) => o.d <= km && !(o.d < 0.12 && poiGroupOf(o.x.p.kind) === 'visit' && (sname.includes(o.x.p.name.toLowerCase()) || o.x.p.name.toLowerCase().includes(sname))))
      .sort((a, b) => a.d - b.d);
  }

  function fitAll() {
    if (!state.spots.length) return;
    const b = L.latLngBounds(state.spots.map(latlng)), mobile = window.innerWidth < 900;
    const bottom = mobile ? Math.round(window.innerHeight * 0.58) : 0;
    map.fitBounds(b, { paddingTopLeft: [16, 16], paddingBottomRight: [16, bottom + 16], animate: false });
  }
  function paintMarkers() {
    const vis = new Set(filtered().map((s) => s.properties.id));
    const colA = cssVar('--a'), colB = cssVar('--b'), colBoth = cssVar('--both');
    for (const s of state.spots) {
      const id = s.properties.id, m = markers.get(id);
      if (!vis.has(id)) { if (map.hasLayer(m)) map.removeLayer(m); continue; }
      if (!map.hasLayer(m)) m.addTo(map);
      const r = state.bulk ? scoreOf(s) : { cls: 'none' }, w = wishOf(id), sel = state.selected === id;
      if (state.view === 'wishes' || state.view === 'trip') {
        if (state.view === 'wishes' && (w.a || w.b)) { map.removeLayer(m); continue; }
        if (state.view === 'trip' && tripHasSpot(id)) { map.removeLayer(m); continue; }
        m.setStyle({ fillColor: cssVar('--' + r.cls), radius: 4, color: '#fff', weight: 1, fillOpacity: .45 });
        continue;
      }
      m.setStyle({ fillColor: cssVar('--' + r.cls), radius: sel ? 11 : (w.a || w.b ? 9 : 7), fillOpacity: .95,
        color: sel ? '#111' : w.a && w.b ? colBoth : w.a ? colA : w.b ? colB : '#fff', weight: sel ? 3 : (w.a || w.b ? 3 : 2) });
      if (sel) m.bringToFront();
    }
    paintWishLayer(); paintTripLayer(); paintPlanLayer();
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
          .bindPopup(() => poiPopup(x), { maxWidth: 280 }).addTo(planLayer);
      }
    }
    if (state.view !== 'trip') state.trip.days.forEach((d, i) => {
      const route = dayRoute(d);
      if (route.seq.length > 1) L.polyline(route.seq, { color: dayColor(i), weight: 2.5, opacity: .35, dashArray: '6 6', interactive: false }).addTo(planLayer);
    });
    if (state.view !== 'trip' && state.trip.base) L.marker([state.trip.base.lat, state.trip.base.lon], { icon: L.divIcon({ className: '', html: `<div class="home-pin" style="opacity:.75">${I('home', { size: 15 })}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }), title: state.trip.base.name, zIndexOffset: 800, interactive: false }).addTo(planLayer);
  }
  function panTo(s) {
    const z = Math.max(map.getZoom(), C.poiMinZoom + 1), mobile = window.innerWidth < 900, p = map.project(latlng(s), z);
    if (mobile) p.y += (sheet.classList.contains('full') ? 0 : sheet.getBoundingClientRect().height / 2);
    map.setView(map.unproject(p, z), z, { animate: true });
  }

  /* ------------------------------------------------------------------ en-tête, jours, profil */
  function renderChrome() {
    $('#btn-settings').classList.toggle('on', state.view === 'config');
    $('#brand-mark').innerHTML = I('wave', { size: 18 });
    $('#brand-name').textContent = state.region.short || state.region.name;
    $('#brand-sub').textContent = state.region.subtitle || 'plages & criques';
    $('#btn-filters').innerHTML = I('sliders', { size: 20 });
    $('#btn-settings').innerHTML = I('users', { size: 20 });
    $('#btn-locate').innerHTML = I('locate', { size: 20 });
    $('#btn-share').innerHTML = I('share', { size: 20 });
    $('#search-ic').innerHTML = I('search', { size: 18 });
    $('.close', $('#dlg-settings')).innerHTML = I('x', { size: 18 });
    $('.close', $('#dlg-pick')).innerHTML = I('x', { size: 18 });
  }
  function renderWho() {
    $('#who').innerHTML = (sync.on ? `<span class="sync-dot" id="sync-dot" title="Synchronisé avec le serveur"></span>` : '') + ['a', 'b'].map((k) => `<button class="avatar ${k} ${state.me === k ? 'on' : ''}" data-k="${k}" title="Je suis ${esc(state.users[k].name)}"><span>${esc(String(state.users[k].name || '?')[0].toUpperCase())}</span></button>`).join('');
    $('#who').querySelectorAll('button').forEach((b) => { b.onclick = () => { if (sync.on) { toast(`Connecté·e en tant que ${state.users[state.me].name}`); return; } state.me = b.dataset.k; save(); renderWho(); if (state.selected) renderPlanCard(state.selected); toast(`Envies et notes de ${state.users[state.me].name}`); }; });
  }
  function bestDot(i) {
    if (!state.bulk) return 'none';
    let best = -1;
    for (const s of filtered({ ignoreScore: true })) { const sc = scoreOf(s, i).score; if (sc != null && sc > best) best = sc; }
    if (best < 0) return 'none';
    return C.scoreClasses.find((c) => best >= c.min).key;
  }
  function renderDays() {
    const el = $('#days'); el.innerHTML = '';
    const dates = state.bulk ? state.bulk.dates : Array.from({ length: C.forecastDays }, (_, i) => addDays(F.todayLocal(), i));
    dates.forEach((iso, i) => {
      const { lbl, sub } = fmtDay(iso, i), b = document.createElement('button');
      b.className = 'day' + (i === state.day ? ' on' : ''); b.type = 'button';
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

  /* ------------------------------------------------------------------ onglets & vue Envies */
  function renderTabs() {
    $('#btn-settings').classList.toggle('on', state.view === 'config');
    const n = wishedIds().length, nt = state.trip.days.reduce((k, d) => k + d.stops.length, 0);
    $('#tabs').innerHTML = `<button type="button" role="tab" aria-selected="${state.view === 'explore'}" data-v="explore" class="${state.view === 'explore' ? 'on' : ''}">${I('compass', { size: 16 })}Explorer</button>
      <button type="button" role="tab" aria-selected="${state.view === 'wishes'}" data-v="wishes" class="${state.view === 'wishes' ? 'on' : ''}">${I('heart', { size: 16, fill: state.view === 'wishes' })}Envies${n ? `<b>${n}</b>` : ''}</button>
      <button type="button" role="tab" aria-selected="${state.view === 'trip'}" data-v="trip" class="${state.view === 'trip' ? 'on' : ''}">${I('calendar', { size: 16 })}Séjour${nt ? `<b>${nt}</b>` : ''}</button>`;
    $('#tabs').querySelectorAll('button').forEach((b) => b.onclick = () => setView(b.dataset.v));
  }
  function setView(v) {
    state.view = v;
    if (state.selected && !$('#panel-detail').hidden) closeDetail();
    $('#panel-list').hidden = v !== 'explore'; $('#panel-wishes').hidden = v !== 'wishes'; $('#panel-trip').hidden = v !== 'trip'; $('#panel-config').hidden = v !== 'config';
    renderTabs(); paintMarkers();
    if (v === 'wishes') { renderWishes(); fitWishes(); } else if (v === 'trip') { renderTrip(); fitTrip(); } else if (v === 'config') { renderConfig(); } else { renderList(); }
    if (v === 'config' && window.innerWidth < 900) setSheet('full');
    if (v !== 'explore' && !state.pois.length) ensurePois().then(() => { if (state.view === v) { v === 'wishes' ? renderWishes() : renderTrip(); paintMarkers(); } });
  }
  function wishList() {
    const who = state.wishWho;
    let ids = wishedIds().filter((id) => { const w = wishOf(id); return who === 'all' ? true : who === 'both' ? w.a && w.b : w[who]; });
    let arr = ids.map(spotById);
    if (state.wishSort === 'score' && state.bulk) arr.sort((a, b) => (scoreOf(b).score ?? -1) - (scoreOf(a).score ?? -1));
    else arr.sort((a, b) => a.geometry.coordinates[0] - b.geometry.coordinates[0]);
    return arr;
  }
  function planSummary(id) {
    const pn = state.plans[id]; if (!pn) return '';
    const parts = [];
    if (pn.items.length) parts.push(pn.items.map((it) => it.text || (poiById(it.poi)?.p.name ?? '…')).slice(0, 3).join(', ') + (pn.items.length > 3 ? ` +${pn.items.length - 3}` : ''));
    const note = pn.notes.a || pn.notes.b; if (note) parts.push('« ' + note.slice(0, 40) + (note.length > 40 ? '…' : '') + ' »');
    return parts.join(' · ');
  }
  function renderWishes() {
    const dot = (k) => `<i style="width:10px;height:10px;border-radius:50%;background:var(--${k});display:inline-block"></i>`;
    seg($('#w-who'), [['all', 'Tous'], ['a', dot('a') + esc(state.users.a.name)], ['b', dot('b') + esc(state.users.b.name)], ['both', 'Communes']], state.wishWho, (v) => { state.wishWho = v; save(); renderWishes(); paintMarkers(); fitWishes(); }, { a: 'a', b: 'b', both: 'both' });
    seg($('#w-sort'), [['coast', "D'ouest en est"], ['score', 'Meilleur score']], state.wishSort, (v) => { state.wishSort = v; save(); renderWishes(); paintMarkers(); });
    const list = wishList(), ul = $('#w-list');
    const wa = state.users.a.wish.length, wb = state.users.b.wish.length, both = state.users.a.wish.filter((id) => state.users.b.wish.includes(id)).length;
    $('#w-summary').innerHTML = `<span>${dot('a')} ${wa} · ${dot('b')} ${wb} · ${dot('both')} ${both} commune${both > 1 ? 's' : ''}</span><span>${list.length} plage${list.length > 1 ? 's' : ''}</span>`;
    if (!list.length) {
      ul.innerHTML = `<li class="empty-state"><span>Aucune envie pour l'instant.</span><span>Marquez des plages avec ${I('heart', { size: 14 })} dans l'onglet Explorer, chacun avec son prénom. Les envies communes ressortent ici.</span></li>`;
      $('#w-foot').innerHTML = ''; return;
    }
    const frag = document.createDocumentFragment();
    list.forEach((s, i) => {
      const p = s.properties, r = state.bulk ? scoreOf(s) : null, w = wishOf(p.id), ph = photoOf(p.id), d = state.bulk ? F.dayOf(state.bulk, s, state.day) : null;
      const who = w.a && w.b ? 'both' : w.a ? 'a' : 'b';
      const li = document.createElement('li'); li.className = 'item' + (state.selected === p.id ? ' sel' : ''); li.dataset.id = p.id;
      li.style.gridTemplateColumns = '44px 56px minmax(0, 1fr) 36px';
      const cond = d && d.tmax != null ? `<span>${wIcon(d.code, 14)}${n0(d.tmax, '°')}</span><span class="mu">${I('drop', { size: 14 })}${n0(d.pprob, ' %')}</span><span class="sea">${I('wave', { size: 14 })}${n1(d.wave, ' m')}</span>` : '';
      li.innerHTML = `
        <div class="num c-${r ? r.cls : 'none'}">${i + 1}<small style="background:var(--${who})">${who === 'both' ? '2' : esc(state.users[who].name[0].toUpperCase())}</small></div>
        ${ph ? `<img class="thumb" src="${esc(thumbAt(ph, 160))}" alt="" loading="lazy" decoding="async" onerror="this.outerHTML='<div class=&quot;thumb empty&quot;></div>'">` : aerialHtml(latlng(s)[0], latlng(s)[1], 16, 56, 56, 'thumb')}
        <div class="body">
          <div class="name"><span>${esc(p.name)}</span><span class="tag">${p.type}</span></div>
          <div class="meta">${esc([p.province, surfaceLbl(p)].filter(Boolean).join(' · '))}${r && r.score != null ? ` · <b style="color:var(--${r.cls})">${r.score}</b> ${esc(r.label)}` : ''}</div>
          ${hasPlan(p.id) ? `<div class="plan">${I('note', { size: 13 })}${esc(planSummary(p.id))}</div>` : `<div class="cond">${cond}</div>`}
        </div>
        <div class="hearts">
          <button type="button" class="heart a ${w.a ? 'on' : ''} ${canEdit('a') ? '' : 'ro'}" data-who="a">${I('heart', { size: 15, fill: w.a })}</button>
          <button type="button" class="heart b ${w.b ? 'on' : ''} ${canEdit('b') ? '' : 'ro'}" data-who="b">${I('heart', { size: 15, fill: w.b })}</button>
        </div>`;
      li.querySelectorAll('.heart').forEach((h) => h.onclick = (e) => { e.stopPropagation(); toggleWish(p.id, h.dataset.who); });
      li.onclick = () => select(p.id, { pan: true });
      frag.appendChild(li);
    });
    ul.innerHTML = ''; ul.appendChild(frag);
    const pts = list.map(latlng);
    let gmaps = null;
    if (pts.length === 1) gmaps = `https://www.google.com/maps/dir/?api=1&destination=${pts[0].join(',')}`;
    else if (pts.length > 1) { const mid = pts.slice(1, -1).slice(0, 9); gmaps = `https://www.google.com/maps/dir/?api=1&origin=${pts[0].join(',')}&destination=${pts[pts.length - 1].join(',')}${mid.length ? '&waypoints=' + mid.map((x) => x.join(',')).join('|') : ''}`; }
    $('#w-foot').innerHTML = `<a class="btn primary big" style="display:flex;align-items:center;justify-content:center;gap:8px" href="${gmaps}" target="_blank" rel="noopener">${I('route', { size: 18 })}Itinéraire Google Maps · ${Math.min(pts.length, 11)} étape${pts.length > 1 ? 's' : ''}</a>
      ${pts.length > 11 ? '<span class="hint">Google Maps accepte 11 étapes au plus : les premières d\'ouest en est sont retenues.</span>' : ''}
      <div class="row"><button type="button" class="btn ghost" id="w-share" style="flex:1">Partager le lien</button><button type="button" class="btn ghost" id="w-export" style="flex:1">Exporter (GeoJSON)</button></div>`;
    $('#w-share').onclick = share; $('#w-export').onclick = exportSelection;
  }
  function fitWishes() {
    const list = wishList(); if (!list.length) return;
    const b = L.latLngBounds(list.map(latlng)), mobile = window.innerWidth < 900, bottom = mobile ? Math.round(window.innerHeight * 0.58) : 0;
    map.fitBounds(b.pad(0.15), { paddingTopLeft: [16, 60], paddingBottomRight: [16, bottom + 16], maxZoom: 12 });
  }
  function paintWishLayer() {
    if (!wishLayer) wishLayer = L.layerGroup().addTo(map);
    wishLayer.clearLayers();
    if (state.view !== 'wishes') return;
    const list = wishList();
    if (list.length > 1) L.polyline(list.map(latlng), { color: cssVar('--both'), weight: 2, dashArray: '4 6', opacity: .7 }).addTo(wishLayer);
    list.forEach((s, i) => {
      const p = s.properties, r = state.bulk ? scoreOf(s) : { cls: 'none' }, w = wishOf(p.id), who = w.a && w.b ? 'both' : w.a ? 'a' : 'b';
      const icon = L.divIcon({ className: '', html: `<div class="num-pin ${who}" style="background:var(--${r.cls})">${i + 1}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      L.marker(latlng(s), { icon, title: p.name, zIndexOffset: 1000 }).on('click', () => select(p.id, { pan: false })).addTo(wishLayer);
    });
  }

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
  function proposeTrip({ silent = false } = {}) {
    ensureTrip();
    const t = state.trip, n = t.days.length;
    let cands = wishedIds().map(spotById);
    if (!cands.length) cands = state.spots.slice();
    if (!state.bulk) { if (!silent) toast('Prévisions nécessaires pour proposer un planning'); return; }
    const base = t.base ? [t.base.lat, t.base.lon] : null;
    if (base && state.prefs.radiusKm) cands = cands.filter((s) => distKm(base, latlng(s)) <= state.prefs.radiusKm) .length ? cands.filter((s) => distKm(base, latlng(s)) <= state.prefs.radiusKm) : cands;
    const perDay = Math.max(1, Math.min(state.prefs.perDay || 2, Math.ceil(cands.length / n)));
    // score jour × spot ; pénalité de distance à l'hébergement ; 2 à 3 plages par jour maximum
    const scored = [];
    for (const s of cands) for (let i = 0; i < n; i++) {
      const fi = forecastIdx(dayIso(i)); if (fi < 0) continue;
      const sc = scoreOf(s, fi).score; if (sc == null) continue;
      const pen = base ? Math.min(20, distKm(base, latlng(s)) / 5) : 0;
      scored.push({ s, i, v: sc - pen });
    }
    scored.sort((a, b) => b.v - a.v);
    const used = new Set(), counts = Array(n).fill(0);
    t.days.forEach((d) => { d.stops = []; });
    const wished = wishedIds().length > 0;
    for (const { s, i } of scored) {
      if (used.has(s.properties.id) || counts[i] >= perDay) continue;
      if (!wished && counts.reduce((a, b) => a + b, 0) >= n * 2) break;
      used.add(s.properties.id); counts[i]++;
      t.days[i].stops.push({ t: 's', id: s.properties.id });
    }
    t.days.forEach((d) => {
      d.stops.sort((x, y) => (spotById(x.id)?.geometry.coordinates[0] ?? 0) - (spotById(y.id)?.geometry.coordinates[0] ?? 0));
      const spots = d.stops.slice(); d.stops = [];
      spots.forEach((st, k) => {
        addStop(t.days.indexOf(d), st);
        if (state.prefs.lunch && k === 0 && !d.stops.some((x) => x.t === 'p' && ['restaurant', 'beach_bar'].includes(poiById(x.id)?.p.kind))) {
          const s0 = spotById(st.id), c = latlng(s0);
          const r = state.pois.filter((x) => ['restaurant', 'beach_bar'].includes(x.p.kind)).map((x) => ({ x, dd: distKm(c, [x.lat, x.lon]) })).filter((o) => o.dd < 1.5).sort((a, b) => a.dd - b.dd)[0];
          if (r) addStop(t.days.indexOf(d), { t: 'p', id: r.x.id });
        }
      });
    });
    save(); renderTabs(); if (state.view === 'trip') { renderTrip(); paintMarkers(); if (!silent) fitTrip(); }
    if (!silent) toast(wished ? 'Planning proposé à partir de vos envies' : 'Planning proposé avec les meilleures plages');
  }
  /* Séjour dynamique : à chaque mise à jour des prévisions, le planning est recalculé (mode auto). */
  function autoReplan() {
    if (!state.trip.auto || !state.bulk) return;
    ensurePois().then(() => { proposeTrip({ silent: true }); });
  }
  function manualEdit() { if (state.trip.auto) { state.trip.auto = false; save(); toast('Planning figé : modifications manuelles conservées'); } }
  function renderTrip() {
    ensureTrip();
    const t = state.trip, el = $('#trip');
    const baseHtml = t.base
      ? `<div class="base-name"><span class="home">${I('home', { size: 16 })}</span><span>${esc(t.base.name)}</span><button type="button" class="linkbtn" id="base-clear" style="margin-left:auto">Changer</button></div>`
      : `<span class="hint">Définissez votre hébergement : chaque journée part de là et y revient.</span>
         <div class="base-search"><input type="search" id="base-q" placeholder="Rechercher un lieu, un village, une plage…" autocomplete="off"><button type="button" class="iconbtn" id="base-geo" title="Ma position" aria-label="Ma position">${I('locate', { size: 18 })}</button><button type="button" class="iconbtn ${state.pickBase ? 'on' : ''}" id="base-map" title="Choisir sur la carte" aria-label="Choisir sur la carte">${I('pin', { size: 18 })}</button></div>
         <div class="sugg" id="base-sugg" hidden></div>`;
    const daysHtml = t.days.map((d, i) => {
      const fi = forecastIdx(dayIso(i)), route = dayRoute(d);
      const stops = d.stops.map((st, k) => {
        const info = stopInfo(st); if (!info) return '';
        const prev = k > 0 ? stopInfo(d.stops[k - 1]) : (t.base ? { lat: t.base.lat, lon: t.base.lon } : null);
        const leg = info.lat != null && prev && prev.lat != null ? `${(distKm([prev.lat, prev.lon], [info.lat, info.lon]) * 1.3).toFixed(0)} km` : '';
        let sc = '';
        if (info.kind === 'spot' && fi >= 0) { const r = scoreOf(info.spot, fi); sc = `<span class="sc"><i style="background:var(--${r.cls})"></i>${r.score ?? '—'}</span>`; }
        const badge = info.kind === 'spot' ? `<span class="n">${k + 1}</span>` : info.kind === 'poi' ? `<span class="n poi" style="background:${info.color}">${I(info.icon, { size: 12 })}</span>` : `<span class="n poi">${I('compass', { size: 12 })}</span>`;
        return `<li data-k="${k}">${badge}<span class="t">${esc(info.name)} <small>· ${esc(info.sub)}</small></span><span class="d">${sc} ${leg}</span>
          <button type="button" class="ib up" data-k="${k}" ${k === 0 ? 'disabled' : ''} aria-label="Monter">${I('up2', { size: 14 })}</button><button type="button" class="ib rm" data-k="${k}" aria-label="Retirer">${I('x', { size: 14 })}</button></li>`;
      }).join('');
      let wx = '';
      if (fi >= 0 && d.stops.some((st) => st.t === 's')) { const s0 = spotById(d.stops.find((st) => st.t === 's').id); const dd = F.dayOf(state.bulk, s0, fi); wx = `${wIcon(dd.code, 16)} ${n0(dd.tmax, '°')}`; }
      return `<div class="card day-card" style="--dc:${dayColor(i)}" data-i="${i}">
        <div class="h"><div><b>Jour ${i + 1}</b> <small>· ${dayLabel(i)}</small></div><span style="display:flex;align-items:center;gap:6px">${wx}</span></div>
        ${stops ? `<ul class="stops">${stops}</ul>` : '<span class="hint">Aucune étape. Ajoutez une plage : son programme (resto, visite…) suit automatiquement.</span>'}
        <div class="day-foot">
          <button type="button" class="linkbtn add-stop" data-i="${i}">${I('plus', { size: 14 })} Ajouter une étape</button>
          ${route.url ? `<span>${I('car', { size: 14 })} ~${Math.round(route.km)} km${t.base && state.prefs.roundTrip ? ' A/R' : ''}</span><a href="${route.url}" target="_blank" rel="noopener">${I('route', { size: 14 })}Google Maps</a>` : ''}
        </div></div>`;
    }).join('');
    el.innerHTML = `
      <div class="card"><div class="h"><h3>${I('home', { size: 13 })} Hébergement</h3></div>${baseHtml}</div>
      <div class="card"><div class="h"><h3>${I('calendar', { size: 13 })} ${t.days.length} jour${t.days.length > 1 ? 's' : ''} · du ${dayLabel(0)} au ${dayLabel(t.days.length - 1)}</h3>
        <div class="stepper"><button type="button" id="days-minus" aria-label="Un jour de moins">${I('minus', { size: 16 })}</button><button type="button" id="days-plus" aria-label="Un jour de plus">${I('plus', { size: 16 })}</button></div></div>
        <div class="row" style="align-items:center;gap:8px;flex-wrap:wrap">
          <button type="button" class="auto-chip ${t.auto ? 'on' : ''}" id="trip-auto" title="Recalculer le planning à chaque mise à jour des prévisions">${I('refresh', { size: 13 })}${t.auto ? 'Dynamique' : 'Manuel'}</button>
          <button type="button" class="auto-chip" id="trip-config">${I('sliders', { size: 13 })}Réglages</button>
          <span class="hint" style="flex-basis:100%">${t.auto ? 'Le planning suit les prévisions : il est recalculé à chaque rafraîchissement, sauf si vous modifiez une étape.' : 'Vos étapes sont conservées telles quelles.'}</span>
        </div>
        <button type="button" class="btn ghost" id="trip-propose" style="display:flex;align-items:center;justify-content:center;gap:8px">${I('wand', { size: 16 })}Proposer un planning selon la météo</button></div>
      ${daysHtml}
      <div class="row"><button type="button" class="btn ghost" id="trip-share" style="flex:1">Partager le séjour</button><button type="button" class="btn ghost" id="trip-clear" style="flex:1">Tout effacer</button></div>`;
    // hébergement
    $('#base-clear') && ($('#base-clear').onclick = () => { t.base = null; save(); renderTrip(); paintMarkers(); });
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
      $('#base-map').onclick = () => { state.pickBase = !state.pickBase; renderTrip(); toast(state.pickBase ? 'Touchez la carte pour placer l\'hébergement' : 'Sélection annulée'); if (state.pickBase && window.innerWidth < 900) setSheet('peek'); };
    }
    // jours
    $('#days-minus').onclick = () => { if (t.days.length > 1) { t.days.pop(); save(); renderTabs(); renderTrip(); paintMarkers(); } };
    $('#days-plus').onclick = () => { if (t.days.length < 14) { t.days.push({ stops: [] }); save(); renderTrip(); } };
    $('#trip-propose').onclick = () => { if (!t.days.some((d) => d.stops.length) || confirm('Remplacer les étapes actuelles par une proposition ?')) { t.auto = true; ensurePois().then(() => proposeTrip()); } };
    $('#trip-auto').onclick = () => { t.auto = !t.auto; save(); renderTrip(); if (t.auto) { toast('Planning dynamique : recalculé à chaque mise à jour des prévisions'); ensurePois().then(() => proposeTrip({ silent: true })); } };
    $('#trip-config').onclick = () => setView('config');
    $('#trip-share').onclick = share;
    $('#trip-clear').onclick = () => { if (confirm('Effacer hébergement et étapes ?')) { state.trip = { base: null, start: null, days: [] }; save(); renderTabs(); renderTrip(); paintMarkers(); } };
    el.querySelectorAll('.add-stop').forEach((b) => b.onclick = () => pickStop(+b.dataset.i));
    el.querySelectorAll('.day-card').forEach((card) => {
      const i = +card.dataset.i, d = t.days[i];
      card.querySelectorAll('.rm').forEach((b) => b.onclick = () => { manualEdit(); d.stops.splice(+b.dataset.k, 1); save(); renderTabs(); renderTrip(); paintMarkers(); });
      card.querySelectorAll('.up').forEach((b) => b.onclick = () => { const k = +b.dataset.k; if (k > 0) { manualEdit(); [d.stops[k - 1], d.stops[k]] = [d.stops[k], d.stops[k - 1]]; save(); renderTrip(); paintMarkers(); } });
      card.querySelectorAll('.stops li').forEach((li) => li.onclick = (e) => { if (e.target.closest('button')) return; const st = d.stops[+li.dataset.k]; if (st.t === 's') select(st.id, { pan: true }); else if (st.t === 'p') { const x = poiById(st.id); if (x) showPoi(x); } });
    });
  }
  function pickStop(di) {
    const dlg = $('#dlg-pick'), day = state.trip.days[di], fi = forecastIdx(dayIso(di));
    const inDay = new Set(day.stops.map((st) => st.t + ':' + (st.id || st.text)));
    $('#pick-title').textContent = `Ajouter au jour ${di + 1} · ${dayLabel(di)}`;
    const scoreTag = (s) => { if (fi < 0 || !state.bulk) return ''; const r = scoreOf(s, fi); return `<span class="sub" style="color:var(--${r.cls});font-weight:700">${r.score ?? '—'}</span>`; };
    const wish = wishedIds().map(spotById).filter((s) => !inDay.has('s:' + s.properties.id));
    const best = state.bulk && fi >= 0 ? state.spots.filter((s) => !inDay.has('s:' + s.properties.id) && !wish.includes(s)).sort((a, b) => (scoreOf(b, fi).score ?? -1) - (scoreOf(a, fi).score ?? -1)).slice(0, 8) : [];
    const last = [...day.stops].reverse().map(stopInfo).find((x) => x && x.lat != null);
    const near = last ? state.pois.map((x) => ({ x, d: distKm([last.lat, last.lon], [x.lat, x.lon]) })).filter((o) => o.d < 2 && !inDay.has('p:' + o.x.id)).sort((a, b) => a.d - b.d).slice(0, 8) : [];
    const row = (s) => `<button type="button" data-t="s" data-id="${esc(s.properties.id)}">${I('wave', { size: 14 })}<span>${esc(s.properties.name)}</span>${scoreTag(s)}</button>`;
    $('#pick-list').innerHTML = (wish.length ? `<h4>Vos envies</h4>${wish.map(row).join('')}` : '') +
      (best.length ? `<h4>Meilleures plages ce jour-là</h4>${best.map(row).join('')}` : '') +
      (near.length ? `<h4>Autour de ${esc(last.name)}</h4>${near.map((o) => { const k = C.poiKinds[o.x.p.kind] || C.poiKinds.tourism; return `<button type="button" data-t="p" data-id="${esc(o.x.id)}"><span class="poi-pin" style="background:${k.color};width:22px;height:22px">${I(k.icon, { size: 12 })}</span><span>${esc(o.x.p.name)}</span><span class="sub">${esc(k.label)} · ${Math.round(o.d * 1000)} m</span></button>`; }).join('')}` : '') +
      `<h4>Autre</h4><div class="plan-add"><input type="text" id="pick-text" maxlength="80" placeholder="Étape libre : marché, pause café…"><button type="button" id="pick-text-add" aria-label="Ajouter">${I('plus', { size: 18 })}</button></div>`;
    const done = () => { dlg.close(); save(); renderTabs(); renderTrip(); paintMarkers(); };
    $('#pick-list').querySelectorAll('button[data-t]').forEach((b) => b.onclick = () => { manualEdit(); addStop(di, { t: b.dataset.t, id: b.dataset.id }); done(); });
    $('#pick-text-add').onclick = () => { const v = $('#pick-text').value.trim(); if (v) { manualEdit(); addStop(di, { t: 'x', text: v }); done(); } };
    dlg.showModal();
  }
  function pickDayFor(spotId) {
    ensureTrip();
    const dlg = $('#dlg-pick');
    $('#pick-title').textContent = 'Ajouter à quel jour ?';
    $('#pick-list').innerHTML = state.trip.days.map((d, i) => { const fi = forecastIdx(dayIso(i)); const s = spotById(spotId); const r = fi >= 0 && state.bulk ? scoreOf(s, fi) : null;
      return `<button type="button" data-i="${i}"><span class="n" style="width:24px;height:24px;border-radius:50%;background:${dayColor(i)};color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center">${i + 1}</span><span>Jour ${i + 1} · ${dayLabel(i)}</span><span class="sub">${d.stops.length} étape${d.stops.length > 1 ? 's' : ''}${r ? ` · <b style="color:var(--${r.cls})">${r.score ?? '—'}</b>` : ''}</span></button>`; }).join('');
    $('#pick-list').querySelectorAll('button').forEach((b) => b.onclick = () => { manualEdit(); const ok = addStop(+b.dataset.i, { t: 's', id: spotId }); dlg.close(); renderTabs(); paintMarkers(); toast(ok ? `Ajouté au jour ${+b.dataset.i + 1}` : 'Déjà dans ce jour'); if (state.selected === spotId) renderDetailHead(); });
    dlg.showModal();
  }
  function fitTrip() {
    const pts = [];
    if (state.trip.base) pts.push([state.trip.base.lat, state.trip.base.lon]);
    for (const d of state.trip.days) for (const st of d.stops) { const x = stopInfo(st); if (x && x.lat != null) pts.push([x.lat, x.lon]); }
    if (!pts.length) return;
    const mobile = window.innerWidth < 900, bottom = mobile ? Math.round(window.innerHeight * 0.58) : 0;
    map.fitBounds(L.latLngBounds(pts).pad(0.15), { paddingTopLeft: [16, 60], paddingBottomRight: [16, bottom + 16], maxZoom: 12 });
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
        <div class="btns"><a class="btn ghost" href="login.html" style="display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none">${I('users', { size: 14 })} Changer de voyageur / code séjour</a></div></div>
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
        <div class="two"><label class="f">Plages par jour (max.)<select id="c-perday">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${pr.perDay === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="f">Rayon depuis la résidence<select id="c-radius">${[20, 40, 60, 100, 200].map((n) => `<option value="${n}" ${pr.radiusKm === n ? 'selected' : ''}>${n} km</option>`).join('')}</select></label></div></div>
      <div class="card"><div class="h"><h3>${I('sliders', { size: 13 })} Affichage</h3></div>
        <label class="f">Profil d'activité par défaut<div class="seg" id="c-profile"></div></label>
        ${sw('c-food', state.poiOn.food, 'Restos & bars sur la carte')}${sw('c-visit', state.poiOn.visit, 'Sites et visites sur la carte')}</div>
      <div class="card"><div class="h"><h3>${I('download', { size: 13 })} Données</h3></div>
        <div class="btns"><button type="button" class="btn ghost" id="c-share">${I('share', { size: 14 })} Partager le lien</button><button type="button" class="btn ghost" id="c-export">${I('download', { size: 14 })} Exporter (GeoJSON)</button><button type="button" class="btn ghost" id="c-refresh">${I('refresh', { size: 14 })} Rafraîchir les prévisions</button><button type="button" class="btn ghost" id="c-intro">${I('info', { size: 14 })} Revoir le guide</button><button type="button" class="btn ghost" id="c-reset" style="color:var(--bad)">${I('trash', { size: 14 })} Tout effacer</button></div></div>
      <div class="card"><div class="h"><h3>${I('info', { size: 13 })} À propos</h3></div>
        <span class="hint">${esc(state.region.name)} · ${state.spots.length} plages et criques · ${state.pois.length ? state.pois.length + ' lieux' : 'lieux chargés à la demande'} · version ${esc(assetVer || '—')}</span>
        <span class="hint">Données © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (ODbL) · prévisions <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0) · photos Wikimedia Commons, Flickr, Openverse (licences indiquées) · imagerie Esri · <a href="https://github.com/imagodata/costa-cantabrica-planner" target="_blank" rel="noopener">code source</a>.</span></div>`;
    if (state.serverUser) { const hint = document.createElement('span'); hint.className = 'hint'; hint.textContent = `Connecté sur le serveur en tant que « ${state.serverUser} » : le voyageur est choisi automatiquement.`; $('#c-me').closest('.card').appendChild(hint); }
    const commit = () => { save(); renderTabs(); renderWho(); };
    $('#c-a').onchange = (e) => { state.users.a.name = e.target.value.trim().slice(0, 14) || DEFAULT_NAMES[0]; commit(); renderConfig(); };
    $('#c-b').onchange = (e) => { state.users.b.name = e.target.value.trim().slice(0, 14) || DEFAULT_NAMES[1]; commit(); renderConfig(); };
    seg($('#c-me'), [['a', esc(state.users.a.name)], ['b', esc(state.users.b.name)]], state.me, (v) => { if (sync.on) { toast('Identité fixée par la connexion au serveur'); renderConfig(); return; } state.me = v; commit(); }, { a: 'a', b: 'b' });
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
    $('#c-base-map').onclick = () => { state.pickBase = !state.pickBase; renderConfig(); if (state.pickBase) { toast('Touchez la carte pour placer la résidence'); if (window.innerWidth < 900) setSheet('peek'); } };
    $('#c-base-clear') && ($('#c-base-clear').onclick = () => setBase(null));
    $('#c-base-name').onchange = (e) => { if (t.base) { t.base.name = e.target.value.trim().slice(0, 60) || 'Résidence'; save(); renderConfig(); paintMarkers(); } };
    const setDays = (n) => { n = Math.max(1, Math.min(14, n)); while (t.days.length < n) t.days.push({ stops: [] }); t.days.length = n; };
    $('#c-start').onchange = (e) => { if (e.target.value) { const n = t.days.length; t.start = e.target.value; setDays(n); save(); renderConfig(); autoReplan(); } };
    $('#c-end').onchange = (e) => { if (e.target.value) { const n = Math.round((new Date(e.target.value) - new Date(t.start)) / 86400000) + 1; setDays(n); save(); renderTabs(); renderConfig(); autoReplan(); } };
    $('#c-auto').onclick = () => { t.auto = !t.auto; save(); renderConfig(); if (t.auto) ensurePois().then(() => proposeTrip({ silent: true })); };
    $('#c-round').onclick = () => { pr.roundTrip = !pr.roundTrip; save(); renderConfig(); };
    $('#c-lunch').onclick = () => { pr.lunch = !pr.lunch; save(); renderConfig(); autoReplan(); };
    $('#c-perday').onchange = (e) => { pr.perDay = +e.target.value; save(); autoReplan(); };
    $('#c-radius').onchange = (e) => { pr.radiusKm = +e.target.value; save(); autoReplan(); };
    $('#c-food').onclick = () => { state.poiOn.food = !state.poiOn.food; save(); renderLayerChips(); renderPois(); renderConfig(); };
    $('#c-visit').onclick = () => { state.poiOn.visit = !state.poiOn.visit; save(); renderLayerChips(); renderPois(); renderConfig(); };
    $('#c-share').onclick = share; $('#c-export').onclick = exportSelection; $('#c-refresh').onclick = () => loadForecast(true);
    $('#c-intro').onclick = () => { try { localStorage.removeItem('ccp:intro'); } catch (e) { } showIntro(); };
    $('#c-reset').onclick = () => { if (confirm('Effacer envies, programmes, séjour et préférences sur cet appareil ?')) { try { localStorage.removeItem(LS_STATE); } catch (e) { } location.hash = ''; location.reload(); } };
  }

  /* ------------------------------------------------------------------ liste */
  const LIST_CHUNK = 60;
  let listShown = LIST_CHUNK, listObserver = null;
  function renderList({ more = false } = {}) {
    if (!more) listShown = LIST_CHUNK;
    const ul = $('#list'), list = sorted(filtered());
    let ideal = 0, good = 0;
    if (state.bulk) for (const s of list) { const c = scoreOf(s).cls; if (c === 'ideal') ideal++; else if (c === 'good') good++; }
    const fetched = state.bulk ? new Date(state.bulk.fetchedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null;
    $('#summary').innerHTML = (state.bulk ? `<span><b>${ideal} idéale${ideal > 1 ? 's' : ''}</b> · ${good} bonne${good > 1 ? 's' : ''} · ${list.length} spot${list.length > 1 ? 's' : ''}</span>` : `<span>${list.length} spots</span>`) +
      (fetched ? `<span><a href="https://open-meteo.com/" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">Open-Meteo</a> ${fetched}</span>` : `<span class="warn">prévisions indisponibles</span>`);
    const frag = document.createDocumentFragment();
    for (const s of list.slice(0, listShown)) {
      const p = s.properties, r = state.bulk ? scoreOf(s) : null, d = state.bulk ? F.dayOf(state.bulk, s, state.day) : null, w = wishOf(p.id), ph = photoOf(p.id);
      const li = document.createElement('li');
      li.className = 'item' + (state.selected === p.id ? ' sel' : ''); li.dataset.id = p.id;
      const meta = [p.province, surfaceLbl(p), p.size_m ? `~${p.size_m.toLocaleString('fr-FR')} m` : null,
        state.userPos ? `${distKm(state.userPos, latlng(s)).toFixed(0)} km` : null].filter(Boolean).join(' · ');
      const cond = d && d.tmax != null ? `<span>${wIcon(d.code, 14)}${n0(d.tmax, '°')}</span><span class="mu">${I('drop', { size: 14 })}${n0(d.pprob, ' %')}</span><span class="mu">${I('wind', { size: 14 })}${n0(d.wind)} ${compass(d.wdir)}</span><span class="sea">${I('wave', { size: 14 })}${n1(d.wave, ' m')}</span>` : '';
      li.innerHTML = `
        <div class="score c-${r ? r.cls : 'none'}"><b>${r && r.score != null ? r.score : '—'}</b><small>${r ? esc(r.label) : ''}</small></div>
        ${ph ? `<img class="thumb" src="${esc(thumbAt(ph, 160))}" alt="" loading="lazy" decoding="async" onerror="this.outerHTML='<div class=&quot;thumb empty&quot;>${I('wave', { size: 20 }).replace(/"/g, '&quot;')}</div>'">` : aerialHtml(latlng(s)[0], latlng(s)[1], 16, 56, 56, 'thumb')}
        <div class="body">
          <div class="name"><span>${esc(p.name)}</span><span class="tag">${p.type}</span>${p.lifeguard === 'yes' ? '<span class="tag">surveillée</span>' : ''}${p.nudism === 'yes' ? '<span class="tag">naturiste</span>' : ''}</div>
          <div class="meta">${esc(meta)}</div>
          <div class="cond">${cond}</div>
        </div>
        <div class="hearts">
          <button type="button" class="heart a ${w.a ? 'on' : ''} ${canEdit('a') ? '' : 'ro'}" data-who="a" aria-label="Envie de ${esc(state.users.a.name)}">${I('heart', { size: 15, fill: w.a })}</button>
          <button type="button" class="heart b ${w.b ? 'on' : ''} ${canEdit('b') ? '' : 'ro'}" data-who="b" aria-label="Envie de ${esc(state.users.b.name)}">${I('heart', { size: 15, fill: w.b })}</button>
        </div>`;
      li.querySelectorAll('.heart').forEach((h) => h.onclick = (e) => { e.stopPropagation(); toggleWish(p.id, h.dataset.who); });
      li.onclick = () => select(p.id, { pan: true });
      frag.appendChild(li);
    }
    ul.innerHTML = ''; ul.appendChild(frag);
    if (!list.length) ul.innerHTML = '<li class="loading">Aucun spot ne correspond aux filtres.</li>';
    if (list.length > listShown) {
      const li = document.createElement('li'); li.innerHTML = `<button type="button" class="more">Afficher ${Math.min(LIST_CHUNK, list.length - listShown)} de plus (${list.length - listShown} restants)</button>`;
      li.querySelector('button').onclick = () => { listShown += LIST_CHUNK; renderList({ more: true }); };
      ul.appendChild(li);
      // chargement automatique quand le bouton entre dans la vue
      if (!listObserver) listObserver = new IntersectionObserver((es) => { es.forEach((e) => { if (e.isIntersecting) { listShown += LIST_CHUNK; renderList({ more: true }); } }); }, { root: $('#panels'), rootMargin: '200px' });
      listObserver.disconnect(); listObserver.observe(li);
    } else if (listObserver) listObserver.disconnect();
  }

  /* ------------------------------------------------------------------ détail */
  const spotById = (id) => state.spots.find((s) => s.properties.id === id);
  async function select(id, { pan = true } = {}) {
    const s = spotById(id); if (!s) return;
    if (!$('#panel-detail').hidden === false) listScroll = $('#panels').scrollTop;
    state.selected = id; detailDay = state.day; detailData = null;
    const token = ++detailReq;
    if (s.properties.slug && location.hash !== '#' + s.properties.slug) {
      const url = location.pathname + location.search + '#' + s.properties.slug;
      if (history.state && history.state.spot) history.replaceState({ spot: id }, '', url); else history.pushState({ spot: id }, '', url);
    }
    nearbyTab = 'all';
    paintMarkers();
    $('#panel-list').hidden = true; $('#panel-wishes').hidden = true; $('#panel-trip').hidden = true; $('#panel-config').hidden = true; $('#panel-detail').hidden = false; $('#panels').scrollTop = 0;
    if (window.innerWidth < 900 && sheet.classList.contains('peek')) setSheet('half');
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
    if (state.view === 'wishes') { $('#panel-wishes').hidden = false; renderWishes(); } else if (state.view === 'trip') { $('#panel-trip').hidden = false; renderTrip(); } else if (state.view === 'config') { $('#panel-config').hidden = false; renderConfig(); } else { $('#panel-list').hidden = false; renderList(); }
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
    const gal = [...photosList, { aerial: true, credit: AERIAL_CREDIT, license: '', page: '' }];
    const heroW = Math.min(window.innerWidth, 900) >= 900 ? 440 : window.innerWidth;
    $('#detail-head').innerHTML = `
      <div class="hero ${ph ? '' : 'nophoto'}">
        <div class="slides" id="slides">${gal.map((g, i) => g.aerial
          ? aerialHtml(lat, lon, 17, heroW, 250, 'slide')
          : `<img src="${esc(g.thumb)}" alt="${esc(p.name)} (${i + 1})" ${i ? 'loading="lazy"' : ''} decoding="async" onerror="this.style.visibility='hidden'">`).join('')}</div>
        <div class="shade"></div>
        ${gal.length > 1 ? `<div class="dots" id="dots">${gal.map((g, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div><span class="count" id="gcount">1 / ${gal.length}</span>
          <button type="button" class="nav l" id="gprev" aria-label="Photo précédente">${I('chevronL', { size: 24 })}</button><button type="button" class="nav r" id="gnext" aria-label="Photo suivante">${I('chevronR', { size: 24 })}</button>` : ''}
        <div class="tl"><button type="button" class="iconbtn" id="btn-close" aria-label="Retour à la liste">${I('back', { size: 20 })}</button></div>
        <div class="tr"><button type="button" class="iconbtn" id="btn-share-spot" aria-label="Partager ce spot">${I('share', { size: 20 })}</button></div>
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
          <span class="spacer"></span>
          <button type="button" class="pill ${tripHasSpot(p.id) ? 'primary' : ''}" id="btn-trip-add" title="Ajouter à un jour du séjour">${I('calendar', { size: 15 })}${tripHasSpot(p.id) ? 'Au séjour' : 'Séjour'}</button>
          <a class="pill primary" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving" target="_blank" rel="noopener">${I('navigation', { size: 16 })}Itinéraire</a>
        </div>
        <div id="plan-slot"></div>
        <div class="links">
          <a href="geo:${lat},${lon}?q=${lat},${lon}(${encodeURIComponent(p.name)})">${I('pin', { size: 14 })}GPS</a>
          ${wiki ? `<a href="${wiki}" target="_blank" rel="noopener">${I('book', { size: 14 })}Wikipédia</a>` : ''}
          <a href="${commons}" target="_blank" rel="noopener">${I('camera', { size: 14 })}Photos</a>
          <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ' ' + p.province)}" target="_blank" rel="noopener">${I('pin', { size: 14 })}Google Maps</a>
          <a href="${esc(p.osm)}" target="_blank" rel="noopener">${I('map', { size: 14 })}OSM</a>
          ${safeUrl(p.website) ? `<a href="${esc(safeUrl(p.website))}" target="_blank" rel="noopener">${I('link', { size: 14 })}Site</a>` : ''}
        </div>
      </div>`;
    $('#btn-close').onclick = () => closeDetail();
    $('#btn-share-spot').onclick = () => shareSpot(s);
    $('#btn-trip-add').onclick = () => pickDayFor(p.id);
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

  /* ------------------------------------------------------------------ panneau glissant */
  function setSheet(mode) {
    sheet.classList.remove('peek', 'half', 'full'); sheet.classList.add(mode);
    document.documentElement.style.setProperty('--sheet-h', mode === 'peek' ? '30vh' : mode === 'half' ? '58vh' : '100vh');
  }
  function initSheet() {
    sheet = $('#sheet'); setSheet('half');
    const order = ['peek', 'half', 'full'], cur = () => order.find((m) => sheet.classList.contains(m));
    const move = (dir) => { const i = order.indexOf(cur()); setSheet(order[Math.max(0, Math.min(2, i + dir))]); };
    const isMobile = () => window.innerWidth < 900;
    /* Glisser : le panneau suit le doigt ; au relâcher, aimantation vers la hauteur la plus proche
       en tenant compte de la vitesse (un geste vif suffit à changer d'état). */
    let drag = null;
    const start = (y) => { if (!isMobile()) return; drag = { y0: y, h0: sheet.getBoundingClientRect().height, t0: performance.now(), y: y, t: performance.now(), moved: false }; sheet.classList.add('dragging'); };
    const update = (y) => {
      if (!drag) return;
      const H = window.innerHeight, hs = { peek: H * 0.30, half: H * 0.58, full: H - parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar')) - 6 };
      let h = drag.h0 + (drag.y0 - y);
      if (h > hs.full) h = hs.full + (h - hs.full) * 0.2; if (h < hs.peek) h = hs.peek - (hs.peek - h) * 0.2;
      if (Math.abs(y - drag.y0) > 4) drag.moved = true;
      drag.vy = (y - drag.y) / Math.max(1, performance.now() - drag.t); drag.y = y; drag.t = performance.now();
      sheet.style.height = h + 'px';
    };
    const end = () => {
      if (!drag) return;
      const H = window.innerHeight, hs = { peek: H * 0.30, half: H * 0.58, full: H - parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar')) - 6 };
      const h = sheet.getBoundingClientRect().height, vy = drag.vy || 0, moved = drag.moved;
      sheet.classList.remove('dragging'); sheet.style.height = '';
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
    $('#tabs').addEventListener('click', (e) => { if (drag) e.stopPropagation(); }, true);
    // Tirer vers le bas depuis le haut de la liste replie le panneau (tactile uniquement)
    const panel = $('#panels'); let y0 = null;
    panel.addEventListener('touchstart', (e) => { y0 = panel.scrollTop === 0 ? e.touches[0].clientY : null; }, { passive: true });
    panel.addEventListener('touchend', (e) => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; if (dy > 70 && panel.scrollTop === 0) move(-1); y0 = null; }, { passive: true });
    // Clavier : la recherche déploie le panneau pour rester visible au-dessus du clavier
    $('#q').addEventListener('focus', () => { if (isMobile()) setSheet('full'); });
  }

  /* ------------------------------------------------------------------ filtres & réglages */
  function seg(el, options, value, onPick, tone) {
    el.innerHTML = options.map(([v, lbl]) => `<button type="button" data-v="${v}" class="${v === value ? 'on' : ''} ${tone && tone[v] ? 'tone-' + tone[v] : ''}">${lbl}</button>`).join('');
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
    const afterFilter = () => { renderDays(); renderList(); paintMarkers(); $('#btn-filters').classList.toggle('on', filtersActive()); };

    const sd = $('#dlg-settings');
    $('#btn-settings').onclick = () => { if (state.selected && !$('#panel-detail').hidden) closeDetail(); setView(state.view === 'config' ? 'explore' : 'config'); };
    $('#u-save').onclick = () => {
      state.users.a.name = $('#u-a').value.trim() || DEFAULT_NAMES[0]; state.users.b.name = $('#u-b').value.trim() || DEFAULT_NAMES[1];
      save(); sd.close(); renderWho(); renderList(); if (state.selected) renderDetailHead();
    };
    $('#u-share').onclick = share;
    $('#u-export').onclick = exportSelection;
    $('#u-refresh').onclick = () => { sd.close(); loadForecast(true); };
    document.querySelectorAll('dialog .close').forEach((b) => b.onclick = () => b.closest('dialog').close());
    document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

    let qTimer = null;
    $('#q').oninput = (e) => { state.filters.q = e.target.value; clearTimeout(qTimer); qTimer = setTimeout(() => { renderList(); paintMarkers(); }, 150); };
    $('#btn-share').onclick = share;
    $('#btn-locate').onclick = locate;
    $('#btn-filters').classList.toggle('on', filtersActive());
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
      map.setView(state.userPos, Math.max(map.getZoom(), 10));
      state.sort = 'dist'; save(); renderList(); toast('Liste triée par distance');
    }, () => toast('Position introuvable'), { enableHighAccuracy: true, timeout: 10000 });
  }

  /* ------------------------------------------------------------------ premier lancement */
  function showIntro() {
    let seen = false; try { seen = localStorage.getItem('ccp:intro') === '1'; } catch (e) { }
    if (seen || wishedIds().length) return;
    const steps = [
      { icon: 'compass', title: 'Explorer', text: `Choisissez le jour et votre profil (plage, famille, surf, balade) : chaque plage reçoit un score selon la météo, le vent et la houle. Touchez un point de la carte ou la liste pour la fiche complète : marées, heure par heure, photos, lieux à proximité.` },
      { icon: 'heart', title: 'À deux', text: `${esc(state.users.a.name)} et ${esc(state.users.b.name)} marquent chacun leurs envies avec le cœur de leur couleur. L'onglet « Nos envies » réunit les listes, numérote les plages d'ouest en est et prépare l'itinéraire.` },
      { icon: 'calendar', title: 'Programmer', text: `Dans une fiche, ajoutez un resto, un monument ou une activité au programme de la plage. L'onglet « Séjour » place votre hébergement, répartit les plages sur les jours selon la météo et prépare chaque trajet aller-retour dans Google Maps. Tout se partage par lien.` },
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
    if (/[#&]reset\b/.test(location.hash)) {          // app.html#reset : repartir de zéro (version de test publique)
      try { localStorage.removeItem(LS_STATE); localStorage.removeItem('ccp:intro'); } catch (e) { }
      history.replaceState(null, '', location.pathname + location.search + location.hash.replace(/[#&]reset\b/, '').replace(/^&/, '#'));
    }
    restore();
    await applyServerIdentity();
    const shared = applyShare();
    let routed = false;
    if (!shared && applyViewParam()) history.replaceState(null, '', location.pathname + location.search);
    const ver = (document.querySelector('script[src*="app.js"]')?.src.match(/v=(\w+)/) || [])[1] || '';
    const [fc, photos, pois, region] = await Promise.all([
      fetch('data/spots.geojson?v=' + ver).then((r) => r.json()),
      fetch('data/photos.json?v=' + ver).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
      fetch('data/pois.geojson?v=' + ver).then((r) => (r.ok ? r.json() : { features: [] })).catch(() => ({ features: [] })),
      fetch('data/region.json?v=' + ver).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    state.region = region || { name: 'Plages', short: 'Plages', subtitle: '', areas: [] };
    if (state.region.center) { C.center = state.region.center; C.zoom = state.region.zoom || C.zoom; }
    if (state.region.timezone) C.timezone = state.region.timezone;
    document.title = `${state.region.name} · plages & criques`;
    state.spots = fc.features; state.photos = photos || {};
    routed = !shared && applyRoute();
    state.pois = (pois.features || []).map((f) => ({ id: f.properties.id, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], p: f.properties }));
    renderChrome(); initSheet(); initMap(); initPois(); initDialogs(); renderWho(); renderProfiles(); renderTabs(); renderDays(); renderList();
    if (state.view !== 'explore') setView(state.view);
    $('#q').value = state.filters.q;
    if (!shared && !routed) showIntro();
    await loadForecast(false);
    if ((shared || routed) && state.selected) select(state.selected, { pan: true }); else state.selected = null;
    window.addEventListener('hashchange', () => { if (!/^#share=/.test(location.hash) && applyRoute() && state.selected !== (history.state && history.state.spot)) select(state.selected, { pan: true }); });
    window.addEventListener('popstate', () => {
      if (applyRoute()) select(state.selected, { pan: true });
      else if (state.selected && !$('#panel-detail').hidden) closeDetail(true);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('dialog[open]')) return;
      if (state.selected && !$('#panel-detail').hidden) closeDetail();
    });
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) navigator.serviceWorker.register('sw.js').catch(() => {});
    window.addEventListener('online', () => { if (!state.bulk) loadForecast(false); });
    if (!shared && !routed) showIntro();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
