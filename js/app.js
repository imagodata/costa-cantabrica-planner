/* Application : carte, liste classée, fiche détail, filtres, deux voyageurs, partage. */
(function () {
  const C = CCP.CONFIG, F = CCP.forecast;
  const LS_STATE = 'ccp:state:v' + C.version;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = {
    spots: [], photos: {}, bulk: null, day: 0, profile: 'plage', selected: null, userPos: null,
    filters: { province: 'all', type: 'all', surface: 'all', minScore: 0, wish: 'all', q: '' },
    sort: 'score',
    users: { a: { name: 'Voyageur 1', wish: [] }, b: { name: 'Voyageur 2', wish: [] } },
    me: 'a',
  };
  const DEFAULT_NAMES = ['Voyageur 1', 'Voyageur 2'];
  const scoreCache = new Map(); // `${id}:${day}:${profile}` → score
  let map, markers = new Map(), userMarker = null, sheet, detailData = null, detailDay = 0;

  /* ------------------------------------------------------------------ utilitaires */
  const dayNames = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  function fmtDay(iso, i) {
    const d = new Date(iso + 'T12:00:00');
    const lbl = i === 0 ? "Auj." : i === 1 ? 'Dem.' : dayNames[d.getDay()];
    return { lbl, sub: d.getDate() + '/' + (d.getMonth() + 1) };
  }
  const hm = (d) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: C.timezone });
  const hmIso = (iso) => iso.slice(11, 16);
  const compass = (deg) => deg == null ? '' : ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(deg / 45) % 8];
  const arrow = (deg) => deg == null ? '' : `<span class="arrow" style="transform:rotate(${Math.round(deg)}deg)">↓</span>`;
  const wc = (code) => C.weatherCodes[code] || ['❔', 'Inconnu'];
  const n1 = (v, u = '') => v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1) + u;
  const n0 = (v, u = '') => v == null ? '—' : Math.round(v) + u;
  function distKm(a, b) {
    const R = 6371, p = Math.PI / 180;
    const x = (b[0] - a[0]) * p, y = (b[1] - a[1]) * p;
    const h = Math.sin(x / 2) ** 2 + Math.cos(a[0] * p) * Math.cos(b[0] * p) * Math.sin(y / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const latlng = (s) => [s.geometry.coordinates[1], s.geometry.coordinates[0]];
  const photoOf = (id) => state.photos[id] || null;
  /* Vignette Commons : largeur réduite en réécrivant « /800px- » (une URL sans /thumb/ est déjà l'original, petit). */
  const thumbAt = (ph, w) => ph.thumb.includes('/thumb/') ? ph.thumb.replace(/\/\d+px-/, `/${w}px-`) : ph.thumb;
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }

  function save() {
    try { localStorage.setItem(LS_STATE, JSON.stringify({ users: state.users, me: state.me, profile: state.profile, filters: state.filters, sort: state.sort })); } catch (e) { }
  }
  function restore() {
    try {
      const j = JSON.parse(localStorage.getItem(LS_STATE) || 'null');
      if (!j) return;
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
    const p = { na: state.users.a.name, nb: state.users.b.name, a: state.users.a.wish, b: state.users.b.wish,
      d: state.day, p: state.profile, s: state.selected };
    return location.origin + location.pathname + '#share=' + b64e(JSON.stringify(p));
  }
  function applyShare() {
    const m = location.hash.match(/#share=([A-Za-z0-9_-]+)/);
    if (!m) return false;
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
      save();
      toast('Sélection partagée importée ✔');
      return true;
    } catch (e) { return false; }
  }
  async function share() {
    const url = shareUrl();
    const title = 'Costa Cantábrica – nos envies de plages';
    try {
      if (navigator.share) { await navigator.share({ title, url }); return; }
    } catch (e) { if (e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast('Lien copié dans le presse-papiers'); }
    catch (e) { prompt('Copiez ce lien :', url); }
  }

  /* ------------------------------------------------------------------ données */
  function scoreOf(s) {
    const k = s.properties.id + ':' + state.day + ':' + state.profile;
    let r = scoreCache.get(k);
    if (!r) { r = F.score(F.dayOf(state.bulk, s, state.day), state.profile); scoreCache.set(k, r); }
    return r;
  }
  function wishOf(id) { return { a: state.users.a.wish.includes(id), b: state.users.b.wish.includes(id) }; }
  function toggleWish(id, who) {
    const list = state.users[who].wish;
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else list.push(id);
    save(); renderList(); paintMarkers();
    if (state.selected === id) renderDetailHead();
  }

  function filtered() {
    const f = state.filters, q = f.q.trim().toLowerCase();
    return state.spots.filter((s) => {
      const p = s.properties;
      if (f.province !== 'all' && p.province !== f.province) return false;
      if (f.type !== 'all' && p.type !== f.type) return false;
      if (f.surface !== 'all' && (f.surface === 'sand' ? p.surface !== 'sand' : p.surface === 'sand' || !p.surface)) return false;
      if (q && !(p.name.toLowerCase().includes(q) || (p.alt_name || '').toLowerCase().includes(q))) return false;
      const w = wishOf(p.id);
      if (f.wish === 'a' && !w.a) return false;
      if (f.wish === 'b' && !w.b) return false;
      if (f.wish === 'both' && !(w.a && w.b)) return false;
      if (f.wish === 'any' && !(w.a || w.b)) return false;
      if (state.bulk && f.minScore > 0) { const sc = scoreOf(s).score; if (sc == null || sc < f.minScore) return false; }
      return true;
    });
  }
  function sorted(list) {
    const by = state.sort;
    const arr = list.slice();
    if (by === 'name') arr.sort((a, b) => a.properties.name.localeCompare(b.properties.name, 'es'));
    else if (by === 'size') arr.sort((a, b) => b.properties.size_m - a.properties.size_m);
    else if (by === 'dist' && state.userPos) arr.sort((a, b) => distKm(state.userPos, latlng(a)) - distKm(state.userPos, latlng(b)));
    else if (state.bulk) arr.sort((a, b) => (scoreOf(b).score ?? -1) - (scoreOf(a).score ?? -1) || a.properties.name.localeCompare(b.properties.name, 'es'));
    return arr;
  }

  /* ------------------------------------------------------------------ carte */
  function initMap() {
    map = L.map('map', { zoomControl: true, attributionControl: true, tap: true }).setView(C.center, C.zoom);
    map.on('load', () => {});
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
      m.addTo(map);
      markers.set(s.properties.id, m);
    }
    fitAll();
  }
  /* Cadre tous les spots, en laissant la place du panneau glissant sur mobile. */
  function fitAll() {
    if (!state.spots.length) return;
    const b = L.latLngBounds(state.spots.map(latlng));
    const mobile = window.innerWidth < 900;
    const bottom = mobile ? Math.round(window.innerHeight * 0.58) : 0;
    map.fitBounds(b, { paddingTopLeft: [16, 16], paddingBottomRight: [16, bottom + 16], animate: false });
  }
  function paintMarkers() {
    const vis = new Set(filtered().map((s) => s.properties.id));
    for (const s of state.spots) {
      const id = s.properties.id, m = markers.get(id);
      if (!vis.has(id)) { if (map.hasLayer(m)) map.removeLayer(m); continue; }
      if (!map.hasLayer(m)) m.addTo(map);
      const r = state.bulk ? scoreOf(s) : { cls: 'none' };
      const w = wishOf(id);
      const sel = state.selected === id;
      const color = getComputedStyle(document.documentElement).getPropertyValue('--' + r.cls).trim();
      m.setStyle({ fillColor: color, radius: sel ? 11 : (w.a || w.b ? 9 : 7),
        color: sel ? '#111' : w.a && w.b ? '#7b2cbf' : w.a ? '#e76f51' : w.b ? '#4361ee' : '#fff', weight: sel ? 3 : (w.a || w.b ? 3 : 2) });
      if (sel) m.bringToFront();
    }
  }
  function panTo(s) {
    const z = Math.max(map.getZoom(), 12);
    const isMobile = window.innerWidth < 900;
    const p = map.project(latlng(s), z);
    if (isMobile) p.y += (sheet.classList.contains('full') ? 0 : sheet.getBoundingClientRect().height / 2);
    map.setView(map.unproject(p, z), z, { animate: true });
  }

  /* ------------------------------------------------------------------ liste */
  function renderDays() {
    const el = $('#days'); el.innerHTML = '';
    const dates = state.bulk ? state.bulk.dates : Array.from({ length: C.forecastDays }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d.toISOString().slice(0, 10); });
    dates.forEach((iso, i) => {
      const { lbl, sub } = fmtDay(iso, i);
      const b = document.createElement('button');
      b.className = 'chip' + (i === state.day ? ' on' : '');
      b.innerHTML = `${lbl}<small>${sub}</small>`;
      b.onclick = () => { state.day = i; renderDays(); renderList(); paintMarkers(); if (state.selected) renderDetailDay(i); };
      el.appendChild(b);
    });
    el.children[state.day]?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
  function renderWho() {
    const el = $('#who');
    el.innerHTML = ['a', 'b'].map((k) => `<button class="chip who-${k} ${state.me === k ? 'on' : ''}" title="Je suis ${esc(state.users[k].name)}"><span class="ini">${esc(state.users[k].name[0].toUpperCase())}</span><span class="nm">${esc(state.users[k].name.slice(0, 12))}</span></button>`).join('');
    el.querySelectorAll('button').forEach((b, i) => { b.onclick = () => { state.me = i ? 'b' : 'a'; save(); renderWho(); toast(`Envies marquées pour ${state.users[state.me].name}`); }; });
    $('#btn-profile').textContent = C.profiles[state.profile].icon;
  }
  function renderList() {
    const ul = $('#list'); const list = sorted(filtered());
    const total = state.spots.length;
    const fetched = state.bulk ? new Date(state.bulk.fetchedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null;
    $('#summary').innerHTML = `<span>${list.length} / ${total} spots · ${C.profiles[state.profile].icon} ${esc(C.profiles[state.profile].label)}</span>` +
      (fetched ? `<span>prévisions ${fetched}</span>` : `<span class="warn">prévisions indisponibles</span>`);
    const frag = document.createDocumentFragment();
    for (const s of list) {
      const p = s.properties, r = state.bulk ? scoreOf(s) : null, d = state.bulk ? F.dayOf(state.bulk, s, state.day) : null;
      const w = wishOf(p.id);
      const li = document.createElement('li');
      li.className = 'item' + (state.selected === p.id ? ' sel' : '') + (photoOf(p.id) ? ' has-photo' : ''); li.dataset.id = p.id;
      const ph = photoOf(p.id);
      const meta = [p.province, p.surface ? C.surfaces[p.surface] || p.surface : null, p.size_m ? `~${p.size_m} m` : null,
        state.userPos ? `${distKm(state.userPos, latlng(s)).toFixed(0)} km` : null].filter(Boolean).join(' · ');
      const cond = d && d.tmax != null ? `${wc(d.code)[0]} ${n0(d.tmax, '°')} · ☔ ${n0(d.pprob, ' %')} · 💨 ${n0(d.wind)} ${compass(d.wdir)} · 🌊 ${n1(d.wave, ' m')}` : '';
      li.innerHTML = `
        <div class="score c-${r ? r.cls : 'none'}">${r && r.score != null ? r.score : '—'}<small>${r ? esc(r.label) : ''}</small></div>
        ${ph ? `<img class="thumb" src="${esc(thumbAt(ph, 160))}" alt="" loading="lazy" decoding="async">` : ''}
        <div class="body">
          <div class="name">${esc(p.name)} <span class="tag">${p.type}</span>${p.nudism === 'yes' ? '<span class="tag">naturiste</span>' : ''}${p.lifeguard === 'yes' ? '<span class="tag">surveillée</span>' : ''}</div>
          <div class="meta">${esc(meta)}</div>
          <div class="cond">${cond}</div>
        </div>
        <div class="hearts">
          <button class="heart a ${w.a ? 'on' : ''}" data-who="a" aria-label="Envie de ${esc(state.users.a.name)}">${w.a ? '❤' : '♡'}<b>${esc(state.users.a.name[0])}</b></button>
          <button class="heart b ${w.b ? 'on' : ''}" data-who="b" aria-label="Envie de ${esc(state.users.b.name)}">${w.b ? '❤' : '♡'}<b>${esc(state.users.b.name[0])}</b></button>
        </div>`;
      li.querySelectorAll('.heart').forEach((h) => h.onclick = (e) => { e.stopPropagation(); toggleWish(p.id, h.dataset.who); });
      li.onclick = () => select(p.id, { pan: true });
      frag.appendChild(li);
    }
    ul.innerHTML = ''; ul.appendChild(frag);
    if (!list.length) ul.innerHTML = '<li class="loading">Aucun spot ne correspond aux filtres.</li>';
  }

  /* ------------------------------------------------------------------ détail */
  function spotById(id) { return state.spots.find((s) => s.properties.id === id); }
  async function select(id, { pan = true } = {}) {
    const s = spotById(id); if (!s) return;
    state.selected = id; detailDay = state.day; detailData = null;
    paintMarkers();
    $('#panel-list').hidden = true; $('#panel-detail').hidden = false;
    if (window.innerWidth < 900 && sheet.classList.contains('peek')) setSheet('half');
    renderDetailHead();
    $('#detail-body').innerHTML = '<div class="loading">Chargement des prévisions horaires…</div>';
    if (pan) panTo(s);
    try { detailData = await F.loadDetail(s); renderDetailDay(detailDay); }
    catch (e) { $('#detail-body').innerHTML = `<div class="loading">Prévisions horaires indisponibles (${esc(e.message)}).</div>`; renderDetailDay(detailDay); }
  }
  function closeDetail() {
    state.selected = null; paintMarkers();
    $('#panel-detail').hidden = true; $('#panel-list').hidden = false;
    renderList();
    const el = $(`#list .item[data-id]`); if (el) el.scrollIntoView({ block: 'nearest' });
  }
  function renderDetailHead() {
    const s = spotById(state.selected), p = s.properties, w = wishOf(p.id);
    const [lat, lon] = latlng(s);
    const tags = [p.type, p.province, p.surface ? C.surfaces[p.surface] || p.surface : null, p.size_m ? `~${p.size_m} m` : null,
      p.nudism === 'yes' ? 'naturiste' : null, p.lifeguard === 'yes' ? 'surveillée' : null, p.dog === 'yes' ? 'chiens OK' : p.dog === 'no' ? 'chiens interdits' : null,
      p.tidal === 'yes' ? 'dépend de la marée' : null, p.access && p.access !== 'yes' ? `accès : ${p.access}` : null].filter(Boolean);
    const wiki = p.wikipedia ? `https://${p.wikipedia.split(':')[0]}.wikipedia.org/wiki/${encodeURIComponent(p.wikipedia.split(':').slice(1).join(':'))}` : null;
    const ph = photoOf(p.id);
    const commonsSearch = `https://commons.wikimedia.org/w/index.php?search=${encodeURIComponent(p.name)}&ns6=1`;
    const hero = ph ? `<figure class="hero"><a href="${esc(ph.page)}" target="_blank" rel="noopener"><img src="${esc(ph.thumb)}" alt="${esc(p.name)}" loading="lazy" decoding="async"></a>
        <figcaption>📷 ${esc(ph.credit)}${ph.license ? ' · ' + esc(ph.license) : ''} · Wikimedia Commons${ph.source === 'geosearch' ? ' · photo prise à proximité' : ''}</figcaption></figure>` : '';
    $('#detail-head').innerHTML = `
      <div class="head"><h2>${esc(p.name)}</h2><button class="iconbtn" id="btn-close" aria-label="Retour à la liste">✕</button></div>
      ${hero}
      <div class="sub">${esc(tags.join(' · '))}${p.alt_name ? ` · <i>${esc(p.alt_name)}</i>` : ''}</div>
      ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
      <div class="hearts-row">
        <button class="heart a ${w.a ? 'on' : ''}" data-who="a">${w.a ? '❤' : '♡'} ${esc(state.users.a.name)}</button>
        <button class="heart b ${w.b ? 'on' : ''}" data-who="b">${w.b ? '❤' : '♡'} ${esc(state.users.b.name)}</button>
      </div>
      <div class="links">
        <a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving" target="_blank" rel="noopener">🚗 Itinéraire</a>
        <a href="geo:${lat},${lon}?q=${lat},${lon}(${encodeURIComponent(p.name)})">📍 GPS</a>
        ${wiki ? `<a href="${wiki}" target="_blank" rel="noopener">📖 Wikipédia</a>` : ''}
        <a href="${esc(p.osm)}" target="_blank" rel="noopener">🗺️ OSM</a>
        <a href="${commonsSearch}" target="_blank" rel="noopener">📷 Photos</a>
        ${p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noopener">🔗 Site</a>` : ''}
      </div>`;
    $('#btn-close').onclick = closeDetail;
    $('#detail-head').querySelectorAll('.heart').forEach((h) => h.onclick = () => toggleWish(p.id, h.dataset.who));
  }
  function renderDetailDay(i) {
    detailDay = i;
    const s = spotById(state.selected); if (!s || !state.bulk) { $('#detail-body').innerHTML = '<div class="loading">Prévisions indisponibles.</div>'; return; }
    const cards = state.bulk.dates.map((iso, j) => {
      const d = F.dayOf(state.bulk, s, j), r = F.score(d, state.profile), { lbl, sub } = fmtDay(iso, j);
      return `<button class="daycard ${j === i ? 'on' : ''}" data-i="${j}"><div class="d">${lbl} ${sub}</div><div class="ic">${wc(d.code)[0]}</div>
        <div>${n0(d.tmax, '°')} / ${n0(d.tmin, '°')}</div><div>🌊 ${n1(d.wave, ' m')}</div><div class="sc c-${r.cls}">${r.score ?? '—'}</div></button>`;
    }).join('');
    const d = F.dayOf(state.bulk, s, i), r = F.score(d, state.profile);
    let body = `<div class="daycards">${cards}</div>
      <div class="reasons"><b>${esc(C.profiles[state.profile].label)} : ${r.score ?? '—'}/100 (${esc(r.label)})</b>${r.reasons.length ? ' · ' + esc(r.reasons.join(', ')) : ''}</div>
      <div class="kv">
        <div><b>Ciel</b>${wc(d.code)[0]} ${esc(wc(d.code)[1])}</div>
        <div><b>Température</b>${n0(d.tmax, '°')} max · ${n0(d.tmin, '°')} min · ressenti ${n0(d.tapp, '°')}</div>
        <div><b>Pluie</b>${n0(d.pprob, ' %')} · ${n1(d.psum, ' mm')}</div>
        <div><b>Vent</b>${n0(d.wind, ' km/h')} ${arrow(d.wdir)} ${compass(d.wdir)} · rafales ${n0(d.gust)}</div>
        <div><b>Houle</b>${n1(d.wave, ' m')} · ${n0(d.period, ' s')} ${arrow(d.wavedir)} ${compass(d.wavedir)}</div>
        <div><b>Swell / mer du vent</b>${n1(d.swell, ' m')} (${n0(d.swellPeriod, ' s')}) · ${n1(d.windWave, ' m')}</div>
        <div><b>UV max</b>${n1(d.uv)}</div>
        <div><b>Soleil</b>${d.sunrise ? hmIso(d.sunrise) : '—'} → ${d.sunset ? hmIso(d.sunset) : '—'} · ${d.sun != null ? (d.sun / 3600).toFixed(1) + ' h' : '—'}</div>
      </div>`;
    if (detailData) body += renderHourly(d.date);
    $('#detail-body').innerHTML = body;
    $('#detail-body').querySelectorAll('.daycard').forEach((b) => b.onclick = () => renderDetailDay(+b.dataset.i));
    $('#detail-body').querySelector('.daycard.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
  function renderHourly(date) {
    const H = detailData.hourly, M = detailData.marine;
    const idx = H.time.map((t, i) => t.startsWith(date) ? i : -1).filter((i) => i >= 0);
    const mIdx = M.time.map((t, i) => t.startsWith(date) ? i : -1).filter((i) => i >= 0);
    const tides = detailData.tides.filter((t) => t.time.toLocaleDateString('sv-SE', { timeZone: C.timezone }) === date);
    const sst = mIdx.map((i) => M.sea_surface_temperature?.[i]).filter((v) => v != null);
    const sstTxt = sst.length ? `🌡️ eau ${n1(sst.reduce((a, b) => a + b, 0) / sst.length, ' °C')}` : '';
    let html = `<h3>Marées ${sstTxt ? '· ' + sstTxt : ''}</h3><div class="tides">` +
      (tides.length ? tides.map((t) => `<span class="tide ${t.type}">${t.type === 'PM' ? '⬆ PM' : '⬇ BM'} ${hm(t.time)} · ${t.height >= 0 ? '+' : ''}${t.height.toFixed(1)} m</span>`).join('') : '<span class="tide">niveau de mer indisponible</span>') + '</div>';
    if (M.sea_level_height_msl) html += spark(mIdx.map((i) => M.sea_level_height_msl[i]));
    html += `<h3>Heure par heure</h3><div style="overflow-x:auto"><table class="hours"><thead><tr><th>h</th><th></th><th>T°</th><th>☔</th><th>Vent</th><th>Houle</th><th>UV</th></tr></thead><tbody>`;
    for (const i of idx) {
      const h = +H.time[i].slice(11, 13); if (h < 6 || h > 22) continue;
      const mi = mIdx.find((k) => M.time[k] === H.time[i]);
      const night = h < 8 || h > 20;
      html += `<tr class="${night ? 'night' : ''}"><td>${String(h).padStart(2, '0')}h</td><td>${wc(H.weather_code[i])[0]}</td><td>${n0(H.temperature_2m[i], '°')}</td>
        <td>${n0(H.precipitation_probability?.[i], ' %')}</td><td>${n0(H.wind_speed_10m[i])} ${arrow(H.wind_direction_10m[i])}</td>
        <td>${mi != null ? n1(M.wave_height[mi], ' m') + ' ' + n0(M.wave_period[mi], 's') : '—'}</td><td>${n1(H.uv_index?.[i])}</td></tr>`;
    }
    return html + '</tbody></table></div>';
  }
  function spark(vals) {
    const v = vals.map((x) => x ?? 0); if (!v.length) return '';
    const min = Math.min(...v), max = Math.max(...v), W = 300, Hh = 70, pad = 4;
    const x = (i) => pad + (i / (v.length - 1)) * (W - 2 * pad), y = (val) => Hh - pad - ((val - min) / ((max - min) || 1)) * (Hh - 2 * pad);
    const pts = v.map((val, i) => `${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(' ');
    const now = new Date(); const hNow = now.getHours() + now.getMinutes() / 60;
    const ticks = [0, 6, 12, 18].map((h) => `<text x="${x(h)}" y="${Hh - 1}" font-size="9" fill="currentColor" opacity=".6">${h}h</text>`).join('');
    return `<svg class="spark" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2"/>
      <line x1="${x(hNow)}" x2="${x(hNow)}" y1="0" y2="${Hh}" stroke="currentColor" opacity=".25" stroke-dasharray="3 3"/>${ticks}</svg>`;
  }

  /* ------------------------------------------------------------------ panneau glissant */
  function setSheet(mode) {
    sheet.classList.remove('peek', 'half', 'full'); sheet.classList.add(mode);
    document.documentElement.style.setProperty('--sheet-h', mode === 'peek' ? '30vh' : mode === 'half' ? '58vh' : '100vh');
  }
  function initSheet() {
    sheet = $('#sheet'); setSheet('half');
    const order = ['peek', 'half', 'full'];
    const cur = () => order.find((m) => sheet.classList.contains(m));
    const move = (dir) => { const i = order.indexOf(cur()); setSheet(order[Math.max(0, Math.min(2, i + dir))]); };
    let y0 = null;
    const h = $('#handle');
    h.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
    h.addEventListener('touchend', (e) => { const dy = e.changedTouches[0].clientY - y0; if (Math.abs(dy) < 18) move(cur() === 'full' ? -1 : 1); else move(dy < 0 ? 1 : -1); });
    h.addEventListener('click', () => move(cur() === 'full' ? -1 : 1));
    // Glisser vers le bas depuis le haut de la liste ferme un peu le panneau
    const panel = $('#panels');
    panel.addEventListener('touchstart', (e) => { y0 = panel.scrollTop === 0 ? e.touches[0].clientY : null; }, { passive: true });
    panel.addEventListener('touchend', (e) => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; if (dy > 70 && panel.scrollTop === 0) move(-1); y0 = null; });
  }

  /* ------------------------------------------------------------------ dialogues */
  function initDialogs() {
    const dlg = $('#dlg-filters'), f = state.filters;
    $('#btn-filters').onclick = () => {
      $('#f-province').value = f.province; $('#f-type').value = f.type; $('#f-surface').value = f.surface; $('#f-wish').value = f.wish;
      $('#f-min').value = f.minScore; $('#f-min-out').textContent = f.minScore; $('#f-sort').value = state.sort;
      $('#f-wish').querySelector('[value=a]').textContent = `envies de ${state.users.a.name}`;
      $('#f-wish').querySelector('[value=b]').textContent = `envies de ${state.users.b.name}`;
      dlg.showModal();
    };
    $('#f-min').oninput = (e) => { $('#f-min-out').textContent = e.target.value; };
    $('#f-apply').onclick = () => {
      Object.assign(f, { province: $('#f-province').value, type: $('#f-type').value, surface: $('#f-surface').value, wish: $('#f-wish').value, minScore: +$('#f-min').value });
      state.sort = $('#f-sort').value; save(); dlg.close(); renderList(); paintMarkers();
      $('#btn-filters').classList.toggle('on', f.province !== 'all' || f.type !== 'all' || f.surface !== 'all' || f.wish !== 'all' || f.minScore > 0);
    };
    $('#f-reset').onclick = () => { Object.assign(f, { province: 'all', type: 'all', surface: 'all', minScore: 0, wish: 'all', q: '' }); $('#q').value = ''; state.sort = 'score'; save(); dlg.close(); renderList(); paintMarkers(); $('#btn-filters').classList.remove('on'); };

    const pd = $('#dlg-profile');
    $('#btn-profile').onclick = () => {
      $('#profiles').innerHTML = Object.entries(C.profiles).map(([k, p]) => `<button data-k="${k}" class="${k === state.profile ? 'on' : ''}">${p.icon} ${esc(p.label)}</button>`).join('');
      $('#profiles').querySelectorAll('button').forEach((b) => b.onclick = () => { state.profile = b.dataset.k; save(); pd.close(); renderWho(); renderList(); paintMarkers(); if (state.selected) renderDetailDay(detailDay); });
      $('#u-a').value = state.users.a.name; $('#u-b').value = state.users.b.name;
      pd.showModal();
    };
    $('#u-save').onclick = () => {
      state.users.a.name = $('#u-a').value.trim() || DEFAULT_NAMES[0]; state.users.b.name = $('#u-b').value.trim() || DEFAULT_NAMES[1];
      save(); pd.close(); renderWho(); renderList(); if (state.selected) renderDetailHead();
    };
    $('#u-share').onclick = share;
    $('#u-export').onclick = exportSelection;
    $('#u-refresh').onclick = () => { pd.close(); loadForecast(true); };
    document.querySelectorAll('dialog .close').forEach((b) => b.onclick = () => b.closest('dialog').close());
    document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

    $('#q').oninput = (e) => { f.q = e.target.value; renderList(); paintMarkers(); };
    $('#btn-share').onclick = share;
    $('#btn-locate').onclick = locate;
    $('#btn-list').onclick = () => { if (state.selected) closeDetail(); setSheet(sheet.classList.contains('full') ? 'half' : 'full'); };
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
    try {
      state.bulk = await F.loadBulk(state.spots, { force });
      scoreCache.clear();
      renderDays(); renderList(); paintMarkers();
      if (state.selected) renderDetailDay(detailDay);
    } catch (e) {
      console.error(e); toast('Prévisions indisponibles : ' + e.message);
      renderDays(); renderList(); paintMarkers();
    }
  }
  async function init() {
    restore();
    const shared = applyShare();
    const [fc, photos] = await Promise.all([
      fetch('data/spots.geojson').then((r) => r.json()),
      fetch('data/photos.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    state.spots = fc.features; state.photos = photos || {};
    initSheet(); initMap(); initDialogs(); renderWho(); renderDays(); renderList();
    $('#q').value = state.filters.q;
    await loadForecast(false);
    if (shared && state.selected) select(state.selected, { pan: true }); else state.selected = null;
  }
  document.addEventListener('DOMContentLoaded', init);
})();
