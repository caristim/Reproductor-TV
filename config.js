/**
 * config.js
 * Constantes de la integración con AntelTV / Vera.
 * Si Antel cambia alguna URL en el futuro, es acá donde hay que corregirla.
 */
const CONFIG = {
  // --- Identidad OIDC de la app de TV ---
  CLIENT_ID: 'veratv-beta',
  OIDC_AUTHORIZE_URL: 'https://login.vera.com.uy/oidc/authorize',

  // --- APIs de Vera / Antel ---
  SESSION_API: 'https://veratv-be.vera.com.uy/api/sesiones',
  SETUP_API: 'https://veratv-be.vera.com.uy/api/setup',
  GRID_API: 'https://cds-frontend.vera.com.uy/api-contenidos/listas/234',

  DOMINIO: 'lua',

  // --- Redirect URI de respaldo (si nuestra callback.html es rechazada) ---
  FALLBACK_REDIRECT_URI: 'https://tv.vera.com.uy/',

  // --- Márgenes de renovación (renovar ANTES de que expire, no cuando ya expiró) ---
  SESSION_RENEW_MARGIN_MS: 10 * 60 * 1000,   // renovar sesión 10 min antes de que venza (~cada 6-8hs)
  STREAM_RENEW_MARGIN_MS: 8 * 60 * 1000,     // renovar URL de stream 8 min antes de que venza (~cada 4hs)

  // --- Tiempos de espera / reintentos ---
  LOGIN_POPUP_TIMEOUT_MS: 25 * 1000,         // si el popup de login no responde en este tiempo, se considera fallido
  MAX_STREAM_RETRY: 3,

  // --- Almacenamiento local ---
  STORAGE_KEYS: {
    usuario: 'antel_usuario',
    password: 'antel_password_b64',
    lastChannel: 'antel_ultimo_canal',
  },
};
