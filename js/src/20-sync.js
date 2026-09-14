  /* ------------------------------------------------------------------ synchronisation serveur (version connectée)
     Le client garde le dernier état serveur connu (base) et n'envoie que la différence : sa liste
     d'envies, les programmes touchés, les champs du séjour modifiés, les préférences. Le serveur fusionne
     clé par clé (voir server/costa_sync.py). En cas de conflit de version (409), la différence locale
     est rejouée sur l'état reçu puis renvoyée : rien n'est perdu. Hors ligne, la différence attend
     (persistée) et repart au retour du réseau ou au lancement suivant. */
  let LS_SYNC = 'ccp:sync:v' + C.version;
  /* ------------------------------------------------------------------ compte et séjour partagé (jeton porteur)
     auth = { token, user:{id,name,email}, ws:{id,name,slot,invite,members} } dans localStorage ; la page de
     connexion l'écrit. Sans compte, le mode hérité (Caddy, /whoami) ou le mode local s'appliquent. */
  const LS_AUTH = 'ccp:auth:v1';
  let auth = null;
  const api = (p) => (C.apiBase ? C.apiBase.replace(/\/$/, '') + '/' + p : p);
  const authHeaders = () => (auth && auth.token ? { Authorization: 'Bearer ' + auth.token } : {});
  function restoreAuth() {
    try { const j = JSON.parse(localStorage.getItem(LS_AUTH) || 'null'); if (j && typeof j.token === 'string' && j.user && j.ws && j.ws.id) auth = j; else if (j && typeof j.token === 'string' && j.user && !/[#&]reset\b/.test(location.hash)) { location.replace('login.html'); return; } } catch (e) { }   // connecté sans séjour choisi : retour au choix
    const suffix = auth ? ':' + auth.ws.id : '';
    LS_STATE = 'ccp:state:v' + C.version + suffix; LS_SYNC = 'ccp:sync:v' + C.version + suffix;
  }
  const saveAuth = () => { try { if (auth) localStorage.setItem(LS_AUTH, JSON.stringify(auth)); else localStorage.removeItem(LS_AUTH); } catch (e) { } };
  async function logout() {
    try { if (auth) await fetch(api('api/auth/logout'), { method: 'POST', headers: authHeaders() }); } catch (e) { }
    try { localStorage.removeItem(LS_STATE); localStorage.removeItem(LS_SYNC); } catch (e) { }   // l'état du séjour ne reste pas sur un appareil partagé
    auth = null; saveAuth(); location.href = 'login.html';
  }
  const sync = { on: false, version: null, timer: null, pushing: false, dirty: false, poll: null, base: null, err: false, at: 0, log: [], pending: 0 };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const stable = (o) => Array.isArray(o) ? o.map(stable) : (o && typeof o === 'object') ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, stable(o[k])])) : o;
  const same = (a, b) => JSON.stringify(stable(a ?? null)) === JSON.stringify(stable(b ?? null));
  const EMPTY_BASE = () => ({ users: { a: { name: DEFAULT_NAMES[0], wish: [], suggest: [] }, b: { name: DEFAULT_NAMES[1], wish: [], suggest: [] } }, plans: {}, trip: { base: null, start: null, days: [], auto: false }, prefs: clone(state.prefs) });
  const snapshot = () => clone({ users: { a: { name: state.users.a.name, wish: state.users.a.wish, suggest: state.users.a.suggest || [] }, b: { name: state.users.b.name, wish: state.users.b.wish, suggest: state.users.b.suggest || [] } }, plans: state.plans, trip: state.trip, prefs: state.prefs });
  const saveSyncMeta = () => { try { localStorage.setItem(LS_SYNC, JSON.stringify({ version: sync.version, base: sync.base, fresh: [...state.fresh] })); } catch (e) { } };
  const validBase = (b) => !!(b && b.users && b.users.a && b.users.b && Array.isArray(b.users.a.wish) && Array.isArray(b.users.b.wish) && b.plans && typeof b.plans === 'object' && b.trip && Array.isArray(b.trip.days));
  const restoreSyncMeta = () => {
    try {
      const j = JSON.parse(localStorage.getItem(LS_SYNC) || 'null'); if (!j) return;
      const hasState = !!localStorage.getItem(LS_STATE);   // état local effacé (remise à zéro) : la base ne doit pas être rejouée comme une suppression
      if (hasState && typeof j.version === 'number' && validBase(j.base)) { sync.version = j.version; sync.base = j.base; }
      if (Array.isArray(j.fresh)) state.fresh = new Set(j.fresh.filter((x) => typeof x === 'string'));
    } catch (e) { }
  };
  const nameOf = (id) => spotById(id)?.properties.name || 'une plage';
  const itemName = (it) => it.text || poiById(it.poi)?.p.name || 'un lieu';
  const emptyPlan = () => ({ notes: { a: '', b: '' }, items: [] });
  /* Différence entre l'état local et la base, avec un résumé lisible de chaque changement (journal). */
  function syncDiff(base) {
    base = base || EMPTY_BASE();
    const cur = snapshot(), me = state.me, other = me === 'a' ? 'b' : 'a', body = {}, log = [];
    let n = 0;
    if (cur.users[me].name !== base.users[me].name || !same(cur.users[me].wish, base.users[me].wish) || !same(cur.users[me].suggest, base.users[me].suggest || [])) {
      body.users = { [me]: { name: cur.users[me].name, wish: cur.users[me].wish, suggest: cur.users[me].suggest } }; n++;
      const was = new Set(base.users[me].wish || []), now = new Set(cur.users[me].wish);
      for (const id of cur.users[me].wish) if (!was.has(id)) log.push(`a ajouté ${nameOf(id)} à ses envies`);
      for (const id of base.users[me].wish || []) if (!now.has(id)) log.push(`a retiré ${nameOf(id)} de ses envies`);
      if (cur.users[me].name !== base.users[me].name) log.push(`s'appelle désormais ${cur.users[me].name}`);
    }
    if (cur.users[other].name !== base.users[other].name) { body.users = { ...(body.users || {}), [other]: { name: cur.users[other].name } }; n++; }
    if (!same(cur.users[other].suggest, base.users[other].suggest || [])) {   // ce que je propose à l'autre
      body.users = { ...(body.users || {}), [other]: { ...((body.users || {})[other] || {}), suggest: cur.users[other].suggest } }; n++;
      const was = new Set(base.users[other].suggest || []);
      for (const id of cur.users[other].suggest) if (!was.has(id)) log.push(`a proposé ${nameOf(id)} à ${cur.users[other].name}`);
    }
    const plans = {};
    const emptyP = (p) => !p || (!p.items.length && !p.notes.a && !p.notes.b);
    for (const id of new Set([...Object.keys(cur.plans), ...Object.keys(base.plans || {})])) {
      if (same(cur.plans[id], (base.plans || {})[id]) || (emptyP(cur.plans[id]) && emptyP((base.plans || {})[id]))) continue;
      plans[id] = cur.plans[id] || null; n++;
      const c = cur.plans[id] || emptyPlan(), b = (base.plans || {})[id] || emptyPlan(), key = (it) => it.poi || 't:' + it.text;
      const bk = new Set(b.items.map(key)), ck = new Set(c.items.map(key));
      for (const it of c.items) if (!bk.has(key(it))) log.push(`a ajouté ${itemName(it)} au programme de ${nameOf(id)}`);
      for (const it of b.items) if (!ck.has(key(it))) log.push(`a retiré ${itemName(it)} du programme de ${nameOf(id)}`);
      if ((c.notes[me] || '') !== (b.notes[me] || '')) log.push(`a ${c.notes[me] ? 'modifié' : 'effacé'} sa note sur ${nameOf(id)}`);
    }
    if (Object.keys(plans).length) body.plans = plans;
    const tr = {}, bt = base.trip || {};
    for (const f of ['base', 'start', 'auto', 'autoBy']) if (!same(cur.trip[f], bt[f])) { tr[f] = cur.trip[f] ?? null; n++; }
    if (!same(cur.trip.days, bt.days)) {
      tr.days = cur.trip.days; n++;
      const bd = bt.days || [];
      cur.trip.days.forEach((d, i) => { if (!same(d, bd[i])) log.push(`a modifié le jour ${i + 1} du séjour`); });
      if (cur.trip.days.length < bd.length) log.push(`a retiré ${bd.length - cur.trip.days.length} jour${bd.length - cur.trip.days.length > 1 ? 's' : ''} du séjour`);
    }
    if ('base' in tr) log.push(tr.base ? `a placé l'hébergement : ${tr.base.name}` : `a retiré l'hébergement`);
    if ('start' in tr && tr.start) log.push(`a fixé l'arrivée au ${tr.start.split('-').reverse().join('/')}`);
    if ('auto' in tr) log.push(tr.auto ? 'a activé le planning dynamique' : 'a figé le planning');
    if (Object.keys(tr).length) body.trip = tr;
    if (!same(cur.prefs, base.prefs)) { body.prefs = cur.prefs; n++; }
    return { body, log, n, cur, base };
  }
  /* Fusion d'un programme : ma note et mes compléments, la note et les compléments de l'autre tels que le serveur les connaît. */
  function mergePlan(local, server, me) {
    const other = me === 'a' ? 'b' : 'a', l = local || emptyPlan(), s = server || emptyPlan(), key = (it) => it.poi || 't:' + it.text;
    const sk = new Set(s.items.map(key)), lk = new Set(l.items.map(key));
    const items = [...l.items.filter((it) => it.by === me || sk.has(key(it))), ...s.items.filter((it) => it.by !== me && !lk.has(key(it)))];
    return { notes: { [me]: l.notes[me] || '', [other]: s.notes[other] || '' }, items };
  }
  /* Rejoue une différence locale sur l'état courant (après réception d'un état serveur). */
  function applyDiff({ body, cur, base }) {
    const me = state.me, other = me === 'a' ? 'b' : 'a', srv = sync.base || EMPTY_BASE(), bs = base || EMPTY_BASE();
    const delta = (k) => { const b = bs.users[k].suggest || [], c = cur.users[k].suggest || []; return { add: c.filter((x) => !b.includes(x)), rem: new Set(b.filter((x) => !c.includes(x))) }; };
    if (body.users && body.users[me]) {
      state.users[me].name = cur.users[me].name; state.users[me].wish = clone(cur.users[me].wish);
      const d = delta(me); state.users[me].suggest = (state.users[me].suggest || []).filter((x) => !d.rem.has(x));   // mes retraits seulement : une proposition reçue entre-temps reste
    }
    if (body.users && body.users[other] && body.users[other].name) state.users[other].name = body.users[other].name;
    if (body.users && body.users[other] && body.users[other].suggest) {   // mes ajouts et retraits ; les retraits de l'autre (accepté, ignoré) sont respectés
      const d = delta(other); state.users[other].suggest = [...new Set([...(state.users[other].suggest || []).filter((x) => !d.rem.has(x)), ...d.add])].filter((x) => !state.users[other].wish.includes(x)).slice(0, 100);
    }
    for (const [id, p] of Object.entries(body.plans || {})) { if (p) state.plans[id] = mergePlan(p, srv.plans[id], me); else delete state.plans[id]; }
    if (body.trip) for (const [f, v] of Object.entries(body.trip)) state.trip[f] = clone(v);
    if (body.prefs) Object.assign(state.prefs, clone(body.prefs));
  }
  const syncUrl = () => (auth ? api('api/w/' + auth.ws.id + '/state') : api('api/state'));
  const fetchSync = (opts = {}) => fetch(syncUrl(), { cache: 'no-store', ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) }, ...(typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(15000) } : {}) });
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const cleanUser = (u, fallback) => ({ name: String((u && u.name) || fallback.name).slice(0, 14), wish: arr(u && u.wish), suggest: arr(u && u.suggest) });
  const syncApply = (st) => {
    const me = state.me, other = me === 'a' ? 'b' : 'a';
    const known = new Set(sync.base ? (sync.base.users[other].wish || []) : (st.users[other].wish || []));   // sans base connue : rien n'est « nouveau »
    for (const id of st.users[other].wish || []) if (!known.has(id)) state.fresh.add(id);
    const knownS = new Set(sync.base ? (sync.base.users[me].suggest || []) : (st.users[me].suggest || []));   // propositions reçues
    for (const id of st.users[me].suggest || []) if (!knownS.has(id)) state.fresh.add(id);
    state.users[other] = cleanUser(st.users[other], state.users[other]);
    state.users[me] = cleanUser(st.users[me], state.users[me]);
    if (st.plans && typeof st.plans === 'object') state.plans = st.plans;
    if (st.trip && Array.isArray(st.trip.days)) state.trip = { auto: false, ...st.trip };
    if (st.prefs && typeof st.prefs === 'object') Object.assign(state.prefs, st.prefs);
    if (Array.isArray(st.log)) sync.log = st.log;
    if (st.workspace) { sync.ws = st.workspace; if (auth) { auth.ws = { ...auth.ws, ...st.workspace, slot: st.me || auth.ws.slot }; saveAuth(); } }
    sync.version = st.version; sync.at = Date.now();
    sync.base = clone({ users: { a: state.users.a, b: state.users.b }, plans: state.plans, trip: state.trip, prefs: state.prefs });
    saveSyncMeta();
  };
  async function syncLoad() {
    try {
      const r = await fetchSync(); if (!r.ok) return false;
      const st = await r.json(); if (!st || typeof st.version !== 'number') return false;
      if (st.me === 'a' || st.me === 'b') state.me = st.me;
      const local = sync.base ? syncDiff(sync.base) : null;   // modifications faites hors ligne ou avant une coupure : rejouées
      const first = sync.base ? null : snapshot();             // première connexion de cet appareil : son travail local est ajouté, jamais écrasé
      syncApply(st); sync.on = true; sync.err = false;
      if (local && local.n) { applyDiff(local); persistLocal(); syncPush(); }
      else if (first) mergeFirst(first);
      return true;
    } catch (e) { return false; }
  }
  function mergeFirst(loc) {
    const me = state.me, other = me === 'a' ? 'b' : 'a';
    state.users[me].wish = [...new Set([...state.users[me].wish, ...loc.users[me].wish])].slice(0, 500);
    if (!state.users[other].wish.length && loc.users[other].wish.length) state.users[other].wish = loc.users[other].wish.slice(0, 500);   // séjour partagé encore vide côté autre : ses envies saisies en mode local
    state.users[other].suggest = [...new Set([...(state.users[other].suggest || []), ...(loc.users[other].suggest || [])])].filter((id) => !state.users[other].wish.includes(id)).slice(0, 100);
    for (const [id, p] of Object.entries(loc.plans)) if (p && (p.items.length || p.notes[me])) state.plans[id] = mergePlan(p, state.plans[id], me);
    if (!state.trip.days.some((d) => d.stops.length) && loc.trip.days.some((d) => d.stops.length)) state.trip = { ...state.trip, start: loc.trip.start, days: loc.trip.days };
    if (!state.trip.base && loc.trip.base) state.trip.base = loc.trip.base;
    if (syncDiff(sync.base).n) { persistLocal(); syncPush(); toast('Vos envies et programmes locaux ont été ajoutés au séjour partagé'); }
  }
  function syncPush() {
    if (!sync.on) return;
    sync.dirty = true; clearTimeout(sync.timer); sync.timer = setTimeout(syncFlush, 700);
  }
  let flushWaits = 0;
  async function syncFlush() {
    if (!sync.on || sync.pushing) return;
    if (!state.spots.length && flushWaits++ < 20) { clearTimeout(sync.timer); sync.timer = setTimeout(syncFlush, 800); return; }   // les noms de plages servent au journal
    const diff = syncDiff(sync.base);
    if (!diff.n) { sync.dirty = false; sync.pending = 0; renderSyncDot(); return; }
    sync.pushing = true; sync.dirty = false;
    try {
      const body = { ...diff.body, log: diff.log.slice(0, 6).map((text) => ({ text })) };
      const r = await fetchSync({ method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': String(sync.version) }, body: JSON.stringify(body) });
      if (r.status === 409) {   // l'autre a écrit entre-temps : son état, puis ma différence (y compris ce qui a été saisi pendant l'envoi), puis renvoi
        const st = await r.json(); sync.pushing = false;
        const late = syncDiff(sync.base);
        syncApply(st); applyDiff(late); persistLocal(); rerenderAll({ soft: true }); syncPush(); return;
      }
      if (r.status === 401) { sync.on = false; sync.err = true; sync.dirty = true; if (auth) { auth = null; saveAuth(); toast('Session expirée : reconnectez-vous'); setTimeout(() => { location.href = 'login.html'; }, 1500); } return; }   // rien n'est perdu : la différence attend
      if (r.status === 429) { sync.err = true; sync.dirty = true; return; }   // réessai au prochain sondage
      if (r.status === 403) { sync.on = false; sync.err = true; toast(auth ? 'Vous ne faites plus partie de ce séjour' : 'Ce compte n\'est pas connu du serveur de synchronisation'); return; }
      if (r.status === 413) { sync.err = true; sync.dirty = false; sync.pending = diff.n; toast('Séjour trop volumineux : retirez des programmes ou des notes'); return; }   // réessai à la prochaine modification seulement
      if (r.status >= 400 && r.status < 500) { sync.base = diff.cur; toast('Modification refusée par le serveur'); return; }   // définitif : on n'insiste pas
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const st = await r.json();
      const late = syncDiff(diff.cur), before = snapshot();   // saisi pendant l'envoi
      syncApply(st); applyDiff(late); sync.err = false;   // la base reflète les normalisations du serveur (troncatures, programmes vides retirés)
      if (!same(before, snapshot())) { persistLocal(); rerenderAll({ soft: true }); }
    } catch (e) { sync.err = true; sync.dirty = true; }
    finally { sync.pushing = false; }
    sync.pending = sync.dirty ? syncDiff(sync.base).n : 0; renderSyncDot();
    if (sync.dirty && !sync.err) syncPush();
  }
  const isTyping = () => { const a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.closest('#sheet')); };
  async function syncPoll() {
    if (document.hidden) return;
    if (!sync.on) { if (state.serverUser && await syncLoad()) { rerenderAll(); renderWho(); } return; }
    if (sync.pushing) return;
    if (sync.dirty) { syncFlush(); return; }
    try {
      const r = await fetchSync();
      if (r.status === 401 && auth) { sync.on = false; auth = null; saveAuth(); toast('Session expirée : reconnectez-vous'); setTimeout(() => { location.href = 'login.html'; }, 1500); return; }
      if (r.status === 403 && auth) { sync.on = false; sync.err = true; renderSyncDot(); toast('Vous ne faites plus partie de ce séjour'); return; }
      if (!r.ok) { sync.err = true; renderSyncDot(); return; }
      const st = await r.json(); sync.err = false; sync.at = Date.now();
      if (st.version !== sync.version) {
        if (isTyping() || sync.dirty || sync.pushing) { renderSyncDot(); return; }   // saisie en cours ou envoi en attente : au prochain sondage
        const seen = sync.version;
        syncApply(st); persistLocal(); rerenderAll();
        const news = sync.log.filter((e) => (e.v || 0) > seen && e.by !== state.me);
        if (news.length) { const last = news[news.length - 1]; toast(`${last.name} ${last.text}${news.length > 1 ? ` (+${news.length - 1})` : ''}`); }
        else toast(`Mis à jour par ${st.by === state.serverUser ? 'vous' : (st.by || 'l\'autre voyageur')}`);
      }
      renderSyncDot();
    } catch (e) { sync.err = true; renderSyncDot(); }
  }
  function syncOnline() { if (!state.serverUser) return; if (sync.dirty) syncFlush(); else syncPoll(); }
  const ago = (ms) => { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); if (s < 60) return `il y a ${s} s`; if (s < 3600) return `il y a ${Math.round(s / 60)} min`; if (s < 86400) return `il y a ${Math.round(s / 3600)} h`; const d = new Date(ms); return `le ${d.getDate()}/${d.getMonth() + 1} à ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  function syncStatusText() {
    if (!sync.on) return state.serverUser ? (auth ? 'Séjour inaccessible ou serveur injoignable : les modifications restent sur cet appareil' : 'Serveur injoignable : les modifications restent sur cet appareil') : 'Version sans serveur';
    const pend = sync.pending ? ` · ${sync.pending} modification${sync.pending > 1 ? 's' : ''} en attente` : '';
    if (sync.err) return (navigator.onLine === false ? 'Hors ligne' : 'Serveur injoignable') + pend;
    if (sync.pending) return `${sync.pending} modification${sync.pending > 1 ? 's' : ''} à envoyer`;
    return `Synchronisé ${sync.at ? ago(sync.at) : ''}`.trim();
  }
  function renderSyncDot() {
    const d = $('#sync-dot'); if (!d) return;
    d.classList.toggle('err', !sync.on || sync.err); d.classList.toggle('pending', sync.on && !sync.err && (sync.dirty || sync.pending > 0));
    d.parentElement.title = syncStatusText();
  }
  function rerenderAll({ soft = false } = {}) {
    renderTabs(); renderWho();
    if (soft && isTyping()) { paintMarkers(); return; }
    if (state.selected && !$('#panel-detail').hidden) { renderDetailHead(); renderDetailDay(detailDay); }
    else if (state.view === 'wishes') renderWishes(); else if (state.view === 'trip') renderTrip(); else if (state.view === 'config') renderConfig(); else renderList({ keep: true });
    paintMarkers();
  }
  const canEdit = (who) => !state.serverUser || who === state.me;
  /* Version protégée (VPS) : l'utilisateur authentifié (/whoami) devient le voyageur actif ; le serveur
     renvoie le voyageur correspondant (me) dans l'état. Le sondage reprend aussi la synchro si le serveur
     était injoignable au lancement. */
  async function applyServerIdentity() {
    if (auth) {   // compte : la session est vérifiée, puis l'état du séjour chargé
      try {
        const r = await fetch(api('api/me'), { cache: 'no-store', headers: authHeaders() });
        if (r.status === 401) { auth = null; saveAuth(); toast('Session expirée : reconnectez-vous'); setTimeout(() => { location.href = 'login.html'; }, 1200); return; }
        if (r.ok) {
          const me = await r.json(); auth.user = me.user;
          const w = (me.workspaces || []).find((x) => x.id === auth.ws.id);
          if (!w) { auth.ws = null; saveAuth(); toast('Ce séjour n\'est plus accessible : choisissez-en un autre'); setTimeout(() => { location.href = 'login.html'; }, 1500); return; }
          auth.ws = { ...auth.ws, ...w }; saveAuth();
        }
      } catch (e) { /* hors ligne : on continue avec la session mémorisée */ }
      state.serverUser = auth.user.name; state.me = auth.ws.slot === 'b' ? 'b' : 'a';
      restoreSyncMeta();
      await syncLoad();
      sync.poll = setInterval(syncPoll, 20000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) syncPoll(); });
      return;
    }
    try {   // mode hérité : Caddy transmet l'utilisateur authentifié
      const r = await fetch('whoami', { cache: 'no-store' });
      if (!r.ok) return;
      const id = (await r.text()).trim().toLowerCase();
      if (!id || id.includes('<')) return;
      state.serverUser = id;
      restoreSyncMeta();
      await syncLoad();
      if (!sync.on) { const k = id === 'marie' ? 'b' : id === 'simon' ? 'a' : id === state.users.b.name.toLowerCase() ? 'b' : id === state.users.a.name.toLowerCase() ? 'a' : null; if (k) state.me = k; }
      sync.poll = setInterval(syncPoll, 20000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) syncPoll(); });
    } catch (e) { /* version publique : pas de serveur */ }
  }
  /* #view=explore|wishes|trip|config ouvre directement une vue (combinable : #share=…&view=explore). */
  function applyViewParam() {
    const m = location.hash.match(/[#&]view=(explore|wishes|trip|config)/);
    if (m) { state.view = m[1]; return true; }
    return false;
  }
  function applyShare() {
    const m = location.hash.match(/#share=([A-Za-z0-9_-]+)/); if (!m) return false;
    try {
      const p = JSON.parse(b64d(m[1]));
      const merge = (k, list) => { state.users[k].wish = [...new Set([...(state.users[k].wish || []), ...(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [])])].slice(0, 500); };
      merge('a', p.a); merge('b', p.b);
      for (const k of ['a', 'b']) state.users[k].suggest = [...new Set([...(state.users[k].suggest || []), ...(Array.isArray(p['s' + k]) ? p['s' + k].filter((x) => typeof x === 'string') : [])])].filter((id) => !state.users[k].wish.includes(id)).slice(0, 100);
      const cleanName = (v) => String(v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14);
      if (p.na && DEFAULT_NAMES.includes(state.users.a.name) && cleanName(p.na)) state.users.a.name = cleanName(p.na);
      if (p.nb && DEFAULT_NAMES.includes(state.users.b.name) && cleanName(p.nb)) state.users.b.name = cleanName(p.nb);
      if (Number.isInteger(p.d)) state.day = Math.max(0, Math.min(C.forecastDays - 1, p.d));
      if (p.p && C.profiles[p.p]) state.profile = p.p;
      if (typeof p.s === 'string') state.selected = p.s.slice(0, 20);
      for (const [id, v] of Object.entries(p.pl || {}).slice(0, 300)) {
        if (!v || typeof v !== 'object' || !/^[nwr]\d+$/.test(id)) continue;
        const pn = planOf(id);
        for (const k of ['a', 'b']) if (v.n && v.n[k] && !pn.notes[k]) pn.notes[k] = String(v.n[k]).slice(0, 500);
        for (const [ref, byRaw] of (Array.isArray(v.i) ? v.i : []).slice(0, 40)) {
          const by = byRaw === 'b' ? 'b' : 'a';
          const it = String(ref).startsWith('t:') ? { text: String(ref).slice(2, 82), by } : (/^[nwr]\d+$/.test(String(ref)) ? { poi: String(ref), by } : null);
          if (!it) continue;
          if (!pn.items.some((x) => (x.poi && x.poi === it.poi) || (x.text && x.text === it.text))) pn.items.push(it);
        }
      }
      if (p.tr && Array.isArray(p.tr.d) && !state.trip.days.some((d) => d.stops.length)) {
        state.trip = { base: p.tr.b && Number.isFinite(p.tr.b.lat) && Number.isFinite(p.tr.b.lon) ? { name: String(p.tr.b.name || 'Hébergement').slice(0, 60), lat: p.tr.b.lat, lon: p.tr.b.lon } : state.trip.base,
          start: typeof p.tr.s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.tr.s) ? p.tr.s : null,
          auto: p.tr.a === 1,
          days: p.tr.d.slice(0, 14).map((stops) => ({ stops: (stops || []).slice(0, 30).map(([t, v, lk]) => ({ ...(t === 'x' ? { t: 'x', text: String(v).slice(0, 80) } : { t: t === 'p' ? 'p' : 's', id: String(v) }), ...(lk === 1 ? { lock: true } : {}) })) })) };
      }
      if ((p.a && p.a.length) || (p.b && p.b.length)) state.view = 'wishes';
      if (p.tr && Array.isArray(p.tr.d) && p.tr.d.some((d) => d && d.length)) state.view = 'trip';
      applyViewParam();
      history.replaceState(null, '', location.pathname + location.search);
      save(); toast('Sélection partagée importée'); return true;
    } catch (e) { return false; }
  }
  async function copyCode() {
    const url = shareUrl();
    try { await navigator.clipboard.writeText(url); toast('Code séjour copié : à coller dans « Code séjour » sur l\'autre téléphone'); } catch (e) { prompt('Copiez ce code :', url); }
  }
  async function share() {
    const url = shareUrl(), title = 'Costa Cantábrica – nos envies de plages';
    try { if (navigator.share) { await navigator.share({ title, url }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast('Lien copié dans le presse-papiers'); } catch (e) { prompt('Copiez ce lien :', url); }
  }

