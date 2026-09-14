// Règles volontairement sobres : le code est du JavaScript navigateur classique (fermeture unique, pas de modules).
const globals = require('globals');
module.exports = [
  { ignores: ['vendor/**', 'node_modules/**', 's/**', 'data/**'] },
  {
    files: ['js/*.js', 'sw.js', 'scripts/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser, ...globals.serviceworker, ...globals.node, L: 'readonly', maplibregl: 'readonly', CCP: 'writable' } },
    rules: {
      'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }], 'no-redeclare': 'error', 'no-dupe-keys': 'error',
      'no-unreachable': 'error', 'no-constant-condition': ['error', { checkLoops: false }], 'eqeqeq': ['warn', 'smart'], 'no-var': 'error', 'prefer-const': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }], 'no-cond-assign': 'error', 'no-self-assign': 'error', 'use-isnan': 'error', 'valid-typeof': 'error',
    },
  },
];
