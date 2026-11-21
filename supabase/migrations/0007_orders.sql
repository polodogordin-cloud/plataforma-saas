-- =============================================================================
-- Menuvo · Etapa 6 · Carrinho e pedidos
-- =============================================================================
-- O cliente chega por QR Code ou NFC, escolhe itens e envia o pedido **sem
-- criar conta**. Isso obriga a maior parte do desenho de segurança desta etapa:
-- no cardápio público não existe usuário autenticado, então nada pode vir do
-- navegador — nem preço, nem total, nem a mesa.
--
-- REGRA CENTRAL: o cliente envia apenas `product_id` + `quantity`.
-- Tudo o mais é derivado no banco, dentro de `create_order`:
--   * a mesa vem do token (`resolve_table_token`: restaurante publicado + mesa ativa);
--   * o produto precisa estar no `public_products` — a mesma view que o cardápio
--     usa, que já filtra disponível + categoria ativa + restaurante publicado;
--   * o preço é lido agora, de `products.price`, nunca do corpo da requisição;
--   * subtotal e total são calculados em `numeric`, não em float.
--
-- HISTÓRICO CONGELADO: cada item guarda `product_name_snapshot` e
-- `unit_price_snapshot`. Se o restaurante subir o preço amanhã, o pedido de
-- ontem continua mostrando o preço que o cliente viu e aceitou. Sem isso um
-- recibo deixaria de ser recibo.
--
-- PREPARADO PARA (sem implementar): adicionais, combos, pagamentos, Pix,
-- WhatsApp, impressão, delivery, retirada, chamada de garçom e pedido de conta.
-- `order_items` é uma tabela própria (não um jsonb solto) justamente para caber
-- adicionais por item e para a cozinha conseguir imprimir linha a linha.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enum: status do pedido
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type public.order_status as enum (
      'pending',    -- pendente
      'confirmed',  -- confirmado
      'preparing',  -- em preparo
      'ready',      -- pronto
      'delivered',  -- entregue
      'cancelled'   -- cancelado
    );
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Enum: canal de origem (preparação para delivery/retirada)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_channel') then
    create type public.order_channel as enum ('dine_in', 'takeaway', 'delivery');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Contador de pedidos por restaurante
-- -----------------------------------------------------------------------------
-- O "Pedido #1042" precisa ser curto e legível no salão, não um uuid. Um
-- contador por restaurante com `insert ... on conflict do update` garante
-- unicidade sob concorrência sem `max() + 1` (que duplica em paralelo).
create table if not exists public.restaurant_order_counters (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  next_number   integer not null default 1001
);

comment on table public.restaurant_order_counters is
  'Sequência de números de pedido por restaurante. Começa em 1001 para não parecer amador.';

create or replace function public.next_order_number(p_restaurant_id uuid)
returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_number integer;
begin
  insert into public.restaurant_order_counters (restaurant_id, next_number)
  values (p_restaurant_id, 1002)
  on conflict (restaurant_id) do update
    set next_number = public.restaurant_order_counters.next_number + 1
  returning next_number - 1 into v_number;

  return v_number;
end;
$$;

revoke all on function public.next_order_number(uuid) from anon, public;
grant execute on function public.next_order_number(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- TABELA: orders
-- -----------------------------------------------------------------------------
create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  table_id       uuid not null references public.tables (id) on delete cascade,

  /** Número curto mostrado ao cliente e à cozinha ("#1042"). */
  order_number   integer not null,

  status         public.order_status not null default 'pending',
  channel        public.order_channel not null default 'dine_in',

  -- Totais congelados no momento do pedido, calculados no servidor.
  subtotal       numeric(10, 2) not null default 0,
  -- Reservado para taxas (delivery/taxa de serviço). Sempre 0 nesta etapa,
  -- mas a coluna existe para o total já ser fechado corretamente depois.
  fees           numeric(10, 2) not null default 0,
  discount       numeric(10, 2) not null default 0,
  total          numeric(10, 2) not null default 0,

  notes          text,

  -- Preparação: quem atendeu e o que a cozinha precisa saber.
  -- Ficam nulos nesta etapa (o cliente não tem conta).
  customer_name  text,
  customer_phone text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint orders_number_key unique (restaurant_id, order_number),
  constraint orders_notes_check check (notes is null or char_length(notes) <= 300),
  constraint orders_totals_check check (subtotal >= 0 and fees >= 0 and discount >= 0 and total >= 0)
);

comment on table public.orders is
  'Pedido feito pelo cliente na mesa. Totais sempre calculados no servidor.';

create index if not exists orders_table_idx
  on public.orders (table_id, created_at desc);
create index if not exists orders_restaurant_status_idx
  on public.orders (restaurant_id, status, created_at desc);

