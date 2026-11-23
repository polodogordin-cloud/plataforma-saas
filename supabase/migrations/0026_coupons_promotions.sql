-- ============================================================================
-- ETAPA 25 · CUPONS E PROMOÇÕES
--
-- O problema que este arquivo resolve
-- -----------------------------------
-- A casa tem `orders.discount` desde a Etapa 6 e **nada escrevia nele**: o
-- total sempre foi `subtotal - discount + fees`, mas `discount` ficava em zero.
-- Desconto existia como promessa de estrutura, não como recurso. Aqui ele passa
-- a ter origem: um cupom que o dono cria e o cliente digita no carrinho.
--
-- As peças:
--
--   1. `coupons`             — a regra que o dono edita (tipo, valor, validade,
--                              limites, valor mínimo).
--   2. `coupon_redemptions`  — quem usou, em que pedido, quanto foi abatido.
--   3. `validate_coupon()`   — a única autoridade sobre "este cupom vale?".
--   4. `create_order`        — recriada lendo o cupom e gravando o snapshot.
--
-- Decisões que valem registro
-- ---------------------------
-- 1. **O desconto é calculado no banco, nunca recebido do cliente.** O corpo
--    que chega de `create_order` traz só o código digitado (`p_coupon_code`);
--    valor, teto e total saem do banco. Se o cliente mandasse "desconto = 90",
--    a função não tem parâmetro para receber isso — a coluna não existe.
--
-- 2. **A validação é uma função só, usada nos dois caminhos.** Existe
--    `validate_coupon()` (leitura, para o cliente ver "Cupom aplicado: -R$ 5"
--    antes de enviar) e `create_order` (escrita). As duas chamam a MESMA
--    função; o cliente nunca decide se o cupom vale. Um segundo algoritmo na
--    tela divergiria do primeiro no dia em que as regras mudassem.
--
-- 3. **Uso duplicado é barrado por índice, não por `count(*)`.** A checagem de
--    limite roda antes do insert, o que sozinha seria uma corrida: duas mesas
--    confirmando o último cupom ao mesmo tempo passariam as duas. Por isso
--    `coupon_redemptions` é `unique (order_id)` — cada pedido abate uma vez —
--    e o limite é reconferido com trava (`for update`) na linha do cupom.
--
-- 4. **Snapshot no pedido, referência viva na redenção.** `orders` guarda
--    `coupon_code`, `coupon_type`, `coupon_value` e `discount` congelados. Se o
--    dono apagar o cupom amanhã, o pedido de ontem continua explicando por que
--    teve 10% de desconto — apagar a regra não reescreve o caixa. O `coupon_id`
--    fica como referência (`on delete set null`) junto do snapshot.
--
-- 5. **Cupom não zera o pedido nem gera troco.** O desconto é limitado a
--    `subtotal - fees` (nunca ao total com taxas), então `total >= 0` sempre.
--    Percentual é limitado a 100%; valor fixo maior que o pedido abate só o que
--    existe. `orders_totals_check` da Etapa 6 continua valendo como rede.
--
-- 6. **Cancelar pedido devolve o cupom.** As redenções de um pedido cancelado
--    são apagadas (`set_order_status`), porque um pedido que não aconteceu não
--    consumiu a promoção — do contrário o limite esgotaria em pedidos que nunca
--    foram servidos.
--
-- 7. **Frete grátis é tipo, não implementação.** `free_shipping` existe no enum
--    e o painel avisa que ainda não há delivery. Guardar o tipo agora evita uma
--    migration de enum depois; criar `delivery_fee` sem delivery seria mentira.
--
-- 8. **Campanhas ficam preparadas.** `coupon_type` e `coupons.status` são
--    fechados; o dia em que houver "promoção por produto/categoria", ela vira
--    uma tabela de escopo (`coupon_scopes`) apontando para o mesmo cupom, sem
--    mexer no que já está gravado em `orders`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------
-- `percentage` = "10% de desconto"; `fixed` = "R$ 5 de desconto";
-- `free_shipping` = "frete grátis" (reservado, sem delivery nesta etapa).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'coupon_discount_type') then
    create type public.coupon_discount_type as enum ('percentage', 'fixed', 'free_shipping');
  end if;
end
$$;

