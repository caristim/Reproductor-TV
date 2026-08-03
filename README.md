# Reproductor TV

Web app personal para ver la grilla de canales con login y renovación de sesión automáticos. Corre 100% en el navegador, pensada para Windows + Edge, smartphone y TV Box Android.

## ⚠️ Antes de usarla

- Tu cuenta puede tener un límite de dispositivos/reproducciones simultáneas. Usar la app en más de un dispositivo *a la vez* podría dar error — usarla de a uno por vez no debería tener problema.
La primera vez, ingresá tu usuario y contraseña — quedan guardados en ese dispositivo/navegador para las próximas veces.
Repetí el paso en cada dispositivo (Windows/Edge, celular, TV Box) — las credenciales se guardan por separado en cada uno.

## Cómo funciona (resumen técnico)

1. **Login:** La app arma automáticamente el pedido de autorización y, si hace falta, envía tu usuario/contraseña mediante una ventana emergente que se abre y cierra sola (necesario porque las cookies de sesión no viajan en pedidos `fetch` comunes entre sitios distintos — sí viajan en una navegación real de ventana).
2. **Sesión:** con el token obtenido, se llama a `/api/sesiones, que devuelve un token corto de sesión válido varias horas.
3. **Grilla:** se piden los canales a `/api-contenidos/listas/234` con ese token.
4. **Reproducción:** al hacer click en un canal, se pide su URL de video a `/api/setup`, que devuelve un `.m3u8` con un token de acceso al video (dura unas horas).
5. **Renovación:** la app calcula cuándo vencen ambos tokens (sesión y stream) y los renueva sola, unos minutos antes de que venzan, sin cortar la reproducción.

## Sobre el login automático (importante)

Por cómo funcionan los navegadores modernos, **abrir una ventana emergente automáticamente sin que la persona haya hecho clic en algo puede ser bloqueado** por el navegador. La app está armada así:

- **Primera vez / al volver a abrir la app:** intenta conectar sola. Si el navegador bloquea la ventana emergente, aparece un botón "Conectar" — un solo clic (no hay que volver a escribir usuario/contraseña).
- **Mientras estás mirando un canal, cada ~6-8hs:** la app intenta renovar la sesión en segundo plano sin ninguna interacción tuya. Si el navegador la bloquea (puede pasar, varía según el dispositivo/navegador), aparece un aviso arriba de la pantalla con un botón "Renovar sesión" — un clic y listo, sin cortar mucho tiempo la reproducción.

Esto es la mejor combinación posible entre "automático" y "confiable en cualquier dispositivo" dada esta restricción de los navegadores — no hay forma de evitarla del todo sin instalar algo adicional (como una extensión de navegador), que fue justamente lo que se quiso evitar.

## Reordenar los canales

Arriba de la grilla hay un botón **"Organizar orden"**:

- **Mouse / touch:** con el modo activado, arrastrá cualquier tarjeta a su nueva posición.
- **Control remoto / teclado:** enfocá una tarjeta y apretá **Enter/OK** para "tomarla" (se resalta), usá las **flechas** para moverla, y **Enter/OK** de nuevo para "soltarla".

El orden se guarda automáticamente en cada dispositivo (localStorage) — si usás la app en Windows, celular y TV Box, podés (y probablemente quieras) ordenar los canales por separado en cada uno, ya que no hay una cuenta en la nube que sincronice esto entre dispositivos.

## Editar / actualizar la app

- **Colores y tipografía:** todo está centralizado en las variables al inicio de `style.css` (`:root { ... }`).
- **Endpoints:** si algo deja de funcionar porque cambió una URL, revisar `config.js` primero.
- **Lógica:** `app.js` está dividido por secciones con comentarios (utilidades, credenciales, login, sesión, grilla, reproductor, arranque).

## Si algo deja de andar

- **La grilla no carga / da error de sesión:** probablemente cambió algo en su sitio. Repetir el proceso de captura de HAR (Network → clic derecho → "Save all as HAR with content") y comparar los endpoints en `config.js`.
- **Un canal no reproduce pero otros sí:** puede ser que ese canal específico esté caído, no de la app.
- **Nunca conecta y siempre pide clic manual:** el navegador/dispositivo está bloqueando las ventanas emergentes de forma más estricta. Revisar la configuración de "ventanas emergentes" del navegador para este sitio y permitirlas.
