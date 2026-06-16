-- ============================================================
--  AEIASW · Base de datos de donaciones (Supabase / PostgreSQL)
--  Pega este SQL en: Supabase → SQL Editor → New query → Run
-- ============================================================

-- 1) TABLA: campaña (una sola fila, la "configuración" del evento actual)
create table if not exists campaign (
  id               int primary key default 1,
  titulo           text    not null default 'Un cumpleaños por la investigación del Síndrome de Wolfram',
  subtitulo        text    not null default 'pero el regalo puede cambiar muchas vidas.',
  homenajeado      text    not null default 'Dra. Gema Esteban Bueno',
  objetivo         numeric not null default 2000,
  -- total recaudado SOLO por tarjeta (lo actualiza el webhook de Stripe, automático)
  recaudado_tarjeta numeric not null default 0,
  -- ajuste manual: aquí sumáis lo que entre por transferencia/Bizum
  recaudado_manual  numeric not null default 0,
  donantes_manual   int     not null default 0,
  actualizado      date    not null default current_date,
  activo           boolean not null default true,
  single_row       boolean not null default true,
  constraint solo_una_fila unique (single_row)
);

-- Inserta la fila inicial si no existe
insert into campaign (id) values (1)
on conflict (id) do nothing;

-- 2) TABLA: donaciones (cada pago con tarjeta queda registrado aquí)
create table if not exists donations (
  id          uuid primary key default gen_random_uuid(),
  importe     numeric not null,
  metodo      text    not null default 'tarjeta',   -- 'tarjeta' | 'transferencia' | 'bizum'
  nombre      text,
  email       text,
  dni         text,
  anonimo     boolean default false,
  stripe_id   text unique,                          -- id de la sesión de Stripe (evita duplicados)
  creado      timestamptz default now()
);

-- 3) VISTA: total recaudado (tarjeta automática + manual)
create or replace view totales as
select
  c.objetivo,
  c.recaudado_tarjeta + c.recaudado_manual                       as recaudado,
  (select count(*) from donations where metodo in ('tarjeta','bizum')) + c.donantes_manual as donantes,
  c.titulo, c.subtitulo, c.homenajeado, c.actualizado, c.activo
from campaign c
where c.id = 1;

-- Permitir que el público (rol anon) pueda LEER la vista de totales
grant select on totales to anon;

-- ============================================================
--  FUNCIÓN ATÓMICA para sumar a la barra sin riesgo de que dos
--  pagos simultáneos se pisen. El webhook la llama vía RPC.
-- ============================================================
create or replace function sumar_donacion(cantidad numeric)
returns void
language sql
as $$
  update campaign
     set recaudado_tarjeta = recaudado_tarjeta + cantidad,
         actualizado = current_date
   where id = 1;
$$;

-- ============================================================
--  SEGURIDAD (RLS): el público SOLO puede leer los totales,
--  nunca escribir. La escritura la hacen las funciones del
--  servidor con la clave secreta (service_role).
-- ============================================================
alter table campaign  enable row level security;
alter table donations enable row level security;

-- El público (anon) puede LEER la campaña (para pintar la barra).
-- DROP previo para poder re-ejecutar este script sin errores.
drop policy if exists "leer campaña pública" on campaign;
create policy "leer campaña pública"
  on campaign for select
  to anon
  using (true);

-- El público NO puede leer la lista de donaciones (datos personales)
-- (no creamos policy de select para anon => queda bloqueado)

-- Nadie escribe con clave pública. El back usa service_role,
-- que se salta RLS por diseño. No hace falta policy de insert/update.
