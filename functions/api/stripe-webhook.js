// ============================================================
//  FUNCIÓN 2 · Webhook de Stripe — CLOUDFLARE PAGES
//  Ruta: /api/stripe-webhook
//  Stripe llama aquí cuando un pago se completa. Aquí sube la barra.
// ============================================================

const CAMPAIGN_ID = "wolfram_gema_2026";

export async function onRequestPost(context) {
  const env = context.env;

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response("Falta configurar STRIPE_WEBHOOK_SECRET", { status: 500 });
  }
  if (!env.STRIPE_SECRET_KEY) {
    return new Response("Falta configurar STRIPE_SECRET_KEY", { status: 500 });
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return new Response("Faltan variables de Supabase", { status: 500 });
  }

  // Leer el cuerpo CRUDO. Es obligatorio para verificar la firma de Stripe.
  const rawBody = await context.request.text();
  const sigHeader = context.request.headers.get("stripe-signature") || "";

  const verificado = await verificarFirmaStripe(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!verificado) {
    return new Response("Firma no válida", { status: 400 });
  }

  let evento;
  try {
    evento = JSON.parse(rawBody);
  } catch (e) {
    return new Response("JSON no válido", { status: 400 });
  }

  if (evento.type !== "checkout.session.completed") {
    return new Response("ok", { status: 200 });
  }

  const session = evento?.data?.object;
  if (!session || !session.id) {
    return new Response("Sesión de Stripe no válida", { status: 400 });
  }

  // No sumamos nada si el pago no está realmente confirmado.
  if (session.payment_status !== "paid") {
    return new Response(
      "Pago no confirmado (payment_status: " + session.payment_status + "), no se suma.",
      { status: 200 }
    );
  }

  // Blindaje frente a eventos de otro tipo, otra moneda o importes inválidos.
  if (session.mode !== "payment") {
    return new Response("Modo de sesión inesperado (" + session.mode + "), se ignora.", { status: 200 });
  }
  if ((session.currency || "").toLowerCase() !== "eur") {
    return new Response("Moneda inesperada (" + session.currency + "), se ignora.", { status: 200 });
  }
  if (!session.amount_total || session.amount_total <= 0) {
    return new Response("Importe inválido o vacío, se ignora.", { status: 200 });
  }

  const euros = session.amount_total / 100;
  const meta = session.metadata || {};

  // Solo procesamos eventos de esta campaña concreta.
  if (meta.campaign !== CAMPAIGN_ID) {
    return new Response("Campaña inesperada, se ignora.", { status: 200 });
  }

  const metodo = await obtenerMetodoReal(session.id, env.STRIPE_SECRET_KEY);

  const SB = env.SUPABASE_URL.replace(/\/$/, "");
  const KEY = env.SUPABASE_SERVICE_KEY;
  const cab = {
    apikey: KEY,
    Authorization: "Bearer " + KEY,
    "Content-Type": "application/json",
  };

  // Registrar la donación. stripe_id único evita filas duplicadas.
  const insRes = await fetch(`${SB}/rest/v1/donations`, {
    method: "POST",
    headers: { ...cab, Prefer: "return=minimal" },
    body: JSON.stringify({
      importe: euros,
      metodo,
      nombre: meta.nombre || null,
      email: meta.email || null,
      dni: meta.dni || null,
      stripe_id: session.id,
    }),
  });

  // 409 = la fila ya existía por un reintento de Stripe. No cortamos aquí:
  // el RPC idempotente puede completar una suma que hubiera fallado después
  // de insertar la fila en un intento anterior.
  if (!insRes.ok && insRes.status !== 409) {
    const t = await insRes.text();
    return new Response("Error guardando donación: " + t, { status: 500 });
  }

  // Suma atómica e idempotente: Supabase lee el importe desde donations.
  const sumRes = await fetch(`${SB}/rest/v1/rpc/sumar_donacion`, {
    method: "POST",
    headers: cab,
    body: JSON.stringify({ p_stripe_id: session.id }),
  });

  if (!sumRes.ok) {
    const t = await sumRes.text();
    return new Response("Error actualizando barra: " + t, { status: 500 });
  }

  return new Response("ok", { status: 200 });
}

// Consulta a Stripe el método de pago REAL usado en la sesión.
async function obtenerMetodoReal(sessionId, stripeSecretKey) {
  try {
    const url =
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}` +
      `?expand[]=payment_intent.payment_method`;

    const r = await fetch(url, {
      headers: { Authorization: "Bearer " + stripeSecretKey },
    });
    if (!r.ok) return "tarjeta";

    const sesionCompleta = await r.json();
    const tipo = sesionCompleta?.payment_intent?.payment_method?.type;

    return tipo === "bizum" ? "bizum" : "tarjeta";
  } catch (e) {
    return "tarjeta";
  }
}

// Verificación de firma de Stripe con Web Crypto (HMAC-SHA256).
async function verificarFirmaStripe(payload, sigHeader, secret) {
  try {
    if (!sigHeader || !secret) return false;

    const partes = sigHeader.split(",");
    let timestamp = "";
    const firmas = [];

    for (const parte of partes) {
      const idx = parte.indexOf("=");
      if (idx === -1) continue;
      const k = parte.slice(0, idx);
      const v = parte.slice(idx + 1);
      if (k === "t") timestamp = v;
      if (k === "v1") firmas.push(v);
    }

    if (!timestamp || firmas.length === 0) return false;

    // Tolerancia de 5 minutos contra repetición de webhooks antiguos.
    const ahora = Math.floor(Date.now() / 1000);
    const TOLERANCIA_SEGUNDOS = 5 * 60;
    if (Math.abs(ahora - Number(timestamp)) > TOLERANCIA_SEGUNDOS) return false;

    const firmado = `${timestamp}.${payload}`;
    const enc = new TextEncoder();
    const clave = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const firmaBuf = await crypto.subtle.sign("HMAC", clave, enc.encode(firmado));
    const firmaCalc = [...new Uint8Array(firmaBuf)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return firmas.some((firma) => compararEnTiempoConstante(firmaCalc, firma));
  } catch (e) {
    return false;
  }
}

function compararEnTiempoConstante(a, b) {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) {
    diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diferencia === 0;
}