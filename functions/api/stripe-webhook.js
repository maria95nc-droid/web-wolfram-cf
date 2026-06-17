// ============================================================
//  FUNCIÓN 2 · Webhook de Stripe — CLOUDFLARE PAGES
//  Ruta: /api/stripe-webhook
//  Stripe llama aquí cuando un pago se completa. Aquí sube la barra.
// ============================================================

export async function onRequestPost(context) {
  const env = context.env;

  // Leer el cuerpo CRUDO (necesario para verificar la firma)
  const rawBody = await context.request.text();
  const sigHeader = context.request.headers.get("stripe-signature") || "";

  // Verificar que el aviso viene de verdad de Stripe
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

  if (evento.type === "checkout.session.completed") {
    const session = evento.data.object;
    const euros = (session.amount_total || 0) / 100;
    const meta = session.metadata || {};

    // El método "ofrecido" (session.payment_method_types) no es el método
    // REAL usado por el cliente cuando se aceptan varios (card + bizum).
    // Para saberlo de verdad hay que consultar el payment_intent expandido.
    const metodo = await obtenerMetodoReal(session.id, env.STRIPE_SECRET_KEY);

    const SB = env.SUPABASE_URL;
    const KEY = env.SUPABASE_SERVICE_KEY;
    const cab = {
      apikey: KEY,
      Authorization: "Bearer " + KEY,
      "Content-Type": "application/json",
    };

    // Registrar la donación (stripe_id evita duplicados a nivel de fila)
    const insRes = await fetch(`${SB}/rest/v1/donations`, {
      method: "POST",
      headers: { ...cab, Prefer: "return=minimal" },
      body: JSON.stringify({
        importe: euros,
        metodo: metodo,
        nombre: meta.nombre || null,
        email: meta.email || null,
        dni: meta.dni || null,
        stripe_id: session.id,
      }),
    });

    // 409 = la fila ya existía de un intento anterior (reintento de Stripe).
    // IMPORTANTE: NO cortocircuitamos aquí. Si el intento anterior falló justo
    // después de insertar (antes de sumar al contador), este reintento es la
    // única oportunidad de completar esa suma. El RPC de abajo es idempotente
    // por sí mismo (columna `contado`), así que es seguro llamarlo siempre,
    // tanto si la fila se insertó ahora como si ya existía de antes.
    if (!insRes.ok && insRes.status !== 409) {
      const t = await insRes.text();
      return new Response("Error guardando donación: " + t, { status: 500 });
    }

    // Sumar a la barra de forma atómica e idempotente (ver columna `contado`
    // y la función sumar_donacion en 01_esquema_supabase.sql). Si esta misma
    // donación ya había sumado correctamente antes, el RPC no hace nada y
    // devuelve false; no hay riesgo de contar el dinero dos veces.
    const sumRes = await fetch(`${SB}/rest/v1/rpc/sumar_donacion`, {
      method: "POST",
      headers: cab,
      body: JSON.stringify({ p_stripe_id: session.id, cantidad: euros }),
    });
    if (!sumRes.ok) {
      const t = await sumRes.text();
      return new Response("Error actualizando barra: " + t, { status: 500 });
    }
  }

  return new Response("ok", { status: 200 });
}

// Consulta a Stripe el método de pago REAL usado en la sesión, expandiendo
// payment_intent.payment_method en una sola llamada (docs.stripe.com/expand).
// Si algo falla, devuelve "tarjeta" por defecto (no rompe el flujo de registro).
async function obtenerMetodoReal(sessionId, stripeSecretKey) {
  try {
    if (!stripeSecretKey) return "tarjeta";

    const url =
      `https://api.stripe.com/v1/checkout/sessions/${sessionId}` +
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

// Verificación de firma de Stripe con Web Crypto (HMAC-SHA256), con
// protección contra repetición (el timestamp debe ser reciente, igual
// que recomienda la documentación oficial de Stripe) y comparación en
// tiempo constante para no filtrar información por temporización.
async function verificarFirmaStripe(payload, sigHeader, secret) {
  try {
    if (!sigHeader || !secret) return false;
    const partes = {};
    sigHeader.split(",").forEach((kv) => {
      const [k, v] = kv.split("=");
      partes[k] = v;
    });
    const timestamp = partes["t"];
    const firmaEsperada = partes["v1"];
    if (!timestamp || !firmaEsperada) return false;

    // Tolerancia de 5 minutos, como recomienda Stripe. Un webhook capturado
    // y reenviado más tarde por un atacante (que conociera o reutilizara
    // una firma antigua) se rechaza aquí, aunque la firma en sí fuera
    // matemáticamente válida en su momento.
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
    const firmaCalc = [...new Uint8Array(firmaBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");

    return compararEnTiempoConstante(firmaCalc, firmaEsperada);
  } catch (e) {
    return false;
  }
}

// Compara dos strings byte a byte sin cortocircuitar en la primera
// diferencia, para que el tiempo de ejecución no dependa de en qué
// posición empiezan a diferir (mitiga ataques de timing, teóricos
// pero triviales de evitar).
function compararEnTiempoConstante(a, b) {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) {
    diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diferencia === 0;
}