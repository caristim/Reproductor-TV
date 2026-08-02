/**
 * app.js — Antena (TV Uruguay / AntelTV)
 * Todo corre 100% en el navegador, sin backend propio.
 * Estructura: utilidades → credenciales → login OIDC/CAS → sesión → grilla → reproductor → arranque
 */

'use strict';

/* ==========================================================================
   ESTADO GLOBAL
   ========================================================================== */
const state = {
  sessionToken: null,      // token corto usado en /api-contenidos y /api/setup
  sessionJwtExp: null,     // epoch (segundos) de vencimiento de la sesión (~6-8hs)
  channels: [],            // lista de canales de la grilla
  currentChannel: null,    // canal en reproducción { publicId, nombre }
  hls: null,
  streamRetryCount: 0,
  sessionRenewTimer: null,
  streamRenewTimer: null,
  popupWin: null,
  orderMode: false,        // true mientras se está reordenando la grilla
  grabbedPublicId: null,   // canal "tomado" con teclado/control remoto, si hay
  dragCtx: null,           // info del arrastre con mouse/touch en curso
  justDragged: false,      // evita que el click sintético post-drag dispare una acción
};

const els = {}; // referencias a elementos del DOM, se completan en bootstrap()

/* ==========================================================================
   UTILIDADES
   ========================================================================== */
function $(id) { return document.getElementById(id); }

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

function parseJwtPayload(jwt) {
  try {
    const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '=='.slice(0, (4 - (b64.length % 4)) % 4);
    return JSON.parse(decodeURIComponent(escape(atob(padded))));
  } catch (e) {
    return null;
  }
}

// Intenta leer el campo "expiry" incrustado en el vxttoken de una URL de stream.
// Es un "nice to have" para programar la renovación con precisión; si no se puede
// parsear (Antel cambió el formato), usamos un intervalo fijo conservador como respaldo.
function parseStreamExpiry(streamUrl) {
  try {
    const match = streamUrl.match(/vxttoken=([^,]+),/);
    if (!match) return null;
    let b64 = match[1];
    b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
    b64 += '=='.slice(0, (4 - (b64.length % 4)) % 4);
    const decoded = decodeURIComponent(atob(b64));
    const expMatch = decoded.match(/expiry=(\d+)/);
    return expMatch ? parseInt(expMatch[1], 10) : null;
  } catch (e) {
    return null;
  }
}

function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
function b64decode(str) { return decodeURIComponent(escape(atob(str))); }

function setStatus(text, kind) {
  els.statusPill.textContent = text;
  els.statusPill.className = 'status-pill' + (kind ? ' is-' + kind : '');
}

/* ==========================================================================
   CREDENCIALES (guardadas solo en este dispositivo)
   ========================================================================== */
function getStoredCreds() {
  const usuario = localStorage.getItem(CONFIG.STORAGE_KEYS.usuario);
  const passB64 = localStorage.getItem(CONFIG.STORAGE_KEYS.password);
  if (!usuario || !passB64) return null;
  return { usuario, password: b64decode(passB64) };
}

function saveCreds(usuario, password) {
  localStorage.setItem(CONFIG.STORAGE_KEYS.usuario, usuario);
  localStorage.setItem(CONFIG.STORAGE_KEYS.password, b64encode(password));
}

function clearCreds() {
  localStorage.removeItem(CONFIG.STORAGE_KEYS.usuario);
  localStorage.removeItem(CONFIG.STORAGE_KEYS.password);
}

/* ==========================================================================
   LOGIN — flujo OIDC/CAS
   Ver README.md para la explicación completa de por qué funciona así.
   ========================================================================== */

// Paso 1: pedir la URL de "authorize". Si la sesión CAS del navegador ya está viva
// (SSO), puede volver directo con el token. Si no, devuelve los datos del form de login.
async function fetchAuthorizeState(redirectUri) {
  const state_ = randomHex(16);
  const nonce = randomHex(16);
  const qs = `client_id=${encodeURIComponent(CONFIG.CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=${encodeURIComponent('id_token token')}` +
    `&scope=openid&state=${state_}&nonce=${nonce}` +
    `&service=${encodeURIComponent(redirectUri)}`;
  const authorizeUrl = `${CONFIG.OIDC_AUTHORIZE_URL}?${qs}`;

  // Nota: no usamos credentials:'include' acá — Antel responde estos endpoints
  // con Access-Control-Allow-Origin: "*" (comodín), y los navegadores no permiten
  // combinar eso con pedidos que envían cookies. Esta primera llamada no las necesita igual.
  const res = await fetch(authorizeUrl);
  const finalUrl = res.url;

  if (finalUrl.indexOf(redirectUri) === 0) {
    // Ya había sesión CAS activa y volvimos directo con el token en el fragmento.
    return { direct: true, hash: new URL(finalUrl).hash };
  }

  const html = await res.text();
  const execMatch = html.match(/name="execution"\s+value="([^"]+)"/);
  if (!execMatch) {
    throw new Error('No se encontró el formulario de login de Antel (puede haber cambiado el sitio).');
  }
  return { direct: false, loginActionUrl: finalUrl, execution: execMatch[1] };
}

