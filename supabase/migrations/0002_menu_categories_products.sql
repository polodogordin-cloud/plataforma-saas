-- =============================================================================
-- Menuvo · Etapa 2 · Categorias e produtos
-- =============================================================================
-- Tudo aqui pertence a um restaurante (tenant). O isolamento é o mesmo da
-- Etapa 1: RLS via restaurant_users.
--
-- Convenções:
--   * "position" é a ordem dentro do escopo (categoria no menu, produto na
--     categoria). Começa em 1 e é reescrita pelas RPCs de reordenação.
--   * Categoria inativa continua existindo (produtos preservados), apenas não
--     aparece no cardápio público — mesma lógica para produto indisponível.
--   * Excluir uma categoria NÃO apaga os produtos: eles ficam "sem categoria"
--     (on delete set null) para evitar perda acidental de dados.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums de extensões futuras (criados agora para não exigir migração depois)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'option_group_kind') then
    create type public.option_group_kind as enum ('addon', 'complement', 'flavor', 'size');
  end if;

  if not exists (select 1 from pg_type where typname = 'promotion_kind') then
    create type public.promotion_kind as enum ('promotion', 'combo');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- CATEGORIES
-- -----------------------------------------------------------------------------
create table if not exists public.categories (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  name           text not null check (char_length(trim(name)) between 1 and 80),
  description    text check (description is null or char_length(description) <= 300),
  image_url      text,
  is_active      boolean not null default true,
  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.categories is 'Categorias do cardápio (Hambúrgueres, Pizzas, Bebidas...).';

-- Chave de comparação de nomes insensível a acento e caixa.
-- IMMUTABLE para poder ser usada em índice único.
create or replace function public.name_key(value text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(
           lower(translate(trim(coalesce(value, '')),
             'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
             'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
           '\s+', ' ', 'g');
$$;

comment on function public.name_key(text) is
  'Normaliza nome para comparação: sem acentos, minúsculo, espaços colapsados.';

-- Nome único por restaurante — "Hambúrgueres" e "hamburgueres" são o mesmo.
create unique index if not exists categories_restaurant_name_key
  on public.categories (restaurant_id, public.name_key(name));

create index if not exists categories_restaurant_position_idx
  on public.categories (restaurant_id, position);

-- -----------------------------------------------------------------------------
-- PRODUCTS
-- -----------------------------------------------------------------------------
create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  -- Excluir a categoria move os produtos para "Sem categoria".
  category_id    uuid references public.categories (id) on delete set null,
  name           text not null check (char_length(trim(name)) between 1 and 120),
  description    text check (description is null or char_length(description) <= 400),
  price          numeric(10, 2) not null default 0 check (price >= 0),
  image_url      text,
  is_available   boolean not null default true,
  is_featured    boolean not null default false,
  internal_code  text check (internal_code is null or char_length(internal_code) <= 40),
  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.products is 'Itens do cardápio. price em numeric(10,2) na moeda do restaurante.';
comment on column public.products.is_available is 'Disponível/indisponível. Indisponível continua visível no painel.';
comment on column public.products.is_featured is 'Destaque mostrado no cardápio público (Etapa 3).';

create index if not exists products_restaurant_idx
  on public.products (restaurant_id);

create index if not exists products_category_position_idx
  on public.products (category_id, position);

-- Código interno único por restaurante, quando informado.
create unique index if not exists products_restaurant_internal_code_key
  on public.products (restaurant_id, lower(trim(internal_code)))
  where internal_code is not null;

-- Busca por nome no painel (ILIKE + trigram viria depois com volume alto).
create index if not exists products_restaurant_name_idx
  on public.products (restaurant_id, lower(name));

-- -----------------------------------------------------------------------------
-- Estruturas preparadas para as próximas etapas (sem UI, sem uso ainda)
-- -----------------------------------------------------------------------------
-- Adicionais / complementos / sabores / tamanhos ficam em grupos de opções.
create table if not exists public.product_option_groups (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  product_id     uuid not null references public.products (id) on delete cascade,
  kind           public.option_group_kind not null default 'addon',
  name           text not null check (char_length(trim(name)) between 1 and 80),
  min_select     integer not null default 0 check (min_select >= 0),
  max_select     integer not null default 1 check (max_select >= 1),
  is_required    boolean not null default false,
  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.product_options (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  group_id       uuid not null references public.product_option_groups (id) on delete cascade,
  name           text not null check (char_length(trim(name)) between 1 and 80),
  price_delta    numeric(10, 2) not null default 0,
  is_available   boolean not null default true,
  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Promoções e combos.
create table if not exists public.promotions (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  kind           public.promotion_kind not null default 'promotion',
  name           text not null check (char_length(trim(name)) between 1 and 120),
  description    text,
  price          numeric(10, 2) check (price is null or price >= 0),
  image_url      text,
  is_active      boolean not null default true,
  starts_at      timestamptz,
  ends_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.promotion_items (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  promotion_id   uuid not null references public.promotions (id) on delete cascade,
  product_id     uuid not null references public.products (id) on delete cascade,
  quantity       integer not null default 1 check (quantity > 0),
  unique (promotion_id, product_id)
);

-- -----------------------------------------------------------------------------
-- Ordem automática na inserção
-- -----------------------------------------------------------------------------
create or replace function public.assign_category_position()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.position is null or new.position <= 0 then
    select coalesce(max(position), 0) + 1 into new.position
    from public.categories
    where restaurant_id = new.restaurant_id;
  end if;
  return new;
end;
$$;

create or replace function public.assign_product_position()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.position is null or new.position <= 0 then
    select coalesce(max(position), 0) + 1 into new.position
    from public.products
    where restaurant_id = new.restaurant_id
      and category_id is not distinct from new.category_id;
  end if;
  return new;
end;
$$;

drop trigger if exists categories_assign_position on public.categories;
create trigger categories_assign_position
  before insert on public.categories
  for each row execute function public.assign_category_position();

drop trigger if exists products_assign_position on public.products;
create trigger products_assign_position
  before insert on public.products
  for each row execute function public.assign_product_position();

-- -----------------------------------------------------------------------------
-- updated_at automático (reusa a função da Etapa 1)
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'categories', 'products', 'product_option_groups', 'product_options', 'promotions'
  ] loop
    execute format('drop trigger if exists %I_touch_updated_at on public.%I', t, t);
    execute format(
      'create trigger %I_touch_updated_at before update on public.%I
         for each row execute function public.touch_updated_at()', t, t);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- RPCs de reordenação
-- SECURITY INVOKER: o UPDATE continua sujeito à RLS, então ninguém reordena
-- dados de outro restaurante.
-- -----------------------------------------------------------------------------
create or replace function public.reorder_categories(
  p_restaurant_id uuid,
  p_ids uuid[]
)
returns void
language plpgsql
set search_path = public
as $$
begin
  update public.categories c
  set position = t.ord
  from (
    select id, ord
    from unnest(p_ids) with ordinality as u (id, ord)
  ) t
  where c.id = t.id
    and c.restaurant_id = p_restaurant_id;
end;
$$;

create or replace function public.reorder_products(
  p_restaurant_id uuid,
  p_ids uuid[]
)
returns void
language plpgsql
set search_path = public
as $$
begin
  update public.products p
  set position = t.ord
  from (
    select id, ord
    from unnest(p_ids) with ordinality as u (id, ord)
  ) t
  where p.id = t.id
    and p.restaurant_id = p_restaurant_id;
end;
$$;

revoke all on function public.reorder_categories(uuid, uuid[]) from public;
revoke all on function public.reorder_products(uuid, uuid[]) from public;
grant execute on function public.reorder_categories(uuid, uuid[]) to authenticated;
grant execute on function public.reorder_products(uuid, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Leitura: qualquer membro ativo do restaurante (inclusive staff).
-- Escrita: owner/admin.
-- -----------------------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_option_groups enable row level security;
alter table public.product_options enable row level security;
alter table public.promotions enable row level security;
alter table public.promotion_items enable row level security;

-- categories
drop policy if exists categories_select_member on public.categories;
create policy categories_select_member on public.categories
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

drop policy if exists categories_insert_admin on public.categories;
create policy categories_insert_admin on public.categories
  for insert to authenticated
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists categories_update_admin on public.categories;
create policy categories_update_admin on public.categories
  for update to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists categories_delete_admin on public.categories;
create policy categories_delete_admin on public.categories
  for delete to authenticated
  using (public.is_restaurant_admin(restaurant_id));

-- products
drop policy if exists products_select_member on public.products;
create policy products_select_member on public.products
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

drop policy if exists products_insert_admin on public.products;
create policy products_insert_admin on public.products
  for insert to authenticated
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists products_update_admin on public.products;
create policy products_update_admin on public.products
  for update to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists products_delete_admin on public.products;
create policy products_delete_admin on public.products
  for delete to authenticated
  using (public.is_restaurant_admin(restaurant_id));

-- Estruturas futuras: mesma regra, prontas para uso nas próximas etapas.
do $$
declare
  t text;
begin
  foreach t in array array[
    'product_option_groups', 'product_options', 'promotions', 'promotion_items'
  ] loop
    execute format('drop policy if exists %I_select_member on public.%I', t, t);
    execute format(
      'create policy %I_select_member on public.%I for select to authenticated
         using (public.is_restaurant_member(restaurant_id))', t, t);

    execute format('drop policy if exists %I_insert_admin on public.%I', t, t);
    execute format(
      'create policy %I_insert_admin on public.%I for insert to authenticated
         with check (public.is_restaurant_admin(restaurant_id))', t, t);

    execute format('drop policy if exists %I_update_admin on public.%I', t, t);
    execute format(
      'create policy %I_update_admin on public.%I for update to authenticated
         using (public.is_restaurant_admin(restaurant_id))
         with check (public.is_restaurant_admin(restaurant_id))', t, t);

    execute format('drop policy if exists %I_delete_admin on public.%I', t, t);
    execute format(
      'create policy %I_delete_admin on public.%I for delete to authenticated
         using (public.is_restaurant_admin(restaurant_id))', t, t);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- Grants para o PostgREST (sempre acompanhados de RLS)
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.product_option_groups to authenticated;
grant select, insert, update, delete on public.product_options to authenticated;
grant select, insert, update, delete on public.promotions to authenticated;
grant select, insert, update, delete on public.promotion_items to authenticated;