-- -----------------------------------------------------------------------------
-- TABELA: order_items
-- -----------------------------------------------------------------------------
create table if not exists public.order_items (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders (id) on delete cascade,
  restaurant_id        uuid not null references public.restaurants (id) on delete cascade,

  -- Referência viva (para relatório de vendas) + snapshot (para o recibo).
  product_id           uuid references public.products (id) on delete set null,
  product_name_snapshot text not null,
  unit_price_snapshot  numeric(10, 2) not null,

  quantity             integer not null,
  -- Congelado: preço unitário × quantidade, arredondado no banco.
  subtotal             numeric(10, 2) not null,

  notes                text,
  position             integer not null default 0,
  created_at           timestamptz not null default now(),

  constraint order_items_quantity_check check (quantity between 1 and 99),
  constraint order_items_price_check check (unit_price_snapshot >= 0 and subtotal >= 0),
  constraint order_items_notes_check check (notes is null or char_length(notes) <= 200)
);

comment on table public.order_items is
  'Itens do pedido com nome e preço congelados: mudar o produto depois não altera o pedido.';

create index if not exists order_items_order_idx
  on public.order_items (order_id, position);

-- -----------------------------------------------------------------------------
-- Trigger: updated_at
-- -----------------------------------------------------------------------------
drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- CRIAÇÃO DO PEDIDO (superfície pública)
-- -----------------------------------------------------------------------------
/**
 * Cria um pedido a partir do token público da mesa.
 *
 * Recebe SOMENTE `product_id` e `quantity`. Nome, preço, subtotal, total e a
 * própria mesa são resolvidos aqui. Qualquer preço que o navegador invente é
 * ignorado porque nunca é lido.
 *
 * Entradas inválidas são rejeitadas inteiras — não existe pedido parcial.
 */
create or replace function public.create_order(
  p_token text,
  p_items jsonb,
  p_notes text default null
)
returns table (
  order_id      uuid,
  order_number  integer,
  table_name    text,
  restaurant_id uuid,
  subtotal      numeric,
  total         numeric,
  status        public.order_status,
  created_at    timestamptz
)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_restaurant uuid;
  v_table      uuid;
  v_table_name text;
  v_order_id   uuid;
  v_number     integer;
  v_subtotal   numeric(10, 2) := 0;
  v_notes      text;
  v_item_count integer;
  v_position   integer := 0;
  v_recent     integer;
  rec          record;
  v_name       text;
  v_price      numeric(10, 2);
begin
  -- 1. Contexto da mesa: token válido, restaurante publicado, mesa ativa.
  select r.restaurant_id, r.table_id, r.table_name
    into v_restaurant, v_table, v_table_name
  from public.resolve_table_token(p_token) r;

  if v_restaurant is null then
    raise exception 'table_unavailable' using errcode = '22023';
  end if;

  -- 2. Observação: limite duro, inclusive no banco (a UI limita antes).
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');
  if v_notes is not null and char_length(v_notes) > 300 then
    raise exception 'notes_too_long' using errcode = '22023';
  end if;

  -- 3. Itens: precisa ser um array não vazio, com limite de linhas.
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items' using errcode = '22023';
  end if;

  v_item_count := jsonb_array_length(p_items);
  if v_item_count = 0 then
    raise exception 'empty_order' using errcode = '22023';
  end if;
  if v_item_count > 50 then
    raise exception 'too_many_items' using errcode = '22023';
  end if;

  -- 4. Freio simples contra flood: a mesma mesa não abre 5 pedidos em 20s.
  --    Não substitui rate limit de infraestrutura, mas evita duplo toque e
  --    script trivial. Cliente em salão pede no máximo uma vez por minuto.
  -- Colunas qualificadas: `created_at` também é nome de coluna de saída desta
  -- função, e o PL/pgSQL recusaria a referência sem o alias (42702).
  select count(*) into v_recent
  from public.orders ord
  where ord.table_id = v_table
    and ord.created_at > now() - interval '20 seconds';

  if v_recent >= 4 then
    raise exception 'too_many_orders' using errcode = '53400';
  end if;

  -- 5. Cria o cabeçalho com totais zerados; preenche depois de somar os itens.
  v_number := public.next_order_number(v_restaurant);

  insert into public.orders (
    restaurant_id, table_id, order_number, status, channel, notes, subtotal, total
  )
  values (
    v_restaurant, v_table, v_number, 'pending', 'dine_in', v_notes, 0, 0
  )
  returning id into v_order_id;

  -- 6. Itens: cada um validado contra o cardápio PÚBLICO atual.
  --
  --    `public_products` é a mesma view que o cardápio renderiza, e ela já
  --    filtra `is_available`, categoria ativa e restaurante publicado. Validar
  --    por ela garante que o cliente só compre o que conseguiu ver.
  for rec in
    select
      (elem ->> 'product_id')::uuid as product_id,
      -- Quantidade fora da faixa vira erro em vez de ser silenciada: o cliente
      -- precisa saber que o item não entrou.
      (elem ->> 'quantity')::integer as quantity
    from jsonb_array_elements(p_items) elem
  loop
    if rec.product_id is null or rec.quantity is null then
      raise exception 'invalid_item' using errcode = '22023';
    end if;
    if rec.quantity < 1 or rec.quantity > 99 then
      raise exception 'invalid_quantity' using errcode = '22023';
    end if;

    v_name := null;
    v_price := null;

    select p.name, p.price into v_name, v_price
    from public.public_products p
    where p.id = rec.product_id
      and p.restaurant_id = v_restaurant
    limit 1;

    -- Produto inexistente, de outro restaurante, esgotado, com categoria
    -- inativa ou restaurante fora do ar: todos caem aqui, com a mesma
    -- mensagem. Não vale contar ao cliente qual foi o caso.
    if v_name is null or v_price is null then
      raise exception 'product_unavailable' using errcode = '22023';
    end if;

    v_position := v_position + 1;

    insert into public.order_items (
      order_id, restaurant_id, product_id, product_name_snapshot,
      unit_price_snapshot, quantity, subtotal, position
    )
    values (
      v_order_id, v_restaurant, rec.product_id, v_name,
      v_price, rec.quantity,
      round(v_price * rec.quantity, 2), v_position
    );

    v_subtotal := v_subtotal + round(v_price * rec.quantity, 2);
  end loop;

  if v_position = 0 then
    raise exception 'empty_order' using errcode = '22023';
  end if;

  -- 7. Totais finais, sempre no servidor.
  update public.orders
     set subtotal = v_subtotal,
         total = v_subtotal - discount + fees
   where id = v_order_id;

  return query
    select o.id, o.order_number, v_table_name, o.restaurant_id,
           o.subtotal, o.total, o.status, o.created_at
    from public.orders o
    where o.id = v_order_id;
