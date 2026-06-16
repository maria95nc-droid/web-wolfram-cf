// ============================================================
//  FUNCIÓN 1 · Crear pago (Stripe Checkout) — CLOUDFLARE PAGES
//  Ruta pública: /api/crear-donacion
// ============================================================

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

  try {
    const env = context.env;
    if (!env.STRIPE_SECRET_KEY) {
      return new Response(JSON.stringify({ error: "Falta configurar STRIPE_SECRET_KEY" }), { status: 500, headers: cors });
    }

    const body = await context.request.json();
    const { importe, nombre, email, dni } = body || {};

    const euros = Number(importe);
    if (!euros || euros < 1) {
      return new Response(JSON.stringify({ error: "Importe no válido" }), { status: 400, headers: cors });
    }
    if (euros > 10000) {
      return new Response(JSON.stringify({ error: "Importe demasiado alto. Contacta con la asociación." }), { status: 400, headers: cors });
    }

    // Dominio desde el que se llama (para las URLs de retorno tras pagar)
    const origin = context.request.headers.get("origin") || ("https://" + new URL(context.request.url).host);

    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("payment_method_types[]", "card");
    params.append("payment_method_types[]", "bizum");
    if (email) params.append("customer_email", email);
    params.append("line_items[0][price_data][currency]", "eur");
    params.append("line_items[0][price_data][product_data][name]", "Donación · Síndrome de Wolfram");
    params.append("line_items[0][price_data][unit_amount]", String(Math.round(euros * 100)));
    params.append("line_items[0][quantity]", "1");
    params.append("metadata[nombre]", nombre || "");
    params.append("metadata[email]", email || "");
    params.append("metadata[dni]", dni || "");
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
    if (session.error) {
      return new Response(JSON.stringify({ error: session.error.message }), { status: 500, headers: cors });
    }

    return new Response(JSON.stringify({ url: session.url }), { status: 200, headers: cors });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors });
  }
}
