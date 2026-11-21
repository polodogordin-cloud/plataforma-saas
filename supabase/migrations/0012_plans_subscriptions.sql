-- ============================================================================
-- Etapa 11 · Planos e assinaturas da plataforma
-- ============================================================================
-- Objetivo: virar SaaS comercial sem integrar gateway de pagamento. Toda a
-- estrutura de planos, limites, trial e assinatura entra agora; cobrança real
-- vem depois e só precisa *alimentar* o que existe aqui.
--
-- Este arquivo é o registro do que foi aplicado no banco vivo. A aplicação foi
-- feita em blocos (create_migration não aceita `alter type ... add value` na
-- mesma transação que usa o valor novo, e um bloco grande é difícil de auditar).
-- A ordem abaixo é a ordem real.
--
-- Decisões deste arquivo, e por quê:
--
--   1. **O limite mora no plano, nunca no código.** `plans.limits` é um jsonb
--      com chaves estáveis (`max_products`, `max_tables`, ...). Nenhum número
--      mágico fica espalhado nas telas: a única fonte é a linha do plano.
--      Criar um plano novo pelo /admin já muda o que o banco permite.
--
--   2. **Limite não é `check constraint`, é trigger.** Um `check` no insert
--      não sabe quantas linhas o restaurante já tem no plano dele, e um
--      `check` na tabela `tables` não sabe ler `plans` sem virar dependência
--      circular. O trigger `enforce_plan_limit` consulta, na hora da escrita,
--      o plano e a contagem real — e vale para qualquer caminho: Server Action,
--      PostgREST direto ou SQL na mão.
--
--   3. **Limite acima de RLS, inclusive para a plataforma.** O trigger não
--      abre exceção para admin global: o painel master também não cria a mesa
--      51. Se a plataforma precisa destravar um cliente, ela troca o plano
--      dele — que é uma decisão registrada na auditoria, não um furo silencioso.
--
--   4. **Recurso é lista de chaves, não coluna por recurso.** `plans.features`
--      guarda `["qr_code", "nfc", ...]`. Adicionar `custom_domain` amanhã é
--      digitar uma string no plano, sem migração.
--
--   5. **Assinatura tem tabela própria, e `restaurants` guarda um espelho.**
--      A tabela `subscriptions` é o histórico (troca de plano, cancelamento,
--      trial); as colunas `restaurants.plan_id`/`subscription_state` são o
--      atalho que a RLS, o layout e o cardápio público leem sem join. O trigger
--      `sync_restaurant_subscription` mantém os dois lados coerentes — é o
--      único lugar que escreve o espelho.
--
--   6. **`plans` continua texto, não uuid.** As colunas da Etapa 10
--      (`restaurants.plan_id`) e as FKs já existentes apontam para `plans.id`;
--      trocar o tipo agora quebraria dados reais por nenhum ganho. `id` segue
--      sendo o slug do plano (`basico`, `profissional`, `premium`).
--
--   7. **Trial é derivado, não digitado.** Quem chama `start_trial` não escolhe
--      a data final: ela vem de `platform_settings.trial_days`. Um trial de 7
--      dias que virasse 7 meses por payload seria a primeira brecha do SaaS.
--
--   8. **Gateway é abstração, não simulação.** `subscriptions` guarda
--      `provider`, `external_customer_id` e `external_subscription_id`; não há
--      chamada de rede em lugar nenhum. A camada TypeScript (`src/lib/billing`)
--      define o contrato que Stripe/Mercado Pago/Asaas vão implementar.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'subscription_state') then
    create type public.subscription_state as enum
      ('trial', 'active', 'past_due', 'cancelled', 'expired', 'suspended');
  end if;

  if not exists (select 1 from pg_type where typname = 'billing_interval') then
    create type public.billing_interval as enum ('monthly', 'yearly');
  end if;
end
$$;

comment on type public.subscription_state is
  'Ciclo de vida comercial da casa. `trial` e `active` liberam o painel; os demais dependem da política de tolerância.';

-- ----------------------------------------------------------------------------
-- 2. Configurações globais da plataforma
--
-- Chave/valor simples: trial e tolerância de atraso mudam sem deploy.
-- ----------------------------------------------------------------------------
create table if not exists public.platform_settings (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{2,48}$'),
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

comment on table public.platform_settings is
  'Configuração global da plataforma (trial_days, grace_days...). Só admin global escreve.';

alter table public.platform_settings enable row level security;

drop policy if exists platform_settings_select_admin on public.platform_settings;
create policy platform_settings_select_admin on public.platform_settings
  for select to authenticated
  using (public.is_platform_admin());

-- Leitura pública de um subconjunto: a vitrine `/planos` precisa do trial_days e
-- o visitante não tem sessão. A policy libera só as chaves de vitrine.
drop policy if exists platform_settings_select_public_keys on public.platform_settings;
create policy platform_settings_select_public_keys on public.platform_settings
  for select to anon, authenticated
  using (key in ('trial_days', 'grace_days'));

grant select on public.platform_settings to authenticated;
grant select on public.platform_settings to anon;

insert into public.platform_settings (key, value, description)
values
  ('trial_days', '7'::jsonb, 'Dias de teste gratuito concedidos a um restaurante novo.'),
  ('grace_days', '5'::jsonb, 'Dias de tolerância após o vencimento antes de bloquear o painel.')
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 3. Planos
-- ----------------------------------------------------------------------------
alter table public.plans
  add column if not exists billing_interval public.billing_interval not null default 'monthly',
  add column if not exists updated_at timestamptz not null default now();

comment on column public.plans.limits is
  'Limites numéricos: max_products, max_tables, max_users, max_categories, max_orders_month. null = sem limite.';
comment on column public.plans.features is
  'Chaves de recurso: custom_theme, nfc, qr_code, waiter_call, bill_request, analytics, custom_domain, whatsapp, pix.';

-- Os dois planos herdados da Etapa 10 ganham limites e recursos no mesmo
-- vocabulário dos três planos comerciais: nenhum código muda de comportamento
-- por causa do nome do plano.
update public.plans
   set limits = coalesce(limits, '{}'::jsonb)
              || '{"max_products": 30, "max_tables": 5, "max_users": 3, "max_categories": 5, "max_orders_month": 100}'::jsonb,
       features = '["qr_code", "waiter_call", "pix"]'::jsonb
 where id = 'free'
   and (limits = '{}'::jsonb or limits is null);

update public.plans
   set limits = coalesce(limits, '{}'::jsonb)
              || '{"max_products": null, "max_tables": null, "max_users": null, "max_categories": null, "max_orders_month": null}'::jsonb,
       features = '["qr_code", "nfc", "waiter_call", "bill_request", "custom_theme", "analytics", "pix"]'::jsonb
 where id = 'pro'
   and (limits = '{}'::jsonb or limits is null);

insert into public.plans (id, name, description, price_monthly, position, features, limits, billing_interval)
values
  (
    'basico', 'Básico',
    'Para quem está começando: cardápio digital, QR Code e pedidos na mesa.',
    49.90, 10,
    '["qr_code", "waiter_call", "pix"]'::jsonb,
    '{"max_products": 50, "max_tables": 10, "max_users": 3, "max_categories": 8, "max_orders_month": 500}'::jsonb,
    'monthly'
  ),
  (
    'profissional', 'Profissional',
    'A casa em movimento: tema personalizado, NFC, chamar garçom e pedir a conta.',
    99.90, 20,
    '["qr_code", "nfc", "waiter_call", "bill_request", "custom_theme", "pix", "whatsapp"]'::jsonb,
    '{"max_products": 500, "max_tables": 50, "max_users": 10, "max_categories": 30, "max_orders_month": 5000}'::jsonb,
    'monthly'
  ),
  (
    'premium', 'Premium',
    'Rede ou casa cheia: limites altos, relatórios e domínio próprio.',
    199.90, 30,
    '["qr_code", "nfc", "waiter_call", "bill_request", "custom_theme", "analytics", "custom_domain", "whatsapp", "pix"]'::jsonb,
    '{"max_products": null, "max_tables": null, "max_users": null, "max_categories": null, "max_orders_month": null}'::jsonb,
    'monthly'
  )
on conflict (id) do nothing;

create index if not exists plans_active_position_idx
  on public.plans (is_active, position);

-- O catálogo de planos é público (a página /planos não tem login). Continua com
-- RLS: leitura livre, escrita só por RPC de admin (o grant abaixo é o que fecha
-- o caminho direto pelo PostgREST).
drop policy if exists plans_select_public on public.plans;
create policy plans_select_public on public.plans
  for select to anon, authenticated
  using (true);

grant select on public.plans to anon;
revoke insert, update, delete on public.plans from authenticated;
revoke insert, update, delete on public.plans from anon;

-- ----------------------------------------------------------------------------
-- 4. Assinaturas
-- ----------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  restaurant_id            uuid not null references public.restaurants (id) on delete cascade,
  plan_id                  text not null references public.plans (id),
  status                   public.subscription_state not null default 'trial',
  billing_interval         public.billing_interval not null default 'monthly',
  current_period_start     timestamptz not null default now(),
  current_period_end       timestamptz,
  trial_start              timestamptz,
  trial_end                timestamptz,
  cancelled_at             timestamptz,
  cancel_reason            text check (cancel_reason is null or char_length(cancel_reason) <= 280),
  -- Abstração de gateway: preenchidos quando um provedor real for ligado.
  provider                 text check (provider is null or char_length(provider) between 2 and 32),
  external_customer_id     text,
  external_subscription_id text,
  -- Preço congelado no momento da contratação: mudar a tabela de planos não
  -- reescreve o que o cliente já contratou.
  price_snapshot           numeric(10, 2) not null default 0 check (price_snapshot >= 0),
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint subscriptions_period_check
    check (current_period_end is null or current_period_end >= current_period_start),
  constraint subscriptions_trial_check
    check (trial_end is null or trial_start is null or trial_end >= trial_start)
);

