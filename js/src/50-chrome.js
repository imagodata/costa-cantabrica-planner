  /* ------------------------------------------------------------------ en-tête, jours, profil */
  function renderChrome() {
    $('#btn-settings').classList.toggle('on', state.view === 'config');
    $('#brand-mark').innerHTML = I('wave', { size: 18 });
    $('#brand-name').textContent = state.region.short || state.region.name;
    $('#brand-sub').textContent = state.region.subtitle || 'plages & criques';
    renderFiltersBtn();
    $('#btn-settings').innerHTML = I('gear', { size: 20 });
    $('#btn-locate').innerHTML = I('locate', { size: 20 });
    $('#btn-target').innerHTML = I('frame', { size: 20 });
    $('#btn-share').innerHTML = I('share', { size: 20 });
    $('#search-ic').innerHTML = I('search', { size: 18 });
    $('.close', $('#dlg-pick')).innerHTML = I('x', { size: 18 });
  }
  function renderWho() {
    const me = state.me, other = me === 'a' ? 'b' : 'a', ini = (k) => esc(String(state.users[k].name || '?')[0].toUpperCase());
    $('#who').innerHTML = (state.serverUser ? `<button type="button" class="sync-btn" id="sync-btn" aria-label="État de la synchronisation"><span class="sync-dot" id="sync-dot"></span></button>` : '')
      + `<button type="button" class="me" data-k="${me}" title="Sur cet appareil, je suis ${esc(state.users[me].name)}" aria-label="Je suis ${esc(state.users[me].name)}"><span class="avatar ${me} on"><span>${ini(me)}</span></span><span class="n">${esc(state.users[me].name)}</span></button>`
      + `<button type="button" class="avatar ${other} other" data-k="${other}" title="${sync.on ? esc(state.users[other].name) : 'Passer à ' + esc(state.users[other].name)}" aria-label="${sync.on ? esc(state.users[other].name) : 'Passer à ' + esc(state.users[other].name)}"><span>${ini(other)}</span></button>`;
    if ($('#sync-btn')) { $('#sync-btn').onclick = () => { toast(syncStatusText()); if (sync.dirty && !sync.pushing) syncFlush(); else if (!sync.on) syncPoll(); }; renderSyncDot(); }
    $('#who').querySelectorAll('button[data-k]').forEach((b) => b.onclick = () => {
      if (sync.on) { toast(b.dataset.k === me ? `Connecté·e en tant que ${state.users[me].name}` : `${state.users[other].name} : envies et notes en lecture seule ici`); return; }
      if (b.dataset.k === me) { toast(`Envies et notes de ${state.users[me].name}`); return; }
      state.me = b.dataset.k; save(); renderWho(); if (state.selected) renderPlanCard(state.selected); renderList({ keep: true }); toast(`Sur cet appareil : ${state.users[state.me].name}`);
    });
  }
  function bestDot(i) {
    if (!state.bulk) return 'none';
    let best = -1;
    for (const s of filtered({ ignoreScore: true, inView: true })) { const sc = scoreOf(s, i).score; if (sc != null && sc > best) best = sc; }
    if (best < 0) return 'none';
    return C.scoreClasses.find((c) => best >= c.min).key;
  }
  function renderDays() {
    const el = $('#days'); el.innerHTML = '';
    const dates = state.bulk ? state.bulk.dates : Array.from({ length: C.forecastDays }, (_, i) => addDays(F.todayLocal(), i));
    dates.forEach((iso, i) => {
      const { lbl, sub } = fmtDay(iso, i), b = document.createElement('button');
      b.className = 'day' + (i === state.day ? ' on' : ''); b.type = 'button'; b.setAttribute('aria-pressed', String(i === state.day));
      b.innerHTML = `<b>${lbl}</b><small>${sub}</small><i style="background:var(--${bestDot(i)})"></i>`;
      b.onclick = () => { state.day = i; renderDays(); renderList(); paintMarkers(); if (state.selected) renderDetailDay(i); };
      el.appendChild(b);
    });
    const onDay = el.children[state.day];
    if (onDay) el.scrollLeft = onDay.offsetLeft - (el.clientWidth - onDay.clientWidth) / 2;
  }
  function renderProfiles() {
    $('#profile-seg').innerHTML = Object.entries(C.profiles).map(([k, p]) => `<button type="button" role="tab" data-k="${k}" class="${k === state.profile ? 'on' : ''}" title="${esc(p.label)}">${k === state.profile ? I(p.icon, { size: 15 }) : ''}${esc(p.short)}</button>`).join('');
    $('#profile-seg').querySelectorAll('button').forEach((b) => b.onclick = () => { state.profile = b.dataset.k; save(); renderProfiles(); renderDays(); renderList(); paintMarkers(); if (state.selected) renderDetailDay(detailDay); });
  }

