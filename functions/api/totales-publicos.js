export async function onRequestGet(context) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
  };

  try {
    const env = context.env;
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
      return json({ objetivo: 1000, recaudado: 0, donantes: 0, actualizado: new Date().toISOString().slice(0, 10), aviso: "Supabase no configurado" }, 200, headers);
    }

    const url = `${env.SUPABASE_URL}/rest/v1/campaign?id=eq.1&select=objetivo,recaudado_manual,donantes_manual,actualizado,titulo,subtitulo,homenajeado,activo`;
    const r = await fetch(url, {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    });

    if (!r.ok) {
      const t = await r.text();
      return json({ error: "Error leyendo totales", detalle: t }, 500, headers);
    }

    const rows = await r.json();
    const c = Array.isArray(rows) && rows[0] ? rows[0] : {};
    return json(normalizar(c), 200, headers);
  } catch (err) {
    return json({ error: err.message }, 500, headers);
  }
}

function normalizar(c) {
  return {
    objetivo: numero(c.objetivo, 1000),
    recaudado: numero(c.recaudado_manual, 0),
    donantes: entero(c.donantes_manual, 0),
    actualizado: c.actualizado || new Date().toISOString().slice(0, 10),
    titulo: c.titulo || "Un cumpleaños por la investigación del Síndrome de Wolfram",
    subtitulo: c.subtitulo || "El regalo puede cambiar muchas vidas.",
    homenajeado: c.homenajeado || "Dra. Gema Esteban Bueno",
    activo: c.activo !== false,
  };
}

function numero(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function entero(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}
