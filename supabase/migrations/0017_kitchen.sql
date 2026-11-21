-- ============================================================================
-- Etapa 17 · Painel de cozinha (KDS)
-- ============================================================================
-- A cozinha já podia *ver* pedidos (qualquer membro lê `orders`), mas não havia
-- como separar quem cozinha de quem atende, nem um lugar onde o preparo seja a
-- tela principal. Este arquivo resolve duas coisas e **não** cria um segundo
-- sistema de pedidos: tudo lê e escreve nas tabelas da Etapa 7 (`orders`,
-- `order_items`) e na mesma função de transição (`set_order_status`).
--
-- Decisões que definem o módulo:
--
--   1. **Dois papéis novos, e só dois.** O escopo pede ADMIN, MANAGER, KITCHEN,
--      STAFF e WAITER. Os três primeiros já existem (`owner`/`admin`,
--      `manager`, `staff`); faltavam `kitchen` e `waiter`. Criar os cinco de
--      novo seria duplicar o que a Etapa 10 já tem e quebraria as policies que
--      dependem de `is_restaurant_admin`.
--
--   2. **Papel novo não é permissão nova: é permissão *menor*.** `staff` já
--      podia mudar status de pedido em `/app/pedidos`. `kitchen` e `waiter`
--      nascem mais restritos do que `staff`, porque foi para isso que foram
--      criados. Nenhum papel perde poder neste arquivo — quem podia cancelar
--      continua podendo.
--
--   3. **Quem cozinha não mexe no cardápio.** `kitchen` fica fora de
--      `is_restaurant_admin`, então não cria produto, não muda preço e não
--      altera mesa. É a aplicação do "acessar somente as funcionalidades
--      necessárias para a cozinha", garantido no banco e não só na tela.
--
--   4. **A estação é filtro, não tabela de pedidos paralela.** `kitchen_stations`
--      nasce pronta (cozinha, bar, sobremesas, churrasqueira, expedição) ligada
--      a **categorias** do cardápio existente. Sem estação configurada, o KDS
--      mostra tudo — que é o comportamento correto para a casa pequena.
--
--   5. **O relógio é do pedido, não da tela.** "Há quanto tempo chegou" sai de
--      `created_at`; "há quanto tempo está em preparo" sai do primeiro evento
--      que levou o pedido para `preparing` em `order_status_events`. Nada disso
--      é digitado nem duplicado: é derivado do histórico append-only da Etapa 7.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Papéis
--
-- `alter type ... add value` não pode ser usado na mesma transação em que o
-- valor novo é lido (erro 55P04). Estes dois comandos vêm sozinhos, no topo,
-- antes de qualquer policy que os referencie. Aplicar o arquivo em blocos
-- separados é seguro: todos são idempotentes.
-- ----------------------------------------------------------------------------

alter type public.restaurant_member_role add value if not exists 'kitchen';
alter type public.restaurant_member_role add value if not exists 'waiter';

comment on type public.restaurant_member_role is
  'owner/admin = dono; manager = operação; kitchen = só preparo; staff = equipe; waiter = salão.';

-- ----------------------------------------------------------------------------
-- 2. Quem pode o quê no KDS
--
-- Três predicados, porque são três decisões diferentes e cada uma precisa de
-- um nome. Juntar tudo num `is_restaurant_member` seria devolver o problema:
-- qualquer membro poderia cancelar um pedido.
-- ----------------------------------------------------------------------------