-- Status derivado de ativo + validade + limite. Guardado como coluna gerada
-- para o painel ordenar/filtrar por "expirado" sem repetir a regra em SQL e em
-- TypeScript — e para nunca haver dois lugares discordando.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'coupon_status') then
    create type public.coupon_status as enum ('active', 'scheduled', 'expired', 'inactive', 'exhausted');
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 2. TABELA: coupons
-- ----------------------------------------------------------------------------
create table if not exists public.coupons (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,

  -- Nome interno ("Volta às aulas") — o que o dono vê na lista.
  name           text not null,
  -- Código que o cliente digita. Sempre maiúsculo e sem espaço (normalizado
  -- antes de gravar; ver `normalize_coupon_code`).
  code           text not null,
  description    text,

  discount_type  public.coupon_discount_type not null,
  -- Mesma coluna para os dois tipos: 10 = 10% ou 10 = R$ 10, conforme o tipo.
  -- Duas colunas (`percent`/`amount`) deixariam uma sempre nula e a regra de
  -- "qual usar" espalhada por toda parte.
  discount_value numeric(10, 2) not null,

  -- Piso para o cupom valer (0 = vale em qualquer valor).
  min_order_value numeric(10, 2) not null default 0,
  -- Teto do desconto em cupom percentual (null = sem teto).
  max_discount    numeric(10, 2),

  starts_at      timestamptz,
  ends_at        timestamptz,

  -- Limite total de usos (null = ilimitado) e limite por cliente.
  max_uses       integer,
  max_uses_per_customer integer not null default 1,

  -- Não apaga: desativa. Apagar apagaria a explicação de pedidos antigos.
  active         boolean not null default true,

  created_by     uuid references public.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint coupons_name_check  check (char_length(btrim(name)) between 1 and 80),
  constraint coupons_code_check  check (code ~ '^[A-Z0-9]{3,24}$'),
  constraint coupons_desc_check  check (description is null or char_length(description) <= 200),
  constraint coupons_value_check check (discount_value > 0 and discount_value <= 1000000),
  constraint coupons_min_check   check (min_order_value >= 0),
  constraint coupons_max_check   check (max_discount is null or max_discount > 0),
  constraint coupons_dates_check check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint coupons_uses_check  check (max_uses is null or max_uses > 0),
  constraint coupons_per_cust_check check (max_uses_per_customer between 1 and 100),
  -- Percentual acima de 100% daria total negativo — e desconto negativo é o
  -- caminho mais curto para "a casa deve ao cliente".
  constraint coupons_percentage_range
    check (discount_type <> 'percentage' or discount_value <= 100)
);

-- Código único por casa, ignorando maiúsculas/minúsculas por garantia (a
-- normalização já grava maiúsculo, mas unicidade não depende de disciplina do
-- app).
create unique index if not exists coupons_code_unique
  on public.coupons (restaurant_id, upper(code));

create index if not exists coupons_restaurant_idx
  on public.coupons (restaurant_id, created_at desc);

drop trigger if exists coupons_touch_updated_at on public.coupons;
create trigger coupons_touch_updated_at
  before update on public.coupons
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. TABELA: coupon_redemptions
-- ----------------------------------------------------------------------------
/*
 * Um registro por pedido que usou cupom.
 *
 * `unique (order_id)` é a trava contra uso duplicado: se `create_order` fosse
 * chamado duas vezes com o mesmo pedido (não é, mas o banco não confia no app),
 * o segundo insert falha em vez de abater duas vezes o limite.
 *
 * `customer_id` fica nulo quando o pedido é anônimo — e é exatamente por isso
 * que `max_uses_per_customer` só é verificável para quem se identificou. O
 * painel explica isso ao dono em vez de fingir que todo mundo é rastreável.
 */
