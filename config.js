/**
 * config.js
 * Constantes de la integración con AntelTV / Vera.
 */
const CONFIG = {
  // --- APIs de Vera / Antel usadas directamente desde el navegador ---
  SETUP_API: 'https://veratv-be.vera.com.uy/api/setup',
  GRID_API: 'https://cds-frontend.vera.com.uy/api-contenidos/listas/234',
  GRID_HEADERS: { 'x-service-id': '3', 'x-frontend-id': '1196', 'x-system-id': '1' },

  // --- API para crear sesión (se llama desde el navegador) ---
  SESSION_API: 'https://veratv-be.vera.com.uy/api/sesiones',
  DOMINIO: 'lua',

  // --- OIDC / CAS (para login en el navegador con popup) ---
  OIDC_AUTHORIZE_URL: 'https://login.vera.com.uy/oidc/authorize',
  CLIENT_ID: 'veratv-beta',
  REDIRECT_URI: window.location.origin + '/callback.html',

  // --- Márgenes de renovación ---
  SESSION_RENEW_MARGIN_MS: 10 * 60 * 1000,
  STREAM_RENEW_MARGIN_MS: 8 * 60 * 1000,

  // --- Reintentos ---
  MAX_STREAM_RETRY: 3,

  // --- Almacenamiento local ---
  STORAGE_KEYS: {
    usuario: 'antel_usuario',
    password: 'antel_password_b64',
    lastChannel: 'antel_ultimo_canal',
    order: 'antel_orden_canales',
  },
};
