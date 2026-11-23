-- ============================================================================
-- ETAPA 24 · FIDELIDADE E CLIENTES
--
-- O problema que este arquivo resolve
-- -----------------------------------
-- Até a Etapa 23 o pedido do salão era anônimo: `orders.customer_name` e
-- `orders.customer_phone` existiam desde a Etapa 6, mas nada os preenchia e
-- nada os lia. O restaurante não sabia quem voltou, quem gasta mais, quem
-- sumiu — e "programa de fidelidade" era uma promessa sem estrutura.
--
-- Aqui entram as quatro peças que faltavam:
--
--   1. `customers`             — a identidade do cliente **dentro da casa**.
--   2. `loyalty_settings`      — a regra que o dono edita (pontos por real,
--                                bônus de cadastro, bônus de aniversário).
--   3. `loyalty_ledger`        — o extrato de pontos, append-only, com saldo
--                                derivado por SUM (nunca uma coluna mutável).
--   4. As RPCs que ligam pedido → cliente → pontos, todas com guarda de tenant.
--
-- Decisões que valem registro
-- ---------------------------
-- 1. **Cliente é do restaurante, não da plataforma.** Não existe "conta
--    Menuvo" de cliente final. `customers.restaurant_id` é obrigatório e a
--    unicidade é `(restaurant_id, phone_normalized)`. Duas casas que recebem o
--    mesmo telefone têm dois clientes distintos e nenhuma delas sabe do outro.
--    Um cadastro único de plataforma vazaria o histórico de uma casa para a
--    concorrente dela — o oposto do que o dono espera de "meus clientes".
--
-- 2. **Identificação é opcional; ver o cardápio não pede nada.** Não há tabela
--    de sessão de cliente, nem obrigação de cadastro. O caminho continua sendo
--    abrir o QR → escolher → enviar. Nome e WhatsApp são um passo opcional no
--    fim, e quem não informa tem pedido anônimo como antes. Sem isso a Etapa 24
--    teria regredido a Etapa 6.
--
-- 3. **Telefone normalizado é a chave, não o nome.** `phone_normalized` guarda
--    só dígitos, com DDI 55 quando o número é brasileiro, e é `unique` por
--    restaurante. É o que permite reconhecer "8599999-8888" e "55 85 99999
--    8888" como a mesma pessoa sem pedir login. Nome muda, telefone é o que o
--    cliente repete.
--
-- 4. **Saldo é soma, nunca coluna.** `loyalty_ledger` é append-only (ponto
--    ganho, ponto resgatado, ajuste, expiração) e o saldo é
--    `sum(delta)`. Uma coluna `points_balance` sempre acaba divergindo do
--    extrato — e quando diverge, ninguém sabe qual dos dois está certo. Com
--    soma, o extrato **é** a verdade por construção. Resgate gera linha
--    negativa, então o histórico nunca é reescrito.
--
-- 5. **Pontos por dinheiro são derivados de pedido entregue, não de "compra".**
--    Só pedido com status `delivered` pontua (ver `loyalty_award_order`). Pedido
--    cancelado não pontua, e o crédito é idempotente por `order_id`: reprocessar
--    a fila não duplica pontos. É o mesmo cuidado que a Etapa 19 teve com
--    comprovante de PIX.
--
-- 6. **O consentimento é um fato gravado, com data e versão do texto.** A LGPD
--    não pede um booleano bonito na tela; pede prova de quando e sob qual texto
--    a pessoa concordou. `consent_at` + `consent_version` guardam isso, e
--    `consent_revoked_at` preserva o histórico em vez de apagar a decisão.
--
-- 7. **Exclusão de dados é anonimização + marcação, não DELETE cego.** Apagar a
--    linha do cliente quebraria o histórico financeiro da casa (o pedido de
--    ontem deixaria de ter dono). `erase_customer()` esvazia nome, telefone
--    (inclusive o normalizado, que é dado pessoal), e-mail, data de nascimento
--    e notas; mantém o `id` e os totais agregados. O que identifica a pessoa sai;
--    o que a casa precisa para fechar o caixa fica, sem apontar para ninguém.
--
-- 8. **Futuro preparado, sem implementar.** Cupons, campanhas, cashback e
--    segmentação entram como: `customers.tags` (segmentação por etiqueta),
--    `loyalty_ledger.source` com valores `campaign`/`cashback` já aceitos e
--    `loyalty_settings.cashback_percent`. **Não** existe tabela de mensagens
--    enviadas nem fila de disparo: o escopo diz "não implementar disparo
--    automático sem integração adequada", e uma tabela de outbox sugeriria que
--    existe alguém enviando.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------
-- `loyalty_entry_kind` separa o que a pessoa ganhou do que gastou. Um único
-- sinal em `delta` já diria isso, mas o painel precisa filtrar "o que foi
-- resgate" sem olhar sinal — e relatório de resgate é o que o dono pergunta.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'loyalty_entry_kind') then
    create type public.loyalty_entry_kind as enum (
      'earn',      -- pontos ganhos em pedido
      'redeem',    -- pontos usados pelo cliente
      'bonus',     -- bônus de cadastro, aniversário
      'adjust',    -- ajuste manual do dono
      'expire',    -- expiração (reservado; nenhuma rotina cria hoje)
      'campaign',  -- campanha futura
      'cashback'   -- cashback futuro
    );
  end if;
end
$$;

-- De onde veio o lançamento. Guardado separado do tipo porque "bônus de
-- aniversário" é `kind = 'bonus'` + `source = 'birthday'`, e o painel mostra os
-- dois textos em colunas diferentes.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'loyalty_entry_source') then
    create type public.loyalty_entry_source as enum (
      'order',       -- pedido entregue
      'signup',      -- primeiro cadastro na casa
      'birthday',    -- aniversário
      'manual',      -- ajuste do dono
      'campaign',    -- campanha (futuro)
      'cashback'     -- cashback (futuro)
    );
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 2. TABELA: customers
-- ----------------------------------------------------------------------------
-- `on delete cascade` em `restaurant_id`: apagar a casa apaga a base dela. É o
-- mesmo padrão de `orders` — o cliente pertence ao restaurante.
create table if not exists public.customers (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,

  name             text,
  -- Telefone como a pessoa digitou (exibição) e normalizado (chave única).
  phone            text,
  phone_normalized text,
  email            text,
  birth_date       date,

  -- Totais materializados para o painel não precisar de SUM em toda abertura.
  -- A fonte de verdade continua sendo `orders`; estes campos são recalculados
  -- por `recount_customer_totals()` sempre que um pedido muda de estado.
  total_orders     integer not null default 0,
  total_spent      numeric(12, 2) not null default 0,
  last_order_at    timestamptz,

  -- Consentimento (LGPD): quando, sob qual versão do texto e se revogou.
  consent_at          timestamptz,
  consent_version     text,
  consent_revoked_at  timestamptz,

  -- Segmentação futura (etiquetas livres: "aniversariante", "sumido", "VIP").
  tags             text[] not null default '{}',

  -- `true` depois de `erase_customer()`: a pessoa pediu exclusão. A linha fica
  -- por causa dos pedidos, mas o painel a mostra como "dados excluídos" e ela
  -- não aparece mais nas listas de contato.
  erased_at        timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint customers_phone_normalized_format
    check (phone_normalized is null or phone_normalized ~ '^[0-9]{10,15}$'),
  constraint customers_name_length
    check (name is null or char_length(name) <= 120),
  constraint customers_email_length
    check (email is null or char_length(email) <= 160),
  constraint customers_totals_check
    check (total_orders >= 0 and total_spent >= 0)
);

