-- =============================================================================
-- Menuvo · Etapa 1 · Estrutura inicial multi-tenant
-- =============================================================================
-- Todo dado de negócio pertence a um restaurante (tenant). O isolamento é
-- garantido por RLS (Row Level Security) usando a tabela de vínculo
-- public.restaurant_users.
--
-- Prepara o terreno para as próximas etapas (categorias, produtos, mesas,
-- QR Codes, pedidos, pagamentos, planos) sem precisar recriar o modelo.
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'restaurant_status') then
    create type public.restaurant_status as enum ('draft', 'published', 'paused', 'closed');
  end if;

  if not exists (select 1 from pg_type where typname = 'restaurant_member_role') then
    create type public.restaurant_member_role as enum ('owner', 'admin', 'staff');
  end if;

  if not exists (select 1 from pg_type where typname = 'restaurant_member_status') then
    create type public.restaurant_member_status as enum ('active', 'invited', 'suspended');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- USERS
-- Espelho leve de auth.users. Nunca guardamos senha aqui — o Supabase Auth é a
-- fonte de verdade da autenticação.
-- -----------------------------------------------------------------------------
create table if not exists public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       citext,
  full_name   text,
  avatar_url  text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.users is 'Perfil público do usuário. Autenticação vive em auth.users.';

-- -----------------------------------------------------------------------------
-- RESTAURANTS (tenant raiz)
-- -----------------------------------------------------------------------------
create table if not exists public.restaurants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(trim(name)) between 2 and 120),
  slug          citext not null unique
                  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  logo_url      text,
  description   text check (description is null or char_length(description) <= 500),
  phone         text check (phone is null or char_length(phone) <= 32),
  address_line  text,
  address_number text,
  district      text,
  city          text,
  state         text check (state is null or char_length(state) <= 2),
  postal_code   text,
  status        public.restaurant_status not null default 'draft',
  -- Campos reservados para etapas futuras
  timezone      text not null default 'America/Sao_Paulo',
  currency      text not null default 'BRL',
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.restaurants is 'Tenant raiz: cada estabelecimento é um restaurante isolado.';
comment on column public.restaurants.settings is 'Preferências futuras (tema, idioma, personalização da etapa 8).';

create index if not exists restaurants_status_idx on public.restaurants (status);

-- -----------------------------------------------------------------------------
-- RESTAURANT_USERS (vínculo N:N usuário <-> restaurante, com papel)
-- -----------------------------------------------------------------------------
create table if not exists public.restaurant_users (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  user_id        uuid not null references public.users (id) on delete cascade,
  role           public.restaurant_member_role not null default 'owner',
  status         public.restaurant_member_status not null default 'active',
  invited_email  citext,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (restaurant_id, user_id)
);

comment on table public.restaurant_users is 'Um usuário pode pertencer a vários restaurantes, com papéis diferentes.';

create index if not exists restaurant_users_user_idx on public.restaurant_users (user_id);
create index if not exists restaurant_users_restaurant_idx on public.restaurant_users (restaurant_id);

-- -----------------------------------------------------------------------------
-- Helper: evita recursão infinita de RLS
-- SECURITY DEFINER para consultar o vínculo sem passar pela policy da própria
-- tabela restaurant_users.
-- -----------------------------------------------------------------------------
create or replace function public.is_restaurant_member(target_restaurant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.restaurant_users ru
    where ru.restaurant_id = target_restaurant_id
      and ru.user_id = auth.uid()
      and ru.status = 'active'
  );
$$;

create or replace function public.has_restaurant_role(
  target_restaurant_id uuid,
  allowed_roles public.restaurant_member_role[]
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.restaurant_users ru
    where ru.restaurant_id = target_restaurant_id
      and ru.user_id = auth.uid()
      and ru.status = 'active'
      and ru.role = any (allowed_roles)
  );
$$;

