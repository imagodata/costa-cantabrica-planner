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

