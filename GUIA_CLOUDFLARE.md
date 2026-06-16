# 🚀 Mudanza a Cloudflare Pages — Guía paso a paso

Tu web pasa de Netlify a Cloudflare Pages (más estable, sin pausas por uso).
El código ya está adaptado. Solo tienes que seguir estos pasos.

> Lo que cambia respecto a Netlify:
> - Las funciones ahora están en `/functions/api/` (Cloudflare las detecta solo).
> - El front llama a `/api/crear-donacion` (ya está cambiado).
> - Todo lo demás (Supabase, Stripe) es igual.

---

## PASO 1 · Subir el código nuevo a GitHub

Tienes dos opciones. La MÁS SIMPLE es crear un repositorio nuevo:

### Opción A — Repositorio nuevo (recomendada, más limpia)
1. Descomprime este paquete en una carpeta (ej. `web-wolfram-cloudflare`).
2. Ábrela en VS Code.
3. En la terminal:
   ```
   git init
   git add .
   git commit -m "Web para Cloudflare"
   ```
4. Crea un repositorio nuevo en github.com (botón "New"), ponle un nombre
   (ej. `web-wolfram-cf`), NO marques añadir README/gitignore.
5. Conéctalo y sube (cambia TU_USUARIO):
   ```
   git remote add origin https://github.com/TU_USUARIO/web-wolfram-cf.git
   git branch -M main
   git push -u origin main
   ```

### Opción B — Reusar tu repositorio actual
Si prefieres usar el mismo repo `web-wolfram`, reemplaza los archivos por los de
este paquete, y haz `git add . && git commit -m "Adaptar a Cloudflare" && git push`.
(Pero la Opción A es más limpia para no mezclar lo de Netlify.)

---

## PASO 2 · Crear cuenta en Cloudflare y conectar GitHub

1. Entra en **dash.cloudflare.com** → crea una cuenta (gratis) o inicia sesión.
2. En el menú izquierdo, busca **"Workers & Pages"**.
3. Pulsa **"Create application"** → pestaña **"Pages"** → **"Connect to Git"**.
4. Autoriza a Cloudflare a acceder a tu GitHub y elige el repositorio
   (`web-wolfram-cf` o el que hayas usado).
5. En la configuración de build:
   - **Framework preset:** None (ninguno)
   - **Build command:** déjalo VACÍO
   - **Build output directory:** déjalo como `/` o vacío
   (Tu web es HTML simple, no necesita "construirse".)
6. Pulsa **"Save and Deploy"**.

En 1-2 minutos tendrás tu web en una dirección tipo `web-wolfram-cf.pages.dev`.

---

## PASO 3 · Poner las 4 variables de entorno

En Cloudflare → tu proyecto Pages → **Settings** → **Environment variables**
(o "Variables and Secrets"). Añade estas 4 (en "Production"):

| Nombre                  | Valor                                          |
|-------------------------|------------------------------------------------|
| `STRIPE_SECRET_KEY`     | tu `sk_test_...` (luego la real de AEIASW)      |
| `STRIPE_WEBHOOK_SECRET` | lo obtienes en el Paso 4                         |
| `SUPABASE_URL`          | `https://wjdstglnteaegxhgxadh.supabase.co`      |
| `SUPABASE_SERVICE_KEY`  | tu clave service_role (secreta) de Supabase      |

> Son las MISMAS que ya tenías en Netlify. Cloudflare te deja marcarlas como
> "secret" (cifradas) — marca como secretas las de Stripe y la service_role.

Tras añadirlas, vuelve a desplegar (Deployments → Retry deployment) para que
las funciones las cojan.

---

## PASO 4 · Rehacer el webhook de Stripe con la nueva dirección

Como la dirección de la web cambia, hay que crear un webhook nuevo apuntando a Cloudflare.

1. En Stripe (modo prueba) → **Desarrolladores → Webhooks → Add endpoint**.
2. URL del endpoint:
   ```
   https://TU-WEB.pages.dev/api/stripe-webhook
   ```
   (cambia `TU-WEB.pages.dev` por tu dirección real de Cloudflare)
3. Evento: `checkout.session.completed`
4. Crea el endpoint y copia el **Signing secret** (`whsec_...`).
5. Pégalo en la variable `STRIPE_WEBHOOK_SECRET` de Cloudflare (Paso 3).
6. Vuelve a desplegar.

---

## PASO 5 · Probar

1. Abre tu web `.pages.dev`, recarga (Ctrl+Shift+R).
2. Comprueba que la barra carga (lee de Supabase).
3. Haz una donación de prueba con la tarjeta `4242 4242 4242 4242`.
4. Comprueba que:
   - Vuelve a TU web `.pages.dev` (no a otra)
   - La barra sube sola
   - En Supabase → `donations` aparece la donación

Si los 3 puntos van ✅, la mudanza está completa y funcionando.

---

## Notas

- Las funciones de Cloudflare ya verifican la firma de Stripe de forma segura
  (igual que en Netlify, pero adaptado a este entorno).
- Tu clave anon de Supabase ya está puesta en el `index.html`.
- Cuando AEIASW tenga su Stripe real: cambias `STRIPE_SECRET_KEY` y rehaces el
  webhook (Paso 4) en modo real. Igual que en Netlify.
- Antes de lanzar: resetea la barra a 0 en Supabase (Table Editor → campaign →
  pon recaudado_tarjeta y recaudado_manual a 0).