// Paso 2: enviar usuario/contraseña con una navegación real hacia un popup
// (no con fetch, porque las cookies de sesión de Antel no viajan en pedidos
// fetch entre sitios distintos — sí viajan en una navegación real).
function submitCredentialsToPopup(loginActionUrl, execution, creds) {
  const host = $('authFormHost');
  host.innerHTML = '';
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = loginActionUrl;
  form.target = 'antelAuthPopup';

  const fields = {
    username: creds.usuario,
    password: creds.password,
    execution: execution,
    _eventId: 'submit',
    geolocation: '',
  };
  for (const name in fields) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = fields[name];
    form.appendChild(input);
  }
  host.appendChild(form);
  form.submit();
}

// Orquesta el login completo. Devuelve el id_token (JWT) listo para /api/sesiones.
// gestureAllowed=true cuando se llama desde un click real del usuario.
//
// IMPORTANTE: la ventana emergente se abre ACÁ, de forma síncrona, antes de
// cualquier "await". Si se abriera después de esperar una respuesta de red,
// los navegadores dejan de asociarla con el clic del usuario y la bloquean
// en silencio — eso es lo que causaba que el login pareciera no hacer nada.
async function performLogin(gestureAllowed) {
  const creds = getStoredCreds();
  if (!creds) throw new Error('NO_CREDS');

  let popup = null;
  if (gestureAllowed) {
    popup = window.open('', 'antelAuthPopup', 'width=480,height=640,left=100,top=80');
    if (!popup) throw new Error('POPUP_BLOCKED');
    state.popupWin = popup;
  }

  const redirectUri = new URL('callback.html', document.baseURI).toString();
  const first = await fetchAuthorizeState(redirectUri);

  if (first.direct) {
    if (popup) { try { popup.close(); } catch (e) {} }
    return extractIdToken(first.hash);
  }

  if (!popup) {
    // Renovación en segundo plano sin clic reciente: no tiene sentido intentar
    // abrir un popup (se bloquearía igual) — avisamos para que un clic lo resuelva.
    throw new Error('POPUP_BLOCKED');
  }

  const tokenPromise = new Promise((resolve, reject) => {
    function onMessage(ev) {
      if (!ev.data || ev.data.source !== 'antel-callback') return;
      window.removeEventListener('message', onMessage);
      clearTimeout(timeoutId);
      resolve(ev.data.hash);
    }
    window.addEventListener('message', onMessage);

    const timeoutId = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('LOGIN_TIMEOUT'));
    }, CONFIG.LOGIN_POPUP_TIMEOUT_MS);
  });

  submitCredentialsToPopup(first.loginActionUrl, first.execution, creds);

  const hash = await tokenPromise;
  try { popup.close(); } catch (e) {}
  return extractIdToken(hash);
}

function extractIdToken(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const idToken = params.get('id_token');
  if (!idToken) throw new Error('NO_ID_TOKEN');
  return idToken;
}

/* ==========================================================================
   SESIÓN (/api/sesiones)
   ========================================================================== */
async function createSession(idToken) {
  const creds = getStoredCreds();
  const res = await fetch(CONFIG.SESSION_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usuario: creds.usuario,
      dominio: CONFIG.DOMINIO,
      tipo: 'usuario',
      autenticacion_jwt: idToken,
    }),
  });
  if (!res.ok) throw new Error('SESSION_API_' + res.status);
  const data = await res.json();

  state.sessionToken = data.token;
  const payload = parseJwtPayload(data.jwt);
  state.sessionJwtExp = payload ? payload.exp : (Math.floor(Date.now() / 1000) + 6 * 3600);

  scheduleSessionRenewal();
  return data;
}

