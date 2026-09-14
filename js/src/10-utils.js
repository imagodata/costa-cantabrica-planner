  /* ------------------------------------------------------------------ utilitaires */
  const dayNames = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  function fmtDay(iso, i) {
    const d = new Date(iso + 'T12:00:00');
    return { lbl: i === 0 ? 'Auj.' : i === 1 ? 'Dem.' : dayNames[d.getDay()], sub: d.getDate() + '/' + (d.getMonth() + 1) };
  }
  const hmIso = (iso) => iso.slice(11, 16);
  const compass = (deg) => deg == null ? '' : ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(deg / 45) % 8];
  const arrow = (deg, size = 13) => deg == null ? '' : I('arrow', { size, rotate: deg });
  const wc = (code) => C.weatherCodes[code] || ['cloud', 'Inconnu'];
  const wIcon = (code, size = 16, cls = '') => I(wc(code)[0], { size, cls: cls || (code <= 2 ? 'sun' : 'mu') });
  const n1 = (v, u = '') => v == null ? '—' : (Math.round(v * 10) / 10).toLocaleString('fr-FR') + u;
  const n0 = (v, u = '') => v == null ? '—' : Math.round(v) + u;
  function distKm(a, b) {
    const R = 6371, p = Math.PI / 180, x = (b[0] - a[0]) * p, y = (b[1] - a[1]) * p;
    const h = Math.sin(x / 2) ** 2 + Math.cos(a[0] * p) * Math.cos(b[0] * p) * Math.sin(y / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const latlng = (s) => [s.geometry.coordinates[1], s.geometry.coordinates[0]];
  const photoOf = (id) => state.photos[id] || null;
  const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null);
  const surfaceLbl = (p) => p.surface ? (C.surfaces[p.surface] || p.surface) : null;
  /* Vue aérienne : mosaïque de tuiles satellite centrée sur le point (aucune bibliothèque). */
  const AERIAL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
  const AERIAL_CREDIT = 'Vue aérienne · Imagerie © Esri, Maxar, Earthstar Geographics';
  const PNOA_URL = 'https://www.ign.es/wmts/pnoa-ma?request=GetTile&service=WMTS&version=1.0.0&layer=OI.OrthoimageCoverage&style=default&format=image/jpeg&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}';
  const TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  function tilePx(lat, lon, z) {
    const n = 2 ** z, x = (lon + 180) / 360 * n, latR = lat * Math.PI / 180;
    const y = (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n;
    return { tx: Math.floor(x), ty: Math.floor(y), px: (x - Math.floor(x)) * 256, py: (y - Math.floor(y)) * 256 };
  }
  /* Mètres par pixel CSS au zoom z (Web Mercator). */
  const mpp = (lat, z) => 156543.03 * Math.cos(lat * Math.PI / 180) / 2 ** z;
  /* Zoom qui fait tenir la plage (diagonale size_m) dans environ 60 % de la largeur affichée, borné. */
  function aerialZoom(s, w, zmin, zmax, fill = 0.6) {
    const size = Math.max(60, s.properties.size_m || 200), lat = latlng(s)[0];
    const z = Math.log2(156543.03 * Math.cos(lat * Math.PI / 180) * fill * w / size);
    return Math.max(zmin, Math.min(zmax, Math.round(z)));
  }
  /* Sur écran haute densité, les tuiles sont demandées un niveau plus loin et affichées à moitié : image nette.
     Option scale : barre d'échelle. Les tuiles apparaissent en fondu une fois chargées. */
  function aerialHtml(lat, lon, z, w, h, cls = '', extra = '', { scale = false } = {}) {
    const hi = (window.devicePixelRatio || 1) >= 1.5, tz = hi ? z + 1 : z, ts = hi ? 128 : 256;
    const t = tilePx(lat, lon, tz), k = ts / 256, cx = w / 2 - t.px * k, cy = h / 2 - t.py * k;
    const r = Math.ceil(Math.max(w, h) / ts) + 1;
    let imgs = '';
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const left = cx + dx * ts, top = cy + dy * ts;
      if (left > w || top > h || left + ts < 0 || top + ts < 0) continue;
      imgs += `<img src="${AERIAL}/${tz}/${t.ty + dy}/${t.tx + dx}" alt="" loading="lazy" decoding="async" onload="this.classList.add('ld')" style="left:${Math.round(left)}px;top:${Math.round(top)}px;width:${ts}px;height:${ts}px">`;
    }
    let bar = '';
    if (scale) { const m = mpp(lat, z), len = [50, 100, 200, 500, 1000, 2000].find((L0) => L0 / m >= 44) || 2000; bar = `<span class="scalebar" style="width:${Math.round(len / m)}px">${len >= 1000 ? len / 1000 + ' km' : len + ' m'}</span>`; }
    return `<div class="aerial ${cls}" style="width:${w}px;height:${h}px" ${extra}>${imgs}<i class="pinpt"></i>${bar}</div>`;
  }
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }

  function persistLocal() {
    try { localStorage.setItem(LS_STATE, JSON.stringify({ users: state.users, me: state.me, profile: state.profile, filters: state.filters, sort: state.sort,
      poiOn: state.poiOn, plans: state.plans, trip: state.trip, wishWho: state.wishWho, wishSort: state.wishSort, prefs: state.prefs, mapFilter: state.mapFilter })); } catch (e) { }
  }
  function save() { persistLocal(); syncPush(); }
  function restore() {
    try {
      const j = JSON.parse(localStorage.getItem(LS_STATE) || 'null'); if (!j) return;
      if (j.users) for (const k of ['a', 'b']) if (j.users[k]) state.users[k] = { name: String(j.users[k].name || DEFAULT_NAMES[k === 'a' ? 0 : 1]).slice(0, 14) || DEFAULT_NAMES[k === 'a' ? 0 : 1], wish: Array.isArray(j.users[k].wish) ? j.users[k].wish.filter((x) => typeof x === 'string') : [], suggest: Array.isArray(j.users[k].suggest) ? j.users[k].suggest.filter((x) => typeof x === 'string') : [] };
      if (j.me) state.me = j.me;
      if (j.profile && C.profiles[j.profile]) state.profile = j.profile;
      if (j.filters) Object.assign(state.filters, j.filters);
      if (j.sort) state.sort = j.sort === 'dist' ? 'score' : j.sort;   // la position n'est pas mémorisée : ce tri n'a de sens qu'après « Ma position »
      if (j.poiOn) Object.assign(state.poiOn, j.poiOn);
      if (j.plans) state.plans = j.plans;
      if (j.wishWho) state.wishWho = j.wishWho;
      if (j.wishSort) state.wishSort = j.wishSort;
      if (j.trip && Array.isArray(j.trip.days)) state.trip = { auto: false, ...j.trip };
      if (j.prefs) Object.assign(state.prefs, j.prefs);
      if (typeof j.mapFilter === 'boolean') state.mapFilter = j.mapFilter;
    } catch (e) { }
  }

