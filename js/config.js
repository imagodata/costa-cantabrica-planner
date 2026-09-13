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
    plage:   { icon: '🏖️', label: 'Plage & baignade' },
    famille: { icon: '👨‍👩‍👧', label: 'Famille (calme)' },
    surf:    { icon: '🏄', label: 'Surf' },
    rando:   { icon: '🥾', label: 'Balade & photo' },
  },

  scoreClasses: [
    { min: 75, key: 'ideal', label: 'Idéal' },
    { min: 55, key: 'good',  label: 'Bon' },
    { min: 35, key: 'mid',   label: 'Moyen' },
    { min: 0,  key: 'bad',   label: 'À éviter' },
  ],

  weatherCodes: {
    0: ['☀️', 'Ciel dégagé'], 1: ['🌤️', 'Plutôt dégagé'], 2: ['⛅', 'Partiellement nuageux'],
    3: ['☁️', 'Couvert'], 45: ['🌫️', 'Brouillard'], 48: ['🌫️', 'Brouillard givrant'],
    51: ['🌦️', 'Bruine légère'], 53: ['🌦️', 'Bruine'], 55: ['🌧️', 'Bruine dense'],
    56: ['🌧️', 'Bruine verglaçante'], 57: ['🌧️', 'Bruine verglaçante'],
    61: ['🌧️', 'Pluie faible'], 63: ['🌧️', 'Pluie'], 65: ['🌧️', 'Pluie forte'],
    66: ['🌧️', 'Pluie verglaçante'], 67: ['🌧️', 'Pluie verglaçante'],
    71: ['🌨️', 'Neige'], 73: ['🌨️', 'Neige'], 75: ['🌨️', 'Neige forte'], 77: ['🌨️', 'Grésil'],
    80: ['🌦️', 'Averses légères'], 81: ['🌧️', 'Averses'], 82: ['⛈️', 'Averses violentes'],
    85: ['🌨️', 'Averses de neige'], 86: ['🌨️', 'Averses de neige'],
    95: ['⛈️', 'Orage'], 96: ['⛈️', 'Orage avec grêle'], 99: ['⛈️', 'Orage avec grêle'],
  },

  surfaces: { sand: 'sable', pebblestone: 'galets', gravel: 'graviers', fine_gravel: 'gravier fin',
              rocky: 'rochers', rock: 'rochers', stone: 'pierres', paved: 'aménagée' },
};
