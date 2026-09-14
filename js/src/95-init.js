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
