-- ============================================================
--  AEIASW · Donaciones sin pasarela
--  Barra principal por DONANTES CONFIRMADOS
--  Supabase / PostgreSQL
--
--  Pega este SQL en: Supabase → SQL Editor → New query → Run
-- ============================================================

create extension if not exists pgcrypto;

-- 1) TABLA: campaña
-- objetivo_donantes = objetivo de la barra principal.
-- objetivo = objetivo económico informativo/legado, por si se quiere mostrar o consultar.
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

-- Migración defensiva si la tabla ya existía.
alter table public.campaign add column if not exists objetivo_donantes int not null default 100;

insert into public.campaign (id, objetivo, objetivo_donantes)
values (1, 1000, 100)
on conflict (id) do update
set objetivo = excluded.objetivo,
    objetivo_donantes = excluded.objetivo_donantes;

-- 2) TABLA: donaciones
-- estado = 'pendiente': el donante rellenó el formulario, pero AEIASW aún no ha confirmado el ingreso.
-- estado = 'confirmado': AEIASW confirmó el ingreso en banco/Bizum. Solo aquí suben la barra de donantes y el importe.
-- estado = 'descartado': registro duplicado, erróneo, spam o no recibido.
create table if not exists public.donations (
  id                  uuid primary key default gen_random_uuid(),
  importe             numeric not null,
  importe_confirmado  numeric,
  metodo              text    not null default 'bizum',
  estado              text    not null default 'pendiente',
  nombre              text    not null,
  email               text,
  dni                 text,
  anonimo             boolean not null default false,
  referencia          text unique,
  concepto            text,
  notas               text,
  creado              timestamptz not null default now(),
  confirmado_en       timestamptz
);

-- Migración defensiva por si la tabla venía de la versión con Stripe o de una versión anterior.
alter table public.donations add column if not exists importe_confirmado numeric;
alter table public.donations add column if not exists estado text not null default 'pendiente';
alter table public.donations add column if not exists referencia text unique;
alter table public.donations add column if not exists concepto text;
alter table public.donations add column if not exists notas text;
alter table public.donations add column if not exists confirmado_en timestamptz;
alter table public.donations add column if not exists anonimo boolean not null default false;

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

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'donations_estado_valido') THEN
    ALTER TABLE public.donations
      ADD CONSTRAINT donations_estado_valido CHECK (estado IN ('pendiente','confirmado','descartado'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'donations_metodo_valido') THEN
    ALTER TABLE public.donations
      ADD CONSTRAINT donations_metodo_valido CHECK (metodo IN ('bizum','transferencia','tarjeta'));
  END IF;
END $$;

create index if not exists donations_estado_idx on public.donations (estado);
create index if not exists donations_creado_idx on public.donations (creado desc);
create index if not exists donations_referencia_idx on public.donations (referencia);

-- 3) VISTA PÚBLICA: totales sin exponer datos personales.
-- Barra principal: donantes_confirmados / objetivo_donantes.
-- Importe recaudado: solo dinero confirmado manualmente por AEIASW.
-- Pendientes: registros recibidos, visibles como dato secundario para gestión/transparencia.
drop view if exists public.totales;
create view public.totales as
select
  c.objetivo as objetivo_euros,
  c.objetivo_donantes,
  c.objetivo_donantes as objetivo,
  coalesce((
    select count(*)
    from public.donations d
    where d.estado = 'confirmado'
  ), 0) as donantes_confirmados,
  coalesce((
    select count(*)
    from public.donations d
    where d.estado = 'pendiente'
  ), 0) as donantes_pendientes,
  coalesce((
    select count(*)
    from public.donations d
    where d.estado in ('pendiente','confirmado')
  ), 0) as donantes_total,
  coalesce((
    select count(*)
    from public.donations d
    where d.estado = 'confirmado'
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
-- Las inserciones las hace Cloudflare con SUPABASE_SERVICE_KEY.
revoke all on public.donations from anon;
revoke all on public.donations from authenticated;

-- ============================================================
--  CÓMO CONFIRMAR UNA DONACIÓN MANUALMENTE
-- ============================================================
-- Opción A: en Supabase Table Editor, busca la fila por referencia y cambia:
--   estado = confirmado
--   confirmado_en = now()
--   importe_confirmado = importe real recibido, si difiere del prometido
--
-- Opción B: SQL, sustituyendo la referencia:
-- update public.donations
-- set estado = 'confirmado',
--     importe_confirmado = coalesce(importe_confirmado, importe),
--     confirmado_en = now()
-- where referencia = 'WG260624-XXXXXX';
--
-- Para descartar spam/error:
-- update public.donations
-- set estado = 'descartado', notas = 'No recibido / duplicado / error'
-- where referencia = 'WG260624-XXXXXX';
--
-- Para cambiar el objetivo de donantes de la barra principal:
-- update public.campaign
-- set objetivo_donantes = 150
-- where id = 1;

-- ============================================================
--  PANEL PRIVADO /admin.html
-- ============================================================
-- Esta versión incluye dos funciones Cloudflare protegidas por ADMIN_TOKEN:
--   /api/admin/listar-donaciones
--   /api/admin/actualizar-donacion
--
-- No hacen falta políticas públicas sobre donations. El panel privado usa
-- funciones servidor con SUPABASE_SERVICE_KEY y valida ADMIN_TOKEN antes de
-- leer o actualizar cualquier fila.