comment on table public.subscriptions is
  'Histórico comercial por restaurante. Espelhado em restaurants.plan_id/subscription_state pelo trigger sync_restaurant_subscription.';

-- Uma assinatura corrente por casa: as antigas viram histórico (`cancelled_at`
-- preenchido) e saem do índice.
create unique index if not exists subscriptions_current_uidx
  on public.subscriptions (restaurant_id)
  where cancelled_at is null;

create index if not exists subscriptions_restaurant_idx
  on public.subscriptions (restaurant_id, created_at desc);

create index if not exists subscriptions_status_idx
  on public.subscriptions (status);

drop trigger if exists subscriptions_touch_updated_at on public.subscriptions;
create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();

alter table public.subscriptions enable row level security;

-- Membro do restaurante lê a própria assinatura; ninguém escreve direto — quem
-- escreve são as RPCs (todas `security definer` com checagem de papel).
drop policy if exists subscriptions_select_member on public.subscriptions;
create policy subscriptions_select_member on public.subscriptions
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

grant select on public.subscriptions to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Restaurantes: retrato da assinatura
--
-- `restaurants.subscription_status` nasceu como text com cinco valores na
-- Etapa 10. A Etapa 11 precisa dos seis estados comerciais como enum; em vez de
-- reescrever a coluna (dado real vivo), entra uma coluna nova
-- `subscription_state` e a antiga passa a espelho legado — mantida para não
-- quebrar nada do que já existe.
-- ----------------------------------------------------------------------------
alter table public.restaurants
  add column if not exists subscription_state public.subscription_state,
  add column if not exists current_subscription_id uuid
    references public.subscriptions (id) on delete set null;

comment on column public.restaurants.subscription_state is
  'Retrato atual da assinatura (enum). Mantido pelo trigger sync_restaurant_subscription.';
comment on column public.restaurants.current_subscription_id is
  'Assinatura corrente da casa. Nula = nunca assinou.';

create index if not exists restaurants_subscription_state_idx
  on public.restaurants (subscription_state);

-- Casas que já existiam entram como trial: a Etapa 11 não pode bloquear quem
-- estava funcionando na Etapa 10 no dia do deploy.
update public.restaurants
   set subscription_state = 'trial'
 where subscription_state is null;

-- ----------------------------------------------------------------------------
-- 6. Helpers de plano
-- ----------------------------------------------------------------------------

/**
 * Plano efetivo da casa, com fallback em `free`.
 *
 * Devolve a linha inteira (rowtype) porque o chamador quase sempre precisa de
 * id, nome, limites e recursos juntos. O fallback existe para que plano ausente
 * nunca libere tudo (falha aberta) nem bloqueie tudo (falha fechada).
 */
create or replace function public.restaurant_plan(p_restaurant_id uuid)
returns public.plans
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select pl from public.plans pl
       join public.restaurants r on r.plan_id = pl.id
      where r.id = p_restaurant_id),
    (select pl from public.plans pl where pl.id = 'free'),
    (select pl from public.plans pl order by pl.position asc limit 1)
  );
$$;

comment on function public.restaurant_plan(uuid) is
  'Plano efetivo da casa. Fallback em free para que plano ausente nunca libere tudo nem bloqueie tudo.';

revoke all on function public.restaurant_plan(uuid) from public;
grant execute on function public.restaurant_plan(uuid) to authenticated, anon;

/**
 * Recurso liberado?
 *
 * Lê `plans.features` e devolve boolean. Não consulta status comercial de
 * propósito: liberar recurso é decisão do plano; suspender a casa é outra
 * alçada (status do restaurante / assinatura).
 */
create or replace function public.has_feature(p_restaurant_id uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (public.restaurant_plan(p_restaurant_id)).features ? lower(coalesce(p_feature, '')),
    false
  );
$$;

comment on function public.has_feature(uuid, text) is
  'true quando o plano da casa lista a chave de recurso (features jsonb contém a string).';

revoke all on function public.has_feature(uuid, text) from public;
grant execute on function public.has_feature(uuid, text) to authenticated, anon;

