// ============================================================
//  Declarar donación como realizada — CLOUDFLARE PAGES
//  Ruta pública: /api/declarar-donacion-pagada
//
//  No confirma dinero. Solo guarda que el donante declara haber hecho
//  Bizum/transferencia. AEIASW sigue teniendo que verificar el ingreso
//  desde el panel admin antes de que cuente como confirmado.
// ============================================================

const ORIGENES_PERMITIDOS = [
  "https://donaciones.aswolfram.org",
  "https://web-wolfram-cf.pages.dev",
  "https://aswolfram.org",
  "https://www.aswolfram.org",
];

function corsHeaders(request) {
  const origen = request.headers.get("origin");
  const allowOrigin = ORIGENES_PERMITIDOS.includes(origen) ? origen : ORIGENES_PERMITIDOS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request) });
}

export async function onRequestPost(context) {
  const headers = corsHeaders(context.request);

  try {
    const env = context.env;
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
      return json({ error: "Faltan variables SUPABASE_URL o SUPABASE_SERVICE_KEY" }, 500, headers);
    }

    if (env.RATE_LIMIT_KV) {
      const ip = context.request.headers.get("CF-Connecting-IP") || "desconocida";
      const clave = `declarar-pagada:${ip}`;
      const LIMITE = 12;
      const VENTANA_SEGUNDOS = 60;
      try {
        const actual = await env.RATE_LIMIT_KV.get(clave);
        const contador = actual ? Number(actual) : 0;
        if (contador >= LIMITE) {
          return json({ error: "Demasiados intentos. Inténtalo de nuevo en un minuto." }, 429, headers);
        }
        await env.RATE_LIMIT_KV.put(clave, String(contador + 1), { expirationTtl: VENTANA_SEGUNDOS });
      } catch (_) {}
    }

    const body = await context.request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "JSON no válido" }, 400, headers);
    }

    const referencia = limpiarTexto(body.referencia, 40).toUpperCase();
    const publicToken = limpiarTexto(body.public_token, 80);

    if (!/^WG\d{6}-[A-Z0-9]{1,12}$/.test(referencia) || !publicToken) {
      return json({ error: "Referencia o token no válidos." }, 400, headers);
    }

    const cab = supabaseHeaders(env);

    const patchRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/donations?referencia=eq.${encodeURIComponent(referencia)}&public_token=eq.${encodeURIComponent(publicToken)}&estado=eq.registrada`,
      {
        method: "PATCH",
        headers: { ...cab, Prefer: "return=representation" },
        body: JSON.stringify({
          estado: "declarada_pagada",
          declarado_pagado_en: new Date().toISOString(),
        }),
      }
    );

    if (!patchRes.ok) {
      const detalle = await patchRes.text();
      return json({ error: "No se pudo actualizar la donación.", detalle }, 500, headers);
    }

    const updated = await patchRes.json();
    if (Array.isArray(updated) && updated.length > 0) {
      return json({ ok: true, estado: "declarada_pagada" }, 200, headers);
    }

    // Si no se actualizó, comprobamos si ya estaba declarada o confirmada.
    const checkRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/donations?referencia=eq.${encodeURIComponent(referencia)}&public_token=eq.${encodeURIComponent(publicToken)}&select=estado&limit=1`,
      { headers: cab }
    );

    if (!checkRes.ok) {
      const detalle = await checkRes.text();
      return json({ error: "No se pudo consultar la donación.", detalle }, 500, headers);
    }

    const rows = await checkRes.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return json({ error: "No se encontró la donación." }, 404, headers);

    if (["declarada_pagada", "confirmado"].includes(row.estado)) {
      return json({ ok: true, estado: row.estado, ya_estaba: true }, 200, headers);
    }

    if (row.estado === "descartado") {
      return json({ error: "Esta donación fue descartada. Contacta con la asociación si es un error." }, 409, headers);
    }

    return json({ ok: true, estado: row.estado }, 200, headers);
  } catch (err) {
    return json({ error: err?.message || "Error interno" }, 500, headers);
  }
}

function supabaseHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

function limpiarTexto(valor, max) {
  if (typeof valor !== "string") return "";
  return valor
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}
