// ============================================================
//  FUNCIÓN 1 · Crear pago (Stripe Checkout) — CLOUDFLARE PAGES
//  Ruta pública: /api/crear-donacion
// ============================================================

const CAMPAIGN_ID = "wolfram_gema_2026";

export async function onRequestOptions() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

export async function onRequestPost(context) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  const ORIGENES_PERMITIDOS = [
    "https://donaciones.aswolfram.org",
    "https://web-wolfram-cf.pages.dev",
    "https://aswolfram.org",
    "https://www.aswolfram.org",
  ];

  try {
    const env = context.env;

    if (!env.STRIPE_SECRET_KEY) {
      return json({ error: "Falta configurar STRIPE_SECRET_KEY" }, 500, cors);
    }

    // ------------------------------------------------------------
    // Rate limiting básico por IP, usando Cloudflare KV.
    // Si RATE_LIMIT_KV no está enlazado, no rompe donaciones legítimas.
    // ------------------------------------------------------------
    if (env.RATE_LIMIT_KV) {
      const ip = context.request.headers.get("CF-Connecting-IP") || "desconocida";
      const clave = `ratelimit:${ip}`;
      const LIMITE = 10;
      const VENTANA_SEGUNDOS = 60;

      try {
        const actual = await env.RATE_LIMIT_KV.get(clave);
        const contador = actual ? Number(actual) : 0;

        if (contador >= LIMITE) {
          return json({ error: "Demasiadas solicitudes. Inténtalo de nuevo en un minuto." }, 429, cors);
        }

        await env.RATE_LIMIT_KV.put(clave, String(contador + 1), {
          expirationTtl: VENTANA_SEGUNDOS,
        });
      } catch (e) {
        // Fail-open: si KV falla, no bloqueamos donaciones legítimas.
      }
    }

    let body;
    try {
      body = await context.request.json();
    } catch (e) {
      return json({ error: "JSON no válido" }, 400, cors);
    }

    const { importe, nombre, email, dni } = body || {};

    const nombreLimpio = limpiarTexto(nombre, 200);
    const emailLimpio = limpiarTexto(email, 200);
    const dniLimpio = limpiarTexto(dni, 50);

    if ((nombre && nombreLimpio === null) || (email && emailLimpio === null) || (dni && dniLimpio === null)) {
      return json({ error: "Uno de los campos es demasiado largo." }, 400, cors);
    }

    if (emailLimpio && !emailValido(emailLimpio)) {
      return json({ error: "Email no válido." }, 400, cors);
    }

    const euros = Number(importe);
    if (!Number.isFinite(euros) || euros < 1) {
      return json({ error: "Importe no válido" }, 400, cors);
    }

    if (euros > 10000) {
      return json({ error: "Importe demasiado alto. Contacta con la asociación." }, 400, cors);
    }

    const centimos = Math.round(euros * 100);
    if (!Number.isInteger(centimos) || centimos < 100) {
      return json({ error: "Importe no válido" }, 400, cors);
    }

    // Dominio desde el que se llama. Se valida contra lista blanca para no
    // permitir que un clon controle success_url/cancel_url.
    const origenSolicitado = context.request.headers.get("origin");
    const origin = ORIGENES_PERMITIDOS.includes(origenSolicitado)
      ? origenSolicitado
      : ORIGENES_PERMITIDOS[0];

    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("payment_method_types[]", "card");
    params.append("payment_method_types[]", "bizum");
    if (emailLimpio) params.append("customer_email", emailLimpio);

    params.append("line_items[0][price_data][currency]", "eur");
    params.append("line_items[0][price_data][product_data][name]", "Donación · Síndrome de Wolfram");
    params.append("line_items[0][price_data][unit_amount]", String(centimos));
    params.append("line_items[0][quantity]", "1");

    params.append("metadata[campaign]", CAMPAIGN_ID);
    params.append("metadata[nombre]", nombreLimpio || "");
    params.append("metadata[email]", emailLimpio || "");
    params.append("metadata[dni]", dniLimpio || "");

    // Duplicamos metadata de campaña también en PaymentIntent para facilitar
    // trazabilidad futura en Stripe. El webhook usa la metadata de la sesión.
    params.append("payment_intent_data[metadata][campaign]", CAMPAIGN_ID);

    params.append("success_url", origin + "/?donacion=ok");
    params.append("cancel_url", origin + "/?donacion=cancelada");

    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.STRIPE_SECRET_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await r.json();
    if (!r.ok || session.error) {
      return json({ error: session?.error?.message || "Error creando el pago en Stripe" }, 500, cors);
    }

    return json({ url: session.url }, 200, cors);
  } catch (err) {
    return json({ error: err?.message || "Error interno" }, 500, cors);
  }
}

function limpiarTexto(valor, max) {
  if (valor === undefined || valor === null || valor === "") return "";
  if (typeof valor !== "string") return null;

  const limpio = valor.trim();
  if (limpio.length > max) return null;
  return limpio;
}

function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function json(payload, status, headers) {
  return new Response(JSON.stringify(payload), { status, headers });
}