comment on table public.customers is
  'Cliente de UMA casa (Etapa 24). Identificado por telefone normalizado; nunca compartilhado entre restaurantes.';

comment on column public.customers.phone_normalized is
  'Só dígitos, DDI 55 quando brasileiro. Chave de reconhecimento única por restaurante.';

comment on column public.customers.erased_at is
  'Preenchido por erase_customer(): dados pessoais foram apagados, a linha permanece pelo histórico de pedidos.';

/*
 * Unicidade do telefone por casa.
 *
 * Índice parcial (e não `unique` na coluna): cliente sem telefone é permitido —
 * existe quem informe só o nome. `null` não colide, mas o índice parcial deixa a
 * intenção explícita e evita um `unique (restaurant_id, phone_normalized)` que
 * barraria dois clientes anônimos.
 */
create unique index if not exists customers_phone_unique
  on public.customers (restaurant_id, phone_normalized)
  where phone_normalized is not null;

-- Lista do painel: mais recentes primeiro, por casa.
create index if not exists customers_restaurant_recent_idx
  on public.customers (restaurant_id, last_order_at desc nulls last, created_at desc);

-- Busca por nome/telefone no painel (ILIKE sem índice usa seq scan; em base
-- pequena tudo bem, e trigram exigiria extensão — fica para quando houver
-- volume que justifique).
create index if not exists customers_restaurant_name_idx
  on public.customers (restaurant_id, name);

drop trigger if exists customers_touch_updated_at on public.customers;
create trigger customers_touch_updated_at
  before update on public.customers
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Ligação pedido → cliente
-- ----------------------------------------------------------------------------
-- Coluna nova em `orders` (não tabela de junção): um pedido tem no máximo um
-- cliente, e junção só criaria um join a mais em toda leitura do painel.
-- `on delete set null`: apagar o cliente (hipótese futura) não apaga o pedido.
alter table public.orders
  add column if not exists customer_id uuid references public.customers (id) on delete set null;

comment on column public.orders.customer_id is
  'Etapa 24: cliente identificado no pedido. Nulo = pedido anônimo, que continua sendo o padrão.';

create index if not exists orders_customer_idx
  on public.orders (customer_id, created_at desc)
  where customer_id is not null;

-- ----------------------------------------------------------------------------
-- 4. TABELA: loyalty_settings
-- ----------------------------------------------------------------------------
-- Uma linha por restaurante. Tabela (e não colunas em `restaurants`) porque a
-- regra é um bloco que cresce — cashback, validade de ponto, teto de resgate —
-- e espalhar isso em `restaurants` misturaria configuração de fidelidade com
-- dados cadastrais da casa.
create table if not exists public.loyalty_settings (
  restaurant_id        uuid primary key references public.restaurants (id) on delete cascade,

  enabled              boolean not null default false,
  -- Quantos pontos por real gasto. `1.0` = "R$ 1 = 1 ponto" (o exemplo do
  -- escopo). Fracionário porque "R$ 1 = 2 pontos" é comum e 0,5 também existe.
  points_per_currency  numeric(6, 2) not null default 1,
  -- Bônus dados no primeiro cadastro do cliente nesta casa.
  signup_bonus         integer not null default 0,
  -- Bônus de aniversário. Não é creditado automaticamente (não há job): quem
  -- credita é o dono, pelo botão do painel, e a RPC evita duplicar no ano.
  birthday_bonus       integer not null default 0,
  -- Quanto vale 1 ponto quando o cliente resgata. `0` = resgate desligado.
  -- Sem isso, "saldo" seria um número sem preço e o caixa não fecharia.
  redeem_value         numeric(6, 4) not null default 0,
  -- Cashback futuro (percentual do pedido que volta em pontos/valor).
  cashback_percent     numeric(5, 2) not null default 0,
  -- Texto mostrado ao cliente no cardápio (o que ele ganha). Nulo = texto padrão.
  program_note         text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint loyalty_points_rate_check
    check (points_per_currency >= 0 and points_per_currency <= 100),
  constraint loyalty_signup_bonus_check
    check (signup_bonus >= 0 and signup_bonus <= 100000),
  constraint loyalty_birthday_bonus_check
    check (birthday_bonus >= 0 and birthday_bonus <= 100000),
  constraint loyalty_redeem_value_check
    check (redeem_value >= 0 and redeem_value <= 1000),
  constraint loyalty_cashback_check
    check (cashback_percent >= 0 and cashback_percent <= 100),
  constraint loyalty_note_length
    check (program_note is null or char_length(program_note) <= 200)
);

comment on table public.loyalty_settings is
  'Regra de fidelidade por restaurante (Etapa 24). Nasce desligada: pontos não são dados sem o dono ligar.';

drop trigger if exists loyalty_settings_touch_updated_at on public.loyalty_settings;
create trigger loyalty_settings_touch_updated_at
  before update on public.loyalty_settings
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 5. TABELA: loyalty_ledger (append-only)
-- ----------------------------------------------------------------------------
create table if not exists public.loyalty_ledger (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  customer_id   uuid not null references public.customers (id) on delete cascade,

  kind          public.loyalty_entry_kind not null,
  source        public.loyalty_entry_source not null,

  -- Positivo entra, negativo sai. Nunca zero (lançamento sem efeito é ruído).
  delta         integer not null,

  -- Origem opcional: pedido que gerou, ou etiqueta do bônus ("birthday:2026").
  order_id      uuid references public.orders (id) on delete set null,
  reference     text,

  -- Quem lançou (ajuste manual). Nulo em lançamento automático.
  actor_id      uuid references public.users (id) on delete set null,
  note          text,

  created_at    timestamptz not null default now(),

  constraint loyalty_delta_nonzero check (delta <> 0),
  constraint loyalty_reference_length check (reference is null or char_length(reference) <= 80),
  constraint loyalty_note_length check (note is null or char_length(note) <= 200)
);

