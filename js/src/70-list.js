  /* ------------------------------------------------------------------ liste */
  const LIST_CHUNK = 60;
  let listShown = LIST_CHUNK, listObserver = null, listKey = '';
  function renderList({ more = false, keep = false } = {}) {
    if (!more && !keep) listShown = LIST_CHUNK;
    const ul = $('#list'), list = sorted(filtered({ inView: true })), inView = !state.filters.q.trim() && !!mapBounds();
    let ideal = 0, good = 0;
    if (state.bulk) for (const s of list) { const c = scoreOf(s).cls; if (c === 'ideal') ideal++; else if (c === 'good') good++; }
    const fetched = state.bulk ? new Date(state.bulk.fetchedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null;
    $('#summary').innerHTML = (state.bulk ? `<span><b>${ideal} idéale${ideal > 1 ? 's' : ''}</b> · ${good} bonne${good > 1 ? 's' : ''} · ${list.length} plage${list.length > 1 ? 's' : ''}${inView ? ' dans la vue' : ''}</span>` : `<span>${list.length} plage${list.length > 1 ? 's' : ''}${inView ? ' dans la vue' : ''}</span>`) +
      `<span class="right"><button type="button" class="chip-mini ${state.mapFilter ? 'on' : ''}" id="sum-view" title="${state.mapFilter ? 'La liste suit la carte : touchez pour afficher toute la côte' : 'Caler la liste sur la carte'}" aria-pressed="${state.mapFilter}">${I('frame', { size: 13 })}Vue carte</button>` +
      (fetched ? `<button type="button" class="linkbtn" id="sum-refresh" title="Rafraîchir les prévisions (Open-Meteo)" style="min-height:28px;color:inherit;font-weight:500">${I('refresh', { size: 12 })}${fetched}</button>` : `<span class="warn">prévisions indisponibles</span>`) + '</span>';
    $('#sum-refresh') && ($('#sum-refresh').onclick = () => loadForecast(true));
    $('#sum-view').onclick = () => { state.mapFilter = !state.mapFilter; persistLocal(); renderDays(); renderList(); toast(state.mapFilter ? 'Liste calée sur la carte' : 'Toute la côte'); };
    // même contenu que le rendu précédent (déplacement de carte sans changement d'emprise utile, sondage sans nouveauté) : le DOM et ses vignettes restent
    const key = [list.slice(0, listShown).map((s) => s.properties.id).join(','), state.day, state.profile, state.selected, state.me, state.users.a.wish.join(','), state.users.b.wish.join(','), [...state.fresh].join(','), state.bulk && state.bulk.fetchedAt, state.userPos && state.userPos.join(','), !!state.serverUser, list.length > listShown].join('|');
    if (key === listKey && ul.querySelector('.item')) return;
    listKey = key;
    const frag = document.createDocumentFragment();
    for (const s of list.slice(0, listShown)) {
      const p = s.properties, r = state.bulk ? scoreOf(s) : null, d = state.bulk ? F.dayOf(state.bulk, s, state.day) : null, w = wishOf(p.id);
      const li = document.createElement('li');
      li.className = 'item' + (state.selected === p.id ? ' sel' : ''); li.dataset.id = p.id;
      const meta = [p.province, surfaceLbl(p), p.size_m ? `~${p.size_m.toLocaleString('fr-FR')} m` : null,
        state.userPos ? `${distKm(state.userPos, latlng(s)).toFixed(0)} km` : null].filter(Boolean).join(' · ');
      const cond = d && d.tmax != null ? `<span>${wIcon(d.code, 14)}${n0(d.tmax, '°')}</span><span class="mu">${I('drop', { size: 14 })}${n0(d.pprob, ' %')}</span><span class="mu">${I('wind', { size: 14 })}${n0(d.wind)} ${compass(d.wdir)}</span><span class="sea">${I('wave', { size: 14 })}${n1(d.wave, ' m')}</span>` : '';
      li.innerHTML = `
        <div class="score c-${r ? r.cls : 'none'}"><b>${r && r.score != null ? r.score : '—'}</b><small>${r ? esc(r.label) : ''}</small></div>
        ${aerialHtml(latlng(s)[0], latlng(s)[1], aerialZoom(s, 64, 13, 17, 0.85), 64, 64, 'thumb')}
        <div class="body">
          <div class="name"><span>${esc(p.name)}</span><span class="tag">${p.type}</span>${state.fresh.has(p.id) ? '<span class="tag new">nouveau</span>' : ''}${p.lifeguard === 'yes' ? '<span class="tag">surveillée</span>' : ''}${p.nudism === 'yes' ? '<span class="tag">naturiste</span>' : ''}</div>
          <div class="meta">${esc(meta)}</div>
          <div class="cond">${cond}</div>
        </div>
        <div class="hearts">
          <button type="button" class="heart a ${w.a ? 'on' : ''} ${canEdit('a') ? '' : 'ro'}" data-who="a" aria-label="Envie de ${esc(state.users.a.name)}">${I('heart', { size: 15, fill: w.a })}</button>
          <button type="button" class="heart b ${w.b ? 'on' : ''} ${canEdit('b') ? '' : 'ro'}" data-who="b" aria-label="Envie de ${esc(state.users.b.name)}">${I('heart', { size: 15, fill: w.b })}</button>
        </div>`;
      li.querySelectorAll('.heart').forEach((h) => h.onclick = (e) => { e.stopPropagation(); toggleWish(p.id, h.dataset.who); });
      li.onclick = () => select(p.id, { pan: true, full: true });
      frag.appendChild(li);
    }
    ul.innerHTML = ''; ul.appendChild(frag);
    if (!list.length) { ul.innerHTML = `<li class="empty-state"><span>Aucune plage ${inView ? 'dans cette partie de la carte' : `ne correspond${state.filters.q ? ` à « ${esc(state.filters.q)} »` : ' aux filtres'}`}.</span>${inView ? `<button type="button" class="btn ghost" id="list-all">Toute la côte</button>` : ''}${filtersActive() || state.filters.q ? `<button type="button" class="btn ghost" id="list-reset">Réinitialiser les filtres</button>` : ''}</li>`;
      $('#list-all') && ($('#list-all').onclick = () => { fitAll(); renderDays(); renderList(); });
      $('#list-reset') && ($('#list-reset').onclick = () => { Object.assign(state.filters, { province: 'all', type: 'all', surface: 'all', lifeguard: false, dog: false, minScore: 0, wish: 'all', q: '' }); $('#q').value = ''; save(); renderFiltersBtn(); renderDays(); renderList(); paintMarkers(); }); }
    if (list.length > listShown) {
      const li = document.createElement('li'); li.innerHTML = `<button type="button" class="more">Afficher ${Math.min(LIST_CHUNK, list.length - listShown)} de plus (${list.length - listShown} restants)</button>`;
      li.querySelector('button').onclick = () => { listShown += LIST_CHUNK; renderList({ more: true }); };
      ul.appendChild(li);
      // chargement automatique quand le bouton entre dans la vue
      if (!listObserver) listObserver = new IntersectionObserver((es) => { es.forEach((e) => { if (e.isIntersecting) { listShown += LIST_CHUNK; renderList({ more: true }); } }); }, { root: $('#panels'), rootMargin: '200px' });
      listObserver.disconnect(); listObserver.observe(li);
    } else if (listObserver) listObserver.disconnect();
  }

