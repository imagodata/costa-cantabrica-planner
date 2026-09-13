/* Configuration globale : sources de données, profils de scoring, codes météo. */
window.CCP = window.CCP || {};
CCP.CONFIG = {
  version: 1,
  center: [43.45, -5.0],
  zoom: 8,
  forecastDays: 7,
  cacheTtlMin: 60,
  timezone: 'Europe/Madrid',
  weatherApi: 'https://api.open-meteo.com/v1/forecast',
  marineApi: 'https://marine-api.open-meteo.com/v1/marine',
  // Regroupement des points pour limiter les appels API (degrés)
  weatherStep: 0.02,
  marineStep: 0.05,

  profiles: {
    plage:   { icon: 'sun',   label: 'Plage & baignade', short: 'Plage' },
    famille: { icon: 'users', label: 'Famille (calme)',  short: 'Famille' },
    surf:    { icon: 'wave',  label: 'Surf',             short: 'Surf' },
    rando:   { icon: 'boot',  label: 'Balade & photo',   short: 'Balade' },
  },

  scoreClasses: [
    { min: 75, key: 'ideal', label: 'Idéal' },
    { min: 55, key: 'good',  label: 'Bon' },
    { min: 35, key: 'mid',   label: 'Moyen' },
    { min: 0,  key: 'bad',   label: 'À éviter' },
  ],

  weatherCodes: {
    0: ['sun', 'Ciel dégagé'], 1: ['sun-cloud', 'Plutôt dégagé'], 2: ['sun-cloud', 'Éclaircies'],
    3: ['cloud', 'Couvert'], 45: ['fog', 'Brouillard'], 48: ['fog', 'Brouillard givrant'],
    51: ['drizzle', 'Bruine légère'], 53: ['drizzle', 'Bruine'], 55: ['rain', 'Bruine dense'],
    56: ['rain', 'Bruine verglaçante'], 57: ['rain', 'Bruine verglaçante'],
    61: ['rain', 'Pluie faible'], 63: ['rain', 'Pluie'], 65: ['rain', 'Pluie forte'],
    66: ['rain', 'Pluie verglaçante'], 67: ['rain', 'Pluie verglaçante'],
    71: ['snow', 'Neige'], 73: ['snow', 'Neige'], 75: ['snow', 'Neige forte'], 77: ['snow', 'Grésil'],
    80: ['drizzle', 'Averses légères'], 81: ['rain', 'Averses'], 82: ['storm', 'Averses violentes'],
    85: ['snow', 'Averses de neige'], 86: ['snow', 'Averses de neige'],
    95: ['storm', 'Orage'], 96: ['storm', 'Orage avec grêle'], 99: ['storm', 'Orage avec grêle'],
  },

  poiKinds: {
    restaurant: { icon: 'fork',       label: 'Restaurant',    color: '#c2410c' },
    bar:        { icon: 'glass',      label: 'Bar',           color: '#7c3aed' },
    beach_bar:  { icon: 'umbrella',   label: 'Bar de plage',  color: '#0a9396' },
    cafe:       { icon: 'cup',        label: 'Café',          color: '#92400e' },
    culture:    { icon: 'landmark',   label: 'Site culturel', color: '#b45309' },
    tourism:    { icon: 'binoculars', label: 'À visiter',     color: '#0369a1' },
  },
  poiGroups: { food: ['restaurant', 'bar', 'beach_bar', 'cafe'], visit: ['culture', 'tourism'] },
  poiMinZoom: 13,
  nearbyKm: 1.5,

  surfaces: { sand: 'sable', pebblestone: 'galets', gravel: 'graviers', fine_gravel: 'gravier fin',
              rocky: 'rochers', rock: 'rochers', stone: 'pierres', paved: 'aménagée' },
};