function scheduleSessionRenewal() {
  if (state.sessionRenewTimer) clearTimeout(state.sessionRenewTimer);
  const msUntilExpiry = state.sessionJwtExp * 1000 - Date.now();
  const delay = Math.max(msUntilExpiry - CONFIG.SESSION_RENEW_MARGIN_MS, 5000);
  state.sessionRenewTimer = setTimeout(() => attemptRenewal(false), delay);
}

async function attemptRenewal(gestureAllowed) {
  try {
    setStatus('Renovando sesión…', 'warn');
    const idToken = await performLogin(gestureAllowed);
    await createSession(idToken);
    hideRenewBanner();
    setStatus('En vivo', 'live');
    // Si había un canal reproduciéndose, le pedimos una URL de stream fresca.
    if (state.currentChannel) await refreshStreamUrl();
  } catch (err) {
    console.warn('Renovación automática falló:', err);
    showRenewBanner();
  }
}

function showRenewBanner() {
  els.renewBanner.hidden = false;
  setStatus('Sesión vencida', 'error');
}
function hideRenewBanner() {
  els.renewBanner.hidden = true;
}

/* ==========================================================================
   GRILLA DE CANALES
   ========================================================================== */
async function loadGrid() {
  const res = await fetch(`${CONFIG.GRID_API}?token=${encodeURIComponent(state.sessionToken)}`);
  if (!res.ok) throw new Error('GRID_API_' + res.status);
  const data = await res.json();
  const fetched = (data.contenidos || []).map(c => ({
    publicId: c.public_id,
    nombre: c.nombre_fantasia || c.nombre,
    logo: c.imagen_horizontal || c.imagen_principal,
  }));
  state.channels = applySavedOrder(fetched);
  renderGrid();
}

// Acomoda los canales recién bajados de la API según el orden que la persona
// guardó antes en este dispositivo. Los canales nuevos que no estén en el
// orden guardado (ej: Antel agregó uno) se agregan al final.
function applySavedOrder(channels) {
  const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.order);
  if (!raw) return channels;
  let savedIds;
  try { savedIds = JSON.parse(raw); } catch (e) { return channels; }
  const rank = new Map(savedIds.map((id, i) => [id, i]));
  return channels.slice().sort((a, b) => {
    const ra = rank.has(a.publicId) ? rank.get(a.publicId) : Infinity;
    const rb = rank.has(b.publicId) ? rank.get(b.publicId) : Infinity;
    return ra - rb;
  });
}

function saveChannelOrder() {
  localStorage.setItem(CONFIG.STORAGE_KEYS.order, JSON.stringify(state.channels.map(c => c.publicId)));
}

function renderGrid() {
  const grid = els.channelGrid;
  grid.innerHTML = '';
  grid.classList.toggle('order-mode', state.orderMode);

  state.channels.forEach((ch) => {
    const card = document.createElement('button');
    card.className = 'channel-card';
    card.type = 'button';
    card.setAttribute('role', 'listitem');
    card.dataset.publicId = ch.publicId;
    if (state.grabbedPublicId === ch.publicId) card.classList.add('is-grabbed');
    card.innerHTML = `
      <img class="channel-card-logo" src="${ch.logo}" alt="" loading="lazy">
      <span class="channel-card-name">${ch.nombre}</span>
    `;

    card.addEventListener('click', () => {
      if (state.orderMode) {
        if (state.justDragged) { state.justDragged = false; return; }
        toggleGrab(card, ch);
        return;
      }
      playChannel(ch);
    });

    enableCardDrag(card);
    grid.appendChild(card);
  });

  if (state.grabbedPublicId) {
    const focused = grid.querySelector(`[data-public-id="${cssEscape(state.grabbedPublicId)}"]`);
    if (focused) focused.focus();
  }
}

