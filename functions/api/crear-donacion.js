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

  // Dominios legítimos desde los que se permite construir las URLs de
  // retorno de Stripe. Esto NO afecta a quién puede llamar a la API (eso
  // lo gestiona Access-Control-Allow-Origin más arriba, que sigue siendo
  // necesario porque Stripe Checkout es una redirección de navegador, no
  // una llamada CORS), sino a dónde puede acabar el donante tras pagar.
  // Sin esto, cualquiera podría clonar la web en otro dominio y usarla
  // para generar sesiones de pago reales contra esta cuenta de Stripe,
  // controlando la página de éxito/cancelación que ve el donante.
  const ORIGENES_PERMITIDOS = [
    "https://donaciones.aswolfram.org",
    "https://web-wolfram-cf.pages.dev",
    "https://aswolfram.org",
    "https://www.aswolfram.org",
  ];

  try {
    const env = context.env;
    if (!env.STRIPE_SECRET_KEY) {
      return new Response(JSON.stringify({ error: "Falta configurar STRIPE_SECRET_KEY" }), { status: 500, headers: cors });
    }

    // ------------------------------------------------------------
    // LÍMITE DE PETICIONES (rate limiting) por IP, usando Cloudflare KV.
    // El dominio aswolfram.org no está gestionado en Cloudflare, así que
    // las reglas de Rate Limiting del panel (a nivel de zona DNS) no están
    // disponibles. Esta es la alternativa equivalente a nivel de código:
    // máximo 10 peticiones por IP cada 60 segundos a este endpoint. Si se
    // supera, se rechaza con 429 ANTES de gastar ninguna llamada a Stripe.
    // Requiere un namespace KV llamado RATE_LIMIT_KV enlazado en Cloudflare
    // (Settings → Functions → KV namespace bindings). Si no está enlazado,
    // se omite el límite en vez de romper la donación (fail-open).
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
          return new Response(
            JSON.stringify({ error: "Demasiadas solicitudes. Inténtalo de nuevo en un minuto." }),
            { status: 429, headers: cors }
          );
        }
        // expirationTtl reinicia el contador automáticamente pasada la ventana
        await env.RATE_LIMIT_KV.put(clave, String(contador + 1), { expirationTtl: VENTANA_SEGUNDOS });
      } catch (e) {
        // Si KV falla por cualquier motivo, no bloqueamos donaciones legítimas
        // por un problema de infraestructura ajeno al donante.
      }
    }

    const body = await context.request.json();
    const { importe, nombre, email, dni } = body || {};

    // Defensa en profundidad: el HTML ya limita estos campos con maxlength,
    // pero alguien podría llamar a esta API directamente sin pasar por el
    // formulario. Stripe rechaza valores de metadata de más de 500
    // caracteres con un error que tumba toda la sesión de pago (incluida
    // la tarjeta), así que conviene cortar esto aquí con un mensaje claro.
    if ((nombre && nombre.length > 200) || (email && email.length > 200) || (dni && dni.length > 50)) {
      return new Response(JSON.stringify({ error: "Uno de los campos es demasiado largo." }), { status: 400, headers: cors });
    }

    const euros = Number(importe);
    if (!euros || euros < 1) {
      return new Response(JSON.stringify({ error: "Importe no válido" }), { status: 400, headers: cors });
    }
    if (euros > 10000) {
      return new Response(JSON.stringify({ error: "Importe demasiado alto. Contacta con la asociación." }), { status: 400, headers: cors });
    }

    // Dominio desde el que se llama (para las URLs de retorno tras pagar).
    // Se valida contra la lista blanca; si no coincide, se usa siempre el
    // dominio oficial de Cloudflare Pages como fallback seguro, en vez de
    // confiar ciegamente en lo que el cliente diga ser.
    const origenSolicitado = context.request.headers.get("origin");
    const origin = ORIGENES_PERMITIDOS.includes(origenSolicitado)
      ? origenSolicitado
      : ORIGENES_PERMITIDOS[0];

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