comment on table public.loyalty_ledger is
  'Extrato de pontos append-only (Etapa 24). O saldo é SUM(delta); nenhuma linha é alterada ou apagada.';

create index if not exists loyalty_ledger_customer_idx
  on public.loyalty_ledger (restaurant_id, customer_id, created_at desc);

-- Idempotência do crédito por pedido: um pedido gera no máximo um lançamento
-- de `earn`. Sem isso, reprocessar (ou dois toques no botão) duplicaria pontos.
create unique index if not exists loyalty_ledger_order_earn_unique
  on public.loyalty_ledger (order_id)
  where order_id is not null and kind = 'earn';

-- Idempotência do bônus anual de aniversário: `reference = 'birthday:2026'`.
create unique index if not exists loyalty_ledger_reference_unique
  on public.loyalty_ledger (customer_id, kind, reference)
  where reference is not null and kind = 'bonus';

/*
 * Extrato imutável.
 *
 * Guarda no banco, não só no código: `security definer` da RPC poderia (e um dia
 * vai) errar. Trigger recusando UPDATE faz o extrato ser o que ele promete.
 * Justificativa de negócio: ponto é passivo da casa; "corrigir o histórico" é
 * exatamente o que um erro de caixa tentaria fazer.
 *
 * O trigger **não** barra DELETE, e isso foi um bug pego no teste: o `delete`
 * de um restaurante (ou de um cliente) precisa cascatear para o extrato. Com
 * DELETE barrado por trigger, apagar uma casa falhava com
 * `loyalty_ledger_immutable` e a exclusão de conta ficava impossível. Quem
 * impede o app de apagar linha de extrato é o `revoke delete`, mais abaixo —
 * que vale para `authenticated` e não atrapalha o cascade do dono da tabela.
 */
create or replace function public.loyalty_ledger_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'loyalty_ledger_immutable' using errcode = '42501';
end;
$$;

drop trigger if exists loyalty_ledger_no_update on public.loyalty_ledger;
create trigger loyalty_ledger_no_update
  before update on public.loyalty_ledger
  for each row execute function public.loyalty_ledger_immutable();

-- ----------------------------------------------------------------------------
-- 6. Normalização de telefone e nome (espelho do `src/lib/loyalty.ts`)
-- ----------------------------------------------------------------------------
-- Existe no banco **e** no app de propósito: o app valida para dar mensagem boa,
-- o banco valida porque o PostgREST é uma porta aberta com a anon key. A regra
-- tem de ser a mesma; o harness compara as duas implementações.
create or replace function public.normalize_phone(p_phone text)
returns text
language sql
immutable
as $$
  with d as (
    select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as raw
  ), s as (
    /*
     * "0" de discagem nacional (0 85 3232-1010).
     *
     * Só é removido quando o que sobra tem tamanho de número brasileiro
     * (11, 12 ou 13 dígitos). Sem essa guarda, "0 85 3232-1010" virava
     * "8532321010", recebia o DDI e saía como "5508532321010" — um número que
     * não existe e que nunca casaria com o mesmo cliente digitado de outro
     * jeito. Foi o próprio teste de normalização que pegou.
     */
    select case
      when left(raw, 1) = '0' and char_length(raw) in (11, 12, 13) then substring(raw from 2)
      else raw
    end as raw
    from d
  )
  select case
    when raw = '' then null
    -- DDI 55 já presente: 12 dígitos (fixo) ou 13 (celular). Devolve como está.
    when char_length(raw) in (12, 13) and left(raw, 2) = '55' then raw
    -- Nacional: 10 (fixo) ou 11 (celular), sempre com DDD.
    when char_length(raw) in (10, 11) then '55' || raw
    /*
     * Fora dos formatos conhecidos: devolve como veio (só dígitos) e deixa a
     * constraint `customers_phone_normalized_format` decidir. Um número
     * estrangeiro de 9 dígitos não é inventado como brasileiro.
     */
    else raw
  end
  from s;
$$;

comment on function public.normalize_phone(text) is
  'Etapa 24: dígitos + DDI 55 quando brasileiro. Mesma regra de sanitizePhone() em src/lib/loyalty.ts.';

revoke all on function public.normalize_phone(text) from public;
grant execute on function public.normalize_phone(text) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. Criação / atualização do cliente pela superfície pública
-- ----------------------------------------------------------------------------
/**
 * Identifica o cliente dentro da casa, ou devolve nulo.
 *
 * Chamada de dentro de `create_order`, com o `restaurant_id` já resolvido pelo
 * token da mesa — nunca de uma RPC exposta ao anon com id de restaurante no
 * corpo, porque aí qualquer um criaria cliente na casa do vizinho.
 *
 * Retorna o id do cliente quando há pelo menos nome OU telefone. Sem os dois,
 * devolve `null` e o pedido fica anônimo (o caso de quem só quis pedir).
 */
