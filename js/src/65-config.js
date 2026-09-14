  /* ------------------------------------------------------------------ page de configuration */
  function renderConfig() {
    ensureTrip();
    const t = state.trip, pr = state.prefs, el = $('#config');
    const sw = (id, on, label, hint) => `<div class="switch"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span><button type="button" class="tg ${on ? 'on' : ''}" id="${id}" role="switch" aria-checked="${on}" aria-label="${label}"></button></div>`;
    const endIso = dayIso(t.days.length - 1);
    el.innerHTML = `
      <h2>Configuration</h2>
      <div class="card"><div class="h"><h3>${I('users', { size: 13 })} Voyageurs</h3></div>
        <div class="two"><label class="f"><span style="color:var(--a)">Voyageur 1</span><input type="text" id="c-a" maxlength="14" value="${esc(state.users.a.name)}"></label>
        <label class="f"><span style="color:var(--b)">Voyageur 2</span><input type="text" id="c-b" maxlength="14" value="${esc(state.users.b.name)}"></label></div>
        <label class="f">Sur cet appareil, je suis<div class="seg" id="c-me"></div></label>
        ${auth ? `<div class="acct"><span>${I('users', { size: 14 })} Compte <b>${esc(auth.user.name)}</b> <small>${esc(auth.user.email || '')}</small></span>
          <span>${I('calendar', { size: 14 })} Séjour <b>${esc((sync.ws || auth.ws).name || '')}</b> · ${((sync.ws || auth.ws).members || []).map((m) => `<i class="dot ${m.slot}" style="display:inline-block;width:10px;height:10px;vertical-align:-1px"></i> ${esc(m.name)}`).join(' · ') || 'vous seul pour l\'instant'}</span>
          <span>${I('copy', { size: 14 })} Code d'invitation <b id="c-invite">${esc((sync.ws || auth.ws).invite || '…')}</b> <button type="button" class="linkbtn" id="c-invite-copy">Copier</button></span>
          <span class="hint">L'autre voyageur crée un compte sur la page de connexion et saisit ce code : il rejoint ce séjour avec sa couleur.</span></div>
          <div class="btns"><a class="btn ghost" href="login.html" style="display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none">${I('calendar', { size: 14 })} Changer de séjour</a><button type="button" class="btn ghost" id="c-newcode">${I('refresh', { size: 14 })} Nouveau code</button><button type="button" class="btn ghost" id="c-pw">${I('lock', { size: 14 })} Mot de passe</button><button type="button" class="btn ghost" id="c-leave" style="color:var(--bad)">${I('trash', { size: 14 })} Quitter ce séjour</button><button type="button" class="btn ghost" id="c-logout">${I('x', { size: 14 })} Se déconnecter</button></div>`
        : state.serverUser && sync.ws && sync.ws.invite ? `<div class="acct"><span>${I('copy', { size: 14 })} Code d'invitation de ce séjour <b id="c-invite">${esc(sync.ws.invite)}</b> <button type="button" class="linkbtn" id="c-invite-copy">Copier</button></span><span class="hint">Avec un compte (page de connexion), ce code ouvre le même séjour depuis n'importe quel appareil, y compris la version publique.</span></div>
          <div class="btns"><a class="btn ghost" href="login.html" style="display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none">${I('users', { size: 14 })} Créer un compte / changer de séjour</a></div>`
        : `<div class="btns"><a class="btn ghost" href="login.html" style="display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none">${I('users', { size: 14 })} Se connecter / changer de voyageur</a></div>`}</div>
      <div class="card"><div class="h"><h3>${I('home', { size: 13 })} Résidence / hébergement</h3></div>
        ${t.base ? `<div class="base-name"><span class="home">${I('home', { size: 16 })}</span><span>${esc(t.base.name)}</span></div><span class="coords">${t.base.lat.toFixed(5)}, ${t.base.lon.toFixed(5)} · <a href="https://www.google.com/maps/search/?api=1&query=${t.base.lat},${t.base.lon}" target="_blank" rel="noopener">voir</a></span>` : '<span class="hint">Aucune résidence définie. Les journées partent et reviennent de ce point.</span>'}
        <div class="base-search"><input type="search" id="c-base-q" placeholder="Rechercher un village, un lieu, une plage…" autocomplete="off"></div>
        <div class="sugg" id="c-base-sugg" hidden></div>
        <div class="btns"><button type="button" class="btn ghost" id="c-base-geo">${I('locate', { size: 14 })} Ma position GPS</button><button type="button" class="btn ghost ${state.pickBase ? 'primary' : ''}" id="c-base-map">${I('pin', { size: 14 })} Point sur la carte</button>${t.base ? `<button type="button" class="btn ghost" id="c-base-clear">${I('trash', { size: 14 })} Effacer</button>` : ''}</div>
        <label class="f">Nom de la résidence<input type="text" id="c-base-name" maxlength="60" value="${esc(t.base ? t.base.name : '')}" placeholder="Ex. : appartement à Llanes" ${t.base ? '' : 'disabled'}></label></div>
      <div class="card"><div class="h"><h3>${I('calendar', { size: 13 })} Séjour</h3></div>
        <div class="two"><label class="f">Arrivée<input type="date" id="c-start" value="${t.start}"></label><label class="f">Départ<input type="date" id="c-end" value="${endIso}" min="${t.start}"></label></div>
        <span class="hint">${t.days.length} jour${t.days.length > 1 ? 's' : ''} · les prévisions couvrent 7 jours ; au-delà, les journées attendent leur météo.</span>
        ${sw('c-auto', t.auto, 'Planning dynamique', 'Recalculé à chaque mise à jour des prévisions, à partir de vos envies')}
        ${sw('c-round', pr.roundTrip, 'Retour quotidien à la résidence', 'Chaque journée part et revient à la résidence')}
        ${sw('c-lunch', pr.lunch, 'Déjeuner proposé', 'Ajoute le resto ou bar de plage le plus proche de la première plage du jour')}
        <label class="f">Départ le matin<select id="c-start-h">${[8, 9, 10, 11].map((h) => `<option value="${h}" ${(pr.startHour || 10) === h ? 'selected' : ''}>${h} h</option>`).join('')}</select></label>
        <div class="two"><label class="f">Plages par jour (max.)<select id="c-perday">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${pr.perDay === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="f">Rayon depuis la résidence<select id="c-radius">${[20, 40, 60, 100, 200].map((n) => `<option value="${n}" ${pr.radiusKm === n ? 'selected' : ''}>${n} km</option>`).join('')}</select></label></div></div>
      <div class="card"><div class="h"><h3>${I('sliders', { size: 13 })} Affichage</h3></div>
        <label class="f">Profil d'activité par défaut<div class="seg" id="c-profile"></div></label>
        ${sw('c-food', state.poiOn.food, 'Restos & bars sur la carte')}${sw('c-visit', state.poiOn.visit, 'Sites et visites sur la carte')}
        ${sw('c-3d', glMode === 'auto', 'Carte 3D automatique', 'Vue d\'ensemble en 2D, relief 3D dès qu\'on zoome ; le bouton 3D/2D fixe un mode')}</div>
      <div class="card"><div class="h"><h3>${I('download', { size: 13 })} Données</h3></div>
        ${sync.on ? `<span class="hint">Connecté au serveur : envies, programmes et séjour se synchronisent entre vos appareils (${esc(syncStatusText().toLowerCase())}).</span>` : '<span class="hint">Sans serveur, le lien de partage est un instantané fusionné sur l\'autre téléphone (ajouts seulement). « Copier le code » donne le même contenu à coller dans « Code séjour » à la connexion.</span>'}
        <div class="btns"><button type="button" class="btn ghost" id="c-share">${I('share', { size: 14 })} Partager le lien</button>${sync.on ? '' : `<button type="button" class="btn ghost" id="c-code">${I('copy', { size: 14 })} Copier le code</button>`}<button type="button" class="btn ghost" id="c-export">${I('download', { size: 14 })} Exporter (GeoJSON)</button><button type="button" class="btn ghost" id="c-refresh">${I('refresh', { size: 14 })} Rafraîchir les prévisions</button><button type="button" class="btn ghost" id="c-intro">${I('info', { size: 14 })} Revoir le guide</button><button type="button" class="btn ghost" id="c-reset" style="color:var(--bad)">${I('trash', { size: 14 })} Tout effacer</button></div></div>
      <div class="card"><div class="h"><h3>${I('info', { size: 13 })} À propos</h3></div>
        <span class="hint">${esc(state.region.name)} · ${state.spots.length} plages et criques · ${state.pois.length ? state.pois.length + ' lieux' : 'lieux chargés à la demande'} · version ${esc(assetVer || '—')}</span>
        <span class="hint">Données © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (ODbL) · prévisions <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0) · photos Wikimedia Commons, Flickr, Openverse (licences indiquées) · imagerie Esri · <a href="https://github.com/imagodata/costa-cantabrica-planner" target="_blank" rel="noopener">code source</a>.</span></div>`;
    if (state.serverUser) { const hint = document.createElement('span'); hint.className = 'hint'; hint.textContent = `Connecté en tant que « ${state.serverUser} » : votre place (${state.me === 'a' ? 'voyageur 1' : 'voyageur 2'}) est fixée par le séjour.`; $('#c-me').closest('.card').appendChild(hint); }
    $('#c-invite-copy') && ($('#c-invite-copy').onclick = async () => { const code = $('#c-invite').textContent; try { await navigator.clipboard.writeText(code); toast('Code d\'invitation copié'); } catch (e) { prompt('Code d\'invitation :', code); } });
    $('#c-logout') && ($('#c-logout').onclick = logout);
    $('#c-pw') && ($('#c-pw').onclick = () => {
      const dlg = $('#dlg-pick'); $('#pick-title').textContent = 'Changer le mot de passe';
      $('#pick-list').innerHTML = `<div class="config" style="padding:0"><label class="f">Mot de passe actuel<input type="password" id="pw-old" autocomplete="current-password"></label><label class="f">Nouveau mot de passe (8 caractères au moins)<input type="password" id="pw-new" autocomplete="new-password" minlength="8"></label><p class="err hint" id="pw-err" hidden style="color:var(--bad)"></p><button type="button" class="btn primary big" id="pw-go">Enregistrer</button></div>`;
      $('#pw-go').onclick = async () => {
        $('#pw-err').hidden = true;
        try { const r = await fetch(api('api/auth/password'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ password: $('#pw-old').value, newPassword: $('#pw-new').value }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); dlg.close(); toast('Mot de passe changé ; les autres appareils devront se reconnecter'); }
        catch (e) { $('#pw-err').textContent = e.message; $('#pw-err').hidden = false; }
      };
      dlg.showModal();
    });
    $('#c-newcode') && ($('#c-newcode').onclick = async () => { try { const r = await fetch(api('api/w/' + auth.ws.id), { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ newInvite: true }) }); if (!r.ok) throw new Error(); const j = await r.json(); auth.ws = { ...auth.ws, ...j.workspace }; sync.ws = j.workspace; saveAuth(); renderConfig(); toast('Nouveau code d\'invitation : l\'ancien ne fonctionne plus'); } catch (e) { toast('Impossible de changer le code pour le moment'); } });
    $('#c-leave') && ($('#c-leave').onclick = async () => { if (!await confirmDlg('Quitter ce séjour ?', { ok: 'Quitter', danger: true, hint: 'Vos envies et notes y restent pour l\'autre voyageur ; le code d\'invitation est renouvelé.' })) return; try { const r = await fetch(api('api/w/' + auth.ws.id + '/leave'), { method: 'POST', headers: authHeaders() }); if (!r.ok) throw new Error(); try { localStorage.removeItem(LS_STATE); localStorage.removeItem(LS_SYNC); } catch (e) { } auth.ws = null; saveAuth(); location.href = 'login.html'; } catch (e) { toast('Impossible de quitter le séjour pour le moment'); } });
    const commit = () => { save(); renderTabs(); renderWho(); };
    $('#c-a').onchange = (e) => { state.users.a.name = e.target.value.trim().slice(0, 14) || DEFAULT_NAMES[0]; commit(); renderConfig(); };
    $('#c-b').onchange = (e) => { state.users.b.name = e.target.value.trim().slice(0, 14) || DEFAULT_NAMES[1]; commit(); renderConfig(); };
    seg($('#c-me'), [['a', esc(state.users.a.name)], ['b', esc(state.users.b.name)]], state.me, (v) => { if (state.serverUser) { toast('Votre place est fixée par le séjour'); renderConfig(); return; } state.me = v; commit(); }, { a: 'a', b: 'b' });
    seg($('#c-profile'), Object.entries(C.profiles).map(([k, p]) => [k, esc(p.short)]), state.profile, (v) => { state.profile = v; save(); renderProfiles(); renderDays(); });
    const setBase = (b) => { t.base = b; state.pickBase = false; save(); renderConfig(); paintMarkers(); };
    const q = $('#c-base-q');
    q.oninput = () => {
      const v = q.value.trim().toLowerCase(), box = $('#c-base-sugg');
      if (v.length < 2) { box.hidden = true; return; }
      const hits = [...state.spots.filter((s) => s.properties.name.toLowerCase().includes(v)).slice(0, 4).map((s) => ({ name: s.properties.name, sub: s.properties.type === 'cala' ? 'crique' : 'plage', lat: latlng(s)[0], lon: latlng(s)[1], icon: 'wave' })),
        ...state.pois.filter((x) => x.p.name.toLowerCase().includes(v)).slice(0, 6).map((x) => ({ name: x.p.name, sub: (C.poiKinds[x.p.kind] || C.poiKinds.tourism).label + (x.p.addr_city ? ' · ' + x.p.addr_city : ''), lat: x.lat, lon: x.lon, icon: (C.poiKinds[x.p.kind] || C.poiKinds.tourism).icon }))];
      box.hidden = !hits.length;
      box.innerHTML = hits.map((h, k) => `<button type="button" data-k="${k}">${I(h.icon, { size: 14 })}<span>${esc(h.name)}</span><small>${esc(h.sub)}</small></button>`).join('');
      box.querySelectorAll('button').forEach((b) => b.onclick = () => { const h = hits[+b.dataset.k]; setBase({ name: h.name, lat: h.lat, lon: h.lon }); });
    };
    if (!state.pois.length) ensurePois();
    $('#c-base-geo').onclick = () => { if (!navigator.geolocation) return toast('Géolocalisation indisponible'); toast('Recherche de la position…');
      navigator.geolocation.getCurrentPosition((pos) => setBase({ name: t.base?.name && !/^Ma position|^Hébergement \(/.test(t.base.name) ? t.base.name : 'Ma position', lat: +pos.coords.latitude.toFixed(5), lon: +pos.coords.longitude.toFixed(5) }), () => toast('Position introuvable'), { enableHighAccuracy: true, timeout: 12000 }); };
    $('#c-base-map').onclick = () => { state.pickBase = !state.pickBase; renderConfig(); if (state.pickBase) { toast('Touchez la carte pour placer la résidence'); if (isMobile()) setSheet('peek'); } };
    $('#c-base-clear') && ($('#c-base-clear').onclick = () => setBase(null));
    $('#c-base-name').onchange = (e) => { if (t.base) { t.base.name = e.target.value.trim().slice(0, 60) || 'Résidence'; save(); renderConfig(); paintMarkers(); } };
    const setDays = (n) => { n = Math.max(1, Math.min(14, n)); while (t.days.length < n) t.days.push({ stops: [] }); t.days.length = n; };
    $('#c-start').onchange = (e) => { if (e.target.value) { const n = t.days.length; t.start = e.target.value; setDays(n); save(); renderConfig(); autoReplan(); } };
    $('#c-end').onchange = (e) => { if (e.target.value) { const n = Math.round((new Date(e.target.value) - new Date(t.start)) / 86400000) + 1; if (n < 1) { toast('Le départ précède l\'arrivée'); renderConfig(); return; } setDays(n); save(); renderTabs(); renderConfig(); autoReplan(); } };
    $('#c-auto').onclick = () => { t.auto = !t.auto; t.autoBy = t.auto ? state.me : null; save(); renderConfig(); if (t.auto) ensurePois().then(() => proposeTrip({ silent: true })); };
    $('#c-round').onclick = () => { pr.roundTrip = !pr.roundTrip; save(); renderConfig(); };
    $('#c-lunch').onclick = () => { pr.lunch = !pr.lunch; save(); renderConfig(); autoReplan(); };
    $('#c-perday').onchange = (e) => { pr.perDay = +e.target.value; save(); autoReplan(); };
    $('#c-start-h').onchange = (e) => { pr.startHour = +e.target.value; save(); renderConfig(); };
    $('#c-radius').onchange = (e) => { pr.radiusKm = +e.target.value; save(); autoReplan(); };
    $('#c-food').onclick = () => { state.poiOn.food = !state.poiOn.food; save(); renderLayerChips(); renderPois(); renderConfig(); };
    $('#c-visit').onclick = () => { state.poiOn.visit = !state.poiOn.visit; save(); renderLayerChips(); renderPois(); renderConfig(); };
    $('#c-3d').onclick = () => { if (glMode === 'auto') saveGlMode(glOn ? '1' : '0'); else { saveGlMode('auto'); if (!glOn && map.getZoom() >= GL_IN) set3d(true, { silent: true }); else if (glOn && gl && gl.getZoom() + 1 < GL_OUT) set3d(false, { silent: true }); } renderBtn3d(); renderConfig(); };
    $('#c-share').onclick = share; $('#c-code') && ($('#c-code').onclick = copyCode); $('#c-export').onclick = exportSelection; $('#c-refresh').onclick = () => loadForecast(true);
    $('#c-intro').onclick = () => { try { localStorage.removeItem('ccp:intro'); } catch (e) { } showIntro(); };
    $('#c-reset').onclick = async () => { if (await confirmDlg('Effacer envies, programmes, séjour et préférences sur cet appareil ?', { ok: 'Tout effacer', danger: true })) { try { localStorage.removeItem(LS_STATE); localStorage.removeItem(LS_SYNC); } catch (e) { } location.hash = ''; location.reload(); } };
  }

