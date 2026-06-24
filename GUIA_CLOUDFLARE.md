# Guía de despliegue · AEIASW Donaciones sin Stripe

Esta versión no usa pasarela de pago. El donante **registra su donación**, recibe una **referencia única** y después paga por **Bizum ONG** o **transferencia**.

## Flujo final

1. El usuario pulsa **Registrar mi donación**.
2. Rellena nombre, importe, método, email/DNI opcionales y acepta privacidad.
3. La web guarda una fila en Supabase con:
   - `estado = registrada`
   - `referencia = WG...`
   - `concepto = DONACION WOLFRAM GEMA WG...`
4. Solo después del registro, la web muestra:
   - Bizum ONG: `02820`
   - IBAN: `ES79 0182 1454 1502 0853 7115`
   - Titular: Asociación Española para la Investigación y Ayuda al Síndrome de Wolfram
   - Concepto único para copiar.
5. El usuario hace Bizum o transferencia.
6. El usuario pulsa **Ya he realizado la donación**.
7. La web actualiza la fila a:
   - `estado = declarada_pagada`
8. AEIASW revisa banco/Bizum desde `/admin.html`.
9. Si el ingreso llegó, AEIASW pulsa **Confirmar**.
10. Entonces la fila pasa a:
   - `estado = confirmado`
   - `importe_confirmado = importe recibido`
   - `confirmado_en = fecha de confirmación`

## Qué muestra la web pública

La web distingue entre tres niveles:

- **Personas registradas**: rellenaron el formulario y recibieron referencia.
- **Han marcado pago realizado**: pulsaron “Ya he realizado la donación”.
- **Confirmadas por AEIASW**: el dinero se verificó en banco/Bizum.

El importe en euros solo suma con `estado = confirmado`.

## Archivos principales

```txt
index.html
admin.html
og-wolfram.jpg
01_esquema_supabase.sql
functions/api/registrar-donacion.js
functions/api/declarar-donacion-pagada.js
functions/api/admin/listar-donaciones.js
functions/api/admin/actualizar-donacion.js
```

## Variables necesarias en Cloudflare

En Cloudflare Pages → Settings → Environment variables → Production:

```txt
SUPABASE_URL
SUPABASE_SERVICE_KEY
ADMIN_TOKEN
```

Opcional:

```txt
RATE_LIMIT_KV
```

Ya no hacen falta variables de Stripe.

## Supabase

Ejecuta todo el contenido de:

```txt
01_esquema_supabase.sql
```

en:

```txt
Supabase → SQL Editor → New query → Run
```

Este SQL prepara los estados:

```txt
registrada
declarada_pagada
confirmado
descartado
```

También migra automáticamente registros antiguos con `estado = pendiente` a `estado = registrada`.

## Panel privado

URL:

```txt
https://donaciones.aswolfram.org/admin.html
```

El panel permite:

- ver todas las donaciones;
- filtrar por registrada, pago declarado, confirmada o descartada;
- copiar referencia/concepto;
- marcar una donación como pago declarado;
- confirmar una donación recibida;
- ajustar el importe confirmado;
- descartar spam, errores o donaciones no recibidas;
- devolver una fila a registrada.

## Prueba obligatoria

1. Despliega la web.
2. Ejecuta el SQL.
3. Comprueba que `ADMIN_TOKEN` existe en Cloudflare.
4. En la web pública registra una donación de prueba de 1 €.
5. Comprueba que aparece como `registrada` en `/admin.html`.
6. Comprueba que el contador de personas registradas sube.
7. En la pantalla final de la web pulsa **Ya he realizado la donación**.
8. Comprueba que en `/admin.html` pasa a `declarada_pagada`.
9. En `/admin.html`, pulsa **Confirmar**.
10. Comprueba que aparece como `confirmado`.
11. Comprueba que suben:
    - confirmadas por AEIASW;
    - euros confirmados.
12. Descarta o borra la prueba antes del lanzamiento real.

## Idea clave

Este sistema permite movimiento automático y honesto sin Stripe:

- el usuario registra su donación automáticamente;
- el usuario declara que ya ha pagado;
- AEIASW sigue teniendo la última palabra sobre lo realmente confirmado.

No se debe llamar “confirmada” a una donación hasta que AEIASW haya visto el ingreso real en banco/Bizum.


## Cambio de Bizum a transferencia tras registrar

La pantalla de datos de pago permite alternar entre Bizum ONG y transferencia sin recargar la página. Cuando el donante pulsa “Ya he realizado la donación”, se guarda también el método final elegido para que el panel admin refleje cómo dice haber pagado.
