# Guía de despliegue · AEIASW donaciones sin pasarela + panel privado

Esta versión **no usa Stripe**. El donante registra su compromiso en la web y después paga por **Bizum ONG** o **transferencia**.

Ahora incluye una pantalla privada para que AEIASW confirme pagos sin entrar directamente en el editor de tablas de Supabase.

## Cambio principal

La barra principal **no mide euros**.

Ahora mide:

```txt
Donantes confirmados / objetivo de donantes
```

El importe económico queda como dato secundario:

```txt
Euros confirmados
```

Esto evita el problema de los tiempos de transferencia: la barra solo sube cuando AEIASW confirma que el pago llegó de verdad.

## Datos configurados

- Asociación: Asociación Española para la Investigación y Ayuda al Síndrome de Wolfram
- CIF: G91036087
- Dirección: Picadilly 7, Costacabana, Almería. 04120
- Bizum ONG: `02820`
- IBAN: `ES79 0182 1454 1502 0853 7115`
- Titular: Asociación Española para la Investigación y Ayuda al Síndrome de Wolfram
- Concepto base: `DONACION WOLFRAM GEMA`

No se publica el DNI/NIF personal de la responsable en el HTML público porque no es necesario para el formulario de donación y supone exponer un dato personal.

## Flujo público

1. El usuario pulsa **Registrar mi donación**.
2. Rellena nombre, importe, método y acepta privacidad.
3. Cloudflare llama a `/api/registrar-donacion`.
4. Se crea una fila en Supabase con `estado = pendiente`.
5. La barra principal todavía no sube.
6. AEIASW revisa banco/Bizum.
7. AEIASW confirma la donación desde `/admin.html`.
8. Entonces sube la barra de donantes confirmados y también el importe confirmado.

## Panel privado cómodo

URL:

```txt
https://donaciones.aswolfram.org/admin.html
```

Ese HTML puede abrirlo cualquiera que conozca la URL, pero **no puede ver ni modificar datos sin el token de administración**.

El token se valida en Cloudflare con la variable:

```txt
ADMIN_TOKEN
```

No está escrito en `admin.html` ni en el repositorio.

Desde el panel se puede:

```txt
- ver pendientes, confirmadas y descartadas
- copiar el concepto/referencia
- confirmar una donación recibida
- cambiar el importe confirmado si llegó una cantidad distinta
- descartar spam/error/no recibido
- devolver una donación a pendiente
```

## Archivos importantes

```txt
index.html
admin.html
01_esquema_supabase.sql
functions/api/registrar-donacion.js
functions/api/admin/listar-donaciones.js
functions/api/admin/actualizar-donacion.js
og-wolfram.jpg
```

Las funciones antiguas de Stripe han sido eliminadas.

## Variables necesarias en Cloudflare Pages

En Cloudflare Pages → Settings → Environment variables → Production:

```txt
SUPABASE_URL
SUPABASE_SERVICE_KEY
ADMIN_TOKEN
```

Opcional, pero recomendable:

```txt
RATE_LIMIT_KV
```

No hacen falta ya:

```txt
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
```

## Cómo crear ADMIN_TOKEN

Usa una contraseña larga, no una palabra simple. Ejemplo de formato:

```txt
AEIASW-2026-Wolfram-una-frase-larga-con-numeros-4729
```

Mejor aún: genera una cadena aleatoria larga y guárdala en un sitio seguro.

Si alguien que no debe tiene el token, cambia `ADMIN_TOKEN` en Cloudflare y redespliega.

## Supabase

1. Ve a Supabase → SQL Editor.
2. Pega y ejecuta `01_esquema_supabase.sql`.
3. Comprueba que existen:

```txt
campaign
donations
totales
```

## Objetivo de donantes

Por defecto queda en:

```txt
100 donantes confirmados
```

Para cambiarlo, ejecuta:

```sql
update public.campaign
set objetivo_donantes = 150
where id = 1;
```

## Confirmar una donación desde el panel

1. Abre `/admin.html`.
2. Pega el token de administración.
3. Localiza la donación pendiente.
4. Revisa en banco/Bizum que el ingreso llegó.
5. Si llegó, pulsa **Confirmar**.
6. Si llegó otra cantidad, cambia antes el campo **Confirmado**.
7. Si no llegó o es spam/error, pulsa **Descartar**.

Cuando confirmas:

```txt
- estado pasa a confirmado
- confirmado_en se rellena automáticamente
- importe_confirmado se guarda
- sube la barra pública de donantes confirmados
- sube el importe confirmado
- deja de contar como pendiente
```

## Confirmar una donación desde Supabase, si hiciera falta

```sql
update public.donations
set estado = 'confirmado',
    importe_confirmado = coalesce(importe_confirmado, importe),
    confirmado_en = now()
where referencia = 'WG260624-XXXXXX';
```

## Descartar spam o error desde Supabase

```sql
update public.donations
set estado = 'descartado',
    notas = 'No recibido / duplicado / error',
    importe_confirmado = null,
    confirmado_en = null
where referencia = 'WG260624-XXXXXX';
```

Los registros descartados no cuentan como donantes confirmados ni como euros.

## Prueba obligatoria antes de lanzar

1. Despliega en Cloudflare.
2. Ejecuta el SQL en Supabase.
3. Configura `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` y `ADMIN_TOKEN`.
4. Abre `https://donaciones.aswolfram.org/`.
5. Registra una donación de prueba de 1 €.
6. Comprueba que aparece una fila `pendiente` en el panel `/admin.html`.
7. Comprueba que **no sube** la barra principal todavía.
8. Confirma esa fila desde el panel.
9. Comprueba que sube la barra de donantes confirmados.
10. Comprueba que sube el importe confirmado.
11. Descarta o borra la prueba antes de publicar masivamente.

## Advertencia técnica

Este sistema elimina comisiones de pasarela, pero no prueba automáticamente que el usuario haya pagado. Por eso la barra principal solo sube con `estado = confirmado`, no simplemente cuando alguien rellena el formulario.
