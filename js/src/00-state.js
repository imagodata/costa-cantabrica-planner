  const C = CCP.CONFIG, F = CCP.forecast, I = CCP.icon;
  let LS_STATE = 'ccp:state:v' + C.version;   // suffixé par le séjour quand un compte est connecté
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEFAULT_NAMES = ['Simon', 'Marie'];

  let assetVer = '', poisLoading = null;
  /* Les lieux (1,3 Mo) ne sont chargés qu'au premier besoin : zoom suffisant, fiche, séjour. */
  function ensurePois() {
    if (state.pois.length || poisLoading) return poisLoading || Promise.resolve();
    poisLoading = fetch('data/pois.geojson?v=' + assetVer).then((r) => (r.ok ? r.json() : { features: [] })).catch(() => ({ features: [] }))
      .then((pois) => { state.pois = (pois.features || []).map((f) => ({ id: f.properties.id, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], p: f.properties })); poisLoading = null; });
    return poisLoading;
  }
  const state = {
    region: null,
    spots: [], photos: {}, pois: [], bulk: null, day: 0, profile: 'plage', selected: null, userPos: null,
    poiOn: { food: true, visit: true },
    view: 'explore', wishWho: 'all', wishSort: 'coast', plans: {},
    trip: { base: null, start: null, days: [], auto: false }, pickBase: false,
    prefs: { perDay: 2, radiusKm: 60, lunch: true, roundTrip: true, startHour: 10 },
    mapFilter: true,   // liste Explorer calée sur l'emprise visible de la carte
    filters: { province: 'all', type: 'all', surface: 'all', lifeguard: false, dog: false, minScore: 0, wish: 'all', q: '' },
    sort: 'score',
    users: { a: { name: DEFAULT_NAMES[0], wish: [], suggest: [] }, b: { name: DEFAULT_NAMES[1], wish: [], suggest: [] } },   // suggest : plages proposées à ce voyageur par l'autre
    me: 'a',
    fresh: new Set(),   // envies de l'autre reçues depuis la dernière consultation de l'onglet Envies
  };
  const scoreCache = new Map();
  let baseLayers = null;
  let map, userMarker = null, sheet, detailData = null, detailDay = 0, detailReq = 0, listScroll = 0;
  const markers = new Map(), poiMarkers = new Map();
  let poiLayer = null, wishLayer = null, tripLayer = null, planLayer = null;
  const DAY_COLORS = ['#0b6e99', '#b45309', '#7c3aed', '#0a9396', '#d64545', '#4361ee', '#f0a202'];
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  /* Disposition : panneau latéral sur grand écran, en paysage bas et sur tablette (même requête que le CSS). */
  const SIDE_MQ = matchMedia('(min-width: 900px), (orientation: landscape) and (max-height: 500px) and (min-width: 640px)');
  const isMobile = () => !SIDE_MQ.matches;

