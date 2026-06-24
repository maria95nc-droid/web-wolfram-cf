// ============================================================
//  ADMIN · Listar donaciones pendientes/confirmadas
//  Ruta: /api/admin/listar-donaciones
//
//  Requiere cabecera:
//  Authorization: Bearer <ADMIN_TOKEN>
//
//  ADMIN_TOKEN se configura en Cloudflare Pages → Settings →
//  Environment variables. Nunca se escribe en el HTML.
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request) });
}

export async function onRequestGet(context) {
  const headers = corsHeaders(context.request);

  try {
    const env = context.env;
    const auth = comprobarAdmin(context.request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status, headers);

    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
      return json({ error: "Faltan variables SUPABASE_URL o SUPABASE_SERVICE_KEY" }, 500, headers);
    }

    const url = new URL(context.request.url);
    const estado = (url.searchParams.get("estado") || "").toLowerCase();
    const limiteRaw = Number(url.searchParams.get("limit") || 200);
    const limite = Number.isFinite(limiteRaw) ? Math.min(Math.max(Math.trunc(limiteRaw), 1), 500) : 200;

    let query =
      `${env.SUPABASE_URL}/rest/v1/donations` +
      `?select=id,referencia,creado,nombre,email,dni,metodo,importe,importe_confirmado,estado,concepto,anonimo,notas,declarado_pagado_en,confirmado_en` +
      `&order=creado.desc` +
      `&limit=${limite}`;

    if (["registrada", "declarada_pagada", "confirmado", "descartado"].includes(estado)) {
      query += `&estado=eq.${encodeURIComponent(estado)}`;
    }

    const donationsRes = await fetch(query, {
      headers: supabaseHeaders(env),
    });

    if (!donationsRes.ok) {
      const detalle = await donationsRes.text();
      return json({ error: "No se pudieron cargar las donaciones.", detalle }, 500, headers);
    }

    const rows = await donationsRes.json();

    const totalsRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/totales?select=*&limit=1`,
      { headers: supabaseHeaders(env) }
    );

    let totales = null;
    if (totalsRes.ok) {
      const t = await totalsRes.json();
      totales = Array.isArray(t) ? t[0] || null : null;
    }

    return json({ ok: true, donations: rows, totales }, 200, headers);
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

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}