/**
 * Leitura do limite declarado pelo plano.
 *
 * `null` = sem limite. Plano sem a chave também é sem limite — um plano novo
 * criado no /admin não bloqueia nada até que alguém digite o número.
 */
create or replace function public.plan_limit(p_plan_id text, p_key text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when (select pl.limits from public.plans pl where pl.id = p_plan_id) ? p_key
      then nullif((select pl.limits ->> p_key from public.plans pl where pl.id = p_plan_id), '')::integer
    else null
  end;
$$;

revoke all on function public.plan_limit(text, text) from public;
grant execute on function public.plan_limit(text, text) to authenticated;

/**
 * Retrato de uso vs. limite da casa — a mesma conta que o trigger faz.
 *
 * A tela "Meu plano" e o aviso de limite leem daqui, então a barra que o dono
 * vê é exatamente a regra que o banco aplica. Se a conta fosse refeita em
 * TypeScript, as duas versões divergiriam com o tempo.
 */
create or replace function public.restaurant_usage(p_restaurant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with pl as (select public.restaurant_plan(p_restaurant_id) as plan)
  select jsonb_build_object(
    'plan_id', (select (plan).id from pl),
    'plan_name', (select (plan).name from pl),
    'limits', (select (plan).limits from pl),
    'features', (select (plan).features from pl),
    'products', jsonb_build_object(
      'used', (select count(*) from public.products where restaurant_id = p_restaurant_id),
      'limit', public.plan_limit((select (plan).id from pl), 'max_products')),
    'tables', jsonb_build_object(
      'used', (select count(*) from public.tables where restaurant_id = p_restaurant_id),
      'limit', public.plan_limit((select (plan).id from pl), 'max_tables')),
    'users', jsonb_build_object(
      'used', (select count(*) from public.restaurant_users
                where restaurant_id = p_restaurant_id and status = 'active'),
      'limit', public.plan_limit((select (plan).id from pl), 'max_users')),
    'categories', jsonb_build_object(
      'used', (select count(*) from public.categories where restaurant_id = p_restaurant_id),
      'limit', public.plan_limit((select (plan).id from pl), 'max_categories')),
    'orders_month', jsonb_build_object(
      'used', (select count(*) from public.orders
                where restaurant_id = p_restaurant_id
                  and created_at >= date_trunc('month', now())),
      'limit', public.plan_limit((select (plan).id from pl), 'max_orders_month'))
  );
$$;

comment on function public.restaurant_usage(uuid) is
  'Uso atual vs. limites do plano. Mesma aritmética do trigger enforce_plan_limit.';

revoke all on function public.restaurant_usage(uuid) from public;
grant execute on function public.restaurant_usage(uuid) to authenticated;

/**
 * Pode criar mais um item deste tipo?
 *
 * Devolve `{allowed, used, limit, key}`. Útil para a tela desabilitar o botão
 * e para a Server Action explicar antes de tentar — mas quem decide de verdade
 * é o trigger, que roda na mesma transação do insert.
 */
create or replace function public.check_plan_limit(p_restaurant_id uuid, p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan   public.plans;
  v_limit  integer;
  v_used   integer;
begin
  v_plan := public.restaurant_plan(p_restaurant_id);
  v_limit := public.plan_limit(v_plan.id, p_key);

  v_used := case p_key
    when 'max_products' then (select count(*) from public.products where restaurant_id = p_restaurant_id)
    when 'max_tables'   then (select count(*) from public.tables where restaurant_id = p_restaurant_id)
    when 'max_users'    then (select count(*) from public.restaurant_users
                               where restaurant_id = p_restaurant_id and status = 'active')
    when 'max_categories' then (select count(*) from public.categories where restaurant_id = p_restaurant_id)
    when 'max_orders_month' then (select count(*) from public.orders
                                   where restaurant_id = p_restaurant_id
                                     and created_at >= date_trunc('month', now()))
    else 0
  end;

  return jsonb_build_object(
    'key', p_key,
    'plan_id', v_plan.id,
    'used', v_used,
    'limit', v_limit,
    'allowed', v_limit is null or v_used < v_limit
  );
end;
$$;

revoke all on function public.check_plan_limit(uuid, text) from public;
grant execute on function public.check_plan_limit(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Trigger de limite
--
-- Genérico: a chave do limite vem de `tg_argv[0]`, não do payload. Qualquer
-- caminho de escrita passa por aqui — inclusive o painel master e SQL manual —
-- porque trigger BEFORE INSERT não tem como ser contornado por quem usa a API.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key      text := tg_argv[0];
  v_rest_id  uuid;
  v_limit    integer;
  v_used     integer;
begin
  v_rest_id := (to_jsonb(new) ->> 'restaurant_id')::uuid;
  if v_rest_id is null then
    return new;
  end if;

  v_limit := public.plan_limit((public.restaurant_plan(v_rest_id)).id, v_key);
  if v_limit is null then
    return new;
  end if;

  v_used := case v_key
    when 'max_products' then (select count(*) from public.products where restaurant_id = v_rest_id)
    when 'max_tables'   then (select count(*) from public.tables where restaurant_id = v_rest_id)
    when 'max_users'    then (select count(*) from public.restaurant_users
                               where restaurant_id = v_rest_id and status = 'active')
    when 'max_categories' then (select count(*) from public.categories where restaurant_id = v_rest_id)
    when 'max_orders_month' then (select count(*) from public.orders
                                   where restaurant_id = v_rest_id
                                     and created_at >= date_trunc('month', now()))
    else 0
  end;

  if v_used >= v_limit then
    -- Erro com prefixo estável: a Server Action traduz para a mensagem da tela
    -- e sabe qual chave citar ("mesas", "produtos", ...).
    raise exception 'plan_limit_reached:%:%', v_key, v_limit
      using errcode = '42501',
            detail = jsonb_build_object('key', v_key, 'limit', v_limit, 'used', v_used)::text;
  end if;

  return new;
end;
$$;

comment on function public.enforce_plan_limit() is
  'Recusa INSERT quando a casa já atingiu o limite do plano. tg_argv[0] = chave do limite. max_orders_month é apenas medido por check_plan_limit, sem bloquear o insert (o cliente no salão não pode ser barrado).';

drop trigger if exists products_enforce_plan_limit on public.products;
create trigger products_enforce_plan_limit
  before insert on public.products
  for each row execute function public.enforce_plan_limit('max_products');

drop trigger if exists tables_enforce_plan_limit on public.tables;
create trigger tables_enforce_plan_limit
  before insert on public.tables
  for each row execute function public.enforce_plan_limit('max_tables');

drop trigger if exists categories_enforce_plan_limit on public.categories;
create trigger categories_enforce_plan_limit
  before insert on public.categories
  for each row execute function public.enforce_plan_limit('max_categories');

-- Usuários também contam: o dono não convida a equipe 11 num plano de 10.
drop trigger if exists restaurant_users_enforce_plan_limit on public.restaurant_users;
create trigger restaurant_users_enforce_plan_limit
  before insert on public.restaurant_users
  for each row execute function public.enforce_plan_limit('max_users');

-- ----------------------------------------------------------------------------
-- 8. Assinatura sem acesso bloqueia escrita
--
-- `expired`, `cancelled` e `suspended` não criam conteúdo novo. `trial`,
-- `active` e `past_due` criam: casa em atraso está operando, e travar o salão
-- por causa de uma fatura em processamento custa mais caro que a mensalidade.
--
-- Pedidos ficam **de fora** de propósito: o cliente na mesa não tem culpa da
-- cobrança da casa.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_subscription_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rest uuid := (to_jsonb(new) ->> 'restaurant_id')::uuid;
  v_state public.subscription_state;
  v_status public.restaurant_status;
begin
  if v_rest is null then
    return new;
  end if;

  select subscription_state, status into v_state, v_status
  from public.restaurants where id = v_rest;

  if v_status = 'suspended' then
    raise exception 'restaurant_suspended' using errcode = '42501';
  end if;

  if v_state is null or v_state in ('expired', 'cancelled', 'suspended') then
    raise exception 'subscription_inactive:%', coalesce(v_state::text, 'none') using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.enforce_subscription_active() is
  'Criação de conteúdo exige assinatura vigente (trial/active/past_due). Pedidos ficam de fora: cliente no salão não pode ser barrado por cobrança da casa.';

drop trigger if exists products_enforce_subscription on public.products;
create trigger products_enforce_subscription before insert on public.products
  for each row execute function public.enforce_subscription_active();

drop trigger if exists tables_enforce_subscription on public.tables;
create trigger tables_enforce_subscription before insert on public.tables
  for each row execute function public.enforce_subscription_active();

drop trigger if exists categories_enforce_subscription on public.categories;
create trigger categories_enforce_subscription before insert on public.categories
  for each row execute function public.enforce_subscription_active();

-- ----------------------------------------------------------------------------
-- 9. Espelho: assinatura → restaurante
--
-- Único lugar que escreve `restaurants.plan_id` e companhia. Como ele roda como
-- `security definer` mas sem sessão de admin (ex.: backfill da migração), ele
-- avisa ao guard "esta escrita é do espelho" por um marcador de transação.
-- Quem chega aqui já passou por `start_trial`, `change_plan`,
-- `admin_set_subscription` ou pelo backfill — todas com autorização própria.
-- ----------------------------------------------------------------------------
create or replace function public.sync_restaurant_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscriptions;
begin
  v_row := coalesce(new, old);

  -- Só a assinatura corrente atualiza o espelho. Uma linha histórica que muda
  -- depois (ex.: cancelamento) não mexe no retrato atual da casa.
  if v_row.cancelled_at is not null then
    return coalesce(new, old);
  end if;

  perform set_config('menuvo.internal_subscription_sync', 'on', true);

  update public.restaurants r
     set plan_id = v_row.plan_id,
         subscription_state = v_row.status,
         current_subscription_id = v_row.id,
         subscription_status = case
           when v_row.status = 'trial' then 'trialing'
           when v_row.status = 'active' then 'active'
           when v_row.status = 'past_due' then 'past_due'
           when v_row.status in ('cancelled', 'expired') then 'canceled'
           else r.subscription_status
         end,
         subscription_start = v_row.current_period_start,
         subscription_end   = coalesce(v_row.current_period_end, v_row.trial_end)
   where r.id = v_row.restaurant_id;

  perform set_config('menuvo.internal_subscription_sync', 'off', true);

  return coalesce(new, old);
end;
$$;

comment on function public.sync_restaurant_subscription() is
  'Mantém restaurants.plan_id/subscription_state iguais à assinatura corrente.';

drop trigger if exists subscriptions_sync_restaurant on public.subscriptions;
create trigger subscriptions_sync_restaurant
  after insert or update on public.subscriptions
  for each row execute function public.sync_restaurant_subscription();

/**
 * Cadeado do plano e da suspensão (versão da Etapa 11).
 *
 * Duas exceções além do admin global, e as duas são estreitas:
 *
 *   • marcador do espelho de assinatura (ver acima);
 *   • desvínculo em cascata — `current_subscription_id` referencia
 *     `subscriptions` com `on delete set null`, então apagar uma assinatura
 *     dispara UPDATE em `restaurants`. Sem esta exceção o restaurante ficava
 *     impossível de excluir (`restaurant_plan_locked` no cleanup). O teste
 *     automático do banco encontrou isso.
 */
create or replace function public.guard_restaurant_admin_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_platform_admin() then
    return new;
  end if;

  if coalesce(current_setting('menuvo.internal_subscription_sync', true), 'off') = 'on' then
    return new;
  end if;

  if new.current_subscription_id is null
     and old.current_subscription_id is not null
     and not exists (select 1 from public.subscriptions s where s.id = old.current_subscription_id)
     and new.plan_id is not distinct from old.plan_id
     and new.subscription_state is not distinct from old.subscription_state
     and new.subscription_status is not distinct from old.subscription_status then
    return new;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'suspended' or new.status = 'suspended' then
      -- Nem sair da suspensão, nem entrar nela. O dono não se auto-desbloqueia.
      raise exception 'restaurant_suspended_locked' using errcode = '42501';
    end if;
  end if;

  if new.plan_id is distinct from old.plan_id
     or new.subscription_status is distinct from old.subscription_status
     or new.subscription_state is distinct from old.subscription_state
     or new.current_subscription_id is distinct from old.current_subscription_id
     or new.subscription_start is distinct from old.subscription_start
     or new.subscription_end is distinct from old.subscription_end
     or new.suspended_at is distinct from old.suspended_at
     or new.suspended_reason is distinct from old.suspended_reason then
    raise exception 'restaurant_plan_locked' using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_restaurant_admin_fields() is
  'Só admin da plataforma suspende/dessuspende ou mexe em plano e assinatura (fora do espelho interno).';

-- ----------------------------------------------------------------------------
-- 10. Trial automático de casa nova
-- ----------------------------------------------------------------------------
create or replace function public.grant_trial_on_create()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer;
  v_plan text;
begin
  select coalesce((value #>> '{}')::integer, 7) into v_days
  from public.platform_settings where key = 'trial_days';
  v_days := coalesce(v_days, 7);

  -- 0 dias = trial desligado, e a casa nasce no fallback `free`.
  if v_days <= 0 then
    return new;
  end if;

  v_plan := coalesce(
    (select id from public.plans where is_active and price_monthly > 0 order by position desc limit 1),
    (select id from public.plans where is_active order by position limit 1),
    'free'
  );

  insert into public.subscriptions (
    restaurant_id, plan_id, status, billing_interval,
    current_period_start, current_period_end, trial_start, trial_end, price_snapshot
  )
  values (
    new.id, v_plan, 'trial', 'monthly',
    now(), now() + make_interval(days => v_days),
    now(), now() + make_interval(days => v_days),
    coalesce((select price_monthly from public.plans where id = v_plan), 0)
  );

  return new;
end;
$$;

drop trigger if exists restaurants_grant_trial on public.restaurants;
create trigger restaurants_grant_trial
  after insert on public.restaurants
  for each row execute function public.grant_trial_on_create();

-- Backfill: casas anteriores à Etapa 11 ganham trial agora, em vez de acordarem
-- bloqueadas no dia do deploy.
insert into public.subscriptions (
  restaurant_id, plan_id, status, billing_interval,
  current_period_start, current_period_end, trial_start, trial_end, price_snapshot, notes
)
select
  r.id,
  coalesce((select id from public.plans where id = 'profissional'), r.plan_id),
  'trial', 'monthly',
  now(), now() + make_interval(days => coalesce((select (value #>> '{}')::integer from public.platform_settings where key = 'trial_days'), 7)),
  now(), now() + make_interval(days => coalesce((select (value #>> '{}')::integer from public.platform_settings where key = 'trial_days'), 7)),
  coalesce((select price_monthly from public.plans where id = 'profissional'), 0),
  'trial concedido na migração da Etapa 11'
from public.restaurants r
where not exists (select 1 from public.subscriptions s where s.restaurant_id = r.id);

-- ----------------------------------------------------------------------------
-- 11. RPCs de assinatura (dono da casa ou admin da plataforma)
-- ----------------------------------------------------------------------------

/**
 * Inicia o teste gratuito.
 *
 * Idempotente por casa: se já houve qualquer assinatura, não cria outra (trial
 * é uma vez só). A data final vem de `platform_settings.trial_days`, nunca do
 * payload.
 */
create or replace function public.start_trial(
  p_restaurant_id uuid default null,
  p_plan_id       text default null
)
returns public.subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rest uuid := coalesce(p_restaurant_id, (select restaurant_id from public.restaurant_users
                                             where user_id = auth.uid() and status = 'active'
                                             order by created_at limit 1));
  v_days integer;
  v_plan text;
  v_row  public.subscriptions;
begin
  if v_rest is null then
    raise exception 'restaurant_not_found' using errcode = 'P0002';
  end if;

  if not (public.is_platform_admin() or public.is_restaurant_owner_admin(v_rest)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if exists (select 1 from public.subscriptions s where s.restaurant_id = v_rest) then
    raise exception 'trial_already_used' using errcode = '23505';
  end if;

  select coalesce((value #>> '{}')::integer, 7) into v_days
  from public.platform_settings where key = 'trial_days';
  v_days := coalesce(v_days, 7);

  v_plan := coalesce(p_plan_id, (select plan_id from public.restaurants where id = v_rest));

  if v_plan is null or not exists (select 1 from public.plans where id = v_plan) then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;

  insert into public.subscriptions (
    restaurant_id, plan_id, status, billing_interval,
    current_period_start, current_period_end, trial_start, trial_end, price_snapshot
  )
  values (
    v_rest, v_plan, 'trial', 'monthly',
    now(), now() + make_interval(days => v_days),
    now(), now() + make_interval(days => v_days),
    coalesce((select price_monthly from public.plans where id = v_plan), 0)
  )
  returning * into v_row;

  perform public.log_admin_action(
    'subscription.trial_started', 'subscription', v_row.id, v_rest,
    jsonb_build_object('plan_id', v_row.plan_id, 'days', v_days, 'trial_end', v_row.trial_end)
  );

  return v_row;
end;
$$;

revoke all on function public.start_trial(uuid, text) from public;
grant execute on function public.start_trial(uuid, text) to authenticated;

/**
 * Troca de plano (upgrade/downgrade) — sem cobrança nesta etapa.
 *
 * Regras:
 *   • só admin global ou owner da casa;
 *   • plano precisa existir e estar ativo;
 *   • **downgrade respeita o uso atual**: não dá para cair para um plano cujo
 *     limite de produtos/mesas/usuários/categorias já está estourado. Sem isso
 *     a casa ficaria acima do próprio plano e o próximo insert falharia com
 *     erro de banco sem explicação.
 */
create or replace function public.change_plan(
  p_restaurant_id uuid,
  p_plan_id       text,
  p_interval      public.billing_interval default 'monthly'
)
returns public.subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan    public.plans;
  v_current public.subscriptions;
  v_row     public.subscriptions;
  v_key     text;
  v_limit   integer;
  v_used    integer;
begin
  if not (public.is_platform_admin() or public.is_restaurant_owner_admin(p_restaurant_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_plan from public.plans where id = p_plan_id and is_active;
  if v_plan.id is null then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;

  foreach v_key in array array['max_products', 'max_tables', 'max_users', 'max_categories'] loop
    v_limit := public.plan_limit(v_plan.id, v_key);
    continue when v_limit is null;

    v_used := case v_key
      when 'max_products' then (select count(*) from public.products where restaurant_id = p_restaurant_id)
      when 'max_tables'   then (select count(*) from public.tables where restaurant_id = p_restaurant_id)
      when 'max_users'    then (select count(*) from public.restaurant_users
                                 where restaurant_id = p_restaurant_id and status = 'active')
      when 'max_categories' then (select count(*) from public.categories where restaurant_id = p_restaurant_id)
    end;

    if v_used > v_limit then
      raise exception 'plan_downgrade_too_small:%:%:%', v_key, v_used, v_limit
        using errcode = '42501';
    end if;
  end loop;

  select * into v_current
  from public.subscriptions
  where restaurant_id = p_restaurant_id and cancelled_at is null;

  if v_current.id is not null and v_current.plan_id = p_plan_id then
    -- Mesmo plano: só atualiza o intervalo, sem criar histórico vazio.
    update public.subscriptions
       set billing_interval = p_interval, updated_at = now()
     where id = v_current.id
    returning * into v_row;
  elsif v_current.id is not null then
    -- Fecha a anterior (vira histórico) e abre a nova.
    update public.subscriptions
       set cancelled_at = now(), cancel_reason = 'plan_changed', status = 'cancelled'
     where id = v_current.id;

    insert into public.subscriptions (
      restaurant_id, plan_id, status, billing_interval,
      current_period_start, current_period_end, price_snapshot,
      trial_start, trial_end, provider, external_customer_id
    )
    values (
      p_restaurant_id, p_plan_id,
      case when v_current.status = 'trial' then 'trial'::public.subscription_state else 'active'::public.subscription_state end,
      p_interval, now(), now() + interval '1 month',
      v_plan.price_monthly,
      -- Trocar de plano durante o trial não reinicia o relógio do teste.
      case when v_current.status = 'trial' then v_current.trial_start end,
      case when v_current.status = 'trial' then v_current.trial_end end,
      v_current.provider, v_current.external_customer_id
    )
    returning * into v_row;
  else
    insert into public.subscriptions (
      restaurant_id, plan_id, status, billing_interval,
      current_period_start, current_period_end, price_snapshot
    )
    values (
      p_restaurant_id, p_plan_id, 'active', p_interval,
      now(), now() + interval '1 month', v_plan.price_monthly
    )
    returning * into v_row;
  end if;

  perform public.log_admin_action(
    'subscription.plan_changed', 'subscription', v_row.id, p_restaurant_id,
    jsonb_build_object(
      'from', v_current.plan_id, 'to', p_plan_id, 'status', v_row.status,
      'interval', p_interval::text
    )
  );

  return v_row;
end;
$$;

revoke all on function public.change_plan(uuid, text, public.billing_interval) from public;
grant execute on function public.change_plan(uuid, text, public.billing_interval) to authenticated;

/** Cancelamento: a casa mantém o acesso até o fim do período registrado. */
create or replace function public.cancel_subscription(
  p_restaurant_id uuid,
  p_reason        text default null
)
returns public.subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscriptions;
begin
  if not (public.is_platform_admin() or public.is_restaurant_owner_admin(p_restaurant_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_reason is not null and char_length(p_reason) > 280 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;

  select * into v_row
  from public.subscriptions
  where restaurant_id = p_restaurant_id and cancelled_at is null;

  if v_row.id is null then
    raise exception 'subscription_not_found' using errcode = 'P0002';
  end if;

  update public.subscriptions
     set status = 'cancelled',
         cancelled_at = now(),
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  perform public.log_admin_action(
    'subscription.cancelled', 'subscription', v_row.id, p_restaurant_id,
    jsonb_build_object('reason', v_row.cancel_reason, 'plan_id', v_row.plan_id)
  );

  return v_row;
end;
$$;

revoke all on function public.cancel_subscription(uuid, text) from public;
grant execute on function public.cancel_subscription(uuid, text) to authenticated;

/**
 * Expira trials vencidos e marca atrasos depois da tolerância.
 *
 * Pensada para rodar via cron/pg_cron quando houver cobrança. Hoje é chamável
 * pelo admin (botão "Revisar") e devolve quantas linhas mexeu, sem apagar nada.
 */
create or replace function public.run_subscription_review()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired integer := 0;
  v_past_due integer := 0;
  v_grace integer;
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  select coalesce((value #>> '{}')::integer, 5) into v_grace
  from public.platform_settings where key = 'grace_days';
  v_grace := coalesce(v_grace, 5);

  with alvo as (
    select id from public.subscriptions
    where cancelled_at is null
      and status = 'trial'
      and trial_end is not null
      and trial_end < now()
  )
  update public.subscriptions s
     set status = 'expired', updated_at = now()
    from alvo
   where s.id = alvo.id;
  get diagnostics v_expired = row_count;

  with alvo as (
    select id from public.subscriptions
    where cancelled_at is null
      and status = 'active'
      and current_period_end is not null
      and current_period_end + make_interval(days => v_grace) < now()
  )
  update public.subscriptions s
     set status = 'past_due', updated_at = now()
    from alvo
   where s.id = alvo.id;
  get diagnostics v_past_due = row_count;

  if v_expired + v_past_due > 0 then
    perform public.log_admin_action(
      'subscription.reviewed', 'subscription', null, null,
      jsonb_build_object('expired', v_expired, 'past_due', v_past_due, 'grace_days', v_grace)
    );
  end if;

  return jsonb_build_object('expired', v_expired, 'past_due', v_past_due, 'grace_days', v_grace);
end;
$$;

revoke all on function public.run_subscription_review() from public;
grant execute on function public.run_subscription_review() to authenticated;

-- ----------------------------------------------------------------------------
-- 12. Painel do restaurante: "Meu plano"
-- ----------------------------------------------------------------------------
create or replace function public.my_subscription(p_restaurant_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rest uuid := coalesce(p_restaurant_id, (select restaurant_id from public.restaurant_users
                                             where user_id = auth.uid() and status = 'active'
                                             order by created_at limit 1));
  v_sub  public.subscriptions;
  v_plan public.plans;
  v_days integer;
begin
  if v_rest is null or not (public.is_restaurant_member(v_rest) or public.is_platform_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_sub
  from public.subscriptions
  where restaurant_id = v_rest and cancelled_at is null;

  v_plan := public.restaurant_plan(v_rest);

  select coalesce((value #>> '{}')::integer, 7) into v_days
  from public.platform_settings where key = 'trial_days';

  return jsonb_build_object(
    'restaurant_id', v_rest,
    'status', coalesce(v_sub.status::text, 'expired'),
    'has_subscription', v_sub.id is not null,
    'plan', jsonb_build_object(
      'id', v_plan.id, 'name', v_plan.name, 'description', v_plan.description,
      'price', v_plan.price_monthly, 'interval', v_plan.billing_interval::text,
      'features', v_plan.features, 'limits', v_plan.limits
    ),
    'period_start', v_sub.current_period_start,
    'period_end', v_sub.current_period_end,
    'trial_start', v_sub.trial_start,
    'trial_end', v_sub.trial_end,
    'cancelled_at', v_sub.cancelled_at,
    'price_snapshot', coalesce(v_sub.price_snapshot, v_plan.price_monthly),
    'trial_days', coalesce(v_days, 7),
    'usage', public.restaurant_usage(v_rest)
  );
end;
$$;

revoke all on function public.my_subscription(uuid) from public;
grant execute on function public.my_subscription(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 13. Vitrine pública
-- ----------------------------------------------------------------------------
create or replace function public.public_plans()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_trial integer;
begin
  select coalesce((value #>> '{}')::integer, 7) into v_trial
  from public.platform_settings where key = 'trial_days';

  return jsonb_build_object(
    'trial_days', coalesce(v_trial, 7),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pl.id, 'name', pl.name, 'description', pl.description,
        'price', pl.price_monthly, 'interval', pl.billing_interval::text,
        'features', pl.features, 'limits', pl.limits
      ) order by pl.position, pl.created_at)
      from public.plans pl
      where pl.is_active
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.public_plans() is
  'Vitrine /planos, sem sessão. Devolve só planos ativos e os limites/recursos que os cards mostram.';

revoke all on function public.public_plans() from public;
grant execute on function public.public_plans() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 14. Painel master: planos e assinaturas
-- ----------------------------------------------------------------------------

/** Catálogo completo, inclusive inativos, para a tela de administração. */
create or replace function public.admin_list_plans()
returns setof public.plans
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  return query select * from public.plans order by position asc, created_at asc;
end;
$$;

revoke all on function public.admin_list_plans() from public;
grant execute on function public.admin_list_plans() to authenticated;

/**
 * Cria ou edita plano.
 *
 * `p_id` só é usado na criação; editar não troca o id (há FKs apontando para
 * ele). Desativar é `p_is_active = false` e **não** derruba quem já assina: o
 * espelho `restaurants.plan_id` continua válido e `restaurant_plan` segue
 * devolvendo o plano — inativo significa "não aparece na vitrine".
 */
create or replace function public.admin_save_plan(
  p_id               text,
  p_name             text,
  p_description      text default null,
  p_price            numeric default 0,
  p_interval         public.billing_interval default 'monthly',
  p_is_active        boolean default true,
  p_features         jsonb default '[]'::jsonb,
  p_limits           jsonb default '{}'::jsonb,
  p_position         integer default 0
)
returns public.plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id  text := lower(btrim(coalesce(p_id, '')));
  v_row public.plans;
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  if v_id !~ '^[a-z0-9-]{2,32}$' then
    raise exception 'invalid_plan_id' using errcode = '22023';
  end if;

  if p_name is null or char_length(btrim(p_name)) < 2 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  if p_price is null or p_price < 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;

  if p_features is null or jsonb_typeof(p_features) <> 'array' then
    raise exception 'invalid_features' using errcode = '22023';
  end if;

  if p_limits is null or jsonb_typeof(p_limits) <> 'object' then
    raise exception 'invalid_limits' using errcode = '22023';
  end if;

  -- Limite negativo criaria um plano impossível (0 slots). Recusar cedo.
  if exists (
    select 1 from jsonb_each(p_limits) e
    where jsonb_typeof(e.value) <> 'null'
      and (jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}')::numeric < 0)
  ) then
    raise exception 'invalid_limits' using errcode = '22023';
  end if;

  insert into public.plans as pl (
    id, name, description, price_monthly, billing_interval,
    is_active, features, limits, position
  )
  values (
    v_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
    p_price, p_interval, coalesce(p_is_active, true), p_features, p_limits,
    coalesce(p_position, 0)
  )
  on conflict (id) do update
    set name = excluded.name,
        description = excluded.description,
        price_monthly = excluded.price_monthly,
        billing_interval = excluded.billing_interval,
        is_active = excluded.is_active,
        features = excluded.features,
        limits = excluded.limits,
        position = excluded.position,
        updated_at = now()
  returning * into v_row;

  perform public.log_admin_action(
    'plan.saved', 'plan', null, null,
    jsonb_build_object(
      'plan_id', v_row.id, 'name', v_row.name, 'price', v_row.price_monthly,
      'active', v_row.is_active, 'features', v_row.features, 'limits', v_row.limits
    )
  );

  return v_row;
end;
$$;

revoke all on function public.admin_save_plan(text, text, text, numeric, public.billing_interval, boolean, jsonb, jsonb, integer) from public;
grant execute on function public.admin_save_plan(text, text, text, numeric, public.billing_interval, boolean, jsonb, jsonb, integer) to authenticated;

/** Liga/desliga a vitrine do plano. */
create or replace function public.admin_toggle_plan(p_id text, p_active boolean)
returns public.plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.plans;
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  update public.plans
     set is_active = coalesce(p_active, false), updated_at = now()
   where id = p_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'plan_not_found' using errcode = 'P0002';
  end if;

  perform public.log_admin_action(
    'plan.toggled', 'plan', null, null,
    jsonb_build_object('plan_id', v_row.id, 'active', v_row.is_active)
  );

  return v_row;
end;
$$;

revoke all on function public.admin_toggle_plan(text, boolean) from public;
grant execute on function public.admin_toggle_plan(text, boolean) to authenticated;

/** Lista de assinaturas para a tela /admin/assinaturas. */
create or replace function public.admin_list_subscriptions(p_search text default null)
returns table (
  restaurant_id            uuid,
  restaurant_name          text,
  restaurant_slug          text,
  plan_id                  text,
  plan_name                text,
  price                    numeric,
  status                   public.subscription_state,
  billing_interval         public.billing_interval,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  trial_start              timestamptz,
  trial_end                timestamptz,
  days_left                integer,
  cancelled_at             timestamptz,
  provider                 text,
  external_subscription_id text,
  subscription_id          uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  return query
  select
    r.id,
    r.name::text,
    r.slug::text,
    pl.id,
    pl.name,
    coalesce(s.price_snapshot, pl.price_monthly),
    coalesce(s.status, 'expired'::public.subscription_state),
    coalesce(s.billing_interval, pl.billing_interval),
    s.current_period_start,
    s.current_period_end,
    s.trial_start,
    s.trial_end,
    -- Dias restantes: do trial quando em trial, do período pago nos demais.
    case
      when s.trial_end is not null and s.status = 'trial'
        then greatest(0, ceil(extract(epoch from (s.trial_end - now())) / 86400))::integer
      when s.current_period_end is not null
        then greatest(0, ceil(extract(epoch from (s.current_period_end - now())) / 86400))::integer
      else null
    end,
    s.cancelled_at,
    s.provider,
    s.external_subscription_id,
    s.id
  from public.restaurants r
  join public.plans pl on pl.id = r.plan_id
  left join public.subscriptions s
    on s.restaurant_id = r.id and s.cancelled_at is null
  where v_search is null
     or public.search_key(r.name) like '%' || public.search_key(v_search) || '%'
     or public.search_key(r.slug::text) like '%' || public.search_key(v_search) || '%'
  order by r.name asc;
end;
$$;

revoke all on function public.admin_list_subscriptions(text) from public;
grant execute on function public.admin_list_subscriptions(text) to authenticated;

/** Altera a assinatura de qualquer casa (só plataforma). */
create or replace function public.admin_set_subscription(
  p_restaurant_id uuid,
  p_plan_id       text,
  p_status        public.subscription_state,
  p_interval      public.billing_interval default 'monthly',
  p_period_days   integer default 30
)
returns public.subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.plans;
  v_row  public.subscriptions;
  v_days integer := greatest(1, coalesce(p_period_days, 30));
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  select * into v_plan from public.plans where id = p_plan_id;
  if v_plan.id is null then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;

  if p_status is null then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  -- Mudança de plano/status fecha a corrente e abre outra (histórico preservado).
  -- Só reajustar período não cria linha nova.
  update public.subscriptions
     set cancelled_at = now(), cancel_reason = 'replaced_by_admin', status = 'cancelled'
   where restaurant_id = p_restaurant_id
     and cancelled_at is null
     and (plan_id <> p_plan_id or status <> p_status);

  select * into v_row
  from public.subscriptions
  where restaurant_id = p_restaurant_id and cancelled_at is null;

  if v_row.id is null then
    insert into public.subscriptions (
      restaurant_id, plan_id, status, billing_interval,
      current_period_start, current_period_end,
      trial_start, trial_end, price_snapshot
    )
    values (
      p_restaurant_id, p_plan_id, p_status, p_interval,
      now(), now() + make_interval(days => v_days),
      case when p_status = 'trial' then now() end,
      case when p_status = 'trial' then now() + make_interval(days => v_days) end,
      v_plan.price_monthly
    )
    returning * into v_row;
  else
    update public.subscriptions
       set plan_id = p_plan_id,
           status = p_status,
           billing_interval = p_interval,
           current_period_start = now(),
           current_period_end = now() + make_interval(days => v_days),
           trial_start = case when p_status = 'trial' then coalesce(trial_start, now()) else trial_start end,
           trial_end = case when p_status = 'trial' then now() + make_interval(days => v_days) else trial_end end,
           price_snapshot = v_plan.price_monthly,
           updated_at = now()
     where id = v_row.id
    returning * into v_row;
  end if;

  perform public.log_admin_action(
    'subscription.updated', 'subscription', v_row.id, p_restaurant_id,
    jsonb_build_object('plan_id', p_plan_id, 'status', p_status::text, 'interval', p_interval::text)
  );

  return v_row;
end;
$$;

revoke all on function public.admin_set_subscription(uuid, text, public.subscription_state, public.billing_interval, integer) from public;
grant execute on function public.admin_set_subscription(uuid, text, public.subscription_state, public.billing_interval, integer) to authenticated;

/** Trial e tolerância configuráveis pelo admin (item 7 do escopo). */
create or replace function public.admin_set_platform_setting(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value jsonb := p_value;
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  if p_key not in ('trial_days', 'grace_days') then
    raise exception 'invalid_setting' using errcode = '22023';
  end if;

  if jsonb_typeof(v_value) <> 'number'
     or (v_value #>> '{}')::integer < 0
     or (v_value #>> '{}')::integer > 365 then
    raise exception 'invalid_setting' using errcode = '22023';
  end if;

  insert into public.platform_settings (key, value, updated_at)
  values (p_key, v_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  perform public.log_admin_action(
    'platform.setting_changed', 'platform', null, null,
    jsonb_build_object('key', p_key, 'value', v_value)
  );

  return v_value;
end;
$$;

revoke all on function public.admin_set_platform_setting(text, jsonb) from public;
grant execute on function public.admin_set_platform_setting(text, jsonb) to authenticated;

/** Contadores comerciais do dashboard e das telas de planos/assinaturas. */
create or replace function public.admin_billing_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'plans_total', (select count(*) from public.plans),
    'plans_active', (select count(*) from public.plans where is_active),
    'subscriptions_total', (select count(*) from public.subscriptions where cancelled_at is null),
    'trials', (select count(*) from public.subscriptions where cancelled_at is null and status = 'trial'),
    'active', (select count(*) from public.subscriptions where cancelled_at is null and status = 'active'),
    'past_due', (select count(*) from public.subscriptions where cancelled_at is null and status = 'past_due'),
    'cancelled', (select count(*) from public.subscriptions where status = 'cancelled'),
    'expired', (select count(*) from public.subscriptions where cancelled_at is null and status = 'expired'),
    'mrr', coalesce((
      select sum(s.price_snapshot) from public.subscriptions s
      where s.cancelled_at is null and s.status in ('active', 'past_due')
    ), 0),
    'trial_days', (select coalesce((value #>> '{}')::integer, 7) from public.platform_settings where key = 'trial_days'),
    'grace_days', (select coalesce((value #>> '{}')::integer, 5) from public.platform_settings where key = 'grace_days')
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_billing_summary() from public;
grant execute on function public.admin_billing_summary() to authenticated;

/** Distribuição de casas por plano (cards do /admin/planos). */
create or replace function public.admin_plan_distribution()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'plan_id', pl.id, 'plan_name', pl.name, 'count', coalesce(c.total, 0)
    ) order by pl.position)
    from public.plans pl
    left join (
      select r.plan_id as id, count(*)::integer as total
      from public.restaurants r group by r.plan_id
    ) c on c.id = pl.id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_plan_distribution() from public;
grant execute on function public.admin_plan_distribution() to authenticated;

-- ----------------------------------------------------------------------------
-- 15. Detalhe de suporte passa a mostrar assinatura, histórico e uso
-- ----------------------------------------------------------------------------
create or replace function public.admin_restaurant_detail(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'restaurant', to_jsonb(r),
    'counts', jsonb_build_object(
      'products', (select count(*) from public.products where restaurant_id = r.id),
      'categories', (select count(*) from public.categories where restaurant_id = r.id),
      'tables', (select count(*) from public.tables where restaurant_id = r.id),
      'orders', (select count(*) from public.orders where restaurant_id = r.id),
      'orders_today', (select count(*) from public.orders
                        where restaurant_id = r.id
                          and created_at >= date_trunc('day', now())),
      'members', (select count(*) from public.restaurant_users where restaurant_id = r.id)
    ),
    'subscription', (
      select to_jsonb(s) from public.subscriptions s
      where s.restaurant_id = r.id and s.cancelled_at is null
    ),
    'subscriptions_history', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at desc)
      from public.subscriptions s where s.restaurant_id = r.id
    ), '[]'::jsonb),
    'usage', public.restaurant_usage(r.id),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', ru.user_id, 'email', u.email, 'full_name', u.full_name,
        'role', ru.role, 'status', ru.status, 'created_at', ru.created_at
      ) order by ru.created_at)
      from public.restaurant_users ru
      join public.users u on u.id = ru.user_id
      where ru.restaurant_id = r.id
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'price', p.price,
        'is_available', p.is_available, 'category_name', c.name
      ) order by p.position, p.name)
      from public.products p
      left join public.categories c on c.id = p.category_id
      where p.restaurant_id = r.id
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'is_active', c.is_active,
        'products_count', (select count(*) from public.products p where p.category_id = c.id)
      ) order by c.position, c.name)
      from public.categories c
      where c.restaurant_id = r.id
    ), '[]'::jsonb),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'is_active', t.is_active, 'public_token', t.public_token
      ) order by t.name)
      from public.tables t
      where t.restaurant_id = r.id
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_number', o.order_number, 'status', o.status,
        'total', o.total, 'created_at', o.created_at, 'table_name', t.name
      ) order by o.created_at desc)
      from (
        select * from public.orders where restaurant_id = r.id
        order by created_at desc limit 20
      ) o
      left join public.tables t on t.id = o.table_id
    ), '[]'::jsonb),
    'theme', (select to_jsonb(th) from public.restaurant_themes th where th.restaurant_id = r.id)
  ) into v_result
  from public.restaurants r
  where r.id = p_restaurant_id;

  if v_result is null then
    raise exception 'restaurant_not_found' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

revoke all on function public.admin_restaurant_detail(uuid) from public;
grant execute on function public.admin_restaurant_detail(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 16. Caixa de entrada de webhooks
--
-- Estrutura pronta, sem integração: o dia em que um gateway existir, ele grava
-- aqui e `handleWebhook` (`src/lib/billing`) traduz evento → RPC do banco. O
-- histórico de eventos é visível só para o admin global.
-- ----------------------------------------------------------------------------
create table if not exists public.billing_events (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null check (char_length(provider) between 2 and 32),
  event_type    text not null check (char_length(event_type) between 3 and 64),
  external_id   text,
  restaurant_id uuid references public.restaurants (id) on delete set null,
  payload       jsonb not null default '{}'::jsonb,
  handled       boolean not null default false,
  received_at   timestamptz not null default now()
);

comment on table public.billing_events is
  'Eventos recebidos do gateway (vazia enquanto não há provedor). Nenhuma policy de escrita: só service role grava.';

alter table public.billing_events enable row level security;

drop policy if exists billing_events_select_admin on public.billing_events;
create policy billing_events_select_admin on public.billing_events
  for select to authenticated
  using (public.is_platform_admin());

grant select on public.billing_events to authenticated;

create index if not exists billing_events_received_idx
  on public.billing_events (received_at desc);

-- ----------------------------------------------------------------------------
-- 17. Analyze
-- ----------------------------------------------------------------------------
analyze public.plans;
analyze public.subscriptions;
analyze public.platform_settings;
