/* Prévisions : appels Open-Meteo (météo + marine), cache local, score par profil, marées. */
(function () {
  const C = CCP.CONFIG;
  const LS_BULK = 'ccp:bulk:v' + C.version;
  const detailCache = new Map();

  const snap = (v, step) => (Math.round(v / step) * step).toFixed(3);
  const keyOf = (lat, lon, step) => snap(lat, step) + ',' + snap(lon, step);

  async function fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (j && j.error) throw new Error(j.reason || 'Erreur API');
    return j;
  }

  /* Appel multi-points, découpé en lots pour garder des URL raisonnables. */
  async function multi(base, coords, params, chunk = 60) {
    const out = [];
    for (let i = 0; i < coords.length; i += chunk) {
      const c = coords.slice(i, i + chunk);
      const q = new URLSearchParams({
        ...params,
        latitude: c.map((x) => x[0]).join(','),
        longitude: c.map((x) => x[1]).join(','),
        timezone: C.timezone,
        forecast_days: C.forecastDays,
      });
      let res = await fetchJson(base + '?' + q.toString());
      if (!Array.isArray(res)) res = [res];
      out.push(...res);
    }
    return out;
  }

  function readCache(key, ttlMin) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const j = JSON.parse(raw);
      if (Date.now() - j.fetchedAt > ttlMin * 60 * 1000) return null;
      return j;
    } catch (e) { return null; }
  }
  function writeCache(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* quota */ }
  }

  /* Prévisions journalières pour tous les spots (météo + état de la mer). */
  async function loadBulk(spots, { force = false } = {}) {
    const cached = force ? null : readCache(LS_BULK, C.cacheTtlMin);
    if (cached && cached.n === spots.length) return cached;

    const wKeys = new Map(), mKeys = new Map();
    for (const s of spots) {
      const [lon, lat] = s.geometry.coordinates;
      wKeys.set(keyOf(lat, lon, C.weatherStep), [snap(lat, C.weatherStep), snap(lon, C.weatherStep)]);
      mKeys.set(keyOf(lat, lon, C.marineStep), [snap(lat, C.marineStep), snap(lon, C.marineStep)]);
    }
    const wList = [...wKeys.entries()], mList = [...mKeys.entries()];

    const [w, m] = await Promise.all([
      multi(C.weatherApi, wList.map((e) => e[1]), {
        daily: ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'apparent_temperature_max',
          'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'wind_gusts_10m_max',
          'wind_direction_10m_dominant', 'uv_index_max', 'sunshine_duration', 'sunrise', 'sunset'].join(','),
        wind_speed_unit: 'kmh',
      }),
      multi(C.marineApi, mList.map((e) => e[1]), {
        daily: ['wave_height_max', 'wave_period_max', 'wave_direction_dominant', 'swell_wave_height_max',
          'swell_wave_period_max', 'wind_wave_height_max'].join(','),
        cell_selection: 'sea',
      }),
    ]);

    const bulk = { fetchedAt: Date.now(), n: spots.length, weather: {}, marine: {}, dates: w[0].daily.time };
    wList.forEach(([k], i) => { bulk.weather[k] = w[i].daily; });
    mList.forEach(([k], i) => { bulk.marine[k] = m[i].daily; });
    writeCache(LS_BULK, bulk);
    return bulk;
  }

  /* Résumé d'un jour pour un spot donné. */
  function dayOf(bulk, spot, i) {
    const [lon, lat] = spot.geometry.coordinates;
    const w = bulk.weather[keyOf(lat, lon, C.weatherStep)] || {};
    const m = bulk.marine[keyOf(lat, lon, C.marineStep)] || {};
    const g = (o, k) => (o && o[k] ? o[k][i] : null);
    return {
      date: bulk.dates[i],
      code: g(w, 'weather_code'), tmax: g(w, 'temperature_2m_max'), tmin: g(w, 'temperature_2m_min'),
      tapp: g(w, 'apparent_temperature_max'), psum: g(w, 'precipitation_sum'),
      pprob: g(w, 'precipitation_probability_max'), wind: g(w, 'wind_speed_10m_max'),
      gust: g(w, 'wind_gusts_10m_max'), wdir: g(w, 'wind_direction_10m_dominant'),
      uv: g(w, 'uv_index_max'), sun: g(w, 'sunshine_duration'),
      sunrise: g(w, 'sunrise'), sunset: g(w, 'sunset'),
      wave: g(m, 'wave_height_max'), period: g(m, 'wave_period_max'), wavedir: g(m, 'wave_direction_dominant'),
      swell: g(m, 'swell_wave_height_max'), swellPeriod: g(m, 'swell_wave_period_max'),
      windWave: g(m, 'wind_wave_height_max'),
    };
  }

  /* Score 0-100 selon le profil d'activité. Renvoie aussi les raisons principales. */
  function score(d, profile) {
    if (d.tmax == null) return { score: null, cls: 'none', label: '—', reasons: ['pas de données'] };
    let s = 100;
    const reasons = [];
    const pen = (v, why) => { if (v > 0) { s -= v; reasons.push([v, why]); } };
    const lin = (x, a, b, max) => Math.max(0, Math.min(1, (x - a) / (b - a))) * max;

    // Pluie
    const pp = d.pprob ?? 0, ps = d.psum ?? 0;
    pen(lin(pp, 15, 80, 45), `pluie ${Math.round(pp)} %`);
    if (ps > 5) pen(Math.min(15, ps), `${ps.toFixed(0)} mm`);

    // Ciel
    const code = d.code ?? 0;
    const sky = code <= 1 ? 0 : code === 2 ? 4 : code === 3 ? 12 : code < 51 ? 15 : code >= 95 ? 30 : 15;
    pen(sky, code === 3 ? 'couvert' : code >= 45 && code < 51 ? 'brouillard' : code >= 95 ? 'orage' : 'nuageux');

    // Température
    const t = d.tmax;
    if (profile === 'rando') {
      pen(lin(14 - t, 0, 8, 25), `frais ${t.toFixed(0)}°`);
      pen(lin(t - 27, 0, 8, 20), `chaud ${t.toFixed(0)}°`);
    } else {
      pen(lin(22 - t, 0, 8, 35), `frais ${t.toFixed(0)}°`);
      pen(lin(t - 31, 0, 6, 12), `canicule ${t.toFixed(0)}°`);
    }

    // Vent
    const wind = d.wind ?? 0, gust = d.gust ?? 0;
    const windMax = profile === 'famille' ? 35 : profile === 'surf' ? 20 : 30;
    pen(lin(wind, 15, 45, windMax), `vent ${Math.round(wind)} km/h`);
    if (gust > 60) pen(10, `rafales ${Math.round(gust)}`);

    // Vagues
    const wave = d.wave;
    if (wave != null) {
      if (profile === 'surf') {
        if (wave < 0.5) pen(45, `plat ${wave.toFixed(1)} m`);
        else if (wave < 0.9) pen(lin(0.9 - wave, 0, 0.4, 25), `petit ${wave.toFixed(1)} m`);
        else if (wave > 3.5) pen(lin(wave - 3.5, 0, 2, 35), `gros ${wave.toFixed(1)} m`);
        if ((d.period ?? 0) >= 10) s = Math.min(100, s + 8);
        // Vent de terre (côte orientée nord) : bonus
        const wd = d.wdir ?? 0;
        if (wd > 135 && wd < 225 && wind < 30) s = Math.min(100, s + 6);
        else if ((wd < 45 || wd > 315) && wind > 15) pen(8, 'vent de mer');
      } else if (profile === 'rando') {
        /* la houle ne gêne pas la balade */
      } else {
        const lim = profile === 'famille' ? 0.6 : 0.9;
        pen(lin(wave, lim, lim + 1.6, profile === 'famille' ? 45 : 35), `houle ${wave.toFixed(1)} m`);
      }
    }

    s = Math.max(0, Math.min(100, Math.round(s)));
    const cls = C.scoreClasses.find((c) => s >= c.min);
    reasons.sort((a, b) => b[0] - a[0]);
    return { score: s, cls: cls.key, label: cls.label, reasons: reasons.slice(0, 3).map((r) => r[1]) };
  }

  /* Détail horaire pour un spot (chargé à la demande). */
  async function loadDetail(spot) {
    const [lon, lat] = spot.geometry.coordinates;
    const key = spot.properties.id;
    const hit = detailCache.get(key);
    if (hit && Date.now() - hit.fetchedAt < C.cacheTtlMin * 60 * 1000) return hit;

    const base = { timezone: C.timezone, forecast_days: C.forecastDays, latitude: lat, longitude: lon };
    const wq = new URLSearchParams({ ...base, wind_speed_unit: 'kmh',
      hourly: ['temperature_2m', 'apparent_temperature', 'precipitation_probability', 'precipitation',
        'weather_code', 'cloud_cover', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'uv_index'].join(',') });
    const mq = new URLSearchParams({ ...base, cell_selection: 'sea',
      hourly: ['wave_height', 'wave_period', 'wave_direction', 'swell_wave_height',
        'sea_level_height_msl', 'sea_surface_temperature'].join(',') });
    const [w, m] = await Promise.all([
      fetchJson(C.weatherApi + '?' + wq), fetchJson(C.marineApi + '?' + mq),
    ]);
    const d = { fetchedAt: Date.now(), hourly: w.hourly, marine: m.hourly,
      tides: tides(m.hourly.time, m.hourly.sea_level_height_msl) };
    detailCache.set(key, d);
    return d;
  }

  /* Marées : extrema locaux du niveau de la mer horaire, affinés par interpolation parabolique. */
  function tides(times, levels) {
    const out = [];
    if (!levels) return out;
    for (let i = 1; i < levels.length - 1; i++) {
      const a = levels[i - 1], b = levels[i], c = levels[i + 1];
      if (a == null || b == null || c == null) continue;
      const isMax = b >= a && b > c, isMin = b <= a && b < c;
      if (!isMax && !isMin) continue;
      const denom = a - 2 * b + c;
      const off = denom === 0 ? 0 : (a - c) / (2 * denom); // heures, dans [-0.5, 0.5]
      const h = b - (a - c) * off / 4;
      const t = new Date(times[i]);
      t.setMinutes(t.getMinutes() + Math.round(off * 60));
      out.push({ time: t, height: h, type: isMax ? 'PM' : 'BM' });
    }
    return out;
  }

  CCP.forecast = { loadBulk, dayOf, score, loadDetail, tides, keyOf };
})();