/** Ver a tela. Todo mundo que trabalha na casa enxerga a cozinha. */
create or replace function public.kds_can_view(target_restaurant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.has_restaurant_role(
    target_restaurant_id,
    array['owner', 'admin', 'manager', 'kitchen', 'staff', 'waiter']::public.restaurant_member_role[]
  );
$$;

/**
 * Aceitar, iniciar preparo e marcar pronto.
 *
 * `waiter` fica de fora de propósito: quem leva o pedido à mesa não decide
 * quando a cozinha começou. Se entrasse aqui, o garçom poderia marcar "pronto"
 * sem nada estar pronto — e o KDS perderia a única coisa que promete.
 */
create or replace function public.kds_can_operate(target_restaurant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.has_restaurant_role(
    target_restaurant_id,
    array['owner', 'admin', 'manager', 'kitchen', 'staff']::public.restaurant_member_role[]
  );
$$;

/**
 * Finalizar (entregar na mesa).
 *
 * Aqui o `waiter` entra: o momento "saiu da cozinha e chegou ao cliente" é
 * justamente o que o salão registra.
 */
create or replace function public.kds_can_finish(target_restaurant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.has_restaurant_role(
    target_restaurant_id,
    array['owner', 'admin', 'manager', 'kitchen', 'staff', 'waiter']::public.restaurant_member_role[]
  );
$$;

/**
 * Cancelar.
 *
 * Lista idêntica à que já valia de fato em `/app/pedidos` na Etapa 7 (qualquer
 * membro). Mantida assim para não tirar poder de ninguém; a diferença é que
 * agora o papel novo (`kitchen`, `waiter`) **não** herda esse poder, porque
 * cancelar mexe em dinheiro e em histórico de produção.
 */
create or replace function public.kds_can_cancel(target_restaurant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.has_restaurant_role(
    target_restaurant_id,
    array['owner', 'admin', 'manager', 'staff']::public.restaurant_member_role[]
  );
$$;

comment on function public.kds_can_view(uuid) is
  'Acesso à tela /kitchen: todos os papéis operacionais, inclusive cozinha e salão.';
comment on function public.kds_can_operate(uuid) is
  'Aceitar/iniciar/pronto: cozinha e operação. Waiter não marca preparo.';
comment on function public.kds_can_finish(uuid) is
  'Entregar: inclui waiter, que é quem leva à mesa.';
comment on function public.kds_can_cancel(uuid) is
  'Cancelar: mesma lista da Etapa 7 (owner/admin/manager/staff). Papéis novos não herdam.';

revoke all on function public.kds_can_view(uuid) from public;
revoke all on function public.kds_can_operate(uuid) from public;
revoke all on function public.kds_can_finish(uuid) from public;
revoke all on function public.kds_can_cancel(uuid) from public;
grant execute on function public.kds_can_view(uuid) to authenticated;
grant execute on function public.kds_can_operate(uuid) to authenticated;
grant execute on function public.kds_can_finish(uuid) to authenticated;
grant execute on function public.kds_can_cancel(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. `set_order_status` com autorização por papel
--
-- Recriada com o mesmo nome e a mesma assinatura: o painel da Etapa 7 continua
-- chamando exatamente a mesma coisa, sem mudança no cliente. O que muda é que
-- a função passa a olhar **quem** está pedindo a transição, não só se é membro.
--
-- A tabela de transições (`order_next_statuses`) não muda: o fluxo do salão é
-- o mesmo. O KDS apenas usa os mesmos degraus.
-- ----------------------------------------------------------------------------

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
  v_allowed    boolean;
begin
  -- 1. O pedido só aparece para membro ativo do restaurante dele. Pedido de
  --    outro tenant é indistinguível de pedido inexistente, de propósito.
  select o.restaurant_id, o.status
    into v_restaurant, v_from
  from public.orders o
  where o.id = p_order_id
    and public.is_restaurant_member(o.restaurant_id);

  if v_restaurant is null then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  -- 2. Transição válida ANTES do papel: pedido já entregue não pode voltar
  --    para preparo nem para quem tem poder de cancelar.
  if p_status is null or not (p_status = any (public.order_next_statuses(v_from))) then
    raise exception 'invalid_transition'
      using errcode = '22023',
            hint    = format('%s -> %s', v_from, p_status);
  end if;

  -- 3. Autorização por papel, decidida pelo status de DESTINO.
  --
  --    Usar o destino (e não a origem) é o que permite a mesma regra servir
  --    para o KDS e para o painel: "marcar pronto" é uma ação de cozinha
  --    independentemente de onde o botão foi tocado.
  v_allowed := case p_status
    when 'cancelled' then public.kds_can_cancel(v_restaurant)
    when 'delivered' then public.kds_can_finish(v_restaurant)
    else                  public.kds_can_operate(v_restaurant)
  end;

  if not v_allowed then
    raise exception 'role_forbidden'
      using errcode = '42501',
            hint    = format('papel sem permissão para %s', p_status);
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
  'Muda o status respeitando o fluxo do salão, o vínculo de equipe e o papel. O histórico é gravado por trigger.';

revoke all on function public.set_order_status(uuid, public.order_status, text) from public;
grant execute on function public.set_order_status(uuid, public.order_status, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Configuração da cozinha
--
-- Só um número interessa de verdade: a partir de quantos minutos um pedido
-- passa a ser "atrasado". O som **não** fica aqui — é preferência do aparelho
-- (a mesma casa pode ter dois tablets e um deles no mudo), então mora no
-- `localStorage`. O default do banco serve para o primeiro acesso do tablet,
-- não para sincronizar dispositivos.
-- ----------------------------------------------------------------------------
create table if not exists public.kitchen_settings (
  restaurant_id      uuid primary key references public.restaurants (id) on delete cascade,
  -- 15 min é o ponto em que a maioria das casas começa a cobrar a cozinha.
  late_after_minutes integer not null default 15
                     check (late_after_minutes between 1 and 240),
  -- Quanto tempo antes do limite o card entra em "atenção" (âmbar).
  warn_after_minutes integer not null default 10
                     check (warn_after_minutes between 1 and 240),
  updated_at         timestamptz not null default now(),

  constraint kitchen_settings_order_check check (warn_after_minutes <= late_after_minutes)
);

comment on table public.kitchen_settings is
  'Limites de tempo do KDS por restaurante. Som e filtros são do aparelho, não da casa.';

alter table public.kitchen_settings enable row level security;

drop policy if exists kitchen_settings_select_member on public.kitchen_settings;
create policy kitchen_settings_select_member on public.kitchen_settings
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

drop policy if exists kitchen_settings_upsert_admin on public.kitchen_settings;
create policy kitchen_settings_upsert_admin on public.kitchen_settings
  for insert to authenticated
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists kitchen_settings_update_admin on public.kitchen_settings;
create policy kitchen_settings_update_admin on public.kitchen_settings
  for update to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

grant select, insert, update on public.kitchen_settings to authenticated;
revoke all on public.kitchen_settings from anon;

/**
 * Lê a configuração com fallback, sem exigir linha criada.
 *
 * Devolver os defaults em vez de `null` evita o clássico "primeiro acesso do
 * tablet abre sem prazo e nada fica vermelho". Quem chama não precisa de
 * `coalesce`.
 */
create or replace function public.get_kitchen_settings(p_restaurant_id uuid)
returns table (late_after_minutes integer, warn_after_minutes integer)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.kds_can_view(p_restaurant_id) then
    raise exception 'not_restaurant_member' using errcode = '42501';
  end if;

  -- `return next` é obrigatório em `returns table` no plpgsql: atribuir às
  -- colunas de saída e sair sem ele devolve zero linhas em silêncio.
  return query
    select
      coalesce(s.late_after_minutes, 15),
      coalesce(s.warn_after_minutes, 10)
    from (select p_restaurant_id as rid) base
    left join public.kitchen_settings s on s.restaurant_id = base.rid;
end;
$$;

revoke all on function public.get_kitchen_settings(uuid) from public;
grant execute on function public.get_kitchen_settings(uuid) to authenticated;

/**
 * Grava os limites. Só admin operacional (owner/admin/manager).
 *
 * `greatest(1, least(...))` em vez de deixar estourar o check: a tela já
 * limita, mas a chamada direta não. Preferir o valor mais próximo ao inválido
 * a devolver erro cru é aceitável aqui porque o campo é um número de espera,
 * não um dado de negócio — e o check do banco continua sendo a última palavra.
 */
create or replace function public.set_kitchen_settings(
  p_restaurant_id      uuid,
  p_late_after_minutes integer,
  p_warn_after_minutes integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_restaurant_admin(p_restaurant_id) then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  insert into public.kitchen_settings as ks (
    restaurant_id, late_after_minutes, warn_after_minutes, updated_at
  )
  values (
    p_restaurant_id,
    greatest(1, least(coalesce(p_late_after_minutes, 15), 240)),
    greatest(1, least(coalesce(p_warn_after_minutes, 10), 240))
  )
  on conflict (restaurant_id) do update
    set late_after_minutes = excluded.late_after_minutes,
        warn_after_minutes = excluded.warn_after_minutes,
        updated_at         = now();
end;
$$;

revoke all on function public.set_kitchen_settings(uuid, integer, integer) from public;
grant execute on function public.set_kitchen_settings(uuid, integer, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Estações — arquitetura, sem a divisão completa
--
-- O escopo diz "não é obrigatório implementar toda essa divisão agora, mas a
-- arquitetura deve permitir expansão". Então: as tabelas existem, a ligação
-- com o cardápio existente é por **categoria** (não por produto duplicado), e
-- o KDS já filtra por estação. O que não entra é a tela de cadastro de estação.
--
-- A ligação por categoria, e não por produto, é o que evita trabalho dobrado:
-- "todas as bebidas vão para o bar" é uma linha, e produto novo em Bebidas cai
-- no bar automaticamente. Ligar produto a produto exigiria reconfigurar a cada
-- item novo — e alguém esqueceria.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'kitchen_station_kind') then
    -- `expedition` é a estação que confere o pedido pronto antes de sair.
    -- Nesta etapa existe só como valor; a tela trata igual às demais.
    create type public.kitchen_station_kind as enum ('prep', 'expedition');
  end if;
end
$$;

create table if not exists public.kitchen_stations (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null check (char_length(trim(name)) between 1 and 40),
  -- Identificador estável para URL/filtro: "bar", "sobremesas".
  slug          text not null check (slug ~ '^[a-z0-9-]{2,32}$'),
  kind          public.kitchen_station_kind not null default 'prep',
  position      integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, slug)
);

comment on table public.kitchen_stations is
  'Cozinha/bar/sobremesas/churrasqueira/expedição. Sem linha = KDS mostra tudo.';

create index if not exists kitchen_stations_restaurant_idx
  on public.kitchen_stations (restaurant_id, position);

create table if not exists public.kitchen_station_categories (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  station_id    uuid not null references public.kitchen_stations (id) on delete cascade,
  category_id   uuid not null references public.categories (id) on delete cascade,
  primary key (station_id, category_id)
);

comment on table public.kitchen_station_categories is
  'Categoria do cardápio -> estação. Produto novo na categoria entra na estação sozinho.';

create index if not exists kitchen_station_categories_category_idx
  on public.kitchen_station_categories (category_id);

alter table public.kitchen_stations enable row level security;
alter table public.kitchen_station_categories enable row level security;

drop policy if exists kitchen_stations_select_member on public.kitchen_stations;
create policy kitchen_stations_select_member on public.kitchen_stations
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

drop policy if exists kitchen_stations_write_admin on public.kitchen_stations;
create policy kitchen_stations_write_admin on public.kitchen_stations
  for all to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists kitchen_station_categories_select_member on public.kitchen_station_categories;
create policy kitchen_station_categories_select_member on public.kitchen_station_categories
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

drop policy if exists kitchen_station_categories_write_admin on public.kitchen_station_categories;
create policy kitchen_station_categories_write_admin on public.kitchen_station_categories
  for all to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

grant select, insert, update, delete on public.kitchen_stations to authenticated;
grant select, insert, update, delete on public.kitchen_station_categories to authenticated;
revoke all on public.kitchen_stations from anon;
revoke all on public.kitchen_station_categories from anon;

-- ----------------------------------------------------------------------------
-- 6. Adicionais do item — estrutura pronta, sem UI de cardápio nesta etapa
--
-- Os grupos de opções (`product_option_groups`) existem desde a Etapa 2, mas o
-- cardápio público nunca ofereceu a escolha: `product-detail.tsx` tem o
-- encaixe `#product-detail-options` reservado e vazio. Sem escolha na tela, não
-- há o que gravar no pedido — e inventar dado no KDS seria mentir para a
-- cozinha.
--
-- A tabela entra agora para que a leitura do KDS seja escrita uma vez só: o card
-- já sabe mostrar "Adicionais" quando existir linha. Quando a Etapa 18 ligar a
-- escolha no cardápio, o KDS não muda.
-- ----------------------------------------------------------------------------
create table if not exists public.order_item_options (
  id           uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  order_id     uuid not null references public.orders (id) on delete cascade,
  item_id      uuid not null references public.order_items (id) on delete cascade,
  -- Referência viva (relatório) + snapshot (recibo), igual ao item.
  option_id    uuid references public.product_options (id) on delete set null,
  group_name    text not null,
  option_name   text not null,
  -- Sem `>= 0` de propósito: `product_options.price_delta` aceita negativo
  -- (opção que desconta, tipo "sem queijo -2,00"). Copiar o check daqui
  -- recusaria justamente o caso que o cardápio precisa permitir.
  price_delta   numeric(10, 2) not null default 0,
  quantity      integer not null default 1 check (quantity between 1 and 99),
  created_at    timestamptz not null default now()
);

comment on table public.order_item_options is
  'Adicionais/complementos escolhidos. Estrutura pronta; a escolha no cardápio entra na próxima etapa.';

create index if not exists order_item_options_item_idx
  on public.order_item_options (item_id);

alter table public.order_item_options enable row level security;

drop policy if exists order_item_options_select_member on public.order_item_options;
create policy order_item_options_select_member on public.order_item_options
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

-- Escrita só por função `security definer`, como o resto do caminho de pedido:
-- o cliente nunca insere linha aqui.
grant select on public.order_item_options to authenticated;
revoke all on public.order_item_options from anon;

-- ----------------------------------------------------------------------------
-- 7. A view que o KDS lê
--
-- Diferença em relação a `restaurant_orders` (Etapa 7): aqui o item leva a
-- própria observação e os adicionais, e cada item sabe a que estação pertence.
-- O painel do salão continua usando a view antiga — nada muda para ele.
--
-- Aviso honesto sobre `notes` do item: a coluna existe desde a Etapa 7, mas
-- `create_order` não a recebe do cliente (`p_items` só traz product_id e
-- quantity), então hoje ela é sempre null. A view **expõe** o campo assim
-- mesmo: o card do KDS já sabe desenhá-lo, e quando a Etapa 18 passar a enviar
-- a observação por item o KDS não precisa de mudança nenhuma. O que aparece
-- com dado real hoje é a observação do PEDIDO, que o cliente já preenche no
-- carrinho.
--
-- `preparing_since` sai de `order_status_events`: é o primeiro evento que levou
-- o pedido para `producing`. Sem ele, "tempo de preparo" teria que ser inventado
-- como `updated_at`, que muda a cada toque e zeraria o contador.
-- ----------------------------------------------------------------------------
drop view if exists public.kitchen_orders;

create view public.kitchen_orders
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
  o.total,
  o.notes,
  o.created_at,
  o.updated_at,
  (
    select min(e.created_at)
    from public.order_status_events e
    where e.order_id = o.id
      and e.to_status = 'preparing'
  ) as preparing_since,
  coalesce(
    (
      select jsonb_agg(
               jsonb_build_object(
                 'id', i.id,
                 'product_id', i.product_id,
                 'name', i.product_name_snapshot,
                 'quantity', i.quantity,
                 'subtotal', i.subtotal,
                 'notes', i.notes,
                 'category_id', p.category_id,
                 -- Primeira estação ativa que reivindica a categoria do
                 -- produto. Sem estação configurada, fica null e o KDS
                 -- mostra o item em todas as estações (comportamento certo
                 -- para a casa que ainda não dividiu a produção).
                 'station_slug', (
                   select ks.slug
                   from public.kitchen_station_categories ksc
                   join public.kitchen_stations ks on ks.id = ksc.station_id
                   where ksc.category_id = p.category_id
                     and ks.restaurant_id = o.restaurant_id
                     and ks.is_active
                   order by ks.position, ks.slug
                   limit 1
                 ),
                 'options', coalesce(
                   (
                     select jsonb_agg(
                              jsonb_build_object(
                                'group_name', oio.group_name,
                                'name', oio.option_name,
                                'price_delta', oio.price_delta,
                                'quantity', oio.quantity
                              )
                              order by oio.group_name, oio.option_name
                            )
                     from public.order_item_options oio
                     where oio.item_id = i.id
                   ),
                   '[]'::jsonb
                 )
               )
               order by i.position
             )
      from public.order_items i
      left join public.products p on p.id = i.product_id
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

comment on view public.kitchen_orders is
  'Pedido completo para o KDS: itens com observação, adicionais e estação resolvida por categoria.';

grant select on public.kitchen_orders to authenticated;
revoke all on public.kitchen_orders from anon;

-- ----------------------------------------------------------------------------
-- 8. Leitura do KDS
--
-- Uma chamada devolve as quatro colunas de uma vez. São poucos pedidos por
-- serviço (dezenas, não milhares), então recortar por status no cliente custa
-- menos que quatro idas ao banco por atualização de tempo real — e o KDS é
-- justamente a tela que mais atualiza.
--
-- `p_station` filtra por slug de estação. `null` = todas, e é o padrão.
-- ----------------------------------------------------------------------------
create or replace function public.list_kitchen_orders(
  p_restaurant_id uuid,
  p_station       text default null,
  p_since_minutes integer default 720,
  p_limit         integer default 200
)
returns setof public.kitchen_orders
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if p_restaurant_id is null or not public.kds_can_view(p_restaurant_id) then
    -- Mesma resposta para "sem vínculo" e "restaurante inexistente": quem não
    -- é da casa não descobre nem que a casa existe.
    return;
  end if;

  return query
    select ko.*
    from public.kitchen_orders ko
    where ko.restaurant_id = p_restaurant_id
      -- Janela de recência: o KDS não é histórico. Sem isto, uma casa com
      -- meses de operação carregaria tudo o que já foi entregue até hoje.
      and ko.created_at > now() - make_interval(mins => greatest(coalesce(p_since_minutes, 720), 30))
      and (
        p_station is null
        or exists (
          select 1
          from jsonb_array_elements(ko.items) it
          where it ->> 'station_slug' = p_station
        )
        -- Item sem estação aparece em qualquer filtro: esconder seria pior.
        or exists (
          select 1
          from jsonb_array_elements(ko.items) it
          where it ->> 'station_slug' is null
        )
      )
    order by ko.created_at asc
    limit greatest(1, least(coalesce(p_limit, 200), 400));
end;
$$;

comment on function public.list_kitchen_orders(uuid, text, integer, integer) is
  'Pedidos para o KDS numa ida: ativos e recém-finalizados, com estação e tempo de preparo.';

revoke all on function public.list_kitchen_orders(uuid, text, integer, integer) from public;
grant execute on function public.list_kitchen_orders(uuid, text, integer, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. Estações do restaurante (leitura para o filtro)
-- ----------------------------------------------------------------------------
create or replace function public.list_kitchen_stations(p_restaurant_id uuid)
returns table (id uuid, name text, slug text, kind public.kitchen_station_kind, position integer)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if p_restaurant_id is null or not public.kds_can_view(p_restaurant_id) then
    return;
  end if;

  return query
    select ks.id, ks.name, ks.slug, ks.kind, ks.position
    from public.kitchen_stations ks
    where ks.restaurant_id = p_restaurant_id
      and ks.is_active
    order by ks.position, ks.name;
end;
$$;

revoke all on function public.list_kitchen_stations(uuid) from public;
grant execute on function public.list_kitchen_stations(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 10. Tempo real
--
-- `orders` já está na publicação desde a Etapa 7 e o KDS assina o mesmo canal
-- (`orders:<restaurant_id>`), então um pedido criado pelo cliente aparece na
-- cozinha pelo mesmo caminho que o painel do restaurante já usa. Não há canal
-- novo, não há polling e não há segunda fonte de verdade.
--
-- `order_items` entra na publicação para o caso de um item ser adicionado a um
-- pedido existente: sem isso o KDS não saberia que o card mudou.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_items'
  ) then
    alter publication supabase_realtime add table public.order_items;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 11. Índices de leitura
--
-- O KDS consulta por (restaurante, created_at) com status entre quatro valores.
-- O índice da Etapa 16 já cobre a faixa de datas; o parcial abaixo cobre o caso
-- em que a casa acumula meses de pedidos entregues e a consulta só quer os
-- vivos — que é o que a tela pede a cada evento de tempo real.
-- ----------------------------------------------------------------------------
create index if not exists orders_kitchen_active_idx
  on public.orders (restaurant_id, created_at)
  where status in ('pending', 'confirmed', 'preparing', 'ready');

create index if not exists order_status_events_preparing_idx
  on public.order_status_events (order_id, created_at)
  where to_status = 'preparing';
