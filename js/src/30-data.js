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

