-- ============================================================================
-- Etapa 7 · Painel de pedidos em tempo real
--
-- O que falta depois da Etapa 6, em ordem de importância:
--
--  1. HISTÓRICO DE STATUS. O pedido sabe em que status está, mas não *quando*
--     chegou lá nem por quem. Sem isso o painel não responde "há quanto tempo
--     essa mesa está esperando?", que é a pergunta que o salão faz o dia todo.
--     A tabela `order_status_events` é append-only e escrita por trigger: a
--     aplicação nunca precisa lembrar de registrar.
--
--  2. TRANSIÇÃO VÁLIDA NO SERVIDOR. O fluxo é pendente → confirmado →
--     em preparo → pronto → entregue. O painel mostra só o botão certo, mas
--     botão não é regra: a RPC `set_order_status` valida a transição, valida o
--     vínculo com o restaurante e recusa salto (de pendente direto para
--     entregue) e volta (de entregue para preparo). Cancelamento é permitido
--     enquanto o pedido não foi entregue nem cancelado.
--
--  3. TEMPO REAL. As duas tabelas entram na publicação `supabase_realtime` com
--     `replica identity full`, para que o payload do evento traga o estado
--     completo e o painel consiga filtrar por `restaurant_id` sem uma segunda
--     consulta. A RLS continua valendo no canal: assinante só recebe linha de
--     restaurante de que é membro.
--
--  4. LEITURA PAGINADA. O painel prioriza o que está em cima da mesa. A view
--     `restaurant_orders` ganha itens como jsonb e a RPC `list_restaurant_orders`
--     limita por status + cursor, em vez de "carregar tudo".
-- ============================================================================

