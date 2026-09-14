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

