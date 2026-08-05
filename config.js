const CONFIG = {
  LOGIN_API: '/api/login',
  SETUP_API: 'https://veratv-be.vera.com.uy/api/setup',
  GRID_API: 'https://cds-frontend.vera.com.uy/api-contenidos/listas/234',
  GRID_HEADERS: { 'x-service-id': '3', 'x-frontend-id': '1196', 'x-system-id': '1' },
  SESSION_API: 'https://veratv-be.vera.com.uy/api/sesiones',
  DOMINIO: 'lua',
  SESSION_RENEW_MARGIN_MS: 10 * 60 * 1000,
  STREAM_RENEW_MARGIN_MS: 8 * 60 * 1000,
  MAX_STREAM_RETRY: 3,
  STORAGE_KEYS: {
    usuario: 'antel_usuario',
    password: 'antel_password_b64',
    lastChannel: 'antel_ultimo_canal',
    order: 'antel_orden_canales',
  },
};