create or replace function public.upsert_customer_for_order(
  p_restaurant_id uuid,
  p_name          text,
  p_phone         text,
  p_consent       boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name    text;
  v_phone   text;
  v_norm    text;
  v_id      uuid;
  v_created boolean := false;
  v_settings public.loyalty_settings;
begin
  v_name := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  v_phone := nullif(btrim(coalesce(p_phone, '')), '');

  if v_name is null and v_phone is null then
    return null;
  end if;

  if v_name is not null and char_length(v_name) > 120 then
    raise exception 'customer_name_too_long' using errcode = '22023';
  end if;

  v_norm := public.normalize_phone(v_phone);

  -- Telefone informado mas fora de formato: recusa em vez de gravar lixo que
  -- nunca mais casaria numa busca. Pedir de novo na tela é barato.
  if v_phone is not null and (v_norm is null or v_norm !~ '^[0-9]{10,15}$') then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;

  -- Consentimento é pré-requisito para guardar telefone/e-mail (dado pessoal
  -- de contato). Guardar nome do cliente no pedido sem consentimento é o que a
  -- Etapa 6 já fazia; a partir daqui o cadastro só nasce com o aceite.
  if not coalesce(p_consent, false) then
    raise exception 'consent_required' using errcode = '22023';
  end if;

  if v_norm is not null then
    select c.id into v_id
    from public.customers c
    where c.restaurant_id = p_restaurant_id
      and c.phone_normalized = v_norm;

    if v_id is not null then
      -- Cliente conhecido: atualiza o nome se veio um (o telefone é a chave e
      -- não muda) e não sobrescreve com vazio.
      update public.customers c
         set name = coalesce(v_name, c.name),
             consent_at = coalesce(c.consent_at, now()),
             consent_revoked_at = null
       where c.id = v_id;
    end if;
  end if;

  if v_id is null then
    -- Sem telefone (só nome) não há chave de deduplicação: cria sempre. Um
    -- cliente só-nome por pedido é o preço de não inventar identidade — e é
    -- raro, porque a tela pede o WhatsApp junto.
    insert into public.customers (
      restaurant_id, name, phone, phone_normalized, consent_at, consent_version
    )
    values (
      p_restaurant_id, v_name, v_phone, v_norm, now(), 'v1'
    )
    returning id into v_id;

    v_created := true;
  end if;

  -- Bônus de cadastro: só no primeiro cadastro E com o programa ligado. Conta
  -- como `bonus`/`signup`, com `reference = 'signup'` para a unicidade
  -- `(customer_id, kind, reference)` impedir crédito duplo.
  if v_created then
    select * into v_settings from public.loyalty_settings where restaurant_id = p_restaurant_id;

    if v_settings.enabled and v_settings.signup_bonus > 0 then
      insert into public.loyalty_ledger (
        restaurant_id, customer_id, kind, source, delta, reference, note
      )
      values (
        p_restaurant_id, v_id, 'bonus', 'signup', v_settings.signup_bonus, 'signup',
        'Bônus de cadastro'
      )
      on conflict do nothing;
    end if;
  end if;

  return v_id;
end;
$$;

comment on function public.upsert_customer_for_order(uuid, text, text, boolean) is
  'Etapa 24: identifica/cria o cliente da casa. Uso interno (create_order) — não é exposta ao anon.';

revoke all on function public.upsert_customer_for_order(uuid, text, text, boolean) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8. create_order: identificação opcional
-- ----------------------------------------------------------------------------
/*
 * Substitui a função da Etapa 6 mantendo **a mesma assinatura de antes** e
 * acrescentando quatro parâmetros com default. Isso é deliberado: a versão
 * antiga continua chamável (`create_order(token, items, notes)`) e a assinatura
 * de 3 argumentos não some — quem não passa identificação tem exatamente o
 * comportamento da Etapa 6.
 *
 * A criação da função de 7 argumentos deixaria **as duas** convivendo, e o
 * PostgREST escolheria por contagem de parâmetros nomeados. Por isso a de 3
 * argumentos é removida depois (drop da assinatura antiga) e esta a substitui.
 */
drop function if exists public.create_order(text, jsonb, text);

create or replace function public.create_order(
  p_token           text,
  p_items           jsonb,
  p_notes           text default null,
  p_customer_name   text default null,
  p_customer_phone  text default null,
  p_consent         boolean default false
)
returns table (
  order_id        uuid,
  order_number    integer,
  table_name      text,
  restaurant_id   uuid,
  subtotal        numeric,
  total           numeric,
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
  v_notes      text;
  v_item_count integer;
  v_position   integer := 0;
  v_recent     integer;
  rec          record;
  v_name       text;
  v_price      numeric(10, 2);
  v_customer   uuid;
  v_cust_name  text;
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

  -- 8. Totais finais, sempre no servidor.
  update public.orders
     set subtotal = v_subtotal,
         total = v_subtotal - discount + fees
   where id = v_order_id;

  -- 9. Resumo do cliente: RECALCULADO a partir de `orders`, nunca incrementado.
  --    Incrementar aqui e recalcular no painel criaria dois jeitos de contar a
  --    mesma coisa, e um pedido cancelado continuaria somando em um deles.
  if v_customer is not null then
    perform public.recount_customer_totals(v_customer);
  end if;

  return query
    select o.id, o.order_number, v_table_name, o.restaurant_id,
           o.subtotal, o.total, o.status, o.created_at, o.customer_id
    from public.orders o
    where o.id = v_order_id;
end;
$$;

comment on function public.create_order(text, jsonb, text, text, text, boolean) is
  'Cria pedido pelo token da mesa (Etapa 6 + identificação opcional da Etapa 24). Preços e pontos vêm do banco.';

revoke all on function public.create_order(text, jsonb, text, text, text, boolean) from public;
grant execute on function public.create_order(text, jsonb, text, text, text, boolean) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 9. Crédito de pontos quando o pedido é entregue
-- ----------------------------------------------------------------------------
/**
 * Credita os pontos de um pedido entregue. Idempotente por `order_id`.
 *
 * Por que não um trigger em `orders.status`: o crédito precisa de
 * `loyalty_settings` (que pode estar desligado), precisa devolver o total ao
 * painel e precisa ser *chamável de novo* por um botão "recalcular" — trigger
 * não dá retorno nem permite reprocessar. A função é chamada por
 * `set_order_status` (quando entra em `delivered`) e pode ser chamada pela RPC
 * administrativa depois.
 *
 * Regra: `floor(total * points_per_currency)`. Piso, não arredondamento, para
 * o cliente nunca receber ponto que a casa não calculou — e o valor é sempre
 * inteiro positivo.
 */
create or replace function public.loyalty_award_order(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order    public.orders;
  v_settings public.loyalty_settings;
  v_points   integer;
  v_exists   integer;
begin
  select * into v_order from public.orders o where o.id = p_order_id;

  if v_order.id is null then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  if v_order.status <> 'delivered' or v_order.customer_id is null then
    return 0;
  end if;

  select * into v_settings from public.loyalty_settings s
   where s.restaurant_id = v_order.restaurant_id;

  if v_settings.restaurant_id is null or not v_settings.enabled then
    return 0;
  end if;

  -- Já creditado? Devolve o que está no extrato em vez de duplicar.
  select l.delta into v_exists
  from public.loyalty_ledger l
  where l.order_id = p_order_id and l.kind = 'earn';

  if v_exists is not null then
    return v_exists;
  end if;

  v_points := floor(v_order.total * v_settings.points_per_currency)::integer;

  if v_points <= 0 then
    return 0;
  end if;

  insert into public.loyalty_ledger (
    restaurant_id, customer_id, kind, source, delta, order_id, note
  )
  values (
    v_order.restaurant_id, v_order.customer_id, 'earn', 'order', v_points, p_order_id,
    'Pedido #' || v_order.order_number
  )
  on conflict do nothing;

  return v_points;
end;
$$;

comment on function public.loyalty_award_order(uuid) is
  'Etapa 24: credita pontos de um pedido entregue. Idempotente por order_id.';

revoke all on function public.loyalty_award_order(uuid) from public, anon;
grant execute on function public.loyalty_award_order(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 10. set_order_status: credita ao entregar
-- ----------------------------------------------------------------------------
/*
 * Substitui a função da Etapa 8 mantendo a assinatura e o fluxo de status.
 * A única diferença é o crédito de pontos no fim — e ele só acontece na
 * transição para `delivered`, que é terminal.
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
  v_number     integer;
begin
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

  -- Etapa 24: entrega é o gatilho do crédito. Falha no crédito derruba a
  -- mudança de status junto — é preferível a cozinha ver "não consegui marcar
  -- como entregue" do que o pedido entregue ficar sem os pontos do cliente.
  if p_status = 'delivered' then
    perform public.loyalty_award_order(p_order_id);
  end if;

  -- O resumo do cliente ignora cancelados, então mudança de status pode mudar
  -- os totais nos dois sentidos. Recalcular aqui mantém a ficha coerente sem
  -- depender de o painel lembrar de fazer isso.
  if p_status in ('delivered', 'cancelled') then
    perform public.recount_customer_totals((select o.customer_id from public.orders o where o.id = p_order_id));
  end if;

  return query
    select o.id, o.order_number, o.status, o.updated_at
    from public.orders o
    where o.id = p_order_id;
end;
$$;

comment on function public.set_order_status(uuid, public.order_status, text) is
  'Muda o status respeitando o fluxo do salão. Etapa 24: entrega credita pontos do cliente identificado.';

revoke all on function public.set_order_status(uuid, public.order_status, text) from public;
grant execute on function public.set_order_status(uuid, public.order_status, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 11. Recalcular totais do cliente
-- ----------------------------------------------------------------------------
/**
 * Recalcula `total_orders`, `total_spent` e `last_order_at` a partir de
 * `orders`, ignorando cancelados.
 *
 * Existe porque o incremento em `create_order` conta o pedido no envio, não na
 * entrega: o painel precisa mostrar "pedidos" e "valor total" como a casa
 * entende — o que de fato foi consumido. Chamada pelo painel ao abrir o cliente
 * e por `recalculate_customer_totals()`.
 */
create or replace function public.recount_customer_totals(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant uuid;
begin
  select c.restaurant_id into v_restaurant
  from public.customers c
  where c.id = p_customer_id;

  if v_restaurant is null then
    return;
  end if;

  update public.customers c
     set total_orders  = coalesce(agg.cnt, 0),
         total_spent   = coalesce(agg.sum_total, 0),
         last_order_at = agg.last_at
  from (
    select
      count(*)                   as cnt,
      sum(o.total)               as sum_total,
      max(o.created_at)          as last_at
    from public.orders o
    where o.customer_id = p_customer_id
      and o.status <> 'cancelled'
  ) agg
  where c.id = p_customer_id;
end;
$$;

revoke all on function public.recount_customer_totals(uuid) from public, anon;
grant execute on function public.recount_customer_totals(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 12. Painel: leitura por tenant
-- ----------------------------------------------------------------------------
/**
 * Lista de clientes para a tela `/app/clientes`.
 *
 * Guarda de tenant na primeira linha do corpo (`is_restaurant_member`), e o
 * filtro por `restaurant_id` na consulta. Um id de outra casa devolve vazio —
 * não erro, porque erro confirmaria que a casa existe.
 */
create or replace function public.list_restaurant_customers(
  p_restaurant_id uuid,
  p_search        text default null,
  p_limit         integer default 50,
  p_offset        integer default 0
)
returns table (
  id              uuid,
  name            text,
  phone           text,
  email           text,
  total_orders    integer,
  total_spent     numeric,
  last_order_at   timestamptz,
  created_at      timestamptz,
  points_balance  integer,
  erased_at       timestamptz,
  total_count     bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text;
  v_digits text;
  v_limit  integer;
  v_offset integer;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    return;
  end if;

  v_search := nullif(btrim(coalesce(p_search, '')), '');
  v_digits := regexp_replace(coalesce(v_search, ''), '[^0-9]', '', 'g');
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
    select
      c.id,
      c.name,
      c.phone,
      c.email,
      c.total_orders,
      c.total_spent,
      c.last_order_at,
      c.created_at,
      coalesce((
        select sum(l.delta)::integer
        from public.loyalty_ledger l
        where l.customer_id = c.id
      ), 0),
      c.erased_at,
      count(*) over ()
    from public.customers c
    where c.restaurant_id = p_restaurant_id
      and (
        v_search is null
        or c.name ilike '%' || v_search || '%'
        -- Só casa por telefone quando a busca TEM dígitos: sem isso, procurar
        -- "pizza" casaria com todos os clientes (o `like '%%'` é sempre true).
        or (v_digits <> '' and c.phone_normalized like '%' || v_digits || '%')
      )
    order by c.last_order_at desc nulls last, c.created_at desc
    limit v_limit offset v_offset;
end;
$$;

comment on function public.list_restaurant_customers(uuid, text, integer, integer) is
  'Etapa 24: clientes da própria casa, com saldo de pontos. Casa alheia devolve vazio.';

revoke all on function public.list_restaurant_customers(uuid, text, integer, integer) from public, anon;
grant execute on function public.list_restaurant_customers(uuid, text, integer, integer) to authenticated;

/**
 * Ficha do cliente: dados, resumo, frequência e extrato.
 *
 * "Frequência" é calculada aqui e não no app: depende de datas e de pedidos
 * não cancelados, e fazer isso no cliente obrigaria a baixar todos os pedidos da
 * pessoa. O resultado é um jsonb só porque a tela mostra tudo de uma vez.
 */
create or replace function public.customer_overview(
  p_restaurant_id uuid,
  p_customer_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer public.customers;
  v_balance  integer;
  v_entries  jsonb;
  v_first    timestamptz;
  v_last     timestamptz;
  v_count    integer;
  v_days     numeric;
  v_freq     numeric;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    return null;
  end if;

  select * into v_customer
  from public.customers c
  where c.id = p_customer_id
    and c.restaurant_id = p_restaurant_id;

  if v_customer.id is null then
    return null;
  end if;

  select coalesce(sum(l.delta)::integer, 0) into v_balance
  from public.loyalty_ledger l
  where l.customer_id = p_customer_id;

  select coalesce(jsonb_agg(row_to_json(e)::jsonb order by e.created_at desc), '[]'::jsonb)
    into v_entries
  from (
    select l.id, l.kind, l.source, l.delta, l.reference, l.note, l.created_at, l.order_id
    from public.loyalty_ledger l
    where l.customer_id = p_customer_id
    order by l.created_at desc
    limit 50
  ) e;

  select count(*), min(o.created_at), max(o.created_at)
    into v_count, v_first, v_last
  from public.orders o
  where o.customer_id = p_customer_id
    and o.status <> 'cancelled';

  /*
   * Frequência = pedidos por mês, medida do primeiro ao último pedido.
   *
   * Um cliente com 1 pedido tem intervalo 0: dividir por zero daria `null` e o
   * painel mostraria "—". Devolvemos `null` nesse caso, e a tela sabe explicar
   * "primeiro pedido" em vez de inventar uma frequência com base em um evento.
   */
  if v_count is not null and v_count > 1 and v_first is not null and v_last is not null then
    v_days := greatest(extract(epoch from (v_last - v_first)) / 86400, 1);
    v_freq := round((v_count::numeric / v_days) * 30.0, 1);
  end if;

  return jsonb_build_object(
    'customer', jsonb_build_object(
      'id', v_customer.id,
      'name', v_customer.name,
      'phone', v_customer.phone,
      'email', v_customer.email,
      'birth_date', v_customer.birth_date,
      'total_orders', v_customer.total_orders,
      'total_spent', v_customer.total_spent,
      'last_order_at', v_customer.last_order_at,
      'created_at', v_customer.created_at,
      'consent_at', v_customer.consent_at,
      'consent_version', v_customer.consent_version,
      'consent_revoked_at', v_customer.consent_revoked_at,
      'tags', v_customer.tags,
      'erased_at', v_customer.erased_at
    ),
    'balance', v_balance,
    'orders_count', coalesce(v_count, 0),
    'first_order_at', v_first,
    'last_order_at', v_last,
    'orders_per_month', v_freq,
    'entries', v_entries
  );
end;
$$;

comment on function public.customer_overview(uuid, uuid) is
  'Etapa 24: ficha do cliente com saldo, frequência e extrato. Cliente de outra casa devolve nulo.';

revoke all on function public.customer_overview(uuid, uuid) from public, anon;
grant execute on function public.customer_overview(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 13. Configuração de fidelidade (dono/admin)
-- ----------------------------------------------------------------------------
create or replace function public.save_loyalty_settings(
  p_restaurant_id       uuid,
  p_enabled             boolean,
  p_points_per_currency numeric,
  p_signup_bonus        integer,
  p_birthday_bonus      integer,
  p_redeem_value        numeric,
  p_program_note        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note   text;
  v_row    public.loyalty_settings;
begin
  if not public.is_restaurant_owner(p_restaurant_id) then
    raise exception 'loyalty_forbidden' using errcode = '42501';
  end if;

  v_note := nullif(btrim(regexp_replace(coalesce(p_program_note, ''), '\s+', ' ', 'g')), '');
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'loyalty_note_too_long' using errcode = '22023';
  end if;

  insert into public.loyalty_settings (
    restaurant_id, enabled, points_per_currency, signup_bonus,
    birthday_bonus, redeem_value, program_note
  )
  values (
    p_restaurant_id,
    coalesce(p_enabled, false),
    greatest(coalesce(p_points_per_currency, 0), 0),
    greatest(coalesce(p_signup_bonus, 0), 0),
    greatest(coalesce(p_birthday_bonus, 0), 0),
    greatest(coalesce(p_redeem_value, 0), 0),
    v_note
  )
  on conflict (restaurant_id) do update
    set enabled             = excluded.enabled,
        points_per_currency = excluded.points_per_currency,
        signup_bonus        = excluded.signup_bonus,
        birthday_bonus      = excluded.birthday_bonus,
        redeem_value        = excluded.redeem_value,
        program_note        = excluded.program_note
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

comment on function public.save_loyalty_settings(uuid, boolean, numeric, integer, integer, numeric, text) is
  'Etapa 24: regra de pontos da casa. Dono/admin apenas.';

revoke all on function public.save_loyalty_settings(uuid, boolean, numeric, integer, integer, numeric, text) from public, anon;
grant execute on function public.save_loyalty_settings(uuid, boolean, numeric, integer, integer, numeric, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 14. Bônus manual (aniversário e ajuste)
-- ----------------------------------------------------------------------------
/**
 * Credita bônus de aniversário do ano corrente.
 *
 * `reference = 'birthday:<ano>'` e o índice único de
 * `(customer_id, kind, reference)` garantem **um bônus por ano**, mesmo com dois
 * toques no botão. Se não houver bônus configurado, é erro de uso (o botão não
 * aparece), não um no-op silencioso.
 */
create or replace function public.award_birthday_bonus(
  p_restaurant_id uuid,
  p_customer_id   uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings public.loyalty_settings;
  v_customer public.customers;
  v_ref      text;
  v_year     integer := extract(year from now())::integer;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    raise exception 'loyalty_forbidden' using errcode = '42501';
  end if;

  select * into v_settings from public.loyalty_settings s where s.restaurant_id = p_restaurant_id;
  if v_settings.restaurant_id is null or not v_settings.enabled or v_settings.birthday_bonus <= 0 then
    raise exception 'birthday_bonus_disabled' using errcode = '22023';
  end if;

  select * into v_customer
  from public.customers c
  where c.id = p_customer_id and c.restaurant_id = p_restaurant_id;

  if v_customer.id is null or v_customer.erased_at is not null then
    raise exception 'customer_not_found' using errcode = 'P0002';
  end if;

  v_ref := 'birthday:' || v_year::text;

  insert into public.loyalty_ledger (
    restaurant_id, customer_id, kind, source, delta, reference, note
  )
  values (
    p_restaurant_id, p_customer_id, 'bonus', 'birthday', v_settings.birthday_bonus, v_ref,
    'Bônus de aniversário ' || v_year::text
  )
  -- `do nothing` sem alvo: conflita com qualquer índice único (aqui, o de
  -- bônus anual). Inferir índice parcial exigiria repetir o predicado inteiro.
  on conflict do nothing;

  return v_settings.birthday_bonus;
end;
$$;

revoke all on function public.award_birthday_bonus(uuid, uuid) from public, anon;
grant execute on function public.award_birthday_bonus(uuid, uuid) to authenticated;

/**
 * Ajuste manual de pontos — o "dar 50 pontos porque o pedido atrasou".
 *
 * Pode ser negativo, mas nunca abaixo de zero: saldo negativo é dívida que o
 * cliente não fez, e o extrato append-only não tem como "voltar depois" sem uma
 * nova linha. A checagem é feita aqui, com o saldo lido na mesma transação.
 */
create or replace function public.adjust_customer_points(
  p_restaurant_id uuid,
  p_customer_id   uuid,
  p_delta         integer,
  p_note          text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance integer;
  v_note    text;
  v_customer public.customers;
  v_restaurant uuid;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    raise exception 'loyalty_forbidden' using errcode = '42501';
  end if;

  if p_delta is null or p_delta = 0 then
    raise exception 'invalid_points' using errcode = '22023';
  end if;

  select * into v_customer
  from public.customers c
  where c.id = p_customer_id and c.restaurant_id = p_restaurant_id;

  if v_customer.id is null or v_customer.erased_at is not null then
    raise exception 'customer_not_found' using errcode = 'P0002';
  end if;

  select coalesce(sum(l.delta)::integer, 0) into v_balance
  from public.loyalty_ledger l
  where l.customer_id = p_customer_id;

  if v_balance + p_delta < 0 then
    raise exception 'insufficient_points' using errcode = '22023',
      hint = format('saldo atual %s', v_balance);
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'loyalty_note_too_long' using errcode = '22023';
  end if;

  insert into public.loyalty_ledger (
    restaurant_id, customer_id, kind, source, delta, actor_id, note
  )
  values (
    p_restaurant_id, p_customer_id, 'adjust', 'manual', p_delta, auth.uid(), v_note
  );

  return v_balance + p_delta;
end;
$$;

revoke all on function public.adjust_customer_points(uuid, uuid, integer, text) from public, anon;
grant execute on function public.adjust_customer_points(uuid, uuid, integer, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 15. Atualizar dados do cliente (painel)
-- ----------------------------------------------------------------------------
create or replace function public.update_customer(
  p_restaurant_id uuid,
  p_customer_id   uuid,
  p_name          text default null,
  p_email         text default null,
  p_birth_date    date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name  text;
  v_email text;
  v_row   public.customers;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    raise exception 'loyalty_forbidden' using errcode = '42501';
  end if;

  select * into v_row
  from public.customers c
  where c.id = p_customer_id and c.restaurant_id = p_restaurant_id;

  if v_row.id is null then
    raise exception 'customer_not_found' using errcode = 'P0002';
  end if;

  -- Cliente com dados apagados não volta a ter nome/e-mail por esta via: a
  -- exclusão foi um pedido dele. Só um novo cadastro (novo consentimento)
  -- recomeça o histórico, e isso é decisão da pessoa, não do painel.
  if v_row.erased_at is not null then
    raise exception 'customer_erased' using errcode = '22023';
  end if;

  v_name := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  v_email := nullif(btrim(lower(coalesce(p_email, ''))), '');

  if v_name is not null and char_length(v_name) > 120 then
    raise exception 'customer_name_too_long' using errcode = '22023';
  end if;

  if v_email is not null and (char_length(v_email) > 160 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'invalid_email' using errcode = '22023';
  end if;

  update public.customers c
     set name       = v_name,
         email      = v_email,
         birth_date = p_birth_date
   where c.id = p_customer_id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.update_customer(uuid, uuid, text, text, date) from public, anon;
grant execute on function public.update_customer(uuid, uuid, text, text, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 16. Exclusão de dados do cliente (LGPD)
-- ----------------------------------------------------------------------------
/**
 * Apaga os dados pessoais do cliente, mantendo o histórico financeiro.
 *
 * O que sai: nome, telefone (e o normalizado, que identifica), e-mail, data de
 * nascimento, etiquetas e a referência do consentimento. O que fica: o `id`,
 * `total_orders`, `total_spent`, `last_order_at` e os pedidos — sem nada que
 * aponte para uma pessoa. `orders.customer_name`/`customer_phone` também são
 * esvaziados, porque eram cópia do mesmo dado pessoal.
 *
 * O extrato de pontos permanece (é passivo contábil), agora órfão de nome. Se o
 * mesmo telefone aparecer de novo, nasce um cliente novo: a exclusão é de fato
 * uma exclusão, não um "esconde e mostra de novo".
 */
create or replace function public.erase_customer(
  p_restaurant_id uuid,
  p_customer_id   uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.customers;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    raise exception 'loyalty_forbidden' using errcode = '42501';
  end if;

  select * into v_row
  from public.customers c
  where c.id = p_customer_id and c.restaurant_id = p_restaurant_id;

  if v_row.id is null then
    raise exception 'customer_not_found' using errcode = 'P0002';
  end if;

  -- Idempotente: pedir duas vezes não é erro, é a mesma decisão.
  if v_row.erased_at is not null then
    return false;
  end if;

  update public.orders o
     set customer_name = null,
         customer_phone = null
   where o.customer_id = p_customer_id;

  update public.customers c
     set name = null,
         phone = null,
         phone_normalized = null,
         email = null,
         birth_date = null,
         tags = '{}',
         consent_revoked_at = now(),
         erased_at = now()
   where c.id = p_customer_id;

  return true;
end;
$$;

comment on function public.erase_customer(uuid, uuid) is
  'Etapa 24 (LGPD): anonimiza o cliente e apaga o telefone; pedidos e totais permanecem sem identificação.';

revoke all on function public.erase_customer(uuid, uuid) from public, anon;
grant execute on function public.erase_customer(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 17. Consulta pública de saldo (interface simples do cliente)
-- ----------------------------------------------------------------------------
/**
 * Saldo de pontos para o próprio cliente, sem login.
 *
 * A credencial é o token da mesa (o mesmo que ele já usou para pedir) **mais**
 * o telefone. Sem o telefone, quem tem o link da mesa veria o saldo dos outros;
 * com ele, é preciso conhecer os dois. Não é autenticação forte — é o mesmo
 * nível da Etapa 6, onde conhecer mesa + número do pedido já bastava.
 *
 * Devolve só o que o cliente precisa ver: nome (para confirmar que é ele),
 * saldo e o texto do programa. Nunca telefone, nunca extrato completo.
 */
create or replace function public.customer_points(
  p_token  text,
  p_phone  text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant uuid;
  v_norm       text;
  v_customer   public.customers;
  v_balance    integer;
  v_settings   public.loyalty_settings;
begin
  select r.restaurant_id into v_restaurant
  from public.resolve_table_token(p_token) r;

  if v_restaurant is null then
    return null;
  end if;

  v_norm := public.normalize_phone(p_phone);
  if v_norm is null then
    return null;
  end if;

  select * into v_customer
  from public.customers c
  where c.restaurant_id = v_restaurant
    and c.phone_normalized = v_norm
    and c.erased_at is null;

  if v_customer.id is null then
    return null;
  end if;

  select coalesce(sum(l.delta)::integer, 0) into v_balance
  from public.loyalty_ledger l
  where l.customer_id = v_customer.id;

  select * into v_settings from public.loyalty_settings s where s.restaurant_id = v_restaurant;

  return jsonb_build_object(
    'name', v_customer.name,
    'balance', v_balance,
    'enabled', coalesce(v_settings.enabled, false),
    'program_note', v_settings.program_note,
    'points_per_currency', coalesce(v_settings.points_per_currency, 0),
    'redeem_value', coalesce(v_settings.redeem_value, 0)
  );
end;
$$;

comment on function public.customer_points(text, text) is
  'Etapa 24: saldo do próprio cliente pelo token da mesa + telefone. Devolve só nome, saldo e texto do programa.';

revoke all on function public.customer_points(text, text) from public;
grant execute on function public.customer_points(text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 17b. Regra visível no cardápio público
-- ----------------------------------------------------------------------------
/**
 * Regra de fidelidade que o **cliente** pode ver.
 *
 * `loyalty_settings` não tem policy para `anon` — é configuração da casa, não
 * cardápio. Mas o carrinho precisa dizer "1 ponto por R$ 1" antes de o cliente
 * decidir se identifica, e a página pública roda como `anon`.
 *
 * A saída é uma lista **fechada** de campos nesta função: `security definer`
 * lendo a tabela e devolvendo só o que é promessa pública. `cashback_percent`
 * fica de fora de propósito — é recurso futuro, e o cardápio não deve anunciar
 * o que nenhuma rotina credita.
 *
 * Nulo quando o programa está desligado ou a casa não está publicada: quem
 * chama (`getPublicLoyaltySettings`) usa isso para não renderizar bloco vazio.
 */
create or replace function public.public_loyalty_settings(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.loyalty_settings;
begin
  if p_restaurant_id is null then
    return null;
  end if;

  if not exists (
    select 1 from public.restaurants r
    where r.id = p_restaurant_id and r.status = 'published'
  ) then
    return null;
  end if;

  select * into v_row from public.loyalty_settings s where s.restaurant_id = p_restaurant_id;
  if v_row.restaurant_id is null or not v_row.enabled then
    return null;
  end if;

  return jsonb_build_object(
    'enabled', v_row.enabled,
    'points_per_currency', v_row.points_per_currency,
    'signup_bonus', v_row.signup_bonus,
    'birthday_bonus', v_row.birthday_bonus,
    'redeem_value', v_row.redeem_value,
    'program_note', v_row.program_note
  );
end;
$$;

comment on function public.public_loyalty_settings(uuid) is
  'Etapa 24: regra de fidelidade visível no cardápio público. Nulo quando desligada ou casa não publicada.';

revoke all on function public.public_loyalty_settings(uuid) from public;
grant execute on function public.public_loyalty_settings(uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 18. RLS
-- ----------------------------------------------------------------------------
-- `customers` é dado pessoal: `anon` não lê nada. A equipe lê e escreve apenas
-- os clientes da própria casa. A criação em si vem de `create_order`
-- (`security definer`), que roda como dono das tabelas.
alter table public.customers enable row level security;
alter table public.loyalty_settings enable row level security;
alter table public.loyalty_ledger enable row level security;

drop policy if exists customers_select_member on public.customers;
create policy customers_select_member on public.customers
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

drop policy if exists customers_insert_member on public.customers;
create policy customers_insert_member on public.customers
  for insert to authenticated
  with check (public.is_restaurant_member(restaurant_id));

drop policy if exists customers_update_member on public.customers;
create policy customers_update_member on public.customers
  for update to authenticated
  using (public.is_restaurant_member(restaurant_id))
  with check (public.is_restaurant_member(restaurant_id));

-- Sem policy de DELETE: exclusão de cliente é anonimização via RPC, não
-- `delete from`. Apagar a linha apagaria o vínculo dos pedidos (FK set null) e
-- o extrato de pontos (cascade) — o histórico financeiro da casa sumiria.

drop policy if exists loyalty_settings_select_member on public.loyalty_settings;
create policy loyalty_settings_select_member on public.loyalty_settings
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

drop policy if exists loyalty_settings_write_owner on public.loyalty_settings;
create policy loyalty_settings_write_owner on public.loyalty_settings
  for all to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists loyalty_ledger_select_member on public.loyalty_ledger;
create policy loyalty_ledger_select_member on public.loyalty_ledger
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

-- Escrita no extrato só por RPC (`security definer`). Nenhum insert direto:
-- um `insert` do cliente autenticado criaria pontos sem pedido.
revoke all on public.customers from anon;
revoke all on public.loyalty_settings from anon;
revoke all on public.loyalty_ledger from anon;

grant select, insert, update on public.customers to authenticated;
grant select on public.loyalty_settings to authenticated;
grant insert, update on public.loyalty_settings to authenticated;
grant select on public.loyalty_ledger to authenticated;
revoke insert, update, delete on public.loyalty_ledger from authenticated;

-- ----------------------------------------------------------------------------
-- 19. Orders: leitura do vínculo
-- ----------------------------------------------------------------------------
-- `orders.customer_id` é lido pelo painel pela view `restaurant_orders`? Não:
-- a view da Etapa 7 é `select` explícito e não inclui a coluna nova. A ficha do
-- cliente lê `orders` direto pela RLS de membro, que já existe desde a Etapa 6.

-- ----------------------------------------------------------------------------
-- 20. Documentação viva
-- ----------------------------------------------------------------------------
comment on column public.customers.tags is
  'Segmentação (Etapa 24, preparação): etiquetas livres por casa. Nenhuma rotina automática as preenche hoje.';

comment on column public.loyalty_settings.cashback_percent is
  'Reservado para cashback (Etapa 24, preparação). Hoje só é gravado; nenhuma rotina credita.';
