-- ============================================================
--  AEIASW · Donaciones sin pasarela
--  Registro honesto automático + confirmación manual
--  Supabase / PostgreSQL
--
--  Pega este SQL en: Supabase → SQL Editor → New query → Run
-- ============================================================

create extension if not exists pgcrypto;

-- 1) TABLA: campaña
-- objetivo_donantes = objetivo visual del contador principal de personas registradas.
-- objetivo = objetivo económico informativo/legado, por si se quiere consultar o mostrar.
create table if not exists public.campaign (
  id                 int primary key default 1,
  titulo             text    not null default 'Un cumpleaños por la investigación del Síndrome de Wolfram',
  subtitulo          text    not null default 'pero el regalo puede cambiar muchas vidas.',
  homenajeado        text    not null default 'Dra. Gema Esteban Bueno',
  objetivo           numeric not null default 1000,
  objetivo_donantes  int     not null default 100,
  actualizado        date    not null default current_date,
  activo             boolean not null default true,
  single_row         boolean not null default true,
  constraint solo_una_fila unique (single_row)
);

alter table public.campaign add column if not exists objetivo_donantes int not null default 100;

insert into public.campaign (id, objetivo, objetivo_donantes)
values (1, 1000, 100)
on conflict (id) do update
set objetivo = excluded.objetivo,
    objetivo_donantes = excluded.objetivo_donantes;

-- 2) TABLA: donaciones
-- Estados:
--   registrada        = el donante rellenó el formulario y recibió referencia/IBAN/Bizum.
--   declarada_pagada  = el donante pulsó "Ya he realizado la donación".
--   confirmado        = AEIASW verificó el ingreso real en banco/Bizum.
--   descartado        = error, duplicado, spam o ingreso no recibido.
create table if not exists public.donations (
  id                    uuid primary key default gen_random_uuid(),
  importe               numeric not null,
  importe_confirmado    numeric,
  metodo                text    not null default 'bizum',
  estado                text    not null default 'registrada',
  nombre                text    not null,
  email                 text,
  dni                   text,
  anonimo               boolean not null default false,
  referencia            text unique,
  concepto              text,
  public_token          text,
  notas                 text,
  creado                timestamptz not null default now(),
  declarado_pagado_en   timestamptz,
  confirmado_en         timestamptz
);

-- Migración defensiva por si la tabla venía de versiones anteriores.
alter table public.donations add column if not exists importe_confirmado numeric;
alter table public.donations add column if not exists estado text not null default 'registrada';
alter table public.donations alter column estado set default 'registrada';
alter table public.donations add column if not exists referencia text;
alter table public.donations add column if not exists concepto text;
alter table public.donations add column if not exists public_token text;
alter table public.donations add column if not exists notas text;
alter table public.donations add column if not exists declarado_pagado_en timestamptz;
alter table public.donations add column if not exists confirmado_en timestamptz;
alter table public.donations add column if not exists anonimo boolean not null default false;

-- Compatibilidad con la versión anterior: "pendiente" pasa a "registrada".
alter table public.donations drop constraint if exists donations_estado_valido;
update public.donations
set estado = 'registrada'
where estado = 'pendiente';

-- Constraints idempotentes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'donations_importe_positivo') THEN
    ALTER TABLE public.donations
      ADD CONSTRAINT donations_importe_positivo CHECK (importe > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'donations_importe_confirmado_valido') THEN
    ALTER TABLE public.donations
      ADD CONSTRAINT donations_importe_confirmado_valido CHECK (importe_confirmado IS NULL OR importe_confirmado >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'donations_metodo_valido') THEN
    ALTER TABLE public.donations
      ADD CONSTRAINT donations_metodo_valido CHECK (metodo IN ('bizum','transferencia','tarjeta'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'donations_referencia_unique') THEN
    ALTER TABLE public.donations
      ADD CONSTRAINT donations_referencia_unique UNIQUE (referencia);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'donations_public_token_unique') THEN
    ALTER TABLE public.donations
      ADD CONSTRAINT donations_public_token_unique UNIQUE (public_token);
  END IF;
END $$;