-- -----------------------------------------------------------------------------
-- 1. Histórico de status
-- -----------------------------------------------------------------------------
create table if not exists public.order_status_events (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id      uuid not null references public.orders(id) on delete cascade,
  from_status   public.order_status,
  to_status     public.order_status not null,
  note          text,
  actor_id      uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists order_status_events_order_idx
  on public.order_status_events (order_id, created_at);
create index if not exists order_status_events_restaurant_idx
  on public.order_status_events (restaurant_id, created_at desc);

comment on table public.order_status_events is
  'Histórico append-only de mudanças de status. Escrito por trigger, nunca pela aplicação.';

alter table public.order_status_events enable row level security;

drop policy if exists order_status_events_select_member on public.order_status_events;
create policy order_status_events_select_member on public.order_status_events
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

grant select on public.order_status_events to authenticated;
revoke all on public.order_status_events from anon;

-- Trigger: toda mudança de status vira uma linha de histórico, com autor.
--
-- O autor sai de `auth.uid()`: `create_order` roda como `anon` (null) e o
-- registro nasce sem autor — o que é correto, o cliente não é usuário do app.
create or replace function public.log_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_events (
      restaurant_id, order_id, from_status, to_status, actor_id
    ) values (
      new.restaurant_id, new.id, null, new.status, auth.uid()
    );
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.order_status_events (
      restaurant_id, order_id, from_status, to_status, actor_id
    ) values (
      new.restaurant_id, new.id, old.status, new.status, auth.uid()
    );
  end if;

  return new;
end;
$$;

drop trigger if exists orders_log_status_insert on public.orders;
create trigger orders_log_status_insert
  after insert on public.orders
  for each row execute function public.log_order_status_change();

drop trigger if exists orders_log_status_update on public.orders;
create trigger orders_log_status_update
  after update of status on public.orders
  for each row execute function public.log_order_status_change();

-- O pedido #1001 da Etapa 6 nasceu antes deste histórico existir: semeia a
-- linha de criação para o painel não mostrar um pedido "sem histórico".
insert into public.order_status_events (restaurant_id, order_id, from_status, to_status, created_at)
select o.restaurant_id, o.id, null, o.status, o.created_at
from public.orders o
where not exists (
  select 1 from public.order_status_events e where e.order_id = o.id
);

-- -----------------------------------------------------------------------------
-- 2. Transições permitidas + RPC de mudança de status
-- -----------------------------------------------------------------------------
/*
 * Fluxo de salão:
 *
 *   pending → confirmed → preparing → ready → delivered
 *
 * e `cancelled` a partir de qualquer estado ainda não final. Não existe
 * "voltar": pedido entregue não volta para a cozinha, e pedido cancelado não
 * ressuscita. Errar o botão é problema do painel (que pede confirmação), não
 * uma licença para reescrever o histórico.
 */
create or replace function public.order_next_statuses(current_status public.order_status)
returns public.order_status[]
language sql
immutable
as $$
  select case current_status
    when 'pending'   then array['confirmed', 'cancelled']::public.order_status[]
    when 'confirmed' then array['preparing', 'cancelled']::public.order_status[]
    when 'preparing' then array['ready', 'cancelled']::public.order_status[]
    when 'ready'     then array['delivered', 'cancelled']::public.order_status[]
    else array[]::public.order_status[]
  end;
$$;

create or replace function public.set_order_status(
  p_order_id uuid,
  p_status   public.order_status,
  p_note     text default null
)
returns table (
  order_id      uuid,
  order_number  integer,
  status        public.order_status,
  updated_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant uuid;
  v_from       public.order_status;
  v_number     integer;
begin
  -- O pedido só aparece para membro ativo do restaurante dele. Pedido de outro
  -- tenant é indistinguível de pedido inexistente, de propósito.
  select o.restaurant_id, o.status, o.order_number
    into v_restaurant, v_from, v_number
  from public.orders o
  where o.id = p_order_id
    and public.is_restaurant_member(o.restaurant_id);

  if v_restaurant is null then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  if p_status is null or not (p_status = any (public.order_next_statuses(v_from))) then
    raise exception 'invalid_transition'
      using errcode = '22023',
            hint    = format('%s -> %s', v_from, p_status);
  end if;

  if p_note is not null and char_length(p_note) > 200 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;

  update public.orders o
     set status = p_status
   where o.id = p_order_id;

  return query
    select o.id, o.order_number, o.status, o.updated_at
    from public.orders o
    where o.id = p_order_id;
end;
$$;

comment on function public.set_order_status(uuid, public.order_status, text) is
  'Muda o status respeitando o fluxo do salão e o vínculo de equipe. O histórico é gravado por trigger.';

revoke all on function public.set_order_status(uuid, public.order_status, text) from public;
grant execute on function public.set_order_status(uuid, public.order_status, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Leitura paginada para o painel
-- -----------------------------------------------------------------------------
/*
 * Recria a view com itens embutidos.
 *
 * O painel desenha "2x X-Bacon / 1x Batata P" em cada card; sem os itens, a
 * lista custaria N+1 consultas. `jsonb_agg` resolve em uma linha só.
 *
 * `order by position` mantém a ordem em que o cliente montou o carrinho —
 * o mesmo pedido aparece igual no cardápio e no painel.
 */
drop view if exists public.restaurant_orders;

create view public.restaurant_orders
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
  ) as items,
  coalesce(
    (
      select sum(i.quantity)::integer
      from public.order_items i
      where i.order_id = o.id
    ),
    0
  ) as item_count
from public.orders o
join public.tables t on t.id = o.table_id;

grant select on public.restaurant_orders to authenticated;
revoke all on public.restaurant_orders from anon;

/*
 * Lista paginada por status.
 *
 * Sem `p_status`, devolve o que está "vivo" (pending, confirmed, preparing,
 * ready) — o painel quase nunca quer histórico na primeira carga. Com
 * `p_status`, filtra exatamente aquele status.
 *
 * Cursor = `order_number`, não `created_at`: dois pedidos vindos da mesma mesa
 * na mesma transação têm timestamp idêntico (`now()` é fixo por transação) e
 * um cursor por data pularia um deles — exatamente no caso de maior movimento.
 * O número é monotônico por casa, então serve de cursor estável.
 */
create or replace function public.list_restaurant_orders(
  p_restaurant_id  uuid,
  p_status         public.order_status default null,
  p_before_number  integer default null,
  p_limit          integer default 20
)
returns setof public.restaurant_orders
language sql
security definer
set search_path = public
stable
as $$
  select ro.*
  from public.restaurant_orders ro
  where ro.restaurant_id = p_restaurant_id
    and public.is_restaurant_member(p_restaurant_id)
    and (
      case
        when p_status is null
          then ro.status in ('pending', 'confirmed', 'preparing', 'ready')
        else ro.status = p_status
      end
    )
    and (p_before_number is null or ro.order_number < p_before_number)
  order by ro.order_number desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

comment on function public.list_restaurant_orders(uuid, public.order_status, integer, integer) is
  'Lista paginada do painel. Cursor = order_number; created_at empata na mesma transacao.';

revoke all on function public.list_restaurant_orders(uuid, public.order_status, integer, integer) from public;
grant execute on function public.list_restaurant_orders(uuid, public.order_status, integer, integer) to authenticated;

-- Contadores do dashboard em uma ida ao banco: novos, em preparo, prontos.
create or replace function public.order_board_counts(p_restaurant_id uuid)
returns table (pending integer, preparing integer, ready integer)
language sql
security definer
set search_path = public
stable
as $$
  select
    count(*) filter (where o.status = 'pending')::integer,
    count(*) filter (where o.status in ('confirmed', 'preparing'))::integer,
    count(*) filter (where o.status = 'ready')::integer
  from public.orders o
  where o.restaurant_id = p_restaurant_id
    and public.is_restaurant_member(p_restaurant_id);
$$;

revoke all on function public.order_board_counts(uuid) from public;
grant execute on function public.order_board_counts(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Tempo real
-- -----------------------------------------------------------------------------
-- `replica identity full` faz o evento carregar a linha inteira (inclusive em
-- DELETE), o que permite filtrar por restaurant_id no cliente sem consulta
-- extra. É o pré-requisito para o painel não precisar de polling.
alter table public.orders replica identity full;
alter table public.order_items replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_status_events'
  ) then
    alter publication supabase_realtime add table public.order_status_events;
  end if;
end $$;
