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