alter table public.donations
  add constraint donations_estado_valido
  check (estado in ('registrada','declarada_pagada','confirmado','descartado'));

create index if not exists donations_estado_idx on public.donations (estado);
create index if not exists donations_creado_idx on public.donations (creado desc);
create index if not exists donations_referencia_idx on public.donations (referencia);
create index if not exists donations_public_token_idx on public.donations (public_token);

-- 3) VISTA PÚBLICA: totales sin exponer datos personales.
-- Contador principal: registros_total / objetivo_donantes.
-- Importe recaudado: solo dinero confirmado manualmente por AEIASW.
drop view if exists public.totales;
create view public.totales as
select
  c.objetivo as objetivo_euros,
  c.objetivo_donantes,
  c.objetivo_donantes as objetivo,
  coalesce((
    select count(*)
    from public.donations d
    where d.estado in ('registrada','declarada_pagada','confirmado')
  ), 0) as registros_total,
  coalesce((
    select count(*)
    from public.donations d
    where d.estado in ('registrada','declarada_pagada','confirmado')
  ), 0) as donantes_registrados,
  coalesce((
    select count(*)
    from public.donations d
    where d.estado in ('declarada_pagada','confirmado')
  ), 0) as donantes_declarados,
  coalesce((
    select count(*)
    from public.donations d
    where d.estado = 'declarada_pagada'
  ), 0) as donantes_por_verificar,
  coalesce((
    select count(*)
    from public.donations d
    where d.estado = 'confirmado'
  ), 0) as donantes_confirmados,
  coalesce((
    select count(*)
    from public.donations d
    where d.estado in ('registrada','declarada_pagada')
  ), 0) as donantes_pendientes,
  coalesce((
    select count(*)
    from public.donations d
    where d.estado in ('registrada','declarada_pagada','confirmado')
  ), 0) as donantes_total,
  coalesce((
    select count(*)
    from public.donations d
    where d.estado in ('registrada','declarada_pagada','confirmado')
  ), 0) as donantes,
  coalesce((
    select sum(coalesce(d.importe_confirmado, d.importe))
    from public.donations d
    where d.estado = 'confirmado'
  ), 0) as recaudado_confirmado,
  coalesce((
    select sum(coalesce(d.importe_confirmado, d.importe))
    from public.donations d
    where d.estado = 'confirmado'
  ), 0) as recaudado,
  c.titulo,
  c.subtitulo,
  c.homenajeado,
  c.actualizado,
  c.activo
from public.campaign c
where c.id = 1;

grant select on public.totales to anon;

-- 4) SEGURIDAD
alter table public.campaign enable row level security;
alter table public.donations enable row level security;

-- Público: puede leer datos generales de campaña.
drop policy if exists "leer campaña pública" on public.campaign;
create policy "leer campaña pública"
  on public.campaign for select
  to anon
  using (true);

-- Público: NO puede leer ni escribir donations.
-- Las inserciones/actualizaciones públicas las hace Cloudflare con SUPABASE_SERVICE_KEY.
revoke all on public.donations from anon;
revoke all on public.donations from authenticated;

-- ============================================================
--  FLUJO OPERATIVO
-- ============================================================
-- 1) Usuario registra la donación:
--      estado = registrada
-- 2) Usuario hace Bizum/transferencia y pulsa "Ya he realizado la donación":
--      estado = declarada_pagada
-- 3) AEIASW revisa banco/Bizum en /admin.html y confirma:
--      estado = confirmado
--      importe_confirmado = importe real recibido
--      confirmado_en = now()
-- 4) Si es error/spam/no recibido:
--      estado = descartado
--
-- Para cambiar el objetivo visual de registros:
-- update public.campaign
-- set objetivo_donantes = 150
-- where id = 1;

-- ============================================================
--  PANEL PRIVADO /admin.html
-- ============================================================
-- Funciones Cloudflare protegidas por ADMIN_TOKEN:
--   /api/admin/listar-donaciones
--   /api/admin/actualizar-donacion
--
-- Función pública de registro:
--   /api/registrar-donacion
--
-- Función pública para declarar pago realizado:
--   /api/declarar-donacion-pagada
