  /* ------------------------------------------------------------------ partage (lien) */
  const b64e = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64d = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
  function shareUrl() {
    const pl = {};
    for (const [id, pn] of Object.entries(state.plans)) if (pn.items.length || pn.notes.a || pn.notes.b) pl[id] = { n: pn.notes, i: pn.items.map((it) => [it.poi || ('t:' + it.text), it.by]) };
    const tr = state.trip.days.some((d) => d.stops.length) || state.trip.base
      ? { b: state.trip.base, s: state.trip.start, a: state.trip.auto ? 1 : 0, d: state.trip.days.map((d) => d.stops.map((st) => st.lock ? [st.t, st.id || st.text, 1] : [st.t, st.id || st.text])) } : undefined;
    const p = { na: state.users.a.name, nb: state.users.b.name, a: state.users.a.wish, b: state.users.b.wish, sa: state.users.a.suggest, sb: state.users.b.suggest, d: state.day, p: state.profile, s: state.selected, pl, tr };
    return location.origin + location.pathname + '#share=' + b64e(JSON.stringify(p));
  }
  const spotBySlug = (slug) => state.spots.find((s) => s.properties.slug === slug);
  const APP_DIR = location.pathname.replace(/[^/]*$/, '');
  const spotUrl = (s) => location.origin + APP_DIR + 's/' + s.properties.slug + '.html';
  async function shareSpot(s) {
    const url = spotUrl(s), p = s.properties, r = state.bulk ? scoreOf(s) : null;
    const text = `${p.name} (${p.type === 'cala' ? 'crique' : 'plage'}, ${p.province})${r && r.score != null ? ` · ${r.score}/100 ${r.label} ${fmtDay(state.bulk.dates[state.day], state.day).lbl.toLowerCase()}` : ''}`;
    try { if (navigator.share) { await navigator.share({ title: p.name, text, url }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast('Lien de la plage copié'); } catch (e) { prompt('Copiez ce lien :', url); }
  }
  function applyRoute() {
    const mp = location.hash.match(/^#poi=([nwr]\d+)$/);
    if (mp) { ensurePois().then(() => { const x = poiById(mp[1]); if (x && currentPoi !== x.id) showPoi(x, { fromHistory: true }); }); return 'poi'; }
    const m = location.hash.match(/^#([a-z0-9-]+)$/);
    if (!m) return false;
    const s = spotBySlug(m[1]); if (!s) return false;
    state.selected = s.properties.id; return true;
  }
