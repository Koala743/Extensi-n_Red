if (!global._capturas)   global._capturas  = [];
if (!global._maxItems)   global._maxItems  = 500;
if (!global._sessionId)  global._sessionId = generateSessionId();

function generateSessionId() {
  return "sess_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return "desconocido"; }
}

function sanitizeString(val, max = 2048) {
  if (typeof val !== "string") return "";
  return val.slice(0, max).replace(/[<>"'`]/g, "");
}

function detectarMediaPorMime(mime = "") {
  const m = mime.toLowerCase();
  if (["video/mp4","video/webm","video/ogg","application/x-mpegurl",
       "video/mp2t","video/vnd.mpeg.dash.mpd","application/vnd.apple.mpegurl",
       "application/dash+xml"].some(v => m.includes(v))) return "VIDEO";
  if (["image/jpeg","image/png","image/webp","image/gif","image/svg+xml","image/avif"].some(v => m.includes(v))) return "IMAGEN";
  return null;
}

function detectarMediaPorExtension(url = "") {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const ext  = path.split(".").pop().split("?")[0];
    if (["mp4","webm","ogg","mkv","avi","mov","m4v","3gp","flv"].includes(ext)) return "VIDEO_MP4";
    if (["m3u8","m3u"].includes(ext)) return "VIDEO_HLS";
    if (ext === "ts")                 return "VIDEO_TS";
    if (ext === "mpd")                return "VIDEO_DASH";
    if (["jpg","jpeg","png","webp","gif","svg","avif","ico"].includes(ext)) return "IMAGEN";
  } catch {}
  return null;
}

async function detectarMediaPorContenido(url) {
  try {
    const resp = await fetch(url, {
      headers: { Range: "bytes=0-188" },
      signal:  AbortSignal.timeout(4000),
    });
    if (!resp.ok) return null;

    const b = new Uint8Array(await resp.arrayBuffer());

    // MP4 / ftyp box
    if (b[4]===0x66&&b[5]===0x74&&b[6]===0x79&&b[7]===0x70) return "VIDEO_MP4";
    // WebM
    if (b[0]===0x1A&&b[1]===0x45&&b[2]===0xDF&&b[3]===0xA3) return "VIDEO_WEBM";
    // Ogg
    if (b[0]===0x4F&&b[1]===0x67&&b[2]===0x67&&b[3]===0x53) return "VIDEO_OGG";
    // MPEG-TS: sync byte 0x47 cada 188 bytes
    if (b[0]===0x47 && (b[188]===0x47 || b.length<188)) return "VIDEO_TS";
    // HLS playlist texto
    const txt = new TextDecoder().decode(b.slice(0,20));
    if (txt.startsWith("#EXTM3U")) return "VIDEO_HLS";
    // JPEG
    if (b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF) return "IMAGEN_JPEG";
    // PNG
    if (b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47) return "IMAGEN_PNG";
    // GIF
    if (b[0]===0x47&&b[1]===0x49&&b[2]===0x46&&b[3]===0x38) return "IMAGEN_GIF";
    // WebP
    if (b[0]===0x52&&b[1]===0x49&&b[2]===0x46&&b[3]===0x46&&
        b[8]===0x57&&b[9]===0x45&&b[10]===0x42&&b[11]===0x50) return "IMAGEN_WEBP";
    return null;
  } catch { return null; }
}

function esInteresante(item) {
  if (item.status >= 400)                                    return true;
  if (item.metodo === "POST" && item.mime?.includes("json")) return true;
  if (item.size_bytes > 5 * 1024 * 1024)                    return true;
  if (item.duration_ms > 3000)                               return true;
  if (item.media_tipo)                                       return true;
  return false;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("X-Content-Type-Options",       "nosniff");
  res.setHeader("X-Frame-Options",              "DENY");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "POST") {
    const body = req.body;
    if (!body?.url) return res.status(400).json({ error: "Falta url" });

    let url;
    try { url = new URL(body.url).toString(); } catch {
      return res.status(400).json({ error: "URL inválida" });
    }

    const media_tipo =
      detectarMediaPorMime(body.mime) ||
      detectarMediaPorExtension(url)  ||
      (await detectarMediaPorContenido(url));

    const item = {
      id:          Date.now() + Math.random().toString(36).slice(2),
      url:         sanitizeString(url),
      tipo:        sanitizeString(body.tipo      || "DESCONOCIDO", 64),
      subtipo:     sanitizeString(body.subtipo   || "", 64),
      metodo:      sanitizeString(body.metodo    || "GET", 10),
      mime:        sanitizeString(body.mime      || "", 128),
      status:      Number(body.status)  || 0,
      tab_url:     sanitizeString(body.tab_url   || "", 2048),
      tab_title:   sanitizeString(body.tab_title || "", 256),
      origen:      sanitizeString(body.origen    || "", 256),
      ts:          Date.now(),
      duration_ms: Number(body.duration_ms) || null,
      size_bytes:  Number(body.size_bytes)  || null,
      dominio:     extractDomain(url),
      session_id:  global._sessionId,
      media_tipo,
      count:       1,
    };

    const duplicado = global._capturas.find(
      i => i.url === item.url && i.tipo === item.tipo && i.session_id === item.session_id
    );

    if (duplicado) {
      duplicado.count++;
      duplicado.ts          = item.ts;
      duplicado.duration_ms = item.duration_ms ?? duplicado.duration_ms;
      duplicado.size_bytes  = item.size_bytes  ?? duplicado.size_bytes;
      duplicado.importante  = esInteresante(duplicado);
      return res.status(200).json({ ok: true, dedup: true, total: global._capturas.length });
    }

    item.importante = esInteresante(item);
    global._capturas.unshift(item);

    if (global._capturas.length > global._maxItems) {
      global._capturas = global._capturas.slice(0, global._maxItems);
    }

    return res.status(200).json({ ok: true, total: global._capturas.length });
  }

  if (req.method === "GET") {
    const {
      desde, tipo, dominio, session_id,
      media, importante, q,
      limit = 100, offset = 0,
    } = req.query;

    let items = global._capturas;

    if (tipo       && tipo !== "TODOS") items = items.filter(i => i.tipo       === tipo);
    if (dominio)                        items = items.filter(i => i.dominio    === dominio);
    if (session_id)                     items = items.filter(i => i.session_id === session_id);
    if (media)                          items = items.filter(i => i.media_tipo?.startsWith(media));
    if (importante === "true")          items = items.filter(i => i.importante);
    if (desde)                          items = items.filter(i => i.ts > Number(desde));
    if (q) {
      const ql = q.toLowerCase();
      items = items.filter(i =>
        i.url.toLowerCase().includes(ql) ||
        i.tab_title.toLowerCase().includes(ql)
      );
    }

    const total_filtrado = items.length;
    items = items.slice(Number(offset), Number(offset) + Number(limit));

    return res.status(200).json({
      ok: true,
      total: global._capturas.length,
      total_filtrado,
      session_id: global._sessionId,
      items,
    });
  }

  if (req.method === "DELETE") {
    global._capturas = [];
    if (req.query.nueva_sesion === "true") global._sessionId = generateSessionId();
    return res.status(200).json({ ok: true, total: 0, session_id: global._sessionId });
  }

  return res.status(405).json({ error: "Método no permitido" });
}
