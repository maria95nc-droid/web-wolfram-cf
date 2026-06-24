// ============================================================
//  Registrar donación — CLOUDFLARE PAGES
//  Ruta pública: /api/registrar-donacion
//
//  No cobra dinero. Guarda una fila en Supabase con estado "registrada".
//  Después se muestran Bizum/IBAN/concepto. Si el usuario pulsa
//  "Ya he realizado la donación", otra función cambia el estado a
//  "declarada_pagada". AEIASW confirma manualmente el ingreso real.
// ============================================================

const ORIGENES_PERMITIDOS = [
  "https://donaciones.aswolfram.org",
  "https://web-wolfram-cf.pages.dev",
  "https://aswolfram.org",
  "https://www.aswolfram.org",
];

const DATOS_PAGO = {
  bizum: "02820",
  iban: "ES79 0182 1454 1502 0853 7115",
  titular: "Asociación Española para la Investigación y Ayuda al Síndrome de Wolfram",
  conceptoBase: "DONACION WOLFRAM GEMA",
};

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

    // Rate limit básico por IP: evita spam evidente sin bloquear la campaña.
    if (env.RATE_LIMIT_KV) {
      const ip = context.request.headers.get("CF-Connecting-IP") || "desconocida";
      const clave = `registrar:${ip}`;
      const LIMITE = 6;
      const VENTANA_SEGUNDOS = 60;
      try {
        const actual = await env.RATE_LIMIT_KV.get(clave);
        const contador = actual ? Number(actual) : 0;
        if (contador >= LIMITE) {
          return json({ error: "Demasiados intentos. Inténtalo de nuevo en un minuto." }, 429, headers);
        }
        await env.RATE_LIMIT_KV.put(clave, String(contador + 1), { expirationTtl: VENTANA_SEGUNDOS });
      } catch (_) {
        // Fail-open: no se bloquean donaciones legítimas si KV falla.
      }
    }

    const body = await context.request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "JSON no válido" }, 400, headers);
    }

    const importe = Number(body.importe);
    const nombre = limpiarTexto(body.nombre, 120);
    const email = limpiarTexto(body.email, 160).toLowerCase();
    const dni = limpiarTexto(body.dni, 30).toUpperCase();
    const metodo = limpiarTexto(body.metodo, 20).toLowerCase();
    const anonimo = Boolean(body.anonimo);

    if (!Number.isFinite(importe) || importe < 1) {
      return json({ error: "Importe no válido. Mínimo 1 €." }, 400, headers);
    }
    if (importe > 10000) {
      return json({ error: "Importe demasiado alto. Contacta con la asociación." }, 400, headers);
    }
    if (!nombre || nombre.length < 2) {
      return json({ error: "El nombre es obligatorio para conciliar la donación." }, 400, headers);
    }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ error: "Email no válido." }, 400, headers);
    }
    if (!["bizum", "transferencia"].includes(metodo)) {
      return json({ error: "Método de pago no válido." }, 400, headers);
    }

    const referencia = generarReferencia();
    const publicToken = generarTokenPublico();
    const concepto = `${DATOS_PAGO.conceptoBase} ${referencia}`;

    const payload = {
      importe,
      metodo,
      estado: "registrada",
      nombre,
      email: email || null,
      dni: dni || null,
      anonimo,
      referencia,
      concepto,
      public_token: publicToken,
    };

    const supabaseRes = await fetch(`${env.SUPABASE_URL}/rest/v1/donations`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    });

    if (!supabaseRes.ok) {
      const detalle = await supabaseRes.text();
      return json({ error: "No se pudo registrar la donación.", detalle }, 500, headers);
    }

    return json({
      ok: true,
      estado: "registrada",
      referencia,
      public_token: publicToken,
      concepto,
      metodo,
      importe,
      iban: DATOS_PAGO.iban,
      bizum: DATOS_PAGO.bizum,
      titular: DATOS_PAGO.titular,
    }, 200, headers);
  } catch (err) {
    return json({ error: err?.message || "Error interno" }, 500, headers);
  }
}

function limpiarTexto(valor, max) {
  if (typeof valor !== "string") return "";
  return valor
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function generarReferencia() {
  const fecha = new Date();
  const y = String(fecha.getUTCFullYear()).slice(-2);
  const m = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  const d = String(fecha.getUTCDate()).padStart(2, "0");
  const aleatorio = crypto.getRandomValues(new Uint32Array(1))[0]
    .toString(36)
    .toUpperCase()
    .padStart(6, "0")
    .slice(0, 6);
  return `WG${y}${m}${d}-${aleatorio}`;
}

function generarTokenPublico() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}
