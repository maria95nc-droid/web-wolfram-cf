export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
  const headers = { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" };

  try {
    const env = context.env;
    if (!env.ADMIN_TOKEN) return json({ error: "Falta configurar ADMIN_TOKEN" }, 500, headers);
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return json({ error: "Faltan variables de Supabase" }, 500, headers);

    const auth = context.request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : (context.request.headers.get("x-admin-token") || "");
    if (!token || token !== env.ADMIN_TOKEN) return json({ error: "No autorizado" }, 401, headers);

    const body = await context.request.json().catch(() => null);
    const objetivo = Number(body?.objetivo);
    const recaudado = Number(body?.recaudado);
    const donantes = parseInt(body?.donantes, 10);

    if (!Number.isFinite(objetivo) || objetivo < 1 || objetivo > 1000000) return json({ error: "Objetivo no válido" }, 400, headers);
    if (!Number.isFinite(recaudado) || recaudado < 0 || recaudado > 1000000) return json({ error: "Recaudado no válido" }, 400, headers);
    if (!Number.isFinite(donantes) || donantes < 0 || donantes > 100000) return json({ error: "Número de donantes no válido" }, 400, headers);

    const payload = {
      objetivo,
      recaudado_manual: recaudado,
      donantes_manual: donantes,
      actualizado: new Date().toISOString().slice(0, 10),
    };

    const patch = await fetch(`${env.SUPABASE_URL}/rest/v1/campaign?id=eq.1`, {
      method: "PATCH",
      headers: supabaseHeaders(env, "return=representation"),
      body: JSON.stringify(payload),
    });

    if (!patch.ok) {
      const t = await patch.text();
      return json({ error: "Error guardando campaña", detalle: t }, 500, headers);
    }

    const rows = await patch.json().catch(() => []);
    const c = rows[0] || payload;
    return json({
      objetivo: Number(c.objetivo ?? objetivo),
      recaudado: Number(c.recaudado_manual ?? recaudado),
      donantes: Number(c.donantes_manual ?? donantes),
      actualizado: c.actualizado || payload.actualizado,
    }, 200, headers);
  } catch (err) {
    return json({ error: err.message }, 500, headers);
  }
}

function supabaseHeaders(env, prefer) {
  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) h.Prefer = prefer;
  return h;
}
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store, max-age=0",
  };
}
function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}
