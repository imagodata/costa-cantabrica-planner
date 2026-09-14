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
