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

