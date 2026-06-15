// VideoSniffer Mobile — Service Worker
// Intercepta peticiones reales de red (funciona en cel sin extensiones)

const CACHE_NAME = "vs-mobile-v1";
const VIDEO_EXTS = /\.(m3u8|mpd|mp4|webm|mkv|flv|avi|mov|ts|m4v|f4v|3gp|mpeg)(\?|$|#|\/)/i;
const IMAGE_EXTS = /\.(jpg|jpeg|png|gif|webp|avif|bmp|svg|tiff?)(\?|$|#)/i;
const API_PATS   = [/\/api\//i,/\/v\d+\//i,/graphql/i,/\.json(\?|$)/i,/\/stream\//i,
                    /\/media\//i,/\/video\//i,/\/playlist/i,/\/manifest/i,/\/segment/i,
                    /\/chunk/i,/\/hls\//i,/\/dash\//i,/\/cdn\//i,/token/i];
const SKIP_PATS  = [/favicon/i,/\.ico(\?|$)/i,/1x1/i,/pixel/i,/tracker/i,/analytics/i,
                    /\/ad\//i,/doubleclick/i,/googletagmanager/i];

// Solo interceptar, no bloquear
self.addEventListener("fetch", (event) => {
  const url  = event.request.url;
  const dest = event.request.destination; // "video","image","fetch","xmlhttprequest","document"...

  // Clasificar
  let tipo = null;
  if (VIDEO_EXTS.test(url) || dest === "video" || dest === "audio") {
    tipo = "VIDEO/STREAM";
  } else if (!SKIP_PATS.some(p => p.test(url)) &&
             (IMAGE_EXTS.test(url) || dest === "image")) {
    tipo = "IMAGE";
  } else if (!SKIP_PATS.some(p => p.test(url)) &&
             API_PATS.some(p => p.test(url)) &&
             (dest === "empty" || dest === "")) {
    tipo = "API/XHR";
  }

  if (tipo) {
    // Notificar a todos los clientes (la página principal)
    self.clients.matchAll({ includeUncontrolled: true, type: "window" })
      .then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type:    "vs_request",
            url,
            tipo,
            subtipo: dest || "fetch",
            ts:      Date.now(),
          });
        });
      });
  }

  // Dejar pasar la petición SIN modificar
  // (no usamos event.respondWith para no romper nada)
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});
