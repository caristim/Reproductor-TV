# Antena — TV Uruguay / AntelTV

Web app personal para ver la grilla de canales de AntelTV con login y renovación de sesión automáticos. Corre 100% en el navegador (sin backend propio), pensada para Windows + Edge, smartphone y TV Box Android.

## ⚠️ Antes de usarla

- **Cambiá tu contraseña de Antel** si en algún momento la compartiste en texto plano con otra persona/IA/chat. La app en sí nunca la envía a ningún servidor propio, pero es buena práctica.
- La contraseña se guarda **solo en el dispositivo** (localStorage del navegador), en base64 — esto es una ofuscación básica, **no es cifrado real**. No uses esta app en un dispositivo compartido o público sin tenerlo en cuenta.
- Tu cuenta de Antel puede tener un límite de dispositivos/reproducciones simultáneas. Usar la app en más de un dispositivo *a la vez* podría dar error — usarla de a uno por vez no debería tener problema.

## Cómo publicarla en GitHub Pages

1. Creá un repositorio nuevo en GitHub (puede ser privado).
2. Subí estos archivos a la raíz del repo: `index.html`, `style.css`, `app.js`, `config.js`, `callback.html`.
3. En el repo → **Settings → Pages** → en "Source" elegí la rama `main` y carpeta `/ (root)` → Guardar.
4. Esperá 1-2 minutos y entrá a la URL que te da GitHub (`https://tu-usuario.github.io/tu-repo/`).
5. La primera vez, ingresá tu usuario y contraseña de Antel — quedan guardados en ese dispositivo/navegador para las próximas veces.

Repetí el paso 4 en cada dispositivo (Windows/Edge, celular, TV Box) — las credenciales se guardan por separado en cada uno.

## Cómo funciona (resumen técnico)

1. **Login:** Antel usa un sistema de identidad tipo CAS/OIDC (`login.vera.com.uy`). La app arma automáticamente el pedido de autorización y, si hace falta, envía tu usuario/contraseña mediante una ventana emergente que se abre y cierra sola (necesario porque las cookies de sesión de Antel no viajan en pedidos `fetch` comunes entre sitios distintos — sí viajan en una navegación real de ventana).
2. **Sesión:** con el token obtenido, se llama a `/api/sesiones` de Antel, que devuelve un token corto de sesión válido varias horas.
3. **Grilla:** se piden los canales a `/api-contenidos/listas/234` con ese token.
4. **Reproducción:** al hacer click en un canal, se pide su URL de video a `/api/setup`, que devuelve un `.m3u8` con un token de acceso al video (dura unas horas).
5. **Renovación:** la app calcula cuándo vencen ambos tokens (sesión y stream) y los renueva sola, unos minutos antes de que venzan, sin cortar la reproducción.

## Sobre el login automático (importante)

Por cómo funcionan los navegadores modernos, **abrir una ventana emergente automáticamente sin que la persona haya hecho clic en algo puede ser bloqueado** por el navegador. La app está armada así:

- **Primera vez / al volver a abrir la app:** intenta conectar sola. Si el navegador bloquea la ventana emergente, aparece un botón "Conectar" — un solo clic (no hay que volver a escribir usuario/contraseña).
- **Mientras estás mirando un canal, cada ~6-8hs:** la app intenta renovar la sesión en segundo plano sin ninguna interacción tuya. Si el navegador la bloquea (puede pasar, varía según el dispositivo/navegador), aparece un aviso arriba de la pantalla con un botón "Renovar sesión" — un clic y listo, sin cortar mucho tiempo la reproducción.

Esto es la mejor combinación posible entre "automático" y "confiable en cualquier dispositivo" dada esta restricción de los navegadores — no hay forma de evitarla del todo sin instalar algo adicional (como una extensión de navegador), que fue justamente lo que se quiso evitar.

## Editar / actualizar la app

- **Colores y tipografía:** todo está centralizado en las variables al inicio de `style.css` (`:root { ... }`).
- **Endpoints de Antel:** si algo deja de funcionar porque Antel cambió una URL, revisar `config.js` primero.
- **Lógica:** `app.js` está dividido por secciones con comentarios (utilidades, credenciales, login, sesión, grilla, reproductor, arranque).

## Si algo deja de andar

- **La grilla no carga / da error de sesión:** probablemente Antel cambió algo en su sitio. Repetir el proceso de captura de HAR (Network → clic derecho → "Save all as HAR with content") y comparar los endpoints en `config.js`.
- **Un canal no reproduce pero otros sí:** puede ser que ese canal específico esté caído del lado de Antel, no de la app.
- **Nunca conecta y siempre pide clic manual:** el navegador/dispositivo está bloqueando las ventanas emergentes de forma más estricta. Revisar la configuración de "ventanas emergentes" del navegador para este sitio y permitirlas.