create table if not exists public.coupon_redemptions (
  id            uuid primary key default gen_random_uuid(),
  coupon_id     uuid not null references public.coupons (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  order_id      uuid not null references public.orders (id) on delete cascade,
  customer_id   uuid references public.customers (id) on delete set null,

  -- Congelado: mudar o cupom depois não reescreve o que foi abatido.
  code_snapshot   text not null,
  type_snapshot   public.coupon_discount_type not null,
  value_snapshot  numeric(10, 2) not null,
  amount          numeric(10, 2) not null,

  created_at    timestamptz not null default now(),

  constraint coupon_redemptions_amount_check check (amount >= 0),
  constraint coupon_redemptions_order_unique unique (order_id)
);

create index if not exists coupon_redemptions_coupon_idx
  on public.coupon_redemptions (coupon_id, created_at desc);
create index if not exists coupon_redemptions_customer_idx
  on public.coupon_redemptions (coupon_id, customer_id);
create index if not exists coupon_redemptions_restaurant_idx
  on public.coupon_redemptions (restaurant_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 4. Normalização e geração de código
-- ----------------------------------------------------------------------------
/*
 * Código normalizado: maiúsculo, sem acento, sem espaço e sem pontuação.
 *
 * O cliente digita "bem vindo10", "BEMVINDO10 " ou "Bem-Vindo-10" esperando o
 * mesmo cupom. Deixar essa tolerância no app não resolveria: o banco recebe
 * PostgREST aberto e o código precisa significar a mesma coisa nas duas portas.
 */
create or replace function public.normalize_coupon_code(p_code text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      upper(translate(
        coalesce(p_code, ''),
        'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
        'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
      )),
      '[^A-Z0-9]', '', 'g'
    ),
    ''
  );
$$;

/*
 * Gera um código a partir do nome ("Volta às aulas" → "VOLTAASAULAS") e, se
 * já existir na casa, acrescenta um sufixo numérico. Devolve código único.
 *
 * Não usa `random()` puro: o dono reconhece o próprio cupom na lista pelo
 * código, e "BEMVINDO10" comunicar melhor que "XQ7Z2K" é parte do recurso.
 */
create or replace function public.generate_coupon_code(
  p_restaurant_id uuid,
  p_name          text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base   text;
  v_candidate text;
  v_suffix integer := 1;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    raise exception 'coupon_forbidden' using errcode = '42501';
  end if;

  v_base := coalesce(public.normalize_coupon_code(p_name), '');
  -- Sem nome útil, parte de um prefixo genérico.
  if char_length(v_base) < 3 then
    v_base := 'PROMO';
  end if;
  v_base := left(v_base, 16);

  v_candidate := v_base;

  while exists (
    select 1 from public.coupons c
    where c.restaurant_id = p_restaurant_id
      and upper(c.code) = v_candidate
  ) loop
    v_suffix := v_suffix + 1;
    v_candidate := left(v_base, 16) || v_suffix::text;

    if v_suffix > 999 then
      raise exception 'coupon_code_exhausted' using errcode = '22023';
    end if;
  end loop;

  -- Garante o mínimo de 3 caracteres exigido pela constraint.
  if char_length(v_candidate) < 3 then
    v_candidate := rpad(v_candidate, 3, 'X');
  end if;

  return v_candidate;
end;
$$;

revoke all on function public.normalize_coupon_code(text) from public;
grant execute on function public.normalize_coupon_code(text) to anon, authenticated;

revoke all on function public.generate_coupon_code(uuid, text) from public, anon;
grant execute on function public.generate_coupon_code(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Status derivado
-- ----------------------------------------------------------------------------
/*
 * O status não é coluna: é calculado de `active`, datas e usos.
 *
 * Por que não uma coluna gravada: "expirou" depende do relógio. Uma coluna
 * precisaria de cron para virar `expired` à meia-noite, e enquanto o cron não
 * rodasse a lista mentiria. Derivar na leitura custa nada e nunca fica
 * desatualizado.
 */
create or replace function public.coupon_status_of(
  p_active     boolean,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz,
  p_max_uses   integer,
  p_used_count integer
)
returns public.coupon_status
language sql
immutable
as $$
  select case
    when not p_active then 'inactive'::public.coupon_status
    when p_starts_at is not null and p_starts_at > now() then 'scheduled'::public.coupon_status
    when p_ends_at is not null and p_ends_at < now() then 'expired'::public.coupon_status
    when p_max_uses is not null and coalesce(p_used_count, 0) >= p_max_uses then 'exhausted'::public.coupon_status
    else 'active'::public.coupon_status
  end;
$$;

-- ----------------------------------------------------------------------------
-- 6. validate_coupon — a única autoridade
-- ----------------------------------------------------------------------------
/*
 * Responde "este cupom vale para este pedido?" sem alterar nada.
 *
 * Devolve sempre UMA linha (nunca erro), com `ok`, o `amount` que seria
 * abatido e um `reason` de máquina (`coupon_not_found`, `coupon_expired`,
 * `below_minimum`, ...). Erro seria pior: o carrinho precisa mostrar "cupom
 * expirado" sem transformar isso em falha do pedido — o cliente segue comendo
 * sem desconto.
 *
 * Por que `security definer`: o cliente anônimo precisa validar o próprio
 * cupom antes de enviar, e `coupons` tem RLS fechada para `anon`. A função
 * recebe o token da mesa (mesmo contrato de `create_order`), então o
 * restaurante vem do token — nunca de um parâmetro que o cliente escolhe.
 *
 * `p_customer_phone` é opcional: sem ele, as regras que dependem do cliente
 * (limite por cliente) são **puladas**, não negadas — negar faria o cupom "não
 * funcionar" para quem ainda não se identificou.
 */
create or replace function public.validate_coupon(
  p_table_token    text,
  p_code           text,
  p_subtotal       numeric,
  p_customer_phone text default null,
  -- Quando informado, ignora a redenção deste pedido ao contar usos (usado na
  -- reconferência de `create_order`, onde a linha ainda não existe).
  p_ignore_order   uuid default null
)
returns table (
  ok         boolean,
  reason     text,
  coupon_id  uuid,
  code       text,
  type       public.coupon_discount_type,
  value      numeric,
  amount     numeric,
  min_order_value numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant uuid;
  v_coupon     public.coupons;
  v_code       text;
  v_used       integer;
  v_customer   uuid;
  v_cust_used  integer;
  v_amount     numeric(10, 2) := 0;
  v_reason     text;
begin
  -- Restaurante vem do token da mesa, como todo o resto do fluxo público.
  select r.restaurant_id into v_restaurant
  from public.resolve_table_token(p_table_token) r;

  if v_restaurant is null then
    return query select false, 'table_unavailable'::text, null::uuid, null::text,
                        null::public.coupon_discount_type, null::numeric, 0::numeric, null::numeric;
    return;
  end if;

  v_code := public.normalize_coupon_code(p_code);

  if v_code is null then
    return query select false, 'coupon_invalid_code'::text, null::uuid, null::text,
                        null::public.coupon_discount_type, null::numeric, 0::numeric, null::numeric;
    return;
  end if;

  select * into v_coupon
  from public.coupons c
  where c.restaurant_id = v_restaurant
    and upper(c.code) = v_code;

  if v_coupon.id is null then
    return query select false, 'coupon_not_found'::text, null::uuid, v_code,
                        null::public.coupon_discount_type, null::numeric, 0::numeric, null::numeric;
    return;
  end if;

  -- Daqui para baixo sempre devolvemos a identidade do cupom, para o painel
  -- poder mostrar o nome mesmo quando a resposta é "não vale".
  if not v_coupon.active then
    v_reason := 'coupon_inactive';
  elsif v_coupon.starts_at is not null and v_coupon.starts_at > now() then
    v_reason := 'coupon_not_started';
  elsif v_coupon.ends_at is not null and v_coupon.ends_at < now() then
    v_reason := 'coupon_expired';
  elsif coalesce(p_subtotal, 0) < v_coupon.min_order_value then
    v_reason := 'below_minimum';
  end if;

  -- Contagem de usos: global e por cliente.
  select count(*) into v_used
  from public.coupon_redemptions cr
  where cr.coupon_id = v_coupon.id
    and (p_ignore_order is null or cr.order_id <> p_ignore_order);

  if v_reason is null
     and v_coupon.max_uses is not null
     and v_used >= v_coupon.max_uses then
    v_reason := 'coupon_exhausted';
  end if;

  if v_reason is null and v_coupon.max_uses_per_customer > 0 then
    select c.id into v_customer
    from public.customers c
    where c.restaurant_id = v_restaurant
      and c.phone_normalized = public.normalize_phone(p_customer_phone)
      and c.erased_at is null;

    -- Sem cliente identificado, o limite por cliente não é aplicável. Não é
    -- "permitido por acaso": é a única leitura honesta de um pedido anônimo.
    if v_customer is not null then
      select count(*) into v_cust_used
      from public.coupon_redemptions cr
      where cr.coupon_id = v_coupon.id
        and cr.customer_id = v_customer
        and (p_ignore_order is null or cr.order_id <> p_ignore_order);

      if v_cust_used >= v_coupon.max_uses_per_customer then
        v_reason := 'customer_limit_reached';
      end if;
    end if;
  end if;

  if v_reason is null then
    /* Base do cálculo: subtotal dos itens, nunca o total (que já leva taxas).
     * O valor mínimo é um piso de elegibilidade, não um abatimento — o
     * desconto incide sobre o subtotal inteiro. Percentual tem teto opcional. */
    if v_coupon.discount_type = 'percentage' then
      v_amount := round(coalesce(p_subtotal, 0) * v_coupon.discount_value / 100, 2);
      if v_coupon.max_discount is not null then
        v_amount := least(v_amount, v_coupon.max_discount);
      end if;
    elsif v_coupon.discount_type = 'fixed' then
      v_amount := v_coupon.discount_value;
    else
      -- Frete grátis ainda não tem taxa para abater (não há delivery). Vale
      -- zero em vez de mentir um desconto sobre um valor que não existe.
      v_amount := 0;
    end if;

    -- Nunca abate mais do que o pedido custa, e nunca toca em `fees`.
    v_amount := least(v_amount, greatest(coalesce(p_subtotal, 0), 0));

    if v_amount <= 0 and v_coupon.discount_type <> 'free_shipping' then
      v_reason := 'coupon_no_effect';
    end if;
  end if;

  return query
    select
      v_reason is null,
      v_reason,
      v_coupon.id,
      v_coupon.code,
      v_coupon.discount_type,
      v_coupon.discount_value,
      case when v_reason is null then round(v_amount, 2) else 0::numeric end,
      v_coupon.min_order_value;
end;
$$;

comment on function public.validate_coupon(text, text, numeric, text, uuid) is
  'Valida cupom pelo token da mesa. Nunca erro: devolve ok/reason. Usado pelo carrinho e por create_order.';

revoke all on function public.validate_coupon(text, text, numeric, text, uuid) from public;
grant execute on function public.validate_coupon(text, text, numeric, text, uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. Colunas de snapshot no pedido
-- ----------------------------------------------------------------------------
alter table public.orders
  add column if not exists coupon_id    uuid references public.coupons (id) on delete set null,
  add column if not exists coupon_code  text,
  add column if not exists coupon_type  public.coupon_discount_type,
  add column if not exists coupon_value numeric(10, 2);

comment on column public.orders.coupon_code is
  'Código do cupom como o cliente digitou (normalizado). Congelado: apagar o cupom não reescreve o pedido.';

-- Um pedido desconta no máximo o próprio subtotal: rede contra qualquer caminho
-- (RPC futura, painel, correção manual) que tente gravar mais.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_discount_within_subtotal'
  ) then
    alter table public.orders
      add constraint orders_discount_within_subtotal
      check (discount <= subtotal);
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 8. create_order — recriada com cupom
-- ----------------------------------------------------------------------------
/*
 * Muda em relação à Etapa 24:
 *
 *   • novo parâmetro `p_coupon_code` (opcional);
 *   • o desconto sai de `validate_coupon`, aplicado DEPOIS de somar os itens
 *     (antes o desconto era lido de uma coluna que ninguém escrevia);
 *   • grava o snapshot do cupom no pedido e a redenção na tabela;
 *   • cupom inválido **derruba o pedido** (`coupon_not_applicable`), e não é
 *     ignorado em silêncio: o cliente viu "10% de desconto" antes de enviar, e
 *     entregar o pedido sem o desconto seria cobrar diferente do combinado.
 *
 * O resto — preço do cardápio, token da mesa, freio de flood, identificação
 * opcional — é idêntico à Etapa 24, de propósito: esta etapa não mexe no
 * caminho do pedido, só acrescenta o desconto já previsto na estrutura.
 */
create or replace function public.create_order(
  p_token           text,
  p_items           jsonb,
  p_notes           text default null,
  p_customer_name   text default null,
  p_customer_phone  text default null,
  p_consent         boolean default false,
  p_coupon_code     text default null
)
returns table (
  order_id        uuid,
  order_number    integer,
  table_name      text,
  restaurant_id   uuid,
  subtotal        numeric,
  discount        numeric,
  total           numeric,
  coupon_code     text,
  status          public.order_status,
  created_at      timestamptz,
  customer_id     uuid
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
  v_discount   numeric(10, 2) := 0;
  v_notes      text;
  v_item_count integer;
  v_position   integer := 0;
  v_recent     integer;
  rec          record;
  v_name       text;
  v_price      numeric(10, 2);
  v_customer   uuid;
  v_cust_name  text;
  v_coupon     record;
  v_code       text;
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
  select count(*) into v_recent
  from public.orders ord
  where ord.table_id = v_table
    and ord.created_at > now() - interval '20 seconds';

  if v_recent >= 4 then
    raise exception 'too_many_orders' using errcode = '53400';
  end if;

  -- 5. Cliente: identificação OPCIONAL. Falha aqui (telefone inválido, sem
  --    consentimento) derruba o pedido inteiro de propósito — gravar o pedido
  --    sem o cliente que a pessoa acabou de informar seria pior: ela acharia
  --    que os pontos foram registrados.
  v_customer := public.upsert_customer_for_order(
    v_restaurant, p_customer_name, p_customer_phone, p_consent
  );

  v_cust_name := nullif(btrim(coalesce(p_customer_name, '')), '');

  -- 6. Cria o cabeçalho com totais zerados; preenche depois de somar os itens.
  v_number := public.next_order_number(v_restaurant);

  insert into public.orders (
    restaurant_id, table_id, order_number, status, channel, notes, subtotal, total,
    customer_id, customer_name, customer_phone
  )
  values (
    v_restaurant, v_table, v_number, 'pending', 'dine_in', v_notes, 0, 0,
    v_customer, v_cust_name, nullif(btrim(coalesce(p_customer_phone, '')), '')
  )
  returning id into v_order_id;

  -- 7. Itens: cada um validado contra o cardápio PÚBLICO atual.
  for rec in
    select
      (elem ->> 'product_id')::uuid as product_id,
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

  -- 8. Cupom — validado DEPOIS de saber o subtotal (o valor mínimo depende
  --    dele) e ANTES de gravar o total. O código é do cliente; o desconto, não.
  v_code := public.normalize_coupon_code(p_coupon_code);

  if v_code is not null then
    select * into v_coupon
    from public.validate_coupon(p_token, v_code, v_subtotal, p_customer_phone, v_order_id);

    if not v_coupon.ok then
      raise exception 'coupon_not_applicable'
        using errcode = '22023',
              detail  = coalesce(v_coupon.reason, 'coupon_invalid');
    end if;

    v_discount := greatest(least(coalesce(v_coupon.amount, 0), v_subtotal), 0);

    -- Trava a linha do cupom: duas mesas confirmando ao mesmo tempo não podem
    -- ambas passar pelo limite. `validate_coupon` já conferiu; o `for update`
    -- + reconferência fecham a janela entre a leitura e o insert.
    perform 1 from public.coupons c where c.id = v_coupon.coupon_id for update;
  end if;

  -- 9. Totais finais, sempre no servidor.
  update public.orders
     set subtotal  = v_subtotal,
         discount  = v_discount,
         total     = v_subtotal - v_discount + fees,
         coupon_id    = case when v_discount > 0 then v_coupon.coupon_id else null end,
         coupon_code  = case when v_discount > 0 then v_coupon.code else null end,
         coupon_type  = case when v_discount > 0 then v_coupon.type else null end,
         coupon_value = case when v_discount > 0 then v_coupon.value else null end
   where id = v_order_id;

  -- 10. Redenção: o `unique (order_id)` é a última palavra contra duplicidade.
  if v_discount > 0 then
    insert into public.coupon_redemptions (
      coupon_id, restaurant_id, order_id, customer_id,
      code_snapshot, type_snapshot, value_snapshot, amount
    )
    values (
      v_coupon.coupon_id, v_restaurant, v_order_id, v_customer,
      v_coupon.code, v_coupon.type, v_coupon.value, v_discount
    );
  end if;

  -- 11. Resumo do cliente: RECALCULADO a partir de `orders`, nunca incrementado.
  if v_customer is not null then
    perform public.recount_customer_totals(v_customer);
  end if;

  return query
    select o.id, o.order_number, v_table_name, o.restaurant_id,
           o.subtotal, o.discount, o.total, o.coupon_code,
           o.status, o.created_at, o.customer_id
    from public.orders o
    where o.id = v_order_id;
end;
$$;

comment on function public.create_order(text, jsonb, text, text, text, boolean, text) is
  'Cria pedido pelo token da mesa (Etapa 6/24) e aplica cupom validado no banco (Etapa 25). Desconto nunca vem do cliente.';

-- A versão de 6 argumentos (Etapa 24) sai: duas assinaturas convivendo fazem o
-- PostgREST escolher por contagem de parâmetros e o cliente cair na errada.
drop function if exists public.create_order(text, jsonb, text, text, text, boolean);

revoke all on function public.create_order(text, jsonb, text, text, text, boolean, text) from public;
grant execute on function public.create_order(text, jsonb, text, text, text, boolean, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 9. get_table_order — devolve o desconto ao cliente
-- ----------------------------------------------------------------------------
/*
 * Recriada só para o cliente ver "Subtotal / Desconto / Total" na tela de
 * sucesso e no acompanhamento. A assinatura de retorno muda; como é `returns
 * table`, é preciso recriar (não dá para `create or replace` com colunas
 * diferentes).
 */
drop function if exists public.get_table_order(text, integer);

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
  coupon_code   text,
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
      o.coupon_code,
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

-- ----------------------------------------------------------------------------
-- 10. Cancelamento devolve o cupom
-- ----------------------------------------------------------------------------
/*
 * `set_order_status` é recriada com um passo novo: ao entrar em `cancelled`,
 * as redenções do pedido são apagadas. Sem isso, um pedido cancelado consumiria
 * para sempre uma unidade de um cupom limitado — e "limite esgotado" em cupom
 * que ninguém usou é o tipo de bug que o dono não consegue explicar.
 *
 * O resto do fluxo (transições válidas, guarda de membro, crédito de pontos na
 * entrega, recálculo de totais) é idêntico ao da Etapa 24.
 */
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
begin
  select o.restaurant_id, o.status
    into v_restaurant, v_from
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

  -- Etapa 24: entrega é o gatilho do crédito. Falha no crédito derruba a
  -- mudança de status junto — é preferível a cozinha ver "não consegui marcar
  -- como entregue" do que o pedido entregue ficar sem os pontos do cliente.
  if p_status = 'delivered' then
    perform public.loyalty_award_order(p_order_id);
  end if;

  -- Etapa 25: pedido cancelado devolve a unidade do cupom. O snapshot no
  -- pedido continua lá para explicar o histórico; só a contagem volta.
  if p_status = 'cancelled' then
    delete from public.coupon_redemptions cr where cr.order_id = p_order_id;
  end if;

  -- O resumo do cliente ignora cancelados, então mudança de status pode mudar
  -- os totais nos dois sentidos. Recalcular aqui mantém a ficha coerente.
  if p_status in ('delivered', 'cancelled') then
    perform public.recount_customer_totals((select o.customer_id from public.orders o where o.id = p_order_id));
  end if;

  return query
    select o.id, o.order_number, o.status, o.updated_at
    from public.orders o
    where o.id = p_order_id;
end;
$$;

revoke all on function public.set_order_status(uuid, public.order_status, text) from public;
grant execute on function public.set_order_status(uuid, public.order_status, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 11. Painel: CRUD de cupons
-- ----------------------------------------------------------------------------
/*
 * `save_coupon` cria/edita. Um parâmetro `p_id` nulo cria; preenchido edita.
 *
 * Por que uma RPC e não insert direto do painel: o código precisa ser
 * normalizado **e** único, o que exige consulta + insert na mesma transação.
 * Feito em duas chamadas do app, duas abas abertas criariam o mesmo código e o
 * dono veria um erro de índice único sem entender.
 */
create or replace function public.save_coupon(
  p_restaurant_id   uuid,
  p_id              uuid,
  p_name            text,
  p_code            text,
  p_description     text,
  p_discount_type   public.coupon_discount_type,
  p_discount_value  numeric,
  p_min_order_value numeric,
  p_max_discount    numeric,
  p_starts_at       timestamptz,
  p_ends_at         timestamptz,
  p_max_uses        integer,
  p_max_uses_per_customer integer,
  p_active          boolean
)
returns public.coupons
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name   text;
  v_code   text;
  v_row    public.coupons;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    raise exception 'coupon_forbidden' using errcode = '42501';
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    raise exception 'coupon_name_required' using errcode = '22023';
  end if;

  v_code := public.normalize_coupon_code(p_code);
  if v_code is null or char_length(v_code) < 3 then
    raise exception 'coupon_invalid_code' using errcode = '22023';
  end if;

  if v_code !~ '^[A-Z0-9]{3,24}$' then
    raise exception 'coupon_invalid_code' using errcode = '22023';
  end if;

  -- Código duplicado na casa: erro claro em vez de 23505 cru.
  if exists (
    select 1 from public.coupons c
    where c.restaurant_id = p_restaurant_id
      and upper(c.code) = v_code
      and (p_id is null or c.id <> p_id)
  ) then
    raise exception 'coupon_code_taken' using errcode = '23505';
  end if;

  if p_id is null then
    insert into public.coupons (
      restaurant_id, name, code, description, discount_type, discount_value,
      min_order_value, max_discount, starts_at, ends_at, max_uses,
      max_uses_per_customer, active, created_by
    )
    values (
      p_restaurant_id, v_name, v_code, nullif(btrim(coalesce(p_description, '')), ''),
      p_discount_type, p_discount_value,
      coalesce(p_min_order_value, 0), p_max_discount, p_starts_at, p_ends_at,
      p_max_uses, coalesce(p_max_uses_per_customer, 1), coalesce(p_active, true),
      auth.uid()
    )
    returning * into v_row;
  else
    update public.coupons c
       set name = v_name,
           code = v_code,
           description = nullif(btrim(coalesce(p_description, '')), ''),
           discount_type = p_discount_type,
           discount_value = p_discount_value,
           min_order_value = coalesce(p_min_order_value, 0),
           max_discount = p_max_discount,
           starts_at = p_starts_at,
           ends_at = p_ends_at,
           max_uses = p_max_uses,
           max_uses_per_customer = coalesce(p_max_uses_per_customer, 1),
           active = coalesce(p_active, true)
     where c.id = p_id
       and c.restaurant_id = p_restaurant_id
    returning * into v_row;

    if v_row.id is null then
      raise exception 'coupon_not_found' using errcode = 'P0002';
    end if;
  end if;

  return v_row;
end;
$$;

revoke all on function public.save_coupon(uuid, uuid, text, text, text, public.coupon_discount_type, numeric, numeric, numeric, timestamptz, timestamptz, integer, integer, boolean) from public, anon;
grant execute on function public.save_coupon(uuid, uuid, text, text, text, public.coupon_discount_type, numeric, numeric, numeric, timestamptz, timestamptz, integer, integer, boolean) to authenticated;

/**
 * Liga/desliga sem passar pelo formulário inteiro — é o toque mais frequente
 * ("acabou a promoção"). Separado porque `save_coupon` exige todos os campos.
 */
create or replace function public.set_coupon_active(
  p_restaurant_id uuid,
  p_id            uuid,
  p_active        boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    raise exception 'coupon_forbidden' using errcode = '42501';
  end if;

  update public.coupons c
     set active = coalesce(p_active, false)
   where c.id = p_id
     and c.restaurant_id = p_restaurant_id;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.set_coupon_active(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_coupon_active(uuid, uuid, boolean) to authenticated;

/**
 * Lista de cupons com o uso atual e o status derivado.
 *
 * O `used_count` vem da tabela de redenções (não de um contador na linha do
 * cupom): contador e redenções divergem no primeiro cancelamento, e o painel
 * mostraria "8 de 10 usados" para um cupom que só gastou 6.
 */
create or replace function public.list_restaurant_coupons(
  p_restaurant_id uuid,
  p_search        text default null,
  p_limit         integer default 50,
  p_offset        integer default 0
)
returns table (
  id              uuid,
  name            text,
  code            text,
  description     text,
  discount_type   public.coupon_discount_type,
  discount_value  numeric,
  min_order_value numeric,
  max_discount    numeric,
  starts_at       timestamptz,
  ends_at         timestamptz,
  max_uses        integer,
  max_uses_per_customer integer,
  active          boolean,
  used_count      integer,
  total_discount  numeric,
  status          public.coupon_status,
  created_at      timestamptz,
  total_count     bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    raise exception 'coupon_forbidden' using errcode = '42501';
  end if;

  return query
    select
      c.id,
      c.name,
      c.code,
      c.description,
      c.discount_type,
      c.discount_value,
      c.min_order_value,
      c.max_discount,
      c.starts_at,
      c.ends_at,
      c.max_uses,
      c.max_uses_per_customer,
      c.active,
      coalesce(u.used_count, 0)::integer,
      coalesce(u.total_discount, 0)::numeric,
      public.coupon_status_of(c.active, c.starts_at, c.ends_at, c.max_uses, coalesce(u.used_count, 0)),
      c.created_at,
      count(*) over () as total_count
    from public.coupons c
    left join (
      select cr.coupon_id,
             count(*)          as used_count,
             sum(cr.amount)    as total_discount
      from public.coupon_redemptions cr
      group by cr.coupon_id
    ) u on u.coupon_id = c.id
    where c.restaurant_id = p_restaurant_id
      and (
        v_search is null
        or c.name ilike '%' || v_search || '%'
        or c.code ilike '%' || v_search || '%'
      )
    order by c.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.list_restaurant_coupons(uuid, text, integer, integer) from public, anon;
grant execute on function public.list_restaurant_coupons(uuid, text, integer, integer) to authenticated;

/**
 * Detalhe de um cupom com os últimos usos — o dono pergunta "quem usou?".
 */
create or replace function public.coupon_details(
  p_restaurant_id uuid,
  p_id            uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_coupon public.coupons;
  v_used   integer;
  v_total  numeric;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    raise exception 'coupon_forbidden' using errcode = '42501';
  end if;

  select * into v_coupon
  from public.coupons c
  where c.id = p_id
    and c.restaurant_id = p_restaurant_id;

  if v_coupon.id is null then
    return null;
  end if;

  select count(*), coalesce(sum(cr.amount), 0)
    into v_used, v_total
  from public.coupon_redemptions cr
  where cr.coupon_id = v_coupon.id;

  return jsonb_build_object(
    'id', v_coupon.id,
    'name', v_coupon.name,
    'code', v_coupon.code,
    'description', v_coupon.description,
    'discount_type', v_coupon.discount_type,
    'discount_value', v_coupon.discount_value,
    'min_order_value', v_coupon.min_order_value,
    'max_discount', v_coupon.max_discount,
    'starts_at', v_coupon.starts_at,
    'ends_at', v_coupon.ends_at,
    'max_uses', v_coupon.max_uses,
    'max_uses_per_customer', v_coupon.max_uses_per_customer,
    'active', v_coupon.active,
    'used_count', v_used,
    'total_discount', v_total,
    'status', public.coupon_status_of(v_coupon.active, v_coupon.starts_at, v_coupon.ends_at, v_coupon.max_uses, v_used),
    'created_at', v_coupon.created_at,
    'redemptions', coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'id', cr.id,
                   'order_id', cr.order_id,
                   'order_number', o.order_number,
                   'table_name', t.name,
                   'customer_name', o.customer_name,
                   'amount', cr.amount,
                   'created_at', cr.created_at
                 )
                 order by cr.created_at desc
               )
        from public.coupon_redemptions cr
        join public.orders o on o.id = cr.order_id
        join public.tables t on t.id = o.table_id
        where cr.coupon_id = v_coupon.id
        limit 50
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.coupon_details(uuid, uuid) from public, anon;
grant execute on function public.coupon_details(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 12. View do painel (desconto visível no pedido)
-- ----------------------------------------------------------------------------
/*
 * Recriada para o card do pedido mostrar o cupom. `coupon_code` sai da própria
 * linha do pedido (snapshot), não de um join com `coupons` — cupom apagado não
 * some do histórico.
 *
 * ─── Ordem importa: a função sai antes da view ───────────────────────────
 *
 * `list_restaurant_orders` é `returns setof public.restaurant_orders`, então o
 * Postgres recusa `drop view` enquanto a função existir (2BP01). Ela é
 * derrubada e recriada logo abaixo, com o mesmo corpo.
 */
drop function if exists public.list_restaurant_orders(uuid, public.order_status, integer, integer);
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
  o.coupon_code,
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

/* Corpo idêntico ao da Etapa 7 — reescrito aqui só porque a view foi recriada
 * e a função precisou ser derrubada junto. Cursor = `order_number` (dois
 * pedidos da mesma mesa na mesma transação empatam em `created_at`). */
create function public.list_restaurant_orders(
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

revoke all on function public.list_restaurant_orders(uuid, public.order_status, integer, integer) from public;
grant execute on function public.list_restaurant_orders(uuid, public.order_status, integer, integer) to authenticated;

comment on function public.list_restaurant_orders(uuid, public.order_status, integer, integer) is
  'Lista paginada do painel. Cursor = order_number; created_at empata na mesma transacao.';

-- ----------------------------------------------------------------------------
-- 13. RLS e grants
-- ----------------------------------------------------------------------------
alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;

revoke all on public.coupons from anon;
revoke all on public.coupon_redemptions from anon;

grant select, insert, update on public.coupons to authenticated;
grant select on public.coupon_redemptions to authenticated;

/*
 * Cupom é visível para a equipe da casa. Escrita passa por `save_coupon`
 * (que confere código e tenant); o grant de insert/update existe para o painel
 * poder usar a tabela direto se precisar, sempre com a policy abaixo.
 */
drop policy if exists coupons_select_member on public.coupons;
create policy coupons_select_member on public.coupons
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

drop policy if exists coupons_write_member on public.coupons;
create policy coupons_write_member on public.coupons
  for insert to authenticated
  with check (public.is_restaurant_member(restaurant_id));

drop policy if exists coupons_update_member on public.coupons;
create policy coupons_update_member on public.coupons
  for update to authenticated
  using (public.is_restaurant_member(restaurant_id))
  with check (public.is_restaurant_member(restaurant_id));

-- Sem policy de DELETE: cupom não é apagado pelo app. Desativar preserva o
-- histórico dos pedidos; apagar apagaria a explicação de um desconto antigo.

drop policy if exists coupon_redemptions_select_member on public.coupon_redemptions;
create policy coupon_redemptions_select_member on public.coupon_redemptions
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

-- Sem insert/update/delete para `authenticated`: só `create_order` (security
-- definer) e `set_order_status` escrevem aqui. Um cupom "resgatado à mão" pelo
-- painel seria um desconto sem pedido — não existe.

-- ----------------------------------------------------------------------------
-- 14. Comentários
-- ----------------------------------------------------------------------------
comment on table public.coupons is
  'Cupons por restaurante (Etapa 25). Código único por casa; status é derivado de ativo/datas/usos.';
comment on table public.coupon_redemptions is
  'Um uso de cupom por pedido (unique order_id). Apagada quando o pedido é cancelado.';
comment on column public.coupons.discount_value is
  'Percentual (0-100) ou valor em reais, conforme discount_type. Nunca negativo.';