function cssEscape(str) {
  return window.CSS && CSS.escape ? CSS.escape(str) : str.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

/* ---- Toggle del modo "Organizar orden" ---- */
function toggleOrderMode() {
  state.orderMode = !state.orderMode;
  state.grabbedPublicId = null;
  els.orderModeBtn.textContent = state.orderMode ? 'Listo' : 'Organizar orden';
  els.orderModeBtn.classList.toggle('is-active', state.orderMode);
  els.orderModeHint.hidden = !state.orderMode;
  renderGrid();
}

/* ---- "Tomar y mover" con teclado / control remoto ---- */
function toggleGrab(card, ch) {
  if (state.grabbedPublicId === ch.publicId) {
    state.grabbedPublicId = null;
    saveChannelOrder();
  } else {
    state.grabbedPublicId = ch.publicId;
  }
  renderGrid();
}

function getColumnCount() {
  const cards = Array.from(els.channelGrid.children);
  if (cards.length < 2) return 1;
  const firstTop = cards[0].offsetTop;
  let count = 0;
  for (const c of cards) {
    if (c.offsetTop === firstTop) count++; else break;
  }
  return count || 1;
}

function moveGrabbedChannel(key) {
  const idx = state.channels.findIndex(c => c.publicId === state.grabbedPublicId);
  if (idx === -1) return;
  const cols = getColumnCount();
  let delta = 0;
  if (key === 'ArrowLeft') delta = -1;
  else if (key === 'ArrowRight') delta = 1;
  else if (key === 'ArrowUp') delta = -cols;
  else if (key === 'ArrowDown') delta = cols;
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= state.channels.length) return;
  const [item] = state.channels.splice(idx, 1);
  state.channels.splice(newIdx, 0, item);
  saveChannelOrder();
  renderGrid();
}

