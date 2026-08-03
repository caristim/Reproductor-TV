/**
 * config.js
 * Constantes de la integración con el proveedor de streaming.
 * Si el proveedor cambia alguna URL en el futuro, es acá donde hay que corregirla.
 */
const CONFIG = {
  // --- Nuestra función de login (Vercel) — hace el login del lado del servidor ---
  LOGIN_API: '/api/login',

  // --- APIs del proveedor usadas directamente desde el navegador (con CORS abierto) ---
  SETUP_API: 'https://veratv-be.vera.com.uy/api/setup',
  GRID_API: 'https://cds-frontend.vera.com.uy/api-contenidos/listas/68',
  GRID_HEADERS: { 'x-service-id': '3', 'x-frontend-id': '1196', 'x-system-id': '1' },

  // --- API para crear sesión (se llama desde el navegador) ---
  SESSION_API: 'https://veratv-be.vera.com.uy/api/sesiones',
  DOMINIO: 'lua',          // valor fijo (si tu usuario es de otro dominio, cámbialo)

  // --- Márgenes de renovación (renovar ANTES de que expire, no cuando ya expiró) ---
  SESSION_RENEW_MARGIN_MS: 10 * 60 * 1000,   // renovar sesión 10 min antes de que venza (~cada 6-8hs)
  STREAM_RENEW_MARGIN_MS: 8 * 60 * 1000,     // renovar URL de stream 8 min antes de que venza (~cada 4hs)

  // --- Reintentos ---
  MAX_STREAM_RETRY: 3,

  // --- Almacenamiento local ---
  STORAGE_KEYS: {
    usuario: 'tv_usuario',
    password: 'tv_password_b64',
    lastChannel: 'tv_ultimo_canal',
    order: 'tv_orden_canales',
  },
};
