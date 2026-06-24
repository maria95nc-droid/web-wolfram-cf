# Guía rápida · Web Wolfram simple con barra manual

## Qué cambia esta versión

Esta versión elimina el formulario de donación y los registros individuales.

La web pública solo muestra:

- Barra de recaudación manual.
- Objetivo de 1.000 €.
- Datos para donar por transferencia bancaria.
- Código Bizum ONG.
- Información fiscal y correo de AEIASW para pedir certificado.

El panel privado `/admin.html` permite actualizar desde el móvil:

- Recaudado confirmado.
- Número de donantes anotados.
- Objetivo.

## Archivos importantes

```txt
index.html
admin.html
og-wolfram.jpg
01_esquema_supabase.sql
functions/api/totales-publicos.js
functions/api/admin/actualizar-campana.js
```

## Variables de Cloudflare necesarias

En Cloudflare Pages → Settings → Environment variables → Production:

```txt
SUPABASE_URL
SUPABASE_SERVICE_KEY
ADMIN_TOKEN
```

No hacen falta variables de Stripe.

## Subir a GitHub

Sube el contenido del ZIP, no la carpeta ni el ZIP entero.

La raíz del repositorio debe quedar así:

```txt
/index.html
/admin.html
/og-wolfram.jpg
/01_esquema_supabase.sql
/GUIA_CLOUDFLARE.md
/functions/api/totales-publicos.js
/functions/api/admin/actualizar-campana.js
```

## Ejecutar SQL

En Supabase:

```txt
SQL Editor → New query → pegar 01_esquema_supabase.sql → Run
```

Esto deja `campaign.objetivo = 1000`.

## Usar el panel admin

Abrir:

```txt
https://donaciones.aswolfram.org/admin.html
```

Introducir el `ADMIN_TOKEN`.

Actualizar:

- Recaudado confirmado.
- Donantes anotados.
- Objetivo.

Guardar.

La web pública lee los datos desde:

```txt
/api/totales-publicos
```

## Datos de donación incluidos

```txt
Bizum ONG: 02820
IBAN: ES79 0182 1454 1502 0853 7115
Titular: Asociación Española para la Investigación y Ayuda al Síndrome de Wolfram
CIF: G91036087
Correo certificado fiscal: aswolfram@aswolfram.org
```

## Texto fiscal

La web indica que no recoge datos personales. Quien necesite certificado fiscal debe escribir a `aswolfram@aswolfram.org` con nombre, DNI/NIF, importe, fecha aproximada y justificante.
