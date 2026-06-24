// ============================================================
//  ADMIN · Confirmar / descartar / devolver a pendiente
//  Ruta: /api/admin/actualizar-donacion
//
//  Requiere cabecera:
//  Authorization: Bearer <ADMIN_TOKEN>
// ============================================================

const ORIGENES_PERMITIDOS = [
  "https://donaciones.aswolfram.org",
  "https://web-wolfram-cf.pages.dev",
  "https://aswolfram.org",
  "https://www.aswolfram.org",
];

const ESTADOS_VALIDOS = ["registrada", "declarada_pagada", "confirmado", "descartado"];

function corsHeaders(request) {
  const origen = request.headers.get("origin");
  const allowOrigin = ORIGENES_PERMITIDOS.includes(origen) ? origen : ORIGENES_PERMITIDOS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
    const auth = comprobarAdmin(context.request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status, headers);

    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
      return json({ error: "Faltan variables SUPABASE_URL o SUPABASE_SERVICE_KEY" }, 500, headers);
    }

    const body = await context.request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "JSON no válido" }, 400, headers);
    }

    const id = limpiarTexto(body.id, 80);
    const estado = limpiarTexto(body.estado, 20).toLowerCase();
    const notas = limpiarTexto(body.notas, 500);

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return json({ error: "ID de donación no válido." }, 400, headers);
    }

    if (!ESTADOS_VALIDOS.includes(estado)) {
      return json({ error: "Estado no válido." }, 400, headers);
    }

    const rowRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/donations?id=eq.${encodeURIComponent(id)}&select=id,importe,estado,declarado_pagado_en`,
      { headers: supabaseHeaders(env) }
    );

    if (!rowRes.ok) {
      const detalle = await rowRes.text();
      return json({ error: "No se pudo consultar la donación.", detalle }, 500, headers);
    }

    const rows = await rowRes.json();
    const donacion = Array.isArray(rows) ? rows[0] : null;
    if (!donacion) {
      return json({ error: "Donación no encontrada." }, 404, headers);
    }

    const patch = { estado };

    if (notas) patch.notas = notas;

    if (estado === "confirmado") {
      const importeConfirmadoRaw = body.importe_confirmado;
      const importeConfirmado = importeConfirmadoRaw === null || importeConfirmadoRaw === undefined || importeConfirmadoRaw === ""
        ? Number(donacion.importe)
        : Number(importeConfirmadoRaw);

      if (!Number.isFinite(importeConfirmado) || importeConfirmado < 0) {
        return json({ error: "Importe confirmado no válido." }, 400, headers);
      }

      patch.importe_confirmado = importeConfirmado;
      patch.confirmado_en = new Date().toISOString();
    } else if (estado === "registrada") {
      patch.importe_confirmado = null;
      patch.confirmado_en = null;
      patch.declarado_pagado_en = null;
    } else if (estado === "declarada_pagada") {
      patch.importe_confirmado = null;
      patch.confirmado_en = null;
      if (!donacion.declarado_pagado_en) patch.declarado_pagado_en = new Date().toISOString();
    } else if (estado === "descartado") {
      patch.importe_confirmado = null;
      patch.confirmado_en = null;
    }

    const updateRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/donations?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: {
          ...supabaseHeaders(env),
          Prefer: "return=representation",
        },
        body: JSON.stringify(patch),
      }
    );

    if (!updateRes.ok) {
      const detalle = await updateRes.text();
      return json({ error: "No se pudo actualizar la donación.", detalle }, 500, headers);
    }

    const updated = await updateRes.json();
    return json({ ok: true, donation: Array.isArray(updated) ? updated[0] : updated }, 200, headers);
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

function comprobarAdmin(request, env) {
  if (!env.ADMIN_TOKEN) {
    return { ok: false, status: 500, error: "Falta configurar ADMIN_TOKEN en Cloudflare." };
  }

  const cabecera = request.headers.get("Authorization") || "";
  const token = cabecera.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { ok: false, status: 401, error: "Acceso no autorizado." };
  }

  if (!compararSeguro(token, env.ADMIN_TOKEN)) {
    return { ok: false, status: 403, error: "Token de administración incorrecto." };
  }

  return { ok: true };
}

function compararSeguro(a, b) {
  const enc = new TextEncoder();
  const aa = enc.encode(String(a));
  const bb = enc.encode(String(b));
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
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
