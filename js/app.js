/* Application : carte, liste classée, fiche détail, filtres, deux voyageurs, partage. */
(function () {
  const C = CCP.CONFIG, F = CCP.forecast, I = CCP.icon;
  const LS_STATE = 'ccp:state:v' + C.version;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEFAULT_NAMES = ['Simon', 'Marie'];

  const state = {
    spots: [], photos: {}, bulk: null, day: 0, profile: 'plage', selected: null, userPos: null,
    filters: { province: 'all', type: 'all', surface: 'all', lifeguard: false, dog: false, minScore: 0, wish: 'all', q: '' },
    sort: 'score',
    users: { a: { name: DEFAULT_NAMES[0], wish: [] }, b: { name: DEFAULT_NAMES[1], wish: [] } },
    me: 'a',
  };
  const scoreCache = new Map();
  let map, markers = new Map(), userMarker = null, sheet, detailData = null, detailDay = 0;
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  /* ------------------------------------------------------------------ utilitaires */
  const dayNames = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  function fmtDay(iso, i) {
    const d = new Date(iso + 'T12:00:00');
    return { lbl: i === 0 ? 'Auj.' : i === 1 ? 'Dem.' : dayNames[d.getDay()], sub: d.getDate() + '/' + (d.getMonth() + 1) };
  }
  const hm = (d) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: C.timezone });
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
  const thumbAt = (ph, w) => ph.thumb.includes('/thumb/') ? ph.thumb.replace(/\/\d+px-/, `/${w}px-`) : ph.thumb;
  const surfaceLbl = (p) => p.surface ? (C.surfaces[p.surface] || p.surface) : null;
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }

  function save() {
    try { localStorage.setItem(LS_STATE, JSON.stringify({ users: state.users, me: state.me, profile: state.profile, filters: state.filters, sort: state.sort })); } catch (e) { }
  }
  function restore() {
    try {
      const j = JSON.parse(localStorage.getItem(LS_STATE) || 'null'); if (!j) return;
      if (j.users) state.users = j.users;
      if (j.me) state.me = j.me;
      if (j.profile && C.profiles[j.profile]) state.profile = j.profile;
      if (j.filters) Object.assign(state.filters, j.filters);
      if (j.sort) state.sort = j.sort;
    } catch (e) { }
  }

  /* ------------------------------------------------------------------ partage (lien) */
  const b64e = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64d = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
  function shareUrl() {
    const p = { na: state.users.a.name, nb: state.users.b.name, a: state.users.a.wish, b: state.users.b.wish, d: state.day, p: state.profile, s: state.selected };
    return location.origin + location.pathname + '#share=' + b64e(JSON.stringify(p));
  }
  function applyShare() {
    const m = location.hash.match(/#share=([A-Za-z0-9_-]+)/); if (!m) return false;
    try {
      const p = JSON.parse(b64d(m[1]));
      const merge = (k, list) => { state.users[k].wish = [...new Set([...(state.users[k].wish || []), ...(list || [])])]; };
      merge('a', p.a); merge('b', p.b);
      if (p.na && DEFAULT_NAMES.includes(state.users.a.name)) state.users.a.name = p.na;
      if (p.nb && DEFAULT_NAMES.includes(state.users.b.name)) state.users.b.name = p.nb;
      if (Number.isInteger(p.d)) state.day = Math.max(0, Math.min(C.forecastDays - 1, p.d));
      if (p.p && C.profiles[p.p]) state.profile = p.p;
      if (p.s) state.selected = p.s;
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
  function toggleWish(id, who) {
    const list = state.users[who].wish, i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else list.push(id);
    save(); renderList(); paintMarkers();
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
    map = L.map('map', { zoomControl: true, attributionControl: true, tap: true }).setView(C.center, C.zoom);
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' });
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagerie © Esri' });
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenTopoMap (CC-BY-SA)' });
    osm.addTo(map);
    L.control.layers({ 'Plan': osm, 'Satellite': sat, 'Relief': topo }, null, { position: 'bottomright' }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    for (const s of state.spots) {
      const m = L.circleMarker(latlng(s), { radius: 7, weight: 2, color: '#fff', fillColor: '#9aa0a6', fillOpacity: .95 })
        .bindTooltip(s.properties.name, { className: 'spot-tip', direction: 'top', offset: [0, -6] })
        .on('click', () => select(s.properties.id, { pan: false }));
      m.addTo(map); markers.set(s.properties.id, m);
    }
    fitAll();
    $('#legend').innerHTML = C.scoreClasses.map((c) => `<span><i style="background:var(--${c.key})"></i>${c.label}</span>`).join('');
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
      m.setStyle({ fillColor: cssVar('--' + r.cls), radius: sel ? 11 : (w.a || w.b ? 9 : 7),
        color: sel ? '#111' : w.a && w.b ? colBoth : w.a ? colA : w.b ? colB : '#fff', weight: sel ? 3 : (w.a || w.b ? 3 : 2) });
      if (sel) m.bringToFront();
    }
  }
  function panTo(s) {
    const z = Math.max(map.getZoom(), 12), mobile = window.innerWidth < 900, p = map.project(latlng(s), z);
    if (mobile) p.y += (sheet.classList.contains('full') ? 0 : sheet.getBoundingClientRect().height / 2);
    map.setView(map.unproject(p, z), z, { animate: true });
  }

  /* ------------------------------------------------------------------ en-tête, jours, profil */
  function renderChrome() {
    $('#brand-mark').innerHTML = I('wave', { size: 18 });
    $('#btn-filters').innerHTML = I('sliders', { size: 20 });
    $('#btn-settings').innerHTML = I('users', { size: 20 });
    $('#btn-locate').innerHTML = I('locate', { size: 20 });
    $('#btn-share').innerHTML = I('share', { size: 20 });
    $('#search-ic').innerHTML = I('search', { size: 18 });
    $('.close', $('#dlg-settings')).innerHTML = I('x', { size: 18 });
  }
  function renderWho() {
    $('#who').innerHTML = ['a', 'b'].map((k) => `<button class="avatar ${k} ${state.me === k ? 'on' : ''}" data-k="${k}" title="Je suis ${esc(state.users[k].name)}"><span>${esc(state.users[k].name[0].toUpperCase())}</span></button>`).join('');
    $('#who').querySelectorAll('button').forEach((b) => { b.onclick = () => { state.me = b.dataset.k; save(); renderWho(); toast(`Envies marquées pour ${state.users[state.me].name}`); }; });
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
    const dates = state.bulk ? state.bulk.dates : Array.from({ length: C.forecastDays }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d.toISOString().slice(0, 10); });
    dates.forEach((iso, i) => {
      const { lbl, sub } = fmtDay(iso, i), b = document.createElement('button');
      b.className = 'day' + (i === state.day ? ' on' : ''); b.type = 'button';
      b.innerHTML = `<b>${lbl}</b><small>${sub}</small><i style="background:var(--${bestDot(i)})"></i>`;
      b.onclick = () => { state.day = i; renderDays(); renderList(); paintMarkers(); if (state.selected) renderDetailDay(i); };
      el.appendChild(b);
    });
    el.children[state.day]?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
  function renderProfiles() {
    $('#profile-seg').innerHTML = Object.entries(C.profiles).map(([k, p]) => `<button type="button" role="tab" data-k="${k}" class="${k === state.profile ? 'on' : ''}" title="${esc(p.label)}">${k === state.profile ? I(p.icon, { size: 15 }) : ''}${esc(p.short)}</button>`).join('');
    $('#profile-seg').querySelectorAll('button').forEach((b) => b.onclick = () => { state.profile = b.dataset.k; save(); renderProfiles(); renderDays(); renderList(); paintMarkers(); if (state.selected) renderDetailDay(detailDay); });
  }

  /* ------------------------------------------------------------------ liste */
  function renderList() {
    const ul = $('#list'), list = sorted(filtered());
    let ideal = 0, good = 0;
    if (state.bulk) for (const s of list) { const c = scoreOf(s).cls; if (c === 'ideal') ideal++; else if (c === 'good') good++; }
    const fetched = state.bulk ? new Date(state.bulk.fetchedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null;
    $('#summary').innerHTML = (state.bulk ? `<span><b>${ideal} idéale${ideal > 1 ? 's' : ''}</b> · ${good} bonne${good > 1 ? 's' : ''} · ${list.length} spot${list.length > 1 ? 's' : ''}</span>` : `<span>${list.length} spots</span>`) +
      (fetched ? `<span>prévisions ${fetched}</span>` : `<span class="warn">prévisions indisponibles</span>`);
    const frag = document.createDocumentFragment();
    for (const s of list) {
      const p = s.properties, r = state.bulk ? scoreOf(s) : null, d = state.bulk ? F.dayOf(state.bulk, s, state.day) : null, w = wishOf(p.id), ph = photoOf(p.id);
      const li = document.createElement('li');
      li.className = 'item' + (state.selected === p.id ? ' sel' : ''); li.dataset.id = p.id;
      const meta = [p.province, surfaceLbl(p), p.size_m ? `~${p.size_m.toLocaleString('fr-FR')} m` : null,
        state.userPos ? `${distKm(state.userPos, latlng(s)).toFixed(0)} km` : null].filter(Boolean).join(' · ');
      const cond = d && d.tmax != null ? `<span>${wIcon(d.code, 14)}${n0(d.tmax, '°')}</span><span class="mu">${I('drop', { size: 14 })}${n0(d.pprob, ' %')}</span><span class="mu">${I('wind', { size: 14 })}${n0(d.wind)} ${compass(d.wdir)}</span><span class="sea">${I('wave', { size: 14 })}${n1(d.wave, ' m')}</span>` : '';
      li.innerHTML = `
        <div class="score c-${r ? r.cls : 'none'}"><b>${r && r.score != null ? r.score : '—'}</b><small>${r ? esc(r.label) : ''}</small></div>
        ${ph ? `<img class="thumb" src="${esc(thumbAt(ph, 160))}" alt="" loading="lazy" decoding="async" onerror="this.outerHTML='<div class=&quot;thumb empty&quot;>${I('wave', { size: 20 }).replace(/"/g, '&quot;')}</div>'">` : `<div class="thumb empty">${I('wave', { size: 20 })}</div>`}
        <div class="body">
          <div class="name"><span>${esc(p.name)}</span><span class="tag">${p.type}</span>${p.lifeguard === 'yes' ? '<span class="tag">surveillée</span>' : ''}${p.nudism === 'yes' ? '<span class="tag">naturiste</span>' : ''}</div>
          <div class="meta">${esc(meta)}</div>
          <div class="cond">${cond}</div>
        </div>
        <div class="hearts">
          <button type="button" class="heart a ${w.a ? 'on' : ''}" data-who="a" aria-label="Envie de ${esc(state.users.a.name)}">${I('heart', { size: 15, fill: w.a })}</button>
          <button type="button" class="heart b ${w.b ? 'on' : ''}" data-who="b" aria-label="Envie de ${esc(state.users.b.name)}">${I('heart', { size: 15, fill: w.b })}</button>
        </div>`;
      li.querySelectorAll('.heart').forEach((h) => h.onclick = (e) => { e.stopPropagation(); toggleWish(p.id, h.dataset.who); });
      li.onclick = () => select(p.id, { pan: true });
      frag.appendChild(li);
    }
    ul.innerHTML = ''; ul.appendChild(frag);
    if (!list.length) ul.innerHTML = '<li class="loading">Aucun spot ne correspond aux filtres.</li>';
  }

  /* ------------------------------------------------------------------ détail */
  const spotById = (id) => state.spots.find((s) => s.properties.id === id);
  async function select(id, { pan = true } = {}) {
    const s = spotById(id); if (!s) return;
    state.selected = id; detailDay = state.day; detailData = null;
    paintMarkers();
    $('#panel-list').hidden = true; $('#panel-detail').hidden = false; $('#panels').scrollTop = 0;
    if (window.innerWidth < 900 && sheet.classList.contains('peek')) setSheet('half');
    renderDetailHead();
    $('#detail-body').innerHTML = '<div class="loading">Chargement des prévisions horaires…</div>';
    if (pan) panTo(s);
    try { detailData = await F.loadDetail(s); renderDetailDay(detailDay); }
    catch (e) { renderDetailDay(detailDay, `Prévisions horaires indisponibles (${esc(e.message)}).`); }
  }
  function closeDetail() {
    state.selected = null; paintMarkers();
    $('#panel-detail').hidden = true; $('#panel-list').hidden = false;
    renderList();
  }
  function renderDetailHead() {
    const s = spotById(state.selected), p = s.properties, w = wishOf(p.id), ph = photoOf(p.id), [lat, lon] = latlng(s);
    const r = state.bulk ? scoreOf(s, detailDay) : null;
    const tags = [p.type, p.province, surfaceLbl(p), p.size_m ? `~${p.size_m.toLocaleString('fr-FR')} m` : null, p.nudism === 'yes' ? 'naturiste' : null,
      p.lifeguard === 'yes' ? 'surveillée' : null, p.dog === 'yes' ? 'chiens OK' : p.dog === 'no' ? 'chiens interdits' : null,
      p.tidal === 'yes' ? 'dépend de la marée' : null, p.access && p.access !== 'yes' ? `accès : ${p.access}` : null].filter(Boolean);
    const wiki = p.wikipedia ? `https://${p.wikipedia.split(':')[0]}.wikipedia.org/wiki/${encodeURIComponent(p.wikipedia.split(':').slice(1).join(':'))}` : null;
    const commons = `https://commons.wikimedia.org/w/index.php?search=${encodeURIComponent(p.name)}&ns6=1`;
    $('#detail-head').innerHTML = `
      <div class="hero ${ph ? '' : 'nophoto'}">
        ${ph ? `<img src="${esc(ph.thumb)}" alt="${esc(p.name)}" decoding="async" onerror="this.remove();this.closest('.hero')?.classList.add('nophoto')">` : ''}
        <div class="shade"></div>
        <div class="tl"><button type="button" class="iconbtn" id="btn-close" aria-label="Retour à la liste">${I('back', { size: 20 })}</button></div>
        <div class="tr"><button type="button" class="iconbtn" id="btn-share-spot" aria-label="Partager ce spot">${I('share', { size: 20 })}</button></div>
        <div class="cap">
          <div class="row"><h2>${esc(p.name)}</h2>${r ? `<div class="score c-${r.cls}"><b>${r.score ?? '—'}</b><small>${esc(r.label)}</small></div>` : ''}</div>
          <span class="sub">${esc(tags.join(' · '))}</span>
          ${ph ? `<span class="credit">${esc(ph.credit)}${ph.license ? ' · ' + esc(ph.license) : ''} · <a href="${esc(ph.page)}" target="_blank" rel="noopener">Wikimedia Commons</a>${ph.source === 'geosearch' ? ' · photo prise à proximité' : ''}</span>` : ''}
        </div>
      </div>
      <div class="dbody" id="dhead-body">
        ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
        <div class="actions">
          <button type="button" class="pill a ${w.a ? 'on' : ''}" data-who="a">${I('heart', { size: 15, fill: w.a })}${esc(state.users.a.name)}</button>
          <button type="button" class="pill b ${w.b ? 'on' : ''}" data-who="b">${I('heart', { size: 15, fill: w.b })}${esc(state.users.b.name)}</button>
          <span class="spacer"></span>
          <a class="pill primary" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving" target="_blank" rel="noopener">${I('navigation', { size: 16 })}Itinéraire</a>
        </div>
        <div class="links">
          <a href="geo:${lat},${lon}?q=${lat},${lon}(${encodeURIComponent(p.name)})">${I('pin', { size: 14 })}GPS</a>
          ${wiki ? `<a href="${wiki}" target="_blank" rel="noopener">${I('book', { size: 14 })}Wikipédia</a>` : ''}
          <a href="${commons}" target="_blank" rel="noopener">${I('camera', { size: 14 })}Photos</a>
          <a href="${esc(p.osm)}" target="_blank" rel="noopener">${I('map', { size: 14 })}OSM</a>
          ${p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noopener">${I('link', { size: 14 })}Site</a>` : ''}
        </div>
      </div>`;
    $('#btn-close').onclick = closeDetail;
    $('#btn-share-spot').onclick = share;
    $('#detail-head').querySelectorAll('.pill[data-who]').forEach((h) => h.onclick = () => toggleWish(p.id, h.dataset.who));
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
        <div><b>Température</b><span>${I('thermo', { size: 15 })}${n0(d.tmax, '°')} / ${n0(d.tmin, '°')} · ressenti ${n0(d.tapp, '°')}</span></div>
        <div><b>Rafales</b><span class="mu">${I('wind', { size: 15 })}${n0(d.gust, ' km/h')}</span></div>
        <div><b>Swell</b><span class="sea">${I('wave', { size: 15 })}${n1(d.swell, ' m')} · ${n0(d.swellPeriod, ' s')}</span></div>
        <div><b>Soleil</b><span>${I('sunrise', { size: 15, cls: 'sun' })}${d.sun != null ? (d.sun / 3600).toFixed(1) + ' h' : '—'}</span></div>
      </div>`;
    body += renderTides(d, p, hourlyError);
    if (detailData) body += renderHourly(d.date);
    body += '</div>';
    $('#detail-body').innerHTML = body;
    $('#detail-body').querySelectorAll('.daycard').forEach((b) => b.onclick = () => renderDetailDay(+b.dataset.i));
    $('#detail-body').querySelector('.daycard.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    const hd = $('#detail-head .score'); if (hd) { hd.className = `score c-${r.cls}`; hd.innerHTML = `<b>${r.score ?? '—'}</b><small>${esc(r.label)}</small>`; }
  }
  function renderTides(d, p, hourlyError) {
    const sun = `${d.sunrise ? hmIso(d.sunrise) : '—'} → ${d.sunset ? hmIso(d.sunset) : '—'}`;
    let html = `<div class="sect"><div class="h"><h3>Marées</h3><span>${I('sunrise', { size: 13 })} ${sun}</span></div>`;
    if (!detailData) { return html + `<div class="loading" style="padding:8px">${hourlyError ? esc(hourlyError) : 'Chargement…'}</div></div>`; }
    const M = detailData.marine, date = d.date;
    const mIdx = M.time.map((t, k) => t.startsWith(date) ? k : -1).filter((k) => k >= 0);
    const tides = detailData.tides.filter((t) => t.time.toLocaleDateString('sv-SE', { timeZone: C.timezone }) === date);
    const sst = mIdx.map((k) => M.sea_surface_temperature?.[k]).filter((v) => v != null);
    if (M.sea_level_height_msl) html += spark(mIdx.map((k) => M.sea_level_height_msl[k]), tides, date);
    html += `<div class="cond" style="flex-wrap:wrap;font-size:12.5px">` + (tides.length
      ? tides.map((t) => `<span class="${t.type === 'PM' ? 'sea' : 'mu'}">${I(t.type === 'PM' ? 'up' : 'down', { size: 14 })}${t.type} ${hm(t.time)} · ${t.height >= 0 ? '+' : ''}${t.height.toFixed(1)} m</span>`).join('')
      : '<span class="mu">niveau de mer indisponible</span>') +
      (sst.length ? `<span>${I('thermo', { size: 14 })}eau ${n1(sst.reduce((a, b) => a + b, 0) / sst.length, ' °C')}</span>` : '') + '</div>';
    if (p.tidal === 'yes' && tides.some((t) => t.type === 'PM')) {
      const win = tides.filter((t) => t.type === 'PM').map((t) => { const a = new Date(t.time.getTime() - 90 * 60000), b = new Date(t.time.getTime() + 90 * 60000); return `${hm(a)}–${hm(b)}`; });
      html += `<div class="advice">${I('clock', { size: 16 })}<span><b>Ce spot dépend de la marée haute</b> : viser ${win.join(' ou ')}.</span></div>`;
    }
    return html + '</div>';
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
        <td>${mi >= 0 ? n1(M.wave_height[mi], ' m') + ' · ' + n0(M.wave_period[mi], ' s') : '—'}</td><td>${n1(H.uv_index?.[i])}</td></tr>`;
    }
    return html + '</tbody></table></div></div>';
  }
  function spark(vals, tides, date) {
    const v = vals.map((x) => x ?? 0); if (!v.length) return '';
    const min = Math.min(...v), max = Math.max(...v), W = 366, Hh = 64, pad = 4, top = 8;
    const x = (i) => pad + (i / (v.length - 1)) * (W - 2 * pad), y = (val) => Hh - 14 - ((val - min) / ((max - min) || 1)) * (Hh - 14 - top);
    const pts = v.map((val, i) => `${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(' ');
    const now = new Date(), isToday = now.toLocaleDateString('sv-SE', { timeZone: C.timezone }) === date;
    const hNow = now.getHours() + now.getMinutes() / 60;
    const labels = tides.map((t) => { const h = t.time.getHours() + t.time.getMinutes() / 60; return `<text x="${x(h).toFixed(1)}" y="${Hh - 2}" font-size="10" text-anchor="middle" fill="currentColor" opacity=".7">${hm(t.time)}</text>`; }).join('');
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
    let y0 = null; const h = $('#handle');
    h.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
    h.addEventListener('touchend', (e) => { const dy = e.changedTouches[0].clientY - y0; if (Math.abs(dy) < 18) move(cur() === 'full' ? -1 : 1); else move(dy < 0 ? 1 : -1); });
    h.addEventListener('click', () => move(cur() === 'full' ? -1 : 1));
    const panel = $('#panels');
    panel.addEventListener('touchstart', (e) => { y0 = panel.scrollTop === 0 ? e.touches[0].clientY : null; }, { passive: true });
    panel.addEventListener('touchend', (e) => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; if (dy > 70 && panel.scrollTop === 0) move(-1); y0 = null; });
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
      seg($('#f-province'), [['all', 'Toutes'], ['Asturias', 'Asturies'], ['Cantabria', 'Cantabrie']], draft.province, (v) => draft.province = v);
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
    $('#btn-settings').onclick = () => { $('#u-a').value = state.users.a.name; $('#u-b').value = state.users.b.name; sd.showModal(); };
    $('#u-save').onclick = () => {
      state.users.a.name = $('#u-a').value.trim() || DEFAULT_NAMES[0]; state.users.b.name = $('#u-b').value.trim() || DEFAULT_NAMES[1];
      save(); sd.close(); renderWho(); renderList(); if (state.selected) renderDetailHead();
    };
    $('#u-share').onclick = share;
    $('#u-export').onclick = exportSelection;
    $('#u-refresh').onclick = () => { sd.close(); loadForecast(true); };
    document.querySelectorAll('dialog .close').forEach((b) => b.onclick = () => b.closest('dialog').close());
    document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

    $('#q').oninput = (e) => { state.filters.q = e.target.value; renderList(); paintMarkers(); };
    $('#btn-share').onclick = share;
    $('#btn-locate').onclick = locate;
    $('#btn-filters').classList.toggle('on', filtersActive());
  }
  function exportSelection() {
    const feats = state.spots.filter((s) => { const w = wishOf(s.properties.id); return w.a || w.b; })
      .map((s) => { const w = wishOf(s.properties.id); return { ...s, properties: { ...s.properties, [state.users.a.name]: w.a, [state.users.b.name]: w.b } }; });
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

  /* ------------------------------------------------------------------ chargement */
  async function loadForecast(force) {
    $('#summary').innerHTML = '<span>Chargement des prévisions…</span>';
    try { state.bulk = await F.loadBulk(state.spots, { force }); scoreCache.clear(); }
    catch (e) { console.error(e); toast('Prévisions indisponibles : ' + e.message); }
    renderDays(); renderList(); paintMarkers();
    if (state.selected) renderDetailDay(detailDay);
  }
  async function init() {
    restore();
    const shared = applyShare();
    const ver = (document.querySelector('script[src*="app.js"]')?.src.match(/v=(\w+)/) || [])[1] || '';
    const [fc, photos] = await Promise.all([
      fetch('data/spots.geojson?v=' + ver).then((r) => r.json()),
      fetch('data/photos.json?v=' + ver).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    state.spots = fc.features; state.photos = photos || {};
    renderChrome(); initSheet(); initMap(); initDialogs(); renderWho(); renderProfiles(); renderDays(); renderList();
    $('#q').value = state.filters.q;
    await loadForecast(false);
    if (shared && state.selected) select(state.selected, { pan: true }); else state.selected = null;
  }
  document.addEventListener('DOMContentLoaded', init);
})();
