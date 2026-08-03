/**
 * api/login.js — Vercel Serverless Function
 *
 * Hace TODO el proceso de login contra Antel del lado del servidor (no en el
 * navegador de la persona), porque los navegadores no dejan que un sitio web
 * lea el contenido de una ventana de otro sitio (por seguridad). Un servidor
 * no tiene esa restricción: puede hacer los mismos pedidos HTTP que hace un
 * navegador real, paso a paso, y quedarse con el resultado final.
 *
 * Recibe:  POST { usuario, password }
 * Devuelve: { id_token, usuario, dominio } (para que el cliente cree la sesión)
 *
 * No guarda ni loguea la contraseña en ningún lado — solo la reenvía a Antel.
 */

const CLIENT_ID = 'veratv-beta';
const REDIRECT_URI = 'https://tv.vera.com.uy/';
const OIDC_AUTHORIZE_URL = 'https://login.vera.com.uy/oidc/authorize';
const DOMINIO = 'lua';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const { usuario, password } = req.body || {};
  if (!usuario || !password) {
    res.status(400).json({ error: 'missing_credentials' });
    return;
  }

  const jar = new CookieJar();

  try {
    // --- Paso 1: pedir autorización OIDC. Como todavía no hay sesión, CAS
    // redirige a su formulario de login. ---
    const authorizeUrl = buildAuthorizeUrl();
    const step1 = await jar.fetch(authorizeUrl);
    assertRedirect(step1, 'PASO_1_AUTHORIZE');
    const loginPageUrl = step1.headers.get('location');

    // --- Paso 2: bajar el formulario de login y leer sus campos ocultos ---
    const step2 = await jar.fetch(loginPageUrl);
    if (step2.status !== 200) throw new AppError('PASO_2_LOGIN_PAGE', `status ${step2.status}`);
    const html = await step2.text();
    const hiddenFields = parseHiddenFields(html);
    if (!hiddenFields.execution) {
      throw new AppError('PASO_2_SIN_EXECUTION', 'no se encontró el campo "execution" en el formulario (¿cambió el sitio de Antel?)');
    }

    // --- Paso 3: enviar usuario/contraseña ---
    // Se postea a la MISMA url del formulario (confirmado con datos reales:
    // en la captura de red real, el POST fue a idéntica URL que el GET del paso 2).
    const body = new URLSearchParams({
      ...hiddenFields,
      username: usuario,
      password: password,
      _eventId: hiddenFields._eventId || 'submit',
      geolocation: hiddenFields.geolocation || '',
    });
    const step3 = await jar.fetch(loginPageUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    assertRedirect(step3, 'PASO_3_CREDENCIALES (revisá usuario/contraseña)');
    const ticketUrl = step3.headers.get('location');

    // --- Paso 4: validar el ticket CAS ---
    const step4 = await jar.fetch(ticketUrl);
    assertRedirect(step4, 'PASO_4_TICKET');
    const backToOidcUrl = step4.headers.get('location');

    // --- Paso 5: volver a pedir autorización OIDC, ahora ya autenticado ---
    const step5 = await jar.fetch(backToOidcUrl);
    assertRedirect(step5, 'PASO_5_OIDC_FINAL');
    const finalUrl = step5.headers.get('location');

    // --- Extraer el id_token del fragmento de la URL final ---
    const idToken = extractIdToken(finalUrl);
    if (!idToken) throw new AppError('PASO_5_SIN_TOKEN', `no se encontró id_token en: ${finalUrl}`);

    // Devolvemos id_token, usuario y dominio para que el navegador cree la sesión.
    res.status(200).json({
      id_token: idToken,
      usuario: usuario,
      dominio: DOMINIO
    });
  } catch (err) {
    console.error('Login falló en', err.step || 'paso desconocido', '-', err.message);
    res.status(502).json({ error: 'login_failed', step: err.step || null, detail: err.message });
  }
};

/* ==================== utilidades ==================== */

class AppError extends Error {
  constructor(step, message) { super(message); this.step = step; }
}

function assertRedirect(response, step) {
  if (response.status < 300 || response.status >= 400 || !response.headers.get('location')) {
    throw new AppError(step, `se esperaba una redirección y llegó status ${response.status}`);
  }
}

function buildAuthorizeUrl() {
  const state = randomHex(16);
  const nonce = randomHex(16);
  const qs = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'id_token token',
    scope: 'openid',
    state,
    nonce,
    service: REDIRECT_URI,
  });
  return `${OIDC_AUTHORIZE_URL}?${qs.toString()}`;
}

function randomHex(bytes) {
  const crypto = require('crypto');
  return crypto.randomBytes(bytes).toString('hex');
}

// Busca TODOS los campos ocultos (<input type="hidden">) en toda la página,
// sin depender de encontrar los límites exactos del <form> (más resistente
// a variaciones de formato de HTML entre distintos temas de CAS).
function parseHiddenFields(html) {
  const hiddenFields = {};
  const inputRe = /<input\b[^>]*>/gi;
  let m;
  while ((m = inputRe.exec(html))) {
    const tag = m[0];
    if (!/type\s*=\s*"hidden"/i.test(tag)) continue;
    const nameMatch = tag.match(/name\s*=\s*"([^"]+)"/i);
    const valueMatch = tag.match(/value\s*=\s*"([^"]*)"/i);
    if (nameMatch) hiddenFields[nameMatch[1]] = valueMatch ? valueMatch[1].replace(/&amp;/g, '&') : '';
  }
  return hiddenFields;
}

function extractIdToken(url) {
  const hashIdx = url.indexOf('#');
  if (hashIdx === -1) return null;
  const params = new URLSearchParams(url.slice(hashIdx + 1));
  return params.get('id_token');
}

// Cookie jar simple: guarda cookies entre pedidos y las reenvía, siguiendo
// redirecciones a mano (necesario para leer el header Location de cada salto).
class CookieJar {
  constructor() { this.cookies = new Map(); }

  header() {
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  store(response) {
    const setCookie = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : (response.headers.raw ? response.headers.raw()['set-cookie'] || [] : []);
    for (const c of setCookie) {
      const pair = c.split(';')[0];
      const idx = pair.indexOf('=');
      if (idx > -1) this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  async fetch(url, opts = {}) {
    const response = await fetch(url, {
      ...opts,
      redirect: 'manual',
      headers: { ...(opts.headers || {}), Cookie: this.header(), 'User-Agent': UA },
    });
    this.store(response);
    return response;
  }
}
