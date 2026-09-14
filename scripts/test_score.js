#!/usr/bin/env node
/* Tests unitaires du score météo (js/forecast.js) hors navigateur : node scripts/test_score.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { window: {}, location: { hostname: 'localhost' }, localStorage: { getItem: () => null, setItem() {} }, fetch: () => Promise.reject(new Error('réseau interdit dans ce test')), console };
ctx.window.CCP = {}; ctx.CCP = ctx.window.CCP;
vm.createContext(ctx);
for (const f of ['js/config.js', 'js/forecast.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
const F = ctx.CCP.forecast;
let fails = 0;
const check = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const day = (o) => ({ tmax: 26, tmin: 17, pprob: 0, psum: 0, code: 0, wind: 10, gust: 15, wdir: 180, wave: 0.6, period: 9, swell: 0.5, swellPeriod: 10, uv: 7, sun: 36000, ...o });
const ideal = F.score(day({}), 'plage');
check(ideal.score >= 75 && ideal.cls === 'ideal', `plage : journée idéale → ${ideal.score} (${ideal.label})`);
const rain = F.score(day({ pprob: 90, psum: 12, code: 63 }), 'plage');
check(rain.score < ideal.score - 30 && rain.cls !== 'ideal' && rain.reasons.some((r) => /pluie/i.test(r)), `plage : pluie forte pénalisée → ${rain.score}, raisons : ${rain.reasons.join(', ')}`);
const windy = F.score(day({ wind: 45, gust: 70 }), 'famille');
const windyPlage = F.score(day({ wind: 45, gust: 70 }), 'plage');
check(windy.score <= windyPlage.score && windy.reasons.some((r) => /vent|rafale/i.test(r)), `famille : plus sévère au vent que plage (${windy.score} ≤ ${windyPlage.score})`);
const bigWave = F.score(day({ wave: 2.5, period: 12 }), 'famille');
check(bigWave.score < ideal.score - 30, `famille : houle 2,5 m pénalisée → ${bigWave.score}`);
const surfGood = F.score(day({ wave: 1.6, period: 12, swell: 1.4, swellPeriod: 12, wdir: 180, wind: 12 }), 'surf');
const surfFlat = F.score(day({ wave: 0.2, period: 5, swell: 0.1, swellPeriod: 5 }), 'surf');
check(surfGood.score > surfFlat.score, `surf : houle longue > mer plate (${surfGood.score} > ${surfFlat.score})`);
const rando = F.score(day({ wave: 3, tmax: 18 }), 'rando');
check(rando.score >= 50, `balade : la houle ne compte guère (${rando.score})`);
const none = F.score({ tmax: null }, 'plage');
check(none.score === null && none.cls === 'none', 'sans données : score nul, classe none');
const unknownWave = F.score(day({ wave: null }), 'plage');
check(unknownWave.score <= 74 && unknownWave.reasons.some((r) => /houle inconnue/.test(r)), `houle inconnue : plafonnée à 74 (${unknownWave.score})`);
for (const p of ['plage', 'famille', 'surf', 'rando']) { const r = F.score(day({ pprob: 100, psum: 30, wind: 80, gust: 110, wave: 5, code: 95 }), p); check(r.score >= 0 && r.score <= 100 && r.reasons.length <= 3, `${p} : tempête → borné [0,100] (${r.score}), 3 raisons au plus`); }
check(typeof F.shiftIso === 'function' && F.shiftIso('2026-09-14T10:00', 90).endsWith('11:30'), 'shiftIso : +90 min');
console.log('ÉCHECS :', fails); process.exit(fails ? 1 : 0);