end;
$$;

comment on function public.create_order(text, jsonb, text) is
  'Cria pedido pelo token da mesa. Preços e totais vêm do banco; o cliente envia apenas produto e quantidade.';

revoke all on function public.create_order(text, jsonb, text) from public;
grant execute on function public.create_order(text, jsonb, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Leitura do pedido pelo cliente (tela de sucesso / acompanhamento)
-- -----------------------------------------------------------------------------
-- O cliente não tem conta: para consultar depois de recarregar a página, ele
-- prova que conhece a mesa e o número do pedido. Não é login, mas impede
-- enumerar pedidos de outras mesas só trocando o número.
create function public.get_table_order(
  p_token text,
  p_order_number integer
)
returns table (
  order_id      uuid,
  order_number  integer,
  table_name    text,
  status        public.order_status,
  subtotal      numeric,
  fees          numeric,
  discount      numeric,
  total         numeric,
  notes         text,
  created_at    timestamptz,
  items         jsonb
)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_restaurant uuid;
  v_table      uuid;
  v_table_name text;
begin
  -- Contexto: só devolve pedido de mesa VÁLIDA (token confere, restaurante
  -- publicado, mesa ativa). Token trocado não lê pedido de ninguém.
  select r.restaurant_id, r.table_id, r.table_name
    into v_restaurant, v_table, v_table_name
  from public.resolve_table_token(p_token) r;

  if v_table is null then
    return;
  end if;

  return query
    select
      o.id,
      o.order_number,
      v_table_name,
      o.status,
      o.subtotal,
      o.fees,
      o.discount,
      o.total,
      o.notes,
      o.created_at,
      coalesce(
        (
          select jsonb_agg(
                   jsonb_build_object(
                     'product_id', i.product_id,
                     'name', i.product_name_snapshot,
                     'quantity', i.quantity,
                     'unit_price', i.unit_price_snapshot,
                     'subtotal', i.subtotal
                   )
                   order by i.position
                 )
          from public.order_items i
          where i.order_id = o.id
        ),
        '[]'::jsonb
      )
    from public.orders o
    where o.restaurant_id = v_restaurant
      and o.table_id = v_table
      and o.order_number = p_order_number
    limit 1;
end;
$$;

revoke all on function public.get_table_order(text, integer) from public;
grant execute on function public.get_table_order(text, integer) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
-- Cliente não escreve direto: só o `create_order` (security definer) insere.
-- A equipe lê os pedidos do próprio restaurante — o painel chega na Etapa 7.
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.restaurant_order_counters enable row level security;

drop policy if exists orders_select_member on public.orders;
create policy orders_select_member on public.orders
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

drop policy if exists order_items_select_member on public.order_items;
create policy order_items_select_member on public.order_items
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

grant select on public.orders to authenticated;
grant select on public.order_items to authenticated;

-- `anon` não toca nas tabelas: a única porta é a RPC.
revoke all on public.orders from anon;
revoke all on public.order_items from anon;
revoke all on public.restaurant_order_counters from anon;
revoke all on public.restaurant_order_counters from authenticated;

-- -----------------------------------------------------------------------------
-- View de leitura para o painel (Etapa 7 já encontra pronto)
-- -----------------------------------------------------------------------------
create or replace view public.restaurant_orders
with (security_invoker = true)
as
select
  o.id,
  o.restaurant_id,
  o.table_id,
  t.name as table_name,
  o.order_number,
  o.status,
  o.channel,
  o.subtotal,
  o.fees,
  o.discount,
  o.total,
  o.notes,
  o.created_at,
  o.updated_at,
  (
    select count(*)::integer
    from public.order_items i
    where i.order_id = o.id
  ) as item_count
from public.orders o
join public.tables t on t.id = o.table_id;

grant select on public.restaurant_orders to authenticated;
revoke all on public.restaurant_orders from anon;
