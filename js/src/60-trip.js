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
  /* Déroulé horaire estimé d'une journée : départ à l'heure choisie, trajets à 45 km/h sur la distance
     corrigée, durées par type d'étape ; le déjeuner attend 12 h 30 s'il arrive trop tôt. */
  const DUR = { playa: 150, cala: 90, restaurant: 75, beach_bar: 75, bar: 45, cafe: 30, culture: 60, tourism: 60, text: 45 };
  const hm = (min) => { const m = Math.max(0, Math.round(min)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
  const isMeal = (info) => info.kind === 'poi' && ['restaurant', 'beach_bar'].includes(info.poi.p.kind);
  function dayTimeline(day) {
    const start = (state.prefs.startHour || 10) * 60, base = state.trip.base ? { lat: state.trip.base.lat, lon: state.trip.base.lon } : null;
    let t = start, prev = base, meals = 0; const slots = [], warns = [];
    const unresolved = day.stops.some((st) => !stopInfo(st));   // lieux pas encore chargés : pas d'alerte hâtive
    day.stops.forEach((st) => {
      const info = stopInfo(st); if (!info) { slots.push(null); return; }
      let km = 0;
      if (info.lat != null && prev && prev.lat != null) { km = distKm([prev.lat, prev.lon], [info.lat, info.lon]) * 1.3; t += km / 45 * 60; }
      let late = false;
      if (isMeal(info) && meals++ === 0) { if (t < 12 * 60 + 30) t = 12 * 60 + 30; if (t > 14 * 60 + 30) { late = true; warns.push(`Déjeuner à ${hm(t)} chez ${info.name} : tard. Avancer l'étape ?`); } }
      const d = info.kind === 'spot' ? DUR[info.spot.properties.type] || DUR.playa : info.kind === 'poi' ? DUR[info.poi.p.kind] || 60 : DUR.text;
      slots.push({ start: t, end: t + d, late, km }); t += d;
      if (info.kind === 'spot' && info.spot.properties.tidal === 'yes') warns.push(`${info.name} dépend de la marée : vérifier l'heure de pleine mer dans sa fiche.`);
      if (info.lat != null) prev = info;
    });
    if (base && state.prefs.roundTrip && prev && prev.lat != null && prev !== base) t += distKm([prev.lat, prev.lon], [base.lat, base.lon]) * 1.3 / 45 * 60;
    if (slots.some(Boolean) && t > 19 * 60 + 30) warns.push(`Retour vers ${hm(t)} : journée chargée, retirer une étape ?`);
    if (state.prefs.lunch && day.stops.length && !meals && !unresolved) warns.push('Pas de déjeuner prévu : « Ajouter une étape » propose les restos possibles.');
    return { slots, end: t, start, warns: unresolved ? [] : warns };
  }
  function proposeTrip({ silent = false } = {}) {
    ensureTrip();
    const t = state.trip, n = t.days.length;
    let cands = wishedIds().map(spotById);
    if (!cands.length) cands = state.spots.slice();
    if (!state.bulk) { if (!silent) toast('Prévisions nécessaires pour proposer un planning'); return; }
    const base = t.base ? [t.base.lat, t.base.lon] : null;
    if (base && state.prefs.radiusKm) cands = cands.filter((s) => distKm(base, latlng(s)) <= state.prefs.radiusKm) .length ? cands.filter((s) => distKm(base, latlng(s)) <= state.prefs.radiusKm) : cands;
    const lockedIds = new Set(t.days.flatMap((d) => d.stops.filter((st) => st.lock && st.t === 's').map((st) => st.id)));
    cands = cands.filter((s) => !lockedIds.has(s.properties.id));
    const perDay = Math.max(1, Math.min(state.prefs.perDay || 2, Math.ceil((cands.length + lockedIds.size) / n)));
    // score jour × spot ; pénalité de distance à l'hébergement ; 2 à 3 plages par jour maximum ; les étapes verrouillées restent
    const scored = [];
    for (const s of cands) for (let i = 0; i < n; i++) {
      const fi = forecastIdx(dayIso(i)); if (fi < 0) continue;
      const sc = scoreOf(s, fi).score; if (sc == null) continue;
      const pen = base ? Math.min(20, distKm(base, latlng(s)) / 5) : 0;
      scored.push({ s, i, v: sc - pen });
    }
    scored.sort((a, b) => b.v - a.v);
    const used = new Set(), counts = t.days.map((d) => d.stops.filter((st) => st.lock && st.t === 's').length), picked = t.days.map(() => []);
    const wished = wishedIds().length > 0;
    for (const { s, i } of scored) {
      if (used.has(s.properties.id) || counts[i] >= perDay) continue;
      if (!wished && counts.reduce((a, b) => a + b, 0) >= n * 2) break;
      used.add(s.properties.id); counts[i]++;
      picked[i].push({ t: 's', id: s.properties.id });
    }
    t.days.forEach((d, i) => {
      const locked = d.stops.filter((st) => st.lock), lon = (st) => spotById(st.id)?.geometry.coordinates[0] ?? 0;
      const beachesAll = [...locked.filter((st) => st.t === 's'), ...picked[i]].sort((x, y) => lon(x) - lon(y));   // d'ouest en est, verrous compris
      d.stops = [...beachesAll.filter((st) => st.lock), ...locked.filter((st) => st.t !== 's')];
      beachesAll.filter((st) => !st.lock).forEach((st) => addStop(i, st));
      { const idx = d.stops.map((st, k) => (st.t === 's' ? k : -1)).filter((k) => k >= 0), sortedSpots = idx.map((k) => d.stops[k]).sort((x, y) => lon(x) - lon(y)); idx.forEach((k, j) => { d.stops[k] = sortedSpots[j]; }); }
      const firstBeach = d.stops.findIndex((x) => x.t === 's');
      if (state.prefs.lunch && firstBeach >= 0 && !d.stops.some((x) => x.t === 'p' && ['restaurant', 'beach_bar'].includes(poiById(x.id)?.p.kind))) {
        const c = latlng(spotById(d.stops[firstBeach].id));   // resto retenu dans un programme du jour, sinon le plus proche de la première plage
        const r = state.pois.filter((x) => ['restaurant', 'beach_bar'].includes(x.p.kind)).map((x) => ({ x, dd: distKm(c, [x.lat, x.lon]) })).filter((o) => o.dd < 1.5).sort((a, b) => a.dd - b.dd)[0];
        if (r) { addStop(i, { t: 'p', id: r.x.id }); const k = d.stops.findIndex((x) => x.t === 'p' && x.id === r.x.id); if (k > firstBeach + 1) { const [m] = d.stops.splice(k, 1); d.stops.splice(firstBeach + 1, 0, m); } }
      }
    });
    save(); renderTabs(); if (state.view === 'trip') { renderTrip(); paintMarkers(); if (!silent) fitTrip(); }
    if (!silent) toast(!scored.length ? 'Aucune prévision pour ces dates : rapprochez le séjour des 7 prochains jours' : !cands.length && lockedIds.size ? 'Toutes vos envies sont déjà verrouillées : rien à ajouter' : wished ? 'Planning proposé à partir de vos envies' : 'Planning proposé avec les meilleures plages');
  }
  /* Séjour dynamique : à chaque mise à jour des prévisions, le planning est recalculé (mode auto). */
  function autoReplan() {
    if (!state.trip.auto || !state.bulk) return;
    if (sync.on && state.trip.autoBy && state.trip.autoBy !== state.me) return;   // l'appareil qui a activé le mode dynamique recalcule, pas les deux
    ensurePois().then(() => { proposeTrip({ silent: true }); });
  }
  function manualEdit() { if (state.trip.auto) { state.trip.auto = false; state.trip.autoBy = null; save(); toast('Planning figé : modifications manuelles conservées'); } }
  function renderTrip() {
    ensureTrip();
    const t = state.trip, el = $('#trip');
    const baseHtml = t.base
      ? `<div class="base-name"><span class="home">${I('home', { size: 16 })}</span><span>${esc(t.base.name)}</span><button type="button" class="linkbtn" id="base-zoom" style="margin-left:auto" title="Voir sur la carte">${I('frame', { size: 14 })}</button><button type="button" class="linkbtn" id="base-clear">Changer</button></div>`
      : `<span class="hint">Définissez votre hébergement : chaque journée part de là et y revient.</span>
         <div class="base-search"><input type="search" id="base-q" placeholder="Rechercher un lieu, un village, une plage…" autocomplete="off"><button type="button" class="iconbtn" id="base-geo" title="Ma position" aria-label="Ma position">${I('locate', { size: 18 })}</button><button type="button" class="iconbtn ${state.pickBase ? 'on' : ''}" id="base-map" title="Choisir sur la carte" aria-label="Choisir sur la carte">${I('pin', { size: 18 })}</button></div>
         <div class="sugg" id="base-sugg" hidden></div>`;
    const daysHtml = t.days.map((d, i) => {
      const fi = forecastIdx(dayIso(i)), route = dayRoute(d), tl = dayTimeline(d);
      const stops = d.stops.map((st, k) => {
        const info = stopInfo(st); if (!info) return '';
        const slot = tl.slots[k], tm = slot ? `<em class="tm ${slot.late ? 'late' : ''}">${hm(slot.start)}</em>` : '';
        const leg = slot && slot.km ? `${slot.km.toFixed(0)} km` : '';
        let sc = '';
        if (info.kind === 'spot' && fi >= 0) { const r = scoreOf(info.spot, fi); sc = `<span class="sc"><i style="background:var(--${r.cls})"></i>${r.score ?? '—'}</span>`; }
        const badge = info.kind === 'spot' ? `<span class="n">${k + 1}</span>` : info.kind === 'poi' ? `<span class="n poi" style="background:${info.color}">${I(info.icon, { size: 12 })}</span>` : `<span class="n poi">${I('compass', { size: 12 })}</span>`;
        return `<li data-k="${k}">${badge}<span class="t">${st.lock ? `<span class="lk" title="Étape conservée par le planificateur">${I('lock', { size: 12 })}</span>` : ''}${esc(info.name)}${info.kind === 'spot' && info.spot.properties.tidal === 'yes' ? `<span class="tide" title="Dépend de la marée">${I('clock', { size: 12 })}</span>` : ''} <small>· ${esc(info.sub)}</small></span><span class="d">${tm}<span>${sc} ${leg}</span></span>
          <span class="grip" title="Glisser pour réordonner" aria-hidden="true">${I('grip', { size: 16 })}</span><button type="button" class="ib menu-btn" data-k="${k}" aria-label="Actions">${I('sliders', { size: 16 })}</button></li>`;
      }).join('');
      let wx = '';
      if (fi >= 0 && d.stops.some((st) => st.t === 's')) { const s0 = spotById(d.stops.find((st) => st.t === 's').id); const dd = F.dayOf(state.bulk, s0, fi); wx = `${wIcon(dd.code, 16)} ${n0(dd.tmax, '°')}`; }
      return `<div class="card day-card" style="--dc:${dayColor(i)}" data-i="${i}">
        <div class="h"><div><b>Jour ${i + 1}</b> <small>· ${dayLabel(i)}</small></div><span style="display:flex;align-items:center;gap:6px">${wx}</span></div>
        ${stops ? `<ul class="stops">${stops}</ul>` : '<span class="hint">Aucune étape. Ajoutez une plage : son programme (resto, visite…) suit automatiquement.</span>'}
        ${tl.warns.map((w) => `<div class="day-warn">${I('info', { size: 14 })}<span>${esc(w)}</span></div>`).join('')}
        <div class="day-foot">
          <button type="button" class="linkbtn add-stop" data-i="${i}">${I('plus', { size: 14 })} Ajouter une étape</button>
          ${d.stops.length ? `<button type="button" class="linkbtn zoom-day" data-i="${i}" title="Voir la journée sur la carte">${I('frame', { size: 14 })} Carte</button><button type="button" class="linkbtn itin-day" data-i="${i}" title="Suivre cette journée en 3D">${I('route', { size: 14 })} 3D</button>` : ''}
          ${route.url ? `${tl.slots.some(Boolean) ? `<span class="tl">${I('clock', { size: 14 })} ${hm(tl.start)} → ${hm(tl.end)}</span>` : ''}<span>${I('car', { size: 14 })} ~${Math.round(route.km)} km${t.base && state.prefs.roundTrip ? ' A/R' : ''}</span><a href="${route.url}" target="_blank" rel="noopener">${I('route', { size: 14 })}Google Maps</a>` : ''}
        </div></div>`;
    }).join('');
    el.innerHTML = `
      <div class="card"><div class="h"><h3>${I('home', { size: 13 })} Hébergement</h3></div>${baseHtml}</div>
      <div class="card"><div class="h"><h3>${I('calendar', { size: 13 })} ${t.days.length} jour${t.days.length > 1 ? 's' : ''} · du ${dayLabel(0)} au ${dayLabel(t.days.length - 1)}</h3>
        <div class="stepper"><button type="button" id="days-minus" aria-label="Un jour de moins">${I('minus', { size: 16 })}</button><button type="button" id="days-plus" aria-label="Un jour de plus">${I('plus', { size: 16 })}</button></div></div>
        <div class="row" style="align-items:center;gap:8px;flex-wrap:wrap">
          <button type="button" class="auto-chip ${t.auto ? 'on' : ''}" id="trip-auto" title="Recalculer le planning à chaque mise à jour des prévisions">${I('refresh', { size: 13 })}${t.auto ? 'Dynamique' : 'Manuel'}</button>
          <button type="button" class="auto-chip" id="trip-config">${I('sliders', { size: 13 })}Réglages</button>
          <span class="hint" style="flex-basis:100%">${t.auto ? 'Le planning suit les prévisions : il est recalculé à chaque rafraîchissement, sauf si vous modifiez une étape. Les étapes verrouillées (menu d\'une étape) sont toujours conservées.' : 'Vos étapes sont conservées telles quelles. Horaires estimés : départ ' + (state.prefs.startHour || 10) + ' h, trajets à 45 km/h, environ 2 h 30 par plage, 1 h 15 au resto.'}</span>
        </div>
        <button type="button" class="btn ghost" id="trip-propose" style="display:flex;align-items:center;justify-content:center;gap:8px">${I('wand', { size: 16 })}Proposer un planning selon la météo</button>
        ${t.days.some((d) => d.stops.length) ? `<button type="button" class="btn ghost" id="trip-itin" style="display:flex;align-items:center;justify-content:center;gap:8px">${I('route', { size: 16 })}Suivre l'itinéraire en 3D, jour par jour</button>` : ''}</div>
      ${daysHtml}
      <div class="row"><button type="button" class="btn ghost" id="trip-share" style="flex:1">Partager le séjour</button><button type="button" class="btn ghost" id="trip-clear" style="flex:1">Tout effacer</button></div>`;
    // hébergement
    $('#base-clear') && ($('#base-clear').onclick = () => { t.base = null; save(); renderTrip(); paintMarkers(); });
    $('#base-zoom') && ($('#base-zoom').onclick = () => zoomTo({ base: t.base }));
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
      $('#base-map').onclick = () => { state.pickBase = !state.pickBase; renderTrip(); toast(state.pickBase ? 'Touchez la carte pour placer l\'hébergement' : 'Sélection annulée'); if (state.pickBase && isMobile()) setSheet('peek'); };
    }
    // jours
    $('#days-minus').onclick = () => { if (t.days.length > 1) { t.days.pop(); save(); renderTabs(); renderTrip(); paintMarkers(); } };
    $('#days-plus').onclick = () => { if (t.days.length < 14) { t.days.push({ stops: [] }); save(); renderTrip(); } };
    $('#trip-propose').onclick = async () => { if (!t.days.some((d) => d.stops.length) || await confirmDlg('Remplacer les étapes actuelles par une proposition ?', { ok: 'Remplacer', hint: 'Les étapes non verrouillées (plages, restos, visites) sont remplacées ; le planning reste manuel ensuite, sauf si vous activez « Dynamique ».' })) ensurePois().then(() => proposeTrip()); };
    $('#trip-auto').onclick = () => { t.auto = !t.auto; t.autoBy = t.auto ? state.me : null; save(); renderTrip(); if (t.auto) { toast('Planning dynamique : recalculé à chaque mise à jour des prévisions'); ensurePois().then(() => proposeTrip({ silent: true })); } };
    $('#trip-config').onclick = () => setView('config');
    $('#trip-share').onclick = share;
    $('#trip-clear').onclick = async () => { if (await confirmDlg('Effacer hébergement et étapes ?', { ok: 'Tout effacer', danger: true })) { state.trip = { base: null, start: null, days: [], auto: false }; save(); renderTabs(); renderTrip(); paintMarkers(); } };
    el.querySelectorAll('.add-stop').forEach((b) => b.onclick = () => pickStop(+b.dataset.i));
    el.querySelectorAll('.zoom-day').forEach((b) => b.onclick = () => zoomTo({ day: t.days[+b.dataset.i] }));
    el.querySelectorAll('.itin-day').forEach((b) => b.onclick = () => itinStart(+b.dataset.i));
    $('#trip-itin') && ($('#trip-itin').onclick = () => itinStart(t.days.findIndex((d) => d.stops.length)));
    el.querySelectorAll('.day-card').forEach((card) => {
      const i = +card.dataset.i, d = t.days[i];
      card.querySelectorAll('.menu-btn').forEach((b) => b.onclick = (e) => { e.stopPropagation(); stepMenu(i, +b.dataset.k); });
      card.querySelectorAll('.stops li').forEach((li) => li.onclick = () => {
        const st = d.stops[+li.dataset.k]; if (!st) return;
        if (st.t === 's') select(st.id, { pan: true, full: true }); else if (st.t === 'p' && poiById(st.id)) showPoi(poiById(st.id)); else stepMenu(i, +li.dataset.k);
      });
      const ul = card.querySelector('.stops'); if (ul) bindStopDrag(ul, i);
    });
  }
  /* Réordonner les étapes au doigt : la poignée (touch-action: none) démarre le glissement sans appui long. */
  function bindStopDrag(ul, di) {
    let drag = null;
    const unbind = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', end); };
    const move = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        for (const other of [...ul.children]) {
          if (other === drag.li) continue;
          const r = other.getBoundingClientRect(), mid = r.top + r.height / 2, after = !!(other.compareDocumentPosition(drag.li) & Node.DOCUMENT_POSITION_FOLLOWING);
          if (after && e.clientY < mid) { ul.insertBefore(drag.li, other); buzz(4); break; }
          if (!after && e.clientY > mid) { ul.insertBefore(drag.li, other.nextSibling); buzz(4); break; }
        }
      };
    const end = (e) => {
        if (!drag) { unbind(); return; }
        if (e.pointerId !== drag.id) return;
        unbind();
        drag.li.classList.remove('dragging');
        const order = [...ul.children].map((li) => +li.dataset.k), d = state.trip.days[di]; drag = null;
        const complete = order.length === d.stops.length && new Set(order).size === order.length && order.every((k) => k >= 0 && k < d.stops.length);
        if (!complete || order.every((k, i) => k === i)) { if (!complete) renderTrip(); return; }   // étapes non rendues (lieux pas encore chargés) : on ne réordonne pas à l'aveugle
        d.stops = order.map((k) => d.stops[k]); manualEdit(); save(); renderTabs(); renderTrip(); paintMarkers();
    };
    ul.querySelectorAll('.grip').forEach((g) => {
      g.addEventListener('click', (e) => e.stopPropagation());
      g.addEventListener('pointerdown', (e) => {
        const li = g.closest('li'); if (!li || drag) return;
        e.preventDefault(); e.stopPropagation(); g.setPointerCapture?.(e.pointerId);
        drag = { li, from: +li.dataset.k, id: e.pointerId }; li.classList.add('dragging'); buzz(8);
        document.addEventListener('pointermove', move); document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);   // suivi même sans capture de pointeur
      });
    });
  }
  function pickStop(di) {
    const dlg = $('#dlg-pick'); if (dlg.open) dlg.close();
    const day = state.trip.days[di], fi = forecastIdx(dayIso(di));
    const inDay = new Set(day.stops.map((st) => st.t + ':' + (st.id || st.text)));
    $('#pick-title').textContent = `Ajouter au jour ${di + 1} · ${dayLabel(di)}`;
    const scoreTag = (s) => { if (fi < 0 || !state.bulk) return ''; const r = scoreOf(s, fi); return `<span class="sub" style="color:var(--${r.cls});font-weight:700">${r.score ?? '—'}</span>`; };
    const wish = wishedIds().map(spotById).filter((s) => !inDay.has('s:' + s.properties.id));
    const best = state.bulk && fi >= 0 ? state.spots.filter((s) => !inDay.has('s:' + s.properties.id) && !wish.includes(s)).sort((a, b) => (scoreOf(b, fi).score ?? -1) - (scoreOf(a, fi).score ?? -1)).slice(0, 8) : [];
    const beaches = day.stops.filter((st) => st.t === 's').map((st) => spotById(st.id)).filter(Boolean);
    const last = [...day.stops].reverse().map(stopInfo).find((x) => x && x.lat != null);
    const anchors = beaches.length ? beaches.map((s) => ({ name: s.properties.name, lat: latlng(s)[0], lon: latlng(s)[1] })) : (last ? [last] : []);
    const seen = new Set();
    // retenus : compléments des programmes des plages du jour (puis des autres programmes), pas encore dans la journée
    let kept = [];
    for (const s of [...beaches, ...wishedIds().map(spotById).filter((s) => s && !beaches.includes(s))]) for (const it of (state.plans[s.properties.id]?.items || [])) {
      const x = it.poi && poiById(it.poi), key = x ? 'p:' + x.id : 'x:' + it.text; if ((it.poi && !x) || inDay.has(key) || seen.has(key)) continue;
      seen.add(key); kept.push({ x, text: it.text, by: it.by, beach: s.properties.name, mine: beaches.includes(s) });
    }
    kept = [...kept.filter((o) => o.mine), ...kept.filter((o) => !o.mine)].slice(0, 10);   // les programmes des plages du jour d'abord
    // possibles : restos et bars de plage à moins de 1,5 km, visites à moins de 3 km des plages du jour
    const around = (kinds, km, n) => { const best = new Map(); for (const a of anchors) for (const x of state.pois) { if (!kinds.includes(x.p.kind) || inDay.has('p:' + x.id) || seen.has('p:' + x.id)) continue; const d = distKm([a.lat, a.lon], [x.lat, x.lon]); if (d <= km && (!best.has(x.id) || best.get(x.id).d > d)) best.set(x.id, { x, d, beach: a.name }); } const out = [...best.values()].sort((p, q) => p.d - q.d).slice(0, n); out.forEach((o) => seen.add('p:' + o.x.id)); return out; };
    const restos = around(['restaurant', 'beach_bar'], 1.5, 6), visits = around(['culture', 'tourism'], 3, 5);
    const row = (s) => `<button type="button" data-t="s" data-id="${esc(s.properties.id)}">${I('wave', { size: 14 })}<span>${esc(s.properties.name)}</span>${scoreTag(s)}</button>`;
    const prow = (o, sub) => { if (!o.x) return `<button type="button" data-t="x" data-text="${esc(o.text)}"><span class="poi-pin" style="background:var(--accent);width:22px;height:22px">${I('compass', { size: 12 })}</span><span>${esc(o.text)}</span><span class="sub by">${sub}</span></button>`; const k = C.poiKinds[o.x.p.kind] || C.poiKinds.tourism; return `<button type="button" data-t="p" data-id="${esc(o.x.id)}"><span class="poi-pin" style="background:${k.color};width:22px;height:22px">${I(k.icon, { size: 12 })}</span><span>${esc(o.x.p.name)}</span><span class="sub ${o.by ? 'by' : ''}">${sub}</span></button>`; };
    $('#pick-list').innerHTML = (kept.length ? `<h4>Retenus dans vos programmes</h4>${kept.map((o) => prow(o, `${esc(state.users[o.by === 'b' ? 'b' : 'a'].name)} · ${esc(o.beach)}`)).join('')}` : '') +
      (restos.length ? `<h4>Restos possibles ${anchors.length ? 'autour de ' + esc(anchors.map((a) => a.name).join(', ')) : ''}</h4>${restos.map((o) => prow(o, `${esc((C.poiKinds[o.x.p.kind] || C.poiKinds.tourism).label)} · ${Math.round(o.d * 1000)} m`)).join('')}` : '') +
      (visits.length ? `<h4>Visites possibles</h4>${visits.map((o) => prow(o, `${esc((C.poiKinds[o.x.p.kind] || C.poiKinds.tourism).label)} · ${o.d < 1 ? Math.round(o.d * 1000) + ' m' : o.d.toFixed(1) + ' km'}`)).join('')}` : '') +
      (wish.length ? `<h4>Vos envies</h4>${wish.map(row).join('')}` : '') +
      (best.length ? `<h4>Meilleures plages ce jour-là</h4>${best.map(row).join('')}` : '') +
      `<h4>Autre</h4><div class="plan-add"><input type="text" id="pick-text" maxlength="80" placeholder="Étape libre : marché, pause café…"><button type="button" id="pick-text-add" aria-label="Ajouter">${I('plus', { size: 18 })}</button></div>`;
    const done = () => { dlg.close(); save(); renderTabs(); renderTrip(); paintMarkers(); };
    $('#pick-list').querySelectorAll('button[data-t]').forEach((b) => b.onclick = () => { manualEdit(); addStop(di, b.dataset.t === 'x' ? { t: 'x', text: b.dataset.text } : { t: b.dataset.t, id: b.dataset.id }); done(); });
    $('#pick-text-add').onclick = () => { const v = $('#pick-text').value.trim(); if (v) { manualEdit(); addStop(di, { t: 'x', text: v }); done(); } };
    dlg.showModal();
  }
  /* Confirmation dans le dialogue de l'application (remplace confirm()). */
  function confirmDlg(title, { ok = 'Confirmer', danger = false, hint = '' } = {}) {
    return new Promise((resolve) => {
      const dlg = $('#dlg-pick'); if (dlg.open) dlg.close();
      $('#pick-title').textContent = title;
      $('#pick-list').innerHTML = `${hint ? `<span class="hint">${esc(hint)}</span>` : ''}<div class="menu"><button type="button" data-a="ok" class="${danger ? 'danger' : ''}">${I(danger ? 'trash' : 'check', { size: 16 })}${esc(ok)}</button><button type="button" data-a="no">${I('x', { size: 16 })}Annuler</button></div>`;
      let res = false;
      $('#pick-list').querySelectorAll('button').forEach((b) => b.onclick = () => { res = b.dataset.a === 'ok'; dlg.close(); });
      dlg.addEventListener('close', () => resolve(res), { once: true });
      dlg.showModal();
    });
  }
  function pickDayFor(stopOrId, label, after) {
    ensureTrip();
    const stop = typeof stopOrId === 'string' ? { t: 's', id: stopOrId } : stopOrId;
    const dlg = $('#dlg-pick'); if (dlg.open) dlg.close();
    $('#pick-title').textContent = `${label ? label + ' · ' : ''}Ajouter à quel jour ?`;
    $('#pick-list').innerHTML = `<div class="menu">` + state.trip.days.map((d, i) => { const fi = forecastIdx(dayIso(i)); const s = stop.t === 's' ? spotById(stop.id) : null; const r = s && fi >= 0 && state.bulk ? scoreOf(s, fi) : null;
      const has = d.stops.some((x) => x.t === stop.t && x.id === stop.id);
      return `<button type="button" data-i="${i}" ${has ? 'disabled style="opacity:.5"' : ''}><span class="n" style="width:26px;height:26px;border-radius:50%;background:${dayColor(i)};color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center">${i + 1}</span><span>Jour ${i + 1} · ${dayLabel(i)}</span><span class="sub">${has ? 'déjà' : d.stops.length + ' étape' + (d.stops.length > 1 ? 's' : '')}${r ? ` · <b style="color:var(--${r.cls})">${r.score ?? '—'}</b>` : ''}</span></button>`; }).join('') +
      `<button type="button" data-i="new"><span class="n" style="width:26px;height:26px;border-radius:50%;background:var(--line);display:grid;place-items:center">${I('plus', { size: 14 })}</span><span>Nouveau jour</span></button></div>`;
    $('#pick-list').querySelectorAll('button').forEach((b) => b.onclick = () => {
      if (b.dataset.i === 'new' && state.trip.days.length >= 14) { toast('14 jours au plus'); return; }
      const i = b.dataset.i === 'new' ? (state.trip.days.push({ stops: [] }), state.trip.days.length - 1) : +b.dataset.i;
      manualEdit(); const ok = addStop(i, stop); dlg.close(); renderTabs(); paintMarkers(); buzz();
      toast(ok ? `Ajouté au jour ${i + 1}` : 'Déjà dans ce jour');
      if (stop.t === 's' && state.selected === stop.id) renderDetailHead();
      if (state.view === 'trip') renderTrip();
      if (after) after();
    });
    dlg.showModal();
  }
  /* Menu d'actions d'une étape (mobile) : voir, monter, descendre, déplacer, retirer. */
  function stepMenu(di, k) {
    const t = state.trip, d = t.days[di], st = d.stops[k], info = stopInfo(st); if (!info) return;
    const dlg = $('#dlg-pick'); if (dlg.open) dlg.close();
    $('#pick-title').textContent = info.name;
    const others = t.days.map((_, i) => i).filter((i) => i !== di);
    $('#pick-list').innerHTML = `<div class="menu">
      ${info.kind !== 'text' ? `<button type="button" data-a="view">${I(info.kind === 'spot' ? 'wave' : 'pin', { size: 16 })}Voir ${info.kind === 'spot' ? 'la plage' : 'le lieu'}</button>` : ''}
      <button type="button" data-a="lock">${I('lock', { size: 16 })}${st.lock ? 'Libérer cette étape' : 'Garder cette étape'}<span class="sub">${st.lock ? 'le planificateur peut la remplacer' : 'conservée par le planificateur'}</span></button>
      <button type="button" data-a="up" ${k === 0 ? 'disabled style="opacity:.4"' : ''}>${I('up2', { size: 16 })}Monter</button>
      <button type="button" data-a="down" ${k === d.stops.length - 1 ? 'disabled style="opacity:.4"' : ''}>${I('down', { size: 16 })}Descendre</button>
      ${others.map((i) => `<button type="button" data-a="move" data-i="${i}"><span class="n" style="width:22px;height:22px;border-radius:50%;background:${dayColor(i)};color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center">${i + 1}</span>Déplacer vers le jour ${i + 1}<span class="sub">${dayLabel(i)}</span></button>`).join('')}
      <button type="button" data-a="rm" class="danger">${I('trash', { size: 16 })}Retirer de ce jour</button></div>`;
    $('#pick-list').querySelectorAll('button').forEach((b) => b.onclick = () => {
      const act = b.dataset.a; dlg.close();
      if (act === 'view') { if (st.t === 's') select(st.id, { pan: true, full: true }); else showPoi(poiById(st.id)); return; }
      if (act === 'lock') { if (st.lock) delete st.lock; else st.lock = true; save(); renderTrip(); buzz(); toast(st.lock ? 'Étape conservée par le planificateur' : 'Étape libérée'); return; }
      manualEdit();
      if (act === 'up') [d.stops[k - 1], d.stops[k]] = [d.stops[k], d.stops[k - 1]];
      else if (act === 'down') [d.stops[k + 1], d.stops[k]] = [d.stops[k], d.stops[k + 1]];
      else if (act === 'move') { const key = (x) => x.t + ':' + (x.id || x.text); if (t.days[+b.dataset.i].stops.some((x) => key(x) === key(st))) { toast('Déjà dans ce jour'); return; } d.stops.splice(k, 1); t.days[+b.dataset.i].stops.push(st); }
      else if (act === 'rm') d.stops.splice(k, 1);
      save(); renderTabs(); renderTrip(); paintMarkers(); buzz();
    });
    dlg.showModal();
  }
  function fitTrip() {
    viewBounds = null;
    const pts = [];
    if (state.trip.base) pts.push([state.trip.base.lat, state.trip.base.lon]);
    for (const d of state.trip.days) for (const st of d.stops) { const x = stopInfo(st); if (x && x.lat != null) pts.push([x.lat, x.lon]); }
    if (!pts.length) return;
    const mobile = isMobile(), bottom = mobile ? Math.round(window.innerHeight * 0.58) : 0;
    progMove(() => map.fitBounds(L.latLngBounds(pts).pad(0.15), { paddingTopLeft: [16, 60], paddingBottomRight: [16, bottom + 16], maxZoom: 12 }));
    if (is3d()) { const p = L.latLngBounds(pts).pad(0.15); progMove(() => gl.fitBounds([[p.getWest(), p.getSouth()], [p.getEast(), p.getNorth()]], { padding: glPadding(), maxZoom: 12, pitch: 50, duration: 700 })); }
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

