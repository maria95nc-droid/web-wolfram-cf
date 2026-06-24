-- ============================================================
--  AEIASW · Campaña simple con barra manual
--  Sistema sin formulario, sin datos personales en la web.
--  La barra se actualiza desde /admin.html mediante Cloudflare.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.campaign (
  id int primary key default 1,
  titulo text not null default 'Un cumpleaños por la investigación del Síndrome de Wolfram',
  subtitulo text not null default 'El regalo puede cambiar muchas vidas.',
  homenajeado text not null default 'Dra. Gema Esteban Bueno',
  objetivo numeric not null default 1000,
  recaudado_manual numeric not null default 0,
  donantes_manual int not null default 0,
  actualizado date not null default current_date,
  activo boolean not null default true,
  single_row boolean not null default true,
  constraint solo_una_fila_campaign unique (single_row)
);

-- Si la tabla ya existía de versiones anteriores, asegura las columnas necesarias.
alter table public.campaign add column if not exists titulo text not null default 'Un cumpleaños por la investigación del Síndrome de Wolfram';
alter table public.campaign add column if not exists subtitulo text not null default 'El regalo puede cambiar muchas vidas.';
alter table public.campaign add column if not exists homenajeado text not null default 'Dra. Gema Esteban Bueno';
alter table public.campaign add column if not exists objetivo numeric not null default 1000;
alter table public.campaign add column if not exists recaudado_manual numeric not null default 0;
alter table public.campaign add column if not exists donantes_manual int not null default 0;
alter table public.campaign add column if not exists actualizado date not null default current_date;
alter table public.campaign add column if not exists activo boolean not null default true;
alter table public.campaign add column if not exists single_row boolean not null default true;

insert into public.campaign (id, objetivo, recaudado_manual, donantes_manual)
values (1, 1000, 0, 0)
on conflict (id) do nothing;

-- Objetivo solicitado para esta versión: 1.000 €.
update public.campaign
set objetivo = 1000,
    actualizado = current_date
where id = 1;

-- Vista pública compatible por si se consulta desde Supabase o desde versiones anteriores.
drop view if exists public.totales;
create view public.totales as
select
  c.objetivo,
  c.recaudado_manual as recaudado,
  c.donantes_manual as donantes,
  c.titulo,
  c.subtitulo,
  c.homenajeado,
  c.actualizado,
  c.activo
from public.campaign c
where c.id = 1;

grant select on public.totales to anon;
grant select on public.totales to authenticated;

-- RLS: el público no escribe. Las funciones de Cloudflare usan service_role.
alter table public.campaign enable row level security;

drop policy if exists "leer campaña pública" on public.campaign;
create policy "leer campaña pública"
  on public.campaign for select
  to anon
  using (true);

-- Opcional: se conservan tablas anteriores de donaciones si existían, pero esta versión no las usa.
-- La web ya no recoge nombre, email, DNI ni importes individuales.
