// VideoSniffer Pro v5 — API Vercel
// Recibe: VIDEO/STREAM, FRAGMENTO, MANIFEST, IMAGE, AUDIO, API/XHR
// GET /api/captura → lista items
// POST /api/captura → guarda item
// DELETE /api/captura → limpia todo

if (!global._capturas)    global._capturas    = [];
if (!global._streamMap)   global._streamMap   = {}; // base → [urls]
if (!global._maxItems)    global._maxItems    = 1000;
if (!global._maxFrags)    global._maxFrags    = 200; // fragmentos por stream

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── POST: guardar captura ──────────────────────────────────────────────
  if (req.method === "POST") {
    const body = req.body;
    if (!body || !body.url) return res.status(400).json({ error: "Falta url" });

    const item = {
      id:            Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      url:           body.url,
      tipo:          body.tipo        || "DESCONOCIDO",
      subtipo:       body.subtipo     || "",
      metodo:        body.metodo      || "GET",
      mime:          body.mime        || "",
      status:        body.status      || 0,
      content_length: body.content_length || 0,
      content_range:  body.content_range  || "",
      stream_base:   body.stream_base || "",
      tab_url:       body.tab_url     || "",
      tab_title:     body.tab_title   || "",
      origen:        body.origen      || "",
      ts:            body.ts          || Date.now(),
    };

    // Si es fragmento, agrupar en streamMap
    if ((item.tipo === "FRAGMENTO" || item.tipo === "MANIFEST") && item.stream_base) {
      const base = item.stream_base;
      if (!global._streamMap[base]) global._streamMap[base] = [];
      // Evitar duplicados dentro del stream
      if (!global._streamMap[base].includes(item.url)) {
        global._streamMap[base].unshift(item.url);
        if (global._streamMap[base].length > global._maxFrags) {
          global._streamMap[base] = global._streamMap[base].slice(0, global._maxFrags);
        }
      }
    }

    // Deduplicar: misma url+tipo en los últimos 2s
    const ahora = Date.now();
    const dup = global._capturas.find(c =>
      c.url === item.url &&
      c.tipo === item.tipo &&
      (ahora - c.ts) < 2000
    );
    if (!dup) {
      global._capturas.unshift(item);
      if (global._capturas.length > global._maxItems) {
        global._capturas = global._capturas.slice(0, global._maxItems);
      }
    }

    return res.status(200).json({
      ok:     true,
      total:  global._capturas.length,
      streams: Object.keys(global._streamMap).length,
    });
  }

  // ── GET: devolver datos ────────────────────────────────────────────────
  if (req.method === "GET") {
    const { tipo, limit = 200, streams = "false" } = req.query;
    let items = global._capturas;

    if (tipo && tipo !== "TODOS") {
      items = items.filter(i => i.tipo === tipo);
    }

    items = items.slice(0, Number(limit));

    const resp = {
      ok:    true,
      total: global._capturas.length,
      items,
    };

    // Devolver mapa de streams si se pide
    if (streams === "true") {
      resp.streams = global._streamMap;
    }

    return res.status(200).json(resp);
  }

  // ── DELETE: limpiar todo ───────────────────────────────────────────────
  if (req.method === "DELETE") {
    global._capturas  = [];
    global._streamMap = {};
    return res.status(200).json({ ok: true, total: 0 });
  }

  return res.status(405).json({ error: "Método no permitido" });
}