/* ---- Arrastre con mouse / touch (reordena en vivo mientras se arrastra) ---- */
function enableCardDrag(card) {
  card.addEventListener('pointerdown', (e) => {
    if (!state.orderMode) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    card.setPointerCapture(e.pointerId);
    state.dragCtx = { pointerId: e.pointerId, el: card, startX: e.clientX, startY: e.clientY, moved: false };
  });

  card.addEventListener('pointermove', (e) => {
    const ctx = state.dragCtx;
    if (!ctx || ctx.pointerId !== e.pointerId || ctx.el !== card) return;
    if (!ctx.moved) {
      const dist = Math.hypot(e.clientX - ctx.startX, e.clientY - ctx.startY);
      if (dist < 6) return;
      ctx.moved = true;
      card.classList.add('is-dragging');
    }
    card.style.pointerEvents = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    card.style.pointerEvents = '';
    const targetCard = under && under.closest ? under.closest('.channel-card') : null;
    if (!targetCard || targetCard === card || !els.channelGrid.contains(targetCard)) return;

    const fromId = card.dataset.publicId;
    const toId = targetCard.dataset.publicId;
    const fromIdx = state.channels.findIndex(c => c.publicId === fromId);
    const toIdx = state.channels.findIndex(c => c.publicId === toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [item] = state.channels.splice(fromIdx, 1);
    state.channels.splice(toIdx, 0, item);

    // Reordenar el DOM en vivo, sin reconstruir todas las tarjetas (así no se
    // pierde el "pointer capture" que mantiene el arrastre activo).
    if (fromIdx < toIdx) els.channelGrid.insertBefore(card, targetCard.nextSibling);
    else els.channelGrid.insertBefore(card, targetCard);
  });

  function endDrag(e) {
    const ctx = state.dragCtx;
    if (!ctx || ctx.pointerId !== e.pointerId || ctx.el !== card) return;
    card.classList.remove('is-dragging');
    if (ctx.moved) {
      state.justDragged = true;
      saveChannelOrder();
    }
    state.dragCtx = null;
  }
  card.addEventListener('pointerup', endDrag);
  card.addEventListener('pointercancel', endDrag);
}

/* Navegación espacial con flechas del control remoto / teclado sobre la grilla */
function setupGridKeyboardNav() {
  els.orderModeBtn.addEventListener('click', toggleOrderMode);

  els.channelGrid.addEventListener('keydown', (e) => {
    const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (arrowKeys.indexOf(e.key) === -1) return;

    if (state.orderMode && state.grabbedPublicId) {
      e.preventDefault();
      moveGrabbedChannel(e.key);
      return;
    }

    const cards = Array.from(els.channelGrid.querySelectorAll('.channel-card'));
    const current = document.activeElement;
    const idx = cards.indexOf(current);
    if (idx === -1) return;
    e.preventDefault();

    const currentRect = cards[idx].getBoundingClientRect();
    let best = null, bestDist = Infinity;

    cards.forEach((card, i) => {
      if (i === idx) return;
      const r = card.getBoundingClientRect();
      const dx = (r.left + r.width / 2) - (currentRect.left + currentRect.width / 2);
      const dy = (r.top + r.height / 2) - (currentRect.top + currentRect.height / 2);
      let valid = false;
      if (e.key === 'ArrowRight' && dx > 4) valid = true;
      if (e.key === 'ArrowLeft' && dx < -4) valid = true;
      if (e.key === 'ArrowDown' && dy > 4) valid = true;
      if (e.key === 'ArrowUp' && dy < -4) valid = true;
      if (!valid) return;
      const dist = Math.abs(dx) + Math.abs(dy) * 1.4;
      if (dist < bestDist) { bestDist = dist; best = card; }
    });
    if (best) best.focus();
  });
}

/* ==========================================================================
   REPRODUCTOR
   ========================================================================== */
async function playChannel(ch) {
  state.currentChannel = ch;
  state.streamRetryCount = 0;
  showScreen('player');
  els.playerChannelName.textContent = ch.nombre;
  showPlayerLoading('Sintonizando…');
  hidePlayerError();

  try {
    await refreshStreamUrl();
  } catch (err) {
    console.error(err);
    showPlayerError('No se pudo cargar este canal. Puede que la sesión haya vencido.');
  }
}

async function fetchStreamUrl(publicId) {
  const url = `${CONFIG.SETUP_API}?token=${encodeURIComponent(state.sessionToken)}&public_id=${encodeURIComponent(publicId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('SETUP_API_' + res.status);
  const data = await res.json();
  const primary = data.url && data.url.suggested && data.url.suggested.url;
  const backup = data.url_backup && data.url_backup.suggested && data.url_backup.suggested.url;
  if (!primary && !backup) throw new Error('NO_STREAM_URL');
  return primary || backup;
}

async function refreshStreamUrl() {
  if (!state.currentChannel) return;
  const streamUrl = await fetchStreamUrl(state.currentChannel.publicId);
  loadIntoPlayer(streamUrl);
  scheduleStreamRenewal(streamUrl);
}

function loadIntoPlayer(streamUrl) {
  const video = els.videoPlayer;

  if (state.hls) { state.hls.destroy(); state.hls = null; }

  if (window.Hls && Hls.isSupported()) {
    const hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30, maxBufferLength: 30 });
    state.hls = hls;
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      hidePlayerLoading();
      video.play().catch(() => {});
    });
    hls.on(Hls.Events.ERROR, (evt, data) => {
      if (!data.fatal) return;
      console.warn('Error fatal de HLS:', data.type);
      if (state.streamRetryCount < CONFIG.MAX_STREAM_RETRY) {
        state.streamRetryCount++;
        showPlayerLoading('Reconectando…');
        refreshStreamUrl().catch(() => showPlayerError('Se perdió la señal de este canal.'));
      } else {
        showPlayerError('Se perdió la señal de este canal.');
      }
    });
    hls.loadSource(streamUrl);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = streamUrl;
    video.addEventListener('loadedmetadata', hidePlayerLoading, { once: true });
  } else {
    showPlayerError('Este navegador no soporta reproducción HLS.');
  }
}

function scheduleStreamRenewal(streamUrl) {
  if (state.streamRenewTimer) clearTimeout(state.streamRenewTimer);
  const expiry = parseStreamExpiry(streamUrl);
  let delay;
  if (expiry) {
    delay = Math.max(expiry * 1000 - Date.now() - CONFIG.STREAM_RENEW_MARGIN_MS, 60000);
  } else {
    delay = 3.5 * 60 * 60 * 1000; // respaldo fijo si no se pudo leer el vencimiento real
  }
  state.streamRenewTimer = setTimeout(() => {
    refreshStreamUrl().catch(err => console.warn('No se pudo renovar el stream:', err));
  }, delay);
}

function stopPlayback() {
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  if (state.streamRenewTimer) { clearTimeout(state.streamRenewTimer); state.streamRenewTimer = null; }
  els.videoPlayer.pause();
  els.videoPlayer.removeAttribute('src');
  els.videoPlayer.load();
  state.currentChannel = null;
}

function showPlayerLoading(text) {
  els.loadingText.textContent = text || 'Cargando…';
  els.loadingOverlay.classList.add('active');
}
function hidePlayerLoading() { els.loadingOverlay.classList.remove('active'); }
function showPlayerError(text) {
  hidePlayerLoading();
  els.playerErrorText.textContent = text;
  els.playerErrorOverlay.hidden = false;
}
function hidePlayerError() { els.playerErrorOverlay.hidden = true; }

/* ==========================================================================
   NAVEGACIÓN ENTRE PANTALLAS
   ========================================================================== */
function showScreen(name) {
  els.gateScreen.hidden = name !== 'gate';
  els.gridScreen.hidden = name !== 'grid';
  els.playerScreen.hidden = name !== 'player';
}

/* ==========================================================================
   ARRANQUE
   ========================================================================== */
async function bootstrapSession(gestureAllowed) {
  setStatus('Conectando…', 'warn');
  try {
    const idToken = await performLogin(gestureAllowed);
    await createSession(idToken);
    setStatus('En vivo', 'live');
    await loadGrid();
    showScreen('grid');
    els.resetBtn.hidden = false;
  } catch (err) {
    console.error('Error al conectar:', err);
    if (err.message === 'POPUP_BLOCKED') {
      if (gestureAllowed) {
        showGateMessage('El navegador bloqueó la ventana de inicio de sesión. Permití ventanas emergentes para este sitio y volvé a intentar.');
      }
      // Si no hubo clic (arranque automático de la página), no mostramos error:
      // el botón "Conectar" de abajo ya resuelve esto con un solo toque.
    } else {
      showGateMessage('No se pudo conectar. Revisá tu usuario/contraseña e intentá de nuevo.');
    }
    showScreen('gate');
    renderGateForCreds();
  }
}

function showGateMessage(msg) {
  els.gateError.textContent = msg;
  els.gateError.hidden = false;
}

// Si ya hay credenciales guardadas, mostramos un botón simple de 1 clic
// en vez del formulario completo (evita reescribir usuario/contraseña).
function renderGateForCreds() {
  const creds = getStoredCreds();
  if (!creds) return;
  $('gateForm').hidden = true;
  let btn = $('gateConnectBtn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'gateConnectBtn';
    btn.className = 'btn-primary btn-block';
    btn.textContent = 'Conectar con ' + creds.usuario;
    btn.style.marginTop = '18px';
    btn.addEventListener('click', () => { els.gateError.hidden = true; bootstrapSession(true); });
    $('gateForm').insertAdjacentElement('afterend', btn);
  }
}

function bootstrap() {
  [
    'clock', 'statusPill', 'resetBtn', 'renewBanner', 'renewBtn',
    'gateScreen', 'gateForm', 'gateUser', 'gatePass', 'gateError',
    'gridScreen', 'channelGrid', 'gridEmpty', 'retryGridBtn', 'orderModeBtn', 'orderModeHint',
    'playerScreen', 'backBtn', 'playerChannelName', 'videoPlayer',
    'loadingOverlay', 'loadingText', 'playerErrorOverlay', 'playerErrorText', 'playerRetryBtn',
  ].forEach(id => { els[id] = $(id); });

  // Reloj
  setInterval(() => {
    els.clock.textContent = new Date().toLocaleTimeString('es-UY', { hour12: false });
  }, 1000);

  // Formulario de credenciales (primera vez) — esto SÍ es un clic real, popup permitido.
  els.gateForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveCreds(els.gateUser.value.trim(), els.gatePass.value);
    els.gateError.hidden = true;
    bootstrapSession(true);
  });

  els.renewBtn.addEventListener('click', () => { hideRenewBanner(); attemptRenewal(true); });

  els.resetBtn.addEventListener('click', () => {
    if (!confirm('¿Olvidar la cuenta guardada en este dispositivo?')) return;
    clearCreds();
    location.reload();
  });

  els.backBtn.addEventListener('click', () => { stopPlayback(); showScreen('grid'); });
  els.playerRetryBtn.addEventListener('click', () => {
    hidePlayerError();
    if (state.currentChannel) playChannel(state.currentChannel);
  });
  els.retryGridBtn.addEventListener('click', () => {
    els.gridEmpty.hidden = true;
    loadGrid().catch(() => { els.gridEmpty.hidden = false; });
  });

  setupGridKeyboardNav();

  // Arranque automático: NO es un clic real, así que si hace falta un popup para
  // loguear va a bloquearse — en ese caso queda listo el botón de 1 clic en la
  // pantalla de acceso (ver renderGateForCreds), sin mostrar ningún error confuso.
  const creds = getStoredCreds();
  if (creds) {
    bootstrapSession(false);
  } else {
    showScreen('gate');
  }
}

document.addEventListener('DOMContentLoaded', bootstrap);
