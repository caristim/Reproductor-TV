/**
 * config.js
 * Constantes de la integración con AntelTV / Vera.
 * Si Antel cambia alguna URL en el futuro, es acá donde hay que corregirla.
 */
const CONFIG = {
  // --- Nuestra función de login (Vercel) — hace el login contra Antel del lado del servidor ---
  LOGIN_API: '/api/login',

  // --- APIs de Vera / Antel usadas directamente desde el navegador (con CORS abierto) ---
  SETUP_API: 'https://veratv-be.vera.com.uy/api/setup',
  GRID_API: 'https://cds-frontend.vera.com.uy/api-contenidos/listas/234',
  GRID_HEADERS: { 'x-service-id': '3', 'x-frontend-id': '1196', 'x-system-id': '1' },
  SESSION_API: 'https://veratv-be.vera.com.uy/api/sesiones',
  DOMINIO: 'lua',

  // --- Márgenes de renovación (renovar ANTES de que expire, no cuando ya expiró) ---
  SESSION_RENEW_MARGIN_MS: 10 * 60 * 1000,   // renovar sesión 10 min antes de que venza (~cada 6-8hs)
  STREAM_RENEW_MARGIN_MS: 8 * 60 * 1000,     // renovar URL de stream 8 min antes de que venza (~cada 4hs)

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