create or replace function public.is_restaurant_admin(target_restaurant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.has_restaurant_role(target_restaurant_id, array['owner','admin']::public.restaurant_member_role[]);
$$;

revoke all on function public.is_restaurant_member(uuid) from public;
revoke all on function public.has_restaurant_role(uuid, public.restaurant_member_role[]) from public;
revoke all on function public.is_restaurant_admin(uuid) from public;
grant execute on function public.is_restaurant_member(uuid) to authenticated;
grant execute on function public.has_restaurant_role(uuid, public.restaurant_member_role[]) to authenticated;
grant execute on function public.is_restaurant_admin(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_touch_updated_at on public.users;
create trigger users_touch_updated_at
  before update on public.users
  for each row execute function public.touch_updated_at();

drop trigger if exists restaurants_touch_updated_at on public.restaurants;
create trigger restaurants_touch_updated_at
  before update on public.restaurants
  for each row execute function public.touch_updated_at();

drop trigger if exists restaurant_users_touch_updated_at on public.restaurant_users;
create trigger restaurant_users_touch_updated_at
  before update on public.restaurant_users
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Provisionamento: ao criar conta no Supabase Auth, cria o perfil público.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- Provisionamento: criar restaurante é atômico (restaurante + vínculo owner).
-- Chamado por RPC autenticada — o cliente nunca escolhe o user_id.
-- -----------------------------------------------------------------------------
create or replace function public.create_restaurant(
  p_name text,
  p_slug text default null,
  p_description text default null,
  p_phone text default null,
  p_address_line text default null,
  p_address_number text default null,
  p_district text default null,
  p_city text default null,
  p_state text default null,
  p_postal_code text default null
)
returns public.restaurants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_base_slug text;
  v_slug text;
  v_attempt int := 0;
  v_restaurant public.restaurants;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_name is null or char_length(trim(p_name)) < 2 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  -- Slug base a partir do nome ou do valor informado
  v_base_slug := lower(coalesce(nullif(trim(p_slug), ''), p_name));
  v_base_slug := translate(v_base_slug, 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn');
  v_base_slug := regexp_replace(v_base_slug, '[^a-z0-9]+', '-', 'g');
  v_base_slug := regexp_replace(v_base_slug, '(^-+|-+$)', '', 'g');
  v_base_slug := left(v_base_slug, 48);

  if v_base_slug = '' then
    v_base_slug := 'restaurante';
  end if;

  v_slug := v_base_slug;

  loop
    begin
      insert into public.restaurants (
        name, slug, description, phone,
        address_line, address_number, district, city, state, postal_code
      )
      values (
        trim(p_name), v_slug, nullif(trim(coalesce(p_description, '')), ''),
        nullif(trim(coalesce(p_phone, '')), ''),
        nullif(trim(coalesce(p_address_line, '')), ''),
        nullif(trim(coalesce(p_address_number, '')), ''),
        nullif(trim(coalesce(p_district, '')), ''),
        nullif(trim(coalesce(p_city, '')), ''),
        nullif(upper(trim(coalesce(p_state, ''))), ''),
        nullif(trim(coalesce(p_postal_code, '')), '')
      )
      returning * into v_restaurant;

      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt > 20 then
        raise exception 'slug_unavailable' using errcode = '23505';
      end if;
      v_slug := v_base_slug || '-' || (v_attempt + 1)::text;
    end;
  end loop;

  insert into public.restaurant_users (restaurant_id, user_id, role, status)
  values (v_restaurant.id, v_user, 'owner', 'active')
  on conflict (restaurant_id, user_id) do nothing;

  return v_restaurant;
end;
$$;

revoke all on function public.create_restaurant(text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.create_restaurant(text, text, text, text, text, text, text, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.restaurants enable row level security;
alter table public.restaurant_users enable row level security;

-- users: cada um vê/edita o próprio perfil
drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users
  for select to authenticated
  using (id = auth.uid());

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- usuarios podem ver perfis de colegas dos mesmos restaurantes (para listar equipe)
drop policy if exists users_select_coworkers on public.users;
create policy users_select_coworkers on public.users
  for select to authenticated
  using (
    exists (
      select 1
      from public.restaurant_users me
      join public.restaurant_users other
        on other.restaurant_id = me.restaurant_id
      where me.user_id = auth.uid()
        and me.status = 'active'
        and other.user_id = public.users.id
    )
  );

-- restaurants: somente membros ativos leem; apenas owner/admin alteram
drop policy if exists restaurants_select_member on public.restaurants;
create policy restaurants_select_member on public.restaurants
  for select to authenticated
  using (public.is_restaurant_member(id));

drop policy if exists restaurants_update_admin on public.restaurants;
create policy restaurants_update_admin on public.restaurants
  for update to authenticated
  using (public.is_restaurant_admin(id))
  with check (public.is_restaurant_admin(id));

drop policy if exists restaurants_delete_owner on public.restaurants;
create policy restaurants_delete_owner on public.restaurants
  for delete to authenticated
  using (public.has_restaurant_role(id, array['owner']::public.restaurant_member_role[]));

-- Obs.: INSERT em restaurants acontece apenas via RPC create_restaurant
-- (SECURITY DEFINER), então não há policy de insert para clientes.

-- restaurant_users: membros veem a equipe do próprio restaurante
drop policy if exists restaurant_users_select_member on public.restaurant_users;
create policy restaurant_users_select_member on public.restaurant_users
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

drop policy if exists restaurant_users_insert_admin on public.restaurant_users;
create policy restaurant_users_insert_admin on public.restaurant_users
  for insert to authenticated
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists restaurant_users_update_admin on public.restaurant_users;
create policy restaurant_users_update_admin on public.restaurant_users
  for update to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists restaurant_users_delete_admin on public.restaurant_users;
create policy restaurant_users_delete_admin on public.restaurant_users
  for delete to authenticated
  using (public.is_restaurant_admin(restaurant_id));

-- -----------------------------------------------------------------------------
-- Storage: bucket público para logos (futuro: fotos de produtos na etapa 2)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'restaurant-assets',
  'restaurant-assets',
  true,
  2097152,
  array['image/png','image/jpeg','image/webp','image/svg+xml']
)
on conflict (id) do nothing;

drop policy if exists restaurant_assets_public_read on storage.objects;
create policy restaurant_assets_public_read on storage.objects
  for select to public
  using (bucket_id = 'restaurant-assets');

-- Convenção de caminho: {restaurant_id}/logo.png — o primeiro segmento é o tenant.
drop policy if exists restaurant_assets_member_write on storage.objects;
create policy restaurant_assets_member_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'restaurant-assets'
    and public.is_restaurant_admin(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists restaurant_assets_member_update on storage.objects;
create policy restaurant_assets_member_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'restaurant-assets'
    and public.is_restaurant_admin(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists restaurant_assets_member_delete on storage.objects;
create policy restaurant_assets_member_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'restaurant-assets'
    and public.is_restaurant_admin(((storage.foldername(name))[1])::uuid)
  );

-- -----------------------------------------------------------------------------
-- Performance: garante uso de índice nas consultas por tenant feitas pelo RLS
-- -----------------------------------------------------------------------------
analyze public.restaurants;
analyze public.restaurant_users;
analyze public.users;
