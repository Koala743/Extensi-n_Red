// api/captura.js
// Recibe peticiones de la extensión Chrome y las guarda
// También sirve los datos al panel HTML

// Vercel Serverless usa un store en memoria por instancia.
// Para persistencia real entre requests usá Vercel KV (Redis).
// Por ahora usamos un array global que dura mientras corre la instancia.
if (!global._capturas) global._capturas = [];
if (!global._maxItems) global._maxItems = 500;

export default function handler(req, res) {
  // ── CORS: permitir desde cualquier origen (extensión + panel local) ──────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ── POST /api/captura — la extensión envía una petición capturada ────────
  if (req.method === "POST") {
    const body = req.body;
    if (!body || !body.url) {
      return res.status(400).json({ error: "Falta url" });
    }

    const item = {
      id:        Date.now() + Math.random().toString(36).slice(2),
      url:       body.url,
      tipo:      body.tipo      || "DESCONOCIDO",
      subtipo:   body.subtipo   || "",
      metodo:    body.metodo    || "GET",
      mime:      body.mime      || "",
      status:    body.status    || 0,
      tab_url:   body.tab_url   || "",
      tab_title: body.tab_title || "",
      origen:    body.origen    || "",
      ts:        body.ts        || Date.now(),
    };

    global._capturas.unshift(item);

    // Limitar a 500 ítems
    if (global._capturas.length > global._maxItems) {
      global._capturas = global._capturas.slice(0, global._maxItems);
    }

    return res.status(200).json({ ok: true, total: global._capturas.length });
  }

  // ── GET /api/captura — el panel pide los datos ───────────────────────────
  if (req.method === "GET") {
    const { desde, tipo, limit = 100 } = req.query;
    let items = global._capturas;

    // Filtrar por tipo si se pide
    if (tipo && tipo !== "TODOS") {
      items = items.filter(i => i.tipo === tipo);
    }

    // Solo traer items más nuevos que `desde` (timestamp)
    if (desde) {
      items = items.filter(i => i.ts > Number(desde));
    }

    items = items.slice(0, Number(limit));

    return res.status(200).json({
      ok:    true,
      total: global._capturas.length,
      items,
    });
  }

  // ── DELETE /api/captura — limpiar lista ───────────────────────────────────
  if (req.method === "DELETE") {
    global._capturas = [];
    return res.status(200).json({ ok: true, total: 0 });
  }

  return res.status(405).json({ error: "Método no permitido" });
}
