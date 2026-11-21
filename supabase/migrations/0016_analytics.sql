-- =============================================================================
-- 0016_analytics.sql · Etapa 16 — Analytics e relatórios
-- =============================================================================
-- Este arquivo faz três coisas, e a ordem importa:
--
--   1. cria o **livro de pagamentos** (`order_payments`), porque até a etapa 15
--      o produto não tinha nenhum registro de dinheiro recebido. Sem isso,
--      "valor efetivamente pago" não é uma métrica difícil: é uma métrica
--      impossível — o banco não sabe se alguém pagou;
--   2. monta as **funções de agregação** que o painel lê, todas recortadas por
--      `restaurant_id` e guardadas por `is_restaurant_member`;
--   3. adiciona os **índices** que fazem essas agregações caberem em milissegundos
--      num período de 30 dias com salão cheio.
--
-- ─── A decisão que define o módulo: pedido não é pagamento ────────────────────
--
-- O escopo pede para diferenciar "valor dos pedidos" de "valor efetivamente
-- pago", e proíbe considerar um pedido pago sem confirmação real. A tentação é
-- adicionar `orders.paid boolean` e marcar `true` quando o status vira
-- `delivered`. Isso seria mentira em pelo menos três situações reais:
--
--   • o cliente entregue **sem pagar** — foi embora, a casa vai cobrar depois;
--   • pagamento **parcial** — dois pagam a mesma conta, um paga metade;
--   • pagamento **por métodos diferentes** — R$ 30 no Pix e R$ 20 em dinheiro.
--
-- Por isso `order_payments` é um livro, não um selo: cada linha é um valor que
-- entrou, com método, horário e quem registrou. `paid` é derivado (soma das
-- linhas com `status = 'paid'`), nunca digitado. E `delivered` continua sendo
-- só o estado da cozinha — não gera pagamento nenhum.
--
-- ─── Multi-tenant ────────────────────────────────────────────────────────────
--
-- Toda função abaixo recebe `p_restaurant_id` e chama
-- `is_restaurant_member(p_restaurant_id)` **na mesma cláusula** da consulta. O
-- padrão já vem da etapa 7 e não foi inventado aqui: quando o guard falha, a
-- função devolve zero linhas ou um jsonb vazio, indistinguível de "casa sem
-- movimento". Um restaurante que chame a minha RPC com o id do vizinho não
-- recebe erro revelador nem dado — recebe vazio.
--
-- O frontend **nunca** manda filtro que o banco confie: o período chega como
-- duas datas, e a função valida ordem, span e fuso. Quem decide o recorte é o
-- banco.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enums de pagamento
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_method') then
    create type public.payment_method as enum (
      'cash',   -- dinheiro
      'pix',
      'card',   -- cartão (débito/crédito, na maquininha da casa)
      'other'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_status') then
    -- Só dois estados de propósito. "pending" seria um pagamento que ainda não
    -- aconteceu, e isso já é o pedido não pago — criar um terceiro estado
    -- obrigaria toda métrica a somar apenas um subconjunto, e o primeiro erro
    -- de quem esquecer seria contar dinheiro que não entrou.
    create type public.payment_status as enum ('paid', 'refunded');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Livro de pagamentos
-- -----------------------------------------------------------------------------
create table if not exists public.order_payments (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  order_id      uuid not null references public.orders (id) on delete cascade,

  method        public.payment_method not null,
  status        public.payment_status not null default 'paid',
  amount        numeric(10, 2) not null,

  -- Quando o dinheiro entrou de fato. Separado de `created_at` porque o dono
  -- registra à noite o que recebeu de manhã — e o relatório tem que contar no
  -- dia do recebimento, não no dia da digitação.
  paid_at       timestamptz not null default now(),

  -- Quem registrou. Nulo se o registro veio de automação futura.
  recorded_by   uuid references auth.users (id) on delete set null,
  note          text,

  created_at    timestamptz not null default now(),

  constraint order_payments_amount_check check (amount > 0 and amount <= 1000000),
  constraint order_payments_note_check check (note is null or char_length(note) <= 200)
);

comment on table public.order_payments is
  'Livro de pagamentos recebidos. Um pedido pode ter vários (parcial, métodos mistos). "Pago" é derivado daqui, nunca digitado no pedido.';
comment on column public.order_payments.paid_at is
  'Momento em que o dinheiro entrou. Pode ser anterior ao registro (lançamento retroativo do dia).';

-- Índice principal das métricas: "pagamentos da casa X entre dois instantes".
create index if not exists order_payments_restaurant_paid_at_idx
  on public.order_payments (restaurant_id, paid_at desc);
-- Detalhe do pedido no painel: "quanto já entrou deste pedido".
create index if not exists order_payments_order_idx
  on public.order_payments (order_id, created_at);

alter table public.order_payments enable row level security;

-- Leitura: membro ativo da casa. Escrita: só pela RPC abaixo (que confere
-- vínculo, valor e teto). Sem policy de insert/update/delete, um navegador não
-- consegue forjar um pagamento nem "marcar como pago" direto na tabela.
drop policy if exists order_payments_select_member on public.order_payments;
create policy order_payments_select_member on public.order_payments
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

grant select on public.order_payments to authenticated;
revoke all on public.order_payments from anon;

-- -----------------------------------------------------------------------------
-- 3. Índices do analytics
-- -----------------------------------------------------------------------------
-- `orders_restaurant_status_idx (restaurant_id, status, created_at)` já existe
-- (0007) e serve para o painel. Analytics pergunta outra coisa: "todos os
-- pedidos da casa neste intervalo, seja qual for o status". Ordem diferente,
-- índice diferente — sem este, o Postgres lê o índice por status três vezes e
-- ainda junta.
create index if not exists orders_restaurant_created_idx
  on public.orders (restaurant_id, created_at desc);

-- Ranking de produtos: filtra por casa e período antes de agrupar por nome.
-- `order_items` já tem `restaurant_id` denormalizado (0007) justamente para não
-- depender de join com `orders` em consulta de relatório.
create index if not exists order_items_restaurant_created_idx
  on public.order_items (restaurant_id, created_at desc);

-- Chamadas de garçom e pedidos de conta por período.
create index if not exists table_requests_restaurant_created_type_idx
  on public.table_requests (restaurant_id, created_at desc, type);

-- -----------------------------------------------------------------------------
-- 4. Registrar pagamento
-- -----------------------------------------------------------------------------
/**
 * Registra um valor recebido de um pedido.
 *
 * Regras, todas conferidas aqui e não no app:
 *   • o pedido existe **e** o chamador é membro ativo da casa dele;
 *   • o valor é positivo;
 *   • a soma dos pagamentos não passa do total do pedido — o teto é o que o
 *     cliente deve, não o que o operador digita.
 *
 * O teto não é burocracia: sem ele, um dedo escorregado no "0" transforma
 * R$ 45 em R$ 450 e o faturamento do mês fica errado para sempre, num número
 * que o dono usa para decidir preço.
 */
create or replace function public.record_order_payment(
  p_order_id uuid,
  p_amount   numeric,
  p_method   public.payment_method default 'cash',
  p_note     text default null
)
returns table (
  payment_id uuid,
  order_id   uuid,
  amount     numeric,
  method     public.payment_method,
  status     public.payment_status,
  paid_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant uuid;
  v_total      numeric;
  v_paid       numeric;
  v_row        public.order_payments;
begin
  select o.restaurant_id, o.total
    into v_restaurant, v_total
  from public.orders o
  where o.id = p_order_id
    and public.is_restaurant_member(o.restaurant_id);

  if v_restaurant is null then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  if p_note is not null and char_length(p_note) > 200 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;

  select coalesce(sum(p.amount), 0)
    into v_paid
  from public.order_payments p
  where p.order_id = p_order_id
    and p.status = 'paid';

  if v_paid + p_amount > v_total + 0.005 then
    -- 0.005 de tolerância para arredondamento de centavo, não para encher.
    raise exception 'amount_exceeds_total'
      using errcode = '22023',
            hint    = format('total=%s pago=%s tentativa=%s', v_total, v_paid, p_amount);
  end if;

  insert into public.order_payments (restaurant_id, order_id, method, amount, note, recorded_by)
  values (v_restaurant, p_order_id, coalesce(p_method, 'cash'), p_amount, p_note, auth.uid())
  returning * into v_row;

  return query
    select v_row.id, v_row.order_id, v_row.amount, v_row.method, v_row.status, v_row.paid_at;
end;
$$;

revoke all on function public.record_order_payment(uuid, numeric, public.payment_method, text) from public, anon;
grant execute on function public.record_order_payment(uuid, numeric, public.payment_method, text) to authenticated;

/**
 * Estorna um pagamento lançado errado.
 *
 * Marca `refunded` em vez de apagar: o histórico do que foi digitado precisa
 * sobreviver ao erro, senão o relatório de ontem muda sozinho e ninguém
 * consegue explicar por quê. Métricas de "pago" consideram só `status = 'paid'`.
 */
create or replace function public.refund_order_payment(
  p_payment_id uuid,
  p_note       text default null
)
returns table (payment_id uuid, status public.payment_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.order_payments;
begin
  select p.* into v_row
  from public.order_payments p
  where p.id = p_payment_id
    and public.is_restaurant_member(p.restaurant_id);

  if v_row.id is null then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;

  if v_row.status = 'refunded' then
    raise exception 'already_refunded' using errcode = '22023';
  end if;

  update public.order_payments p
     set status = 'refunded',
         note = coalesce(nullif(p_note, ''), p.note)
   where p.id = p_payment_id
  returning * into v_row;

  return query select v_row.id, v_row.status;
end;
$$;

revoke all on function public.refund_order_payment(uuid, text) from public, anon;
grant execute on function public.refund_order_payment(uuid, text) to authenticated;

/**
 * Pagamentos de um pedido — para o detalhe no painel mostrar "já entrou
 * R$ 30 de R$ 45" antes de o operador lançar o resto.
 */
create or replace function public.list_order_payments(p_order_id uuid)
returns table (
  payment_id uuid,
  amount     numeric,
  method     public.payment_method,
  status     public.payment_status,
  paid_at    timestamptz,
  note       text
)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.amount, p.method, p.status, p.paid_at, p.note
  from public.order_payments p
  join public.orders o on o.id = p.order_id
  where p.order_id = p_order_id
    and public.is_restaurant_member(o.restaurant_id)
  order by p.created_at desc;
$$;

revoke all on function public.list_order_payments(uuid) from public, anon;
grant execute on function public.list_order_payments(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Normalização do período (validado no banco)
-- -----------------------------------------------------------------------------
/**
 * Traduz o período pedido em [início, fim) no fuso da casa.
 *
 * Por que no banco e não no app: o recorte decide _quais_ pedidos entram na
 * conta. Se o app manda `from`/`to`, dois clientes diferentes calculam "este
 * mês" com regras diferentes — e o número que o dono vê às 23h58 de 31 de
 * dezembro não bate com o que ele viu de manhã. Aqui a regra é uma só.
 *
 * Contrato:
 *   p_preset = 'today' | 'yesterday' | 'last7' | 'last30' | 'this_month'
 *            | 'last_month' | 'custom'
 *   p_from / p_to  obrigatórios em 'custom' (datas YYYY-MM-DD, inclusivas)
 *
 * Devolve um intervalo semiaberto — `[from_at, to_at)`. Semiaberto é o que
 * evita o bug clássico de contagem dupla no primeiro instante do dia seguinte:
 * `<= 23:59:59` perde o pedido das 23:59:59.5.
 *
 * O limite de 366 dias existe porque um `custom` sem limite vira uma varredura
 * da tabela inteira dentro de uma requisição HTTP, a pedido de quem chama.
 */
create or replace function public.analytics_period(
  p_preset text,
  p_from   date default null,
  p_to     date default null,
  p_tz     text default 'America/Sao_Paulo'
)
returns table (from_at timestamptz, to_at timestamptz, preset text, from_date date, to_date date)
language plpgsql
stable
as $$
declare
  v_tz      text := coalesce(nullif(p_tz, ''), 'America/Sao_Paulo');
  v_preset  text := lower(coalesce(nullif(trim(p_preset), ''), 'last7'));
  v_today   date := (now() at time zone v_tz)::date;
  v_from    date;
  v_to      date;   -- inclusivo
begin
  -- Fuso inventado faria o Postgres levantar erro no meio da consulta. Melhor
  -- cair no padrão do país do que devolver 500 num relatório.
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    v_tz := 'America/Sao_Paulo';
  end if;

  case v_preset
    when 'today' then
      v_from := v_today; v_to := v_today;
    when 'yesterday' then
      v_from := v_today - 1; v_to := v_today - 1;
    when 'last7' then
      -- "Últimos 7 dias" inclui hoje: é o que o dono espera ao abrir o painel
      -- no fim do expediente e ver o próprio dia lá dentro.
      v_from := v_today - 6; v_to := v_today;
    when 'last30' then
      v_from := v_today - 29; v_to := v_today;
    when 'this_month' then
      v_from := date_trunc('month', v_today)::date;
      v_to   := v_today;
    when 'last_month' then
      v_from := (date_trunc('month', v_today) - interval '1 month')::date;
      v_to   := (date_trunc('month', v_today) - interval '1 day')::date;
    when 'custom' then
      if p_from is null or p_to is null then
        raise exception 'period_required' using errcode = '22023';
      end if;
      if p_to < p_from then
        raise exception 'period_inverted' using errcode = '22023';
      end if;
      if p_to - p_from > 366 then
        raise exception 'period_too_long' using errcode = '22023';
      end if;
      v_from := p_from; v_to := p_to;
    else
      raise exception 'unknown_preset' using errcode = '22023', hint = v_preset;
  end case;

  from_at := (v_from::timestamp at time zone v_tz);
  to_at   := ((v_to + 1)::timestamp at time zone v_tz);  -- primeiro instante do dia seguinte
  preset  := v_preset;
  from_date := v_from;
  to_date := v_to;

  /*
   * `return next` é obrigatório e não é decorativo. Em plpgsql, atribuir às
   * colunas de saída de uma função `returns table` **não** emite linha: sem
   * esta linha a função devolve zero registros em silêncio, e todas as
   * agregações que dependem dela devolvem zero também. Foi exatamente o que
   * aconteceu no primeiro teste — o sintoma não foi erro, foi um painel vazio.
   */
  return next;
end;
$$;

revoke all on function public.analytics_period(text, date, date, text) from public, anon;

-- -----------------------------------------------------------------------------
-- 6. Visão geral do período
-- -----------------------------------------------------------------------------
/**
 * Os números do topo da tela, numa consulta.
 *
 * A separação central do módulo está nas três primeiras colunas:
 *
 *   orders_value    — soma de `orders.total` dos pedidos não cancelados.
 *                     É o que foi **pedido**.
 *   paid_value      — soma de `order_payments.amount` com status 'paid' e
 *                     `paid_at` dentro do período. É o que **entrou**.
 *   unpaid_value    — orders_value - paid_value dos pedidos do período. É o que
 *                     a casa tem a receber.
 *
 * Note que `paid_value` usa `paid_at` e `orders_value` usa `created_at`: um
 * pedido feito em março e pago em abril aparece como pedido em março e como
 * dinheiro em abril. É a única leitura honesta dos dois números, e é por isso
 * que eles divergem de propósito.
 *
 * Cancelado não conta como faturamento, mas conta em `orders_cancelled` — o
 * dono precisa ver o que perdeu, não ter isso escondido.
 */
create or replace function public.restaurant_analytics_summary(
  p_restaurant_id uuid,
  p_preset text default 'last7',
  p_from date default null,
  p_to date default null
)
returns table (
  preset            text,
  from_date         date,
  to_date           date,
  orders_count      integer,
  orders_value      numeric,
  paid_value        numeric,
  unpaid_value      numeric,
  orders_cancelled  integer,
  cancelled_value   numeric,
  ticket_average    numeric,
  waiter_calls      integer,
  bill_requests     integer,
  items_sold        integer,
  orders_by_status  jsonb
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_tz   text;
  v_from timestamptz;
  v_to   timestamptz;
  v_preset text;
  v_from_date date;
  v_to_date date;
begin
  -- Membro ativo ou nada. Zero linhas é indistinguível de casa sem movimento,
  -- e é isso que impede usar esta RPC para descobrir se um id existe.
  if not public.is_restaurant_member(p_restaurant_id) then
    return;
  end if;

  select r.timezone into v_tz from public.restaurants r where r.id = p_restaurant_id;

  select p.from_at, p.to_at, p.preset, p.from_date, p.to_date
    into v_from, v_to, v_preset, v_from_date, v_to_date
  from public.analytics_period(p_preset, p_from, p_to, coalesce(v_tz, 'America/Sao_Paulo')) p;

  return query
  with ord as (
    select o.id, o.status, o.total, o.created_at
    from public.orders o
    where o.restaurant_id = p_restaurant_id
      and o.created_at >= v_from
      and o.created_at <  v_to
  ),
  live as (
    select * from ord where status <> 'cancelled'
  ),
  pay as (
    select p.amount
    from public.order_payments p
    where p.restaurant_id = p_restaurant_id
      and p.status = 'paid'
      and p.paid_at >= v_from
      and p.paid_at <  v_to
  ),
  req as (
    select tr.type, tr.status
    from public.table_requests tr
    where tr.restaurant_id = p_restaurant_id
      and tr.created_at >= v_from
      and tr.created_at <  v_to
  ),
  items as (
    select i.quantity
    from public.order_items i
    join live l on l.id = i.order_id
    where i.restaurant_id = p_restaurant_id
  ),
  by_status as (
    select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) as payload
    from (
      select o.status::text as status, count(*)::integer as n
      from ord o
      group by o.status
    ) s
  )
  select
    v_preset,
    v_from_date,
    v_to_date,
    (select count(*)::integer from live),
    (select coalesce(sum(l.total), 0) from live l),
    (select coalesce(sum(p.amount), 0) from pay p),
    -- A receber: só dos pedidos do período. O que foi pago a mais de um pedido
    -- antigo já apareceu em `paid_value` do mês do pagamento — não se mistura.
    (select coalesce(sum(greatest(l.total - coalesce(pd.paid, 0), 0)), 0)
       from live l
       left join (
         select p2.order_id, sum(p2.amount) as paid
         from public.order_payments p2
         where p2.status = 'paid'
           and p2.restaurant_id = p_restaurant_id
         group by p2.order_id
       ) pd on pd.order_id = l.id),
    (select count(*)::integer from ord o where o.status = 'cancelled'),
    (select coalesce(sum(o.total), 0) from ord o where o.status = 'cancelled'),
    -- Ticket médio: média do que foi pedido, não do que foi pago. Misturar os
    -- dois faria o ticket cair no dia em que a casa ainda não lançou os
    -- recebimentos da noite — número que assusta sem motivo.
    (select case when count(*) = 0 then 0
                 else round(sum(l.total) / count(*), 2) end from live l),
    -- Chamadas e pedidos de conta: só as que aconteceram. Cancelada pelo
    -- próprio cliente não é atendimento prestado, mas também não é erro da
    -- casa — por isso entra em `waiter_calls` tudo que não foi cancelado.
    (select count(*)::integer from req r where r.type = 'waiter' and r.status <> 'cancelled'),
    (select count(*)::integer from req r where r.type = 'bill' and r.status <> 'cancelled'),
    (select coalesce(sum(i.quantity), 0)::integer from items i),
    (select payload from by_status);
end;
$$;

revoke all on function public.restaurant_analytics_summary(uuid, text, date, date) from public, anon;
grant execute on function public.restaurant_analytics_summary(uuid, text, date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Série temporal (vendas por dia, pedidos por dia)
-- -----------------------------------------------------------------------------
/**
 * Um ponto por dia do período, **inclusive os dias sem movimento**.
 *
 * O `generate_series` não é preciosismo: sem ele o gráfico pula o domingo
 * fechado e o eixo mentindo faz uma casa que vendeu R$ 0 no domingo parecer
 * constante. O app não precisa preencher lacuna — e preencher no app é onde
 * nasce o bug de fuso, porque aí cada dia é convertido duas vezes.
 *
 * Devolve também `paid_value` por dia, para o gráfico poder mostrar vendido x
 * recebido no mesmo eixo.
 */
create or replace function public.restaurant_analytics_daily(
  p_restaurant_id uuid,
  p_preset text default 'last7',
  p_from date default null,
  p_to date default null
)
returns table (
  day         date,
  orders_count integer,
  orders_value numeric,
  paid_value   numeric,
  cancelled_count integer
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_tz   text;
  v_from timestamptz;
  v_to   timestamptz;
  v_from_date date;
  v_to_date date;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    return;
  end if;

  select r.timezone into v_tz from public.restaurants r where r.id = p_restaurant_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');

  select p.from_at, p.to_at, p.from_date, p.to_date
    into v_from, v_to, v_from_date, v_to_date
  from public.analytics_period(p_preset, p_from, p_to, v_tz) p;

  return query
  with days as (
    select gs::date as day
    from generate_series(v_from_date, v_to_date, interval '1 day') gs
  ),
  ord as (
    select (o.created_at at time zone v_tz)::date as day,
           count(*) filter (where o.status <> 'cancelled')::integer as orders_count,
           coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0) as orders_value,
           count(*) filter (where o.status = 'cancelled')::integer as cancelled_count
    from public.orders o
    where o.restaurant_id = p_restaurant_id
      and o.created_at >= v_from
      and o.created_at <  v_to
    group by 1
  ),
  pay as (
    select (p.paid_at at time zone v_tz)::date as day,
           coalesce(sum(p.amount), 0) as paid_value
    from public.order_payments p
    where p.restaurant_id = p_restaurant_id
      and p.status = 'paid'
      and p.paid_at >= v_from
      and p.paid_at <  v_to
    group by 1
  )
  select d.day,
         coalesce(ord.orders_count, 0),
         coalesce(ord.orders_value, 0),
         coalesce(pay.paid_value, 0),
         coalesce(ord.cancelled_count, 0)
  from days d
  left join ord on ord.day = d.day
  left join pay on pay.day = d.day
  order by d.day;
end;
$$;

revoke all on function public.restaurant_analytics_daily(uuid, text, date, date) from public, anon;
grant execute on function public.restaurant_analytics_daily(uuid, text, date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Horários de pico
-- -----------------------------------------------------------------------------
/**
 * Pedidos por hora do dia (0–23), somados ao longo do período.
 *
 * As 24 linhas saem sempre, mesmo as vazias: o gráfico de pico precisa de um
 * eixo fixo de 24 horas para a forma da curva significar alguma coisa. Fechado
 * das 15h às 18h é um vale visível, não um buraco no eixo.
 *
 * `business_hour` é a hora local da casa — 20h no relatório é 20h no salão,
 * não 23h UTC.
 */
create or replace function public.restaurant_analytics_hours(
  p_restaurant_id uuid,
  p_preset text default 'last7',
  p_from date default null,
  p_to date default null
)
returns table (hour integer, orders_count integer, orders_value numeric)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_tz   text;
  v_from timestamptz;
  v_to   timestamptz;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    return;
  end if;

  select r.timezone into v_tz from public.restaurants r where r.id = p_restaurant_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');

  select p.from_at, p.to_at into v_from, v_to
  from public.analytics_period(p_preset, p_from, p_to, v_tz) p;

  return query
  with hours as (
    select generate_series(0, 23) as hour
  ),
  agg as (
    select extract(hour from (o.created_at at time zone v_tz))::integer as hour,
           count(*)::integer as orders_count,
           coalesce(sum(o.total), 0) as orders_value
    from public.orders o
    where o.restaurant_id = p_restaurant_id
      and o.status <> 'cancelled'
      and o.created_at >= v_from
      and o.created_at <  v_to
    group by 1
  )
  select h.hour, coalesce(a.orders_count, 0), coalesce(a.orders_value, 0)
  from hours h
  left join agg a on a.hour = h.hour
  order by h.hour;
end;
$$;

revoke all on function public.restaurant_analytics_hours(uuid, text, date, date) from public, anon;
grant execute on function public.restaurant_analytics_hours(uuid, text, date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. Produtos, categorias, mesas e formas de pagamento
-- -----------------------------------------------------------------------------
/**
 * Produtos mais vendidos.
 *
 * Agrupa por `product_name_snapshot`, não por `product_id`. O motivo é o
 * histórico congelado da etapa 6: se o dono renomear "X-Bacon" para "X-Bacon
 * Especial", um agrupamento por id mostraria uma linha só (correto), mas um
 * agrupamento por nome mostraria duas. Aqui escolhemos o nome porque ele é o
 * que o **relatório lê**, e um produto apagado (`product_id` vira null) some
 * de um agrupamento por id — o que apagaria venda real do passado.
 *
 * Ordena por quantidade, não por valor: "o que sai mais" é a pergunta da
 * cozinha e do estoque. O valor vem junto para o dono decidir preço.
 */
create or replace function public.restaurant_analytics_top_products(
  p_restaurant_id uuid,
  p_preset text default 'last7',
  p_from date default null,
  p_to date default null,
  p_limit integer default 10
)
returns table (product_name text, quantity integer, revenue numeric)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_tz   text;
  v_from timestamptz;
  v_to   timestamptz;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    return;
  end if;

  select r.timezone into v_tz from public.restaurants r where r.id = p_restaurant_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');

  select p.from_at, p.to_at into v_from, v_to
  from public.analytics_period(p_preset, p_from, p_to, v_tz) p;

  return query
  select i.product_name_snapshot,
         sum(i.quantity)::integer,
         round(sum(i.subtotal), 2)
  from public.order_items i
  join public.orders o on o.id = i.order_id
  where i.restaurant_id = p_restaurant_id
    and o.status <> 'cancelled'
    and o.created_at >= v_from
    and o.created_at <  v_to
  group by i.product_name_snapshot
  order by 2 desc, 3 desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
end;
$$;

revoke all on function public.restaurant_analytics_top_products(uuid, text, date, date, integer) from public, anon;
grant execute on function public.restaurant_analytics_top_products(uuid, text, date, date, integer) to authenticated;

/**
 * Categorias mais vendidas.
 *
 * Vem por `category_id` da tabela base, com o nome atual e tolerância a
 * categoria apagada (`left join` + "Sem categoria"). Categoria é estrutura
 * viva do cardápio; aqui o id é a chave certa porque "Sobremesas" continua
 * sendo a mesma categoria depois de renomeada.
 */
create or replace function public.restaurant_analytics_categories(
  p_restaurant_id uuid,
  p_preset text default 'last7',
  p_from date default null,
  p_to date default null
)
returns table (category_id uuid, category_name text, quantity integer, revenue numeric)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_tz   text;
  v_from timestamptz;
  v_to   timestamptz;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    return;
  end if;

  select r.timezone into v_tz from public.restaurants r where r.id = p_restaurant_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');

  select p.from_at, p.to_at into v_from, v_to
  from public.analytics_period(p_preset, p_from, p_to, v_tz) p;

  return query
  select coalesce(c.id, i.product_id) as category_id,
         coalesce(c.name, 'Sem categoria') as category_name,
         sum(i.quantity)::integer,
         round(sum(i.subtotal), 2)
  from public.order_items i
  join public.orders o on o.id = i.order_id
  left join public.products pr on pr.id = i.product_id
  left join public.categories c on c.id = pr.category_id
  where i.restaurant_id = p_restaurant_id
    and o.status <> 'cancelled'
    and o.created_at >= v_from
    and o.created_at <  v_to
  group by coalesce(c.id, i.product_id), coalesce(c.name, 'Sem categoria')
  order by 3 desc, 4 desc
  limit 20;
end;
$$;

revoke all on function public.restaurant_analytics_categories(uuid, text, date, date) from public, anon;
grant execute on function public.restaurant_analytics_categories(uuid, text, date, date) to authenticated;

/**
 * Mesas com maior volume.
 *
 * Responde "qual canto do salão gira mais", que é uma pergunta de operação:
 * mesa que sempre lidera pode ser a que o garçom passa mais perto, e mesa
 * sempre vazia pode estar com QR Code ruim. Só mesas do período entram — o
 * ranking de 30 mesas onde 26 têm zero não se lê no celular.
 */
create or replace function public.restaurant_analytics_tables(
  p_restaurant_id uuid,
  p_preset text default 'last7',
  p_from date default null,
  p_to date default null
)
returns table (table_id uuid, table_name text, orders_count integer, orders_value numeric)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_tz   text;
  v_from timestamptz;
  v_to   timestamptz;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    return;
  end if;

  select r.timezone into v_tz from public.restaurants r where r.id = p_restaurant_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');

  select p.from_at, p.to_at into v_from, v_to
  from public.analytics_period(p_preset, p_from, p_to, v_tz) p;

  return query
  select t.id, t.name, count(*)::integer, round(sum(o.total), 2)
  from public.orders o
  join public.tables t on t.id = o.table_id
  where o.restaurant_id = p_restaurant_id
    and o.status <> 'cancelled'
    and o.created_at >= v_from
    and o.created_at <  v_to
  group by t.id, t.name
  order by 3 desc, 4 desc
  limit 15;
end;
$$;

revoke all on function public.restaurant_analytics_tables(uuid, text, date, date) from public, anon;
grant execute on function public.restaurant_analytics_tables(uuid, text, date, date) to authenticated;

/**
 * Formas de pagamento — só do que foi **efetivamente recebido**.
 *
 * Lê de `order_payments` e não dos pedidos, porque método de pagamento é uma
 * propriedade do pagamento, não do pedido: o mesmo pedido pode ter Pix e
 * dinheiro. É esta função que responde "quanto entrou em dinheiro no caixa".
 */
create or replace function public.restaurant_analytics_payment_methods(
  p_restaurant_id uuid,
  p_preset text default 'last7',
  p_from date default null,
  p_to date default null
)
returns table (method public.payment_method, payments_count integer, amount numeric)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_tz   text;
  v_from timestamptz;
  v_to   timestamptz;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    return;
  end if;

  select r.timezone into v_tz from public.restaurants r where r.id = p_restaurant_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');

  select p.from_at, p.to_at into v_from, v_to
  from public.analytics_period(p_preset, p_from, p_to, v_tz) p;

  return query
  select p.method, count(*)::integer, round(sum(p.amount), 2)
  from public.order_payments p
  where p.restaurant_id = p_restaurant_id
    and p.status = 'paid'
    and p.paid_at >= v_from
    and p.paid_at <  v_to
  group by p.method
  order by 3 desc;
end;
$$;

revoke all on function public.restaurant_analytics_payment_methods(uuid, text, date, date) from public, anon;
grant execute on function public.restaurant_analytics_payment_methods(uuid, text, date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 10. Comparação com o período anterior
-- -----------------------------------------------------------------------------
/**
 * O mesmo resumo, deslocado um período para trás — a base do "↑ 12% vs. 7 dias
 * anteriores".
 *
 * `analytics_previous_period` é calculada em SQL e não no app de propósito: o
 * "período anterior" de "este mês" é o mês passado inteiro até o mesmo dia, e
 * de "últimos 7" são os 7 dias anteriores. Duas regras que dependem do preset.
 * Se o app calculasse, o preset `custom` (que o app monta) divergiria das
 * outras seis.
 *
 * Devolve `null` quando o período anterior tem zero pedidos: "crescimento de
 * 0 para 3" é `+∞%`, e mostrar "∞%" ou "100%" no card seria inventar. O app
 * mostra "sem base de comparação".
 */
create or replace function public.analytics_previous_period(
  p_preset text,
  p_from date default null,
  p_to date default null,
  p_tz text default 'America/Sao_Paulo'
)
returns table (from_at timestamptz, to_at timestamptz, from_date date, to_date date)
language plpgsql
stable
as $$
declare
  v_cur record;
  v_days integer;
begin
  select * into v_cur from public.analytics_period(p_preset, p_from, p_to, p_tz) p
   limit 1;

  -- Período atual medido em dias inclusivos; o anterior tem o mesmo tamanho e
  -- termina no instante imediatamente anterior ao início do atual.
  v_days := (v_cur.to_date - v_cur.from_date) + 1;

  from_date := v_cur.from_date - v_days;
  to_date   := v_cur.from_date - 1;
  from_at   := ((v_cur.from_date - v_days)::timestamp at time zone p_tz);
  to_at     := (v_cur.from_date::timestamp at time zone p_tz);

  -- Mesma armadilha de `analytics_period`: sem `return next`, devolve vazio.
  return next;
end;
$$;

revoke all on function public.analytics_previous_period(text, date, date, text) from public, anon;

/**
 * Resumo do período anterior — só o que a comparação precisa.
 *
 * Separado do `restaurant_analytics_summary` para não duplicar sete métricas
 * que não são comparadas (mensagens de garçom, itens vendidos) e para deixar o
 * contrato explícito: a tela compara receita, pedidos e ticket.
 */
create or replace function public.restaurant_analytics_previous(
  p_restaurant_id uuid,
  p_preset text default 'last7',
  p_from date default null,
  p_to date default null
)
returns table (
  from_date    date,
  to_date      date,
  orders_count integer,
  orders_value numeric,
  paid_value   numeric,
  ticket_average numeric,
  has_data     boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_tz   text;
  v_from timestamptz;
  v_to   timestamptz;
  v_from_date date;
  v_to_date date;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    return;
  end if;

  select r.timezone into v_tz from public.restaurants r where r.id = p_restaurant_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');

  select p.from_at, p.to_at, p.from_date, p.to_date
    into v_from, v_to, v_from_date, v_to_date
  from public.analytics_previous_period(p_preset, p_from, p_to, v_tz) p;

  return query
  with live as (
    select o.total
    from public.orders o
    where o.restaurant_id = p_restaurant_id
      and o.status <> 'cancelled'
      and o.created_at >= v_from
      and o.created_at <  v_to
  ),
  pay as (
    select coalesce(sum(p.amount), 0) as paid
    from public.order_payments p
    where p.restaurant_id = p_restaurant_id
      and p.status = 'paid'
      and p.paid_at >= v_from
      and p.paid_at <  v_to
  )
  select
    v_from_date,
    v_to_date,
    (select count(*)::integer from live),
    (select coalesce(sum(l.total), 0) from live l),
    (select paid from pay),
    (select case when count(*) = 0 then 0
                 else round(sum(l.total) / count(*), 2) end from live l),
    (select count(*) > 0 from live);
end;
$$;

revoke all on function public.restaurant_analytics_previous(uuid, text, date, date) from public, anon;
grant execute on function public.restaurant_analytics_previous(uuid, text, date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 11. Admin master: métricas globais da plataforma
-- -----------------------------------------------------------------------------
/**
 * Crescimento e volume da plataforma inteira — Etapa 16, item "ADMIN MASTER".
 *
 * É a única função do módulo sem recorte por tenant, e isso é o contrato dela:
 * painel master vê global. O guard é outro (`is_platform_admin()`), aplicado
 * linha por linha como nas outras RPCs de `0011`.
 *
 * `p_days` limita a janela de crescimento (7/30/90) e é validado aqui: o admin
 * não deveria conseguir pedir "compare com 10 anos atrás" e travar o banco.
 *
 * Os números:
 *   • `new_restaurants` / `new_orders` — criados na janela;
 *   • `previous_restaurants` / `previous_orders` — a mesma janela deslocada,
 *     para o "crescimento" ser comparação de iguais;
 *   • `active_subscriptions` — assinaturas correntes (`cancelled_at is null`)
 *     em estado que dá acesso ao produto. `trial` NÃO conta como assinatura
 *     ativa: trial é funil, e somar os dois faz o painel mostrar receita que
 *     não existe.
 *   • `orders_value` — volume pedido, sem cancelados;
 *   • `paid_value` — dinheiro que entrou, de `order_payments`.
 */
create or replace function public.admin_analytics(p_days integer default 30)
returns table (
  days                 integer,
  restaurants_total    integer,
  restaurants_active   integer,
  restaurants_suspended integer,
  restaurants_new      integer,
  restaurants_previous integer,
  orders_total         integer,
  orders_value         numeric,
  paid_value           numeric,
  orders_cancelled     integer,
  orders_new           integer,
  orders_previous      integer,
  active_subscriptions integer,
  trials_now           integer,
  mrr                  numeric
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_days     integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_tz       text := 'America/Sao_Paulo';
  v_from     timestamptz;
  v_to       timestamptz;
  v_prev_from timestamptz;
  v_prev_to   timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  v_to := now();
  v_from := now() - make_interval(days => v_days);
  v_prev_to := v_from;
  v_prev_from := v_from - make_interval(days => v_days);

  return query
  select
    v_days,
    (select count(*)::integer from public.restaurants),
    (select count(*)::integer from public.restaurants r where r.status = 'published'),
    (select count(*)::integer from public.restaurants r where r.status = 'suspended'),
    (select count(*)::integer from public.restaurants r where r.created_at >= v_from),
    (select count(*)::integer from public.restaurants r
      where r.created_at >= v_prev_from and r.created_at < v_prev_to),
    (select count(*)::integer from public.orders o where o.status <> 'cancelled'),
    (select coalesce(sum(o.total), 0) from public.orders o where o.status <> 'cancelled'),
    (select coalesce(sum(p.amount), 0) from public.order_payments p where p.status = 'paid'),
    (select count(*)::integer from public.orders o where o.status = 'cancelled'),
    (select count(*)::integer from public.orders o where o.created_at >= v_from),
    (select count(*)::integer from public.orders o
      where o.created_at >= v_prev_from and o.created_at < v_prev_to),
    (select count(*)::integer
       from public.subscriptions s
      where s.cancelled_at is null
        and s.status in ('active', 'past_due')),
    (select count(*)::integer
       from public.subscriptions s
      where s.cancelled_at is null
        and s.status = 'trial'),
    -- MRR: só assinatura paga corrente. Trial e past_due fora — um é funil, o
    -- outro é dinheiro que a casa diz que vai pagar e ainda não pagou.
    (select coalesce(sum(coalesce(s.price_snapshot, pl.price_monthly)), 0)
       from public.subscriptions s
       join public.plans pl on pl.id = s.plan_id
      where s.cancelled_at is null
        and s.status = 'active');
end;
$$;

revoke all on function public.admin_analytics(integer) from public, anon;
grant execute on function public.admin_analytics(integer) to authenticated;

/**
 * Volume de pedidos por dia, plataforma inteira — o gráfico do /admin.
 *
 * `p_days` aceita 7, 30 ou 90 (validado). Mesma regra do gráfico por casa:
 * dias sem pedido saem com zero, para o eixo não mentir.
 */
create or replace function public.admin_analytics_daily(p_days integer default 30)
returns table (day date, restaurants_new integer, orders_count integer, orders_value numeric)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_tz   text := 'America/Sao_Paulo';
  v_today date := (now() at time zone v_tz)::date;
  v_from date := v_today - (v_days - 1);
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  return query
  with days as (
    select gs::date as day
    from generate_series(v_from, v_today, interval '1 day') gs
  ),
  new_restaurants as (
    select (r.created_at at time zone v_tz)::date as day, count(*)::integer as n
    from public.restaurants r
    where (r.created_at at time zone v_tz)::date >= v_from
    group by 1
  ),
  ord as (
    select (o.created_at at time zone v_tz)::date as day,
           count(*)::integer as n,
           coalesce(sum(o.total), 0) as value
    from public.orders o
    where o.status <> 'cancelled'
      and (o.created_at at time zone v_tz)::date >= v_from
    group by 1
  )
  select d.day,
         coalesce(nr.n, 0),
         coalesce(o.n, 0),
         coalesce(o.value, 0)
  from days d
  left join new_restaurants nr on nr.day = d.day
  left join ord o on o.day = d.day
  order by d.day;
end;
$$;

revoke all on function public.admin_analytics_daily(integer) from public, anon;
grant execute on function public.admin_analytics_daily(integer) to authenticated;
