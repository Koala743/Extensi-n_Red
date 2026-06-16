if (!global._capturas)        global._capturas   = [];
if (!global._maxItems)        global._maxItems   = 500;
if (!global._sessionId)       global._sessionId  = generateSessionId();
if (!global._rateLimit)       global._rateLimit  = new Map();
if (!global._blockedIPs)      global._blockedIPs = new Set();

const API_KEY      = process.env.CAPTURA_API_KEY || "changeme";
const RATE_MAX     = 60;
const RATE_WINDOW  = 60_000;
const BLOCK_AFTER  = 5;

function generateSessionId() {
  return "sess_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return "desconocido"; }
}

function getIP(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function checkRateLimit(ip) {
  const now  = Date.now();
  const data = global._rateLimit.get(ip) || { count: 0, start: now, strikes: 0 };

  if (now - data.start > RATE_WINDOW) {
    data.count = 0;
    data.start = now;
  }

  data.count++;

  if (data.count > RATE_MAX) {
    data.strikes++;
    if (data.strikes >= BLOCK_AFTER) global._blockedIPs.add(ip);
    global._rateLimit.set(ip, data);
    return false;
  }

  global._rateLimit.set(ip, data);
  return true;
}

function sanitizeString(val, max = 2048) {
  if (typeof val !== "string") return "";
  return val.slice(0, max).replace(/[<>"'`]/g, "");
}

function detectarMediaPorMime(mime = "") {
  const m = mime.toLowerCase();
  if (["video/mp4","video/webm","video/ogg","application/x-mpegurl","video/mp2t"].some(v => m.includes(v))) return "VIDEO";
  if (["image/jpeg","image/png","image/webp","image/gif","image/svg+xml","image/avif"].some(v => m.includes(v))) return "IMAGEN";
  return null;
}

function detectarMediaPorExtension(url = "") {
  try {
    const ext = new URL(url).pathname.split(".").pop().toLowerCase();
    if (["mp4","webm","ogg","m3u8","ts","mkv","avi","mov"].includes(ext)) return "VIDEO";
    if (["jpg","jpeg","png","webp","gif","svg","avif","ico"].includes(ext)) return "IMAGEN";
  } catch {}
  return null;
}

async function detectarMediaPorContenido(url) {
  try {
    const resp = await fetch(url, {
      headers: { Range: "bytes=0-11" },
      signal:  AbortSignal.timeout(4000),
    });
    if (!resp.ok) return null;

    const b = new Uint8Array(await resp.arrayBuffer());

    if (b[4]===0x66&&b[5]===0x74&&b[6]===0x79&&b[7]===0x70) return "VIDEO_MP4";
    if (b[0]===0x1A&&b[1]===0x45&&b[2]===0xDF&&b[3]===0xA3) return "VIDEO_WEBM";
    if (b[0]===0x4F&&b[1]===0x67&&b[2]===0x67&&b[3]===0x53) return "VIDEO_OGG";
    if (b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF)               return "IMAGEN_JPEG";
    if (b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47) return "IMAGEN_PNG";
    if (b[0]===0x47&&b[1]===0x49&&b[2]===0x46&&b[3]===0x38) return "IMAGEN_GIF";
    if (b[0]===0x52&&b[1]===0x49&&b[2]===0x46&&b[3]===0x46&&
        b[8]===0x57&&b[9]===0x45&&b[10]===0x42&&b[11]===0x50) return "IMAGEN_WEBP";
    return null;
  } catch { return null; }
}

function esInteresante(item) {
  if (item.status >= 400)                              return true;
  if (item.metodo === "POST" && item.mime?.includes("json")) return true;
  if (item.size_bytes > 5 * 1024 * 1024)              return true;
  if (item.duration_ms > 3000)                         return true;
  if (item.media_tipo)                                 return true;
  return false;
}

export default async function handler(req, res) {
  const ip = getIP(req);

  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  res.setHeader("X-Content-Type-Options",       "nosniff");
  res.setHeader("X-Frame-Options",              "DENY");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (global._blockedIPs.has(ip)) {
    return res.status(403).json({ error: "Bloqueado" });
  }

  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: "Demasiadas peticiones" });
  }

  const apiKey = req.headers["x-api-key"] || req.query.key;
  if (!apiKey || apiKey !== API_KEY) {
    return res.status(401).json({ error: "No autorizado" });
  }

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
