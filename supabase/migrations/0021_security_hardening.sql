-- ============================================================================
-- 0021 — Endurecimento de segurança (Etapa 20)
--
-- Duas vulnerabilidades reais encontradas na revisão desta etapa, ambas
-- confirmadas no banco de produção antes de escrever esta migration:
--
--   (1) VAZAMENTO ENTRE CASAS via funções SECURITY DEFINER
--       `restaurant_usage`, `check_plan_limit`, `subscription_days_left` e
--       `restaurant_plan` recebiam `p_restaurant_id` e liam os dados **daquele**
--       tenant sem conferir se quem chamava pertencia a ele. Como
--       `SECURITY DEFINER` roda como dono da função, a RLS não filtra nada:
--       qualquer usuário autenticado lia a contagem de produtos/mesas/usuários
--       e os dias restantes de assinatura de **outra** casa, só variando o uuid.
--
--       Provado em transação de teste:
--         restaurant_usage('<casa de outro dono>')  → used = 2 (vazou)
--         check_plan_limit(...)                     → used = 2 (vazou)
--         subscription_days_left(...)               → não-nulo (vazou)
--
--   (2) AUDITORIA FORJÁVEL
--       `log_admin_action` estava com EXECUTE para `authenticated` e aceitava
--       ação, entidade, restaurante e metadata livres do cliente. Um dono de
--       restaurante gravava `restaurant.suspended` contra a própria casa, e o
--       registro aparecia na tela de auditoria do master com o próprio e-mail
--       como autor. Auditoria que o auditado escreve não serve para nada.
--
-- A correção tem três partes:
--
--   A. As funções auxiliares passam a exigir vínculo (membro da casa, ou admin
--      da plataforma) e o acesso por cliente é revogado. Elas continuam
--      servindo a quem chama **de dentro do banco** (triggers, RPCs DEFINER,
--      policies) — caminho interno não passa por grant.
--   B. `log_admin_action` deixa de ser chamável por cliente.
--   C. A tabela de auditoria ganha um `WHEN OLD`/`WHEN NEW` guard contra
--      reescrita, e entra em modo append-only de verdade.
--
-- Nada aqui muda contrato de tela: as RPCs que o app usa (with tenant checks
-- próprios) seguem iguais.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Auxiliares de plano: negam tenant alheio
-- ----------------------------------------------------------------------------

/**
 * O chamador pode ler dados comerciais desta casa?
 *
 * `auth.uid()` nulo = chamada interna (trigger, RPC DEFINER de outro contexto,
 * job). Nesse caso não há usuário a restringir e a função confia em quem
 * chamou — o que é seguro, porque o cliente não alcança mais esta função.
 */
create or replace function public.can_read_tenant(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_restaurant_id is null then false
    when auth.uid() is null then true
    else public.is_platform_admin() or public.is_restaurant_member(p_restaurant_id)
  end;
$$;

comment on function public.can_read_tenant(uuid) is
  'Guarda de leitura por tenant. Chamada interna (auth.uid() nulo) passa; cliente só passa sendo membro da casa ou admin da plataforma.';

revoke all on function public.can_read_tenant(uuid) from public;
-- Sem grant para `authenticated`/`anon`: uso interno. O harness de segurança
-- verifica justamente que o cliente não alcança.

/**
 * Plano da casa. Antes: qualquer uuid devolvia o plano alheio.
 *
 * `plpgsql` com `if`, e não `sql` com `case`: em SQL o planejador pode avaliar a
 * subconsulta das duas pernas do `case`, e o "ramo negado" ainda executava a
 * junção com `restaurants` — o que, sob RLS, levantava `permission denied`
 * (barrava, mas com o erro errado) e lia a linha mesmo assim. Com `if` o ramo
 * negado não é executado: devolve `null` sem tocar a casa alheia.
 */
create or replace function public.restaurant_plan(p_restaurant_id uuid)
returns public.plans
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan public.plans;
begin
  if not public.can_read_tenant(p_restaurant_id) then
    return null;
  end if;

  select pl.* into v_plan
  from public.plans pl
  join public.restaurants r on r.plan_id = pl.id
  where r.id = p_restaurant_id;

  if v_plan.id is not null then
    return v_plan;
  end if;

  select pl.* into v_plan from public.plans pl where pl.id = 'free';
  if v_plan.id is not null then
    return v_plan;
  end if;

  select pl.* into v_plan from public.plans pl order by pl.position asc limit 1;
  return v_plan;
end;
$$;

/**
 * Uso do plano (contagens). Antes: vazava a contagem de outra casa.
 *
 * Mesmo motivo do `if` acima: `case` em SQL avalia a subconsulta das contagens
 * antes de decidir, então a guarda não bastava — o `if` em plpgsql é o que
 * impede a leitura. Devolve `{}` para quem não é do tenant.
 */
create or replace function public.restaurant_usage(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan  public.plans;
  v_limit_products   integer;
  v_limit_tables     integer;
  v_limit_users      integer;
  v_limit_categories integer;
  v_limit_orders     integer;
begin
  if not public.can_read_tenant(p_restaurant_id) then
    return '{}'::jsonb;
  end if;

  v_plan := public.restaurant_plan(p_restaurant_id);
  v_limit_products   := public.plan_limit(v_plan.id, 'max_products');
  v_limit_tables     := public.plan_limit(v_plan.id, 'max_tables');
  v_limit_users      := public.plan_limit(v_plan.id, 'max_users');
  v_limit_categories := public.plan_limit(v_plan.id, 'max_categories');
  v_limit_orders     := public.plan_limit(v_plan.id, 'max_orders_month');

  return jsonb_build_object(
    'plan_id', v_plan.id,
    'plan_name', v_plan.name,
    'limits', v_plan.limits,
    'features', v_plan.features,
    'products', jsonb_build_object(
      'used', (select count(*) from public.products where restaurant_id = p_restaurant_id),
      'limit', v_limit_products),
    'tables', jsonb_build_object(
      'used', (select count(*) from public.tables where restaurant_id = p_restaurant_id),
      'limit', v_limit_tables),
    'users', jsonb_build_object(
      'used', (select count(*) from public.restaurant_users where restaurant_id = p_restaurant_id and status = 'active'),
      'limit', v_limit_users),
    'categories', jsonb_build_object(
      'used', (select count(*) from public.categories where restaurant_id = p_restaurant_id),
      'limit', v_limit_categories),
    'orders_month', jsonb_build_object(
      'used', (select count(*) from public.orders where restaurant_id = p_restaurant_id and created_at >= date_trunc('month', now())),
      'limit', v_limit_orders)
  );
end;
$$;

/** Limite + uso de uma chave. Antes: vazava a contagem de outra casa. */
create or replace function public.check_plan_limit(p_restaurant_id uuid, p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan public.plans;
  v_limit integer;
  v_used integer;
begin
  if not public.can_read_tenant(p_restaurant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_plan := public.restaurant_plan(p_restaurant_id);
  -- Plano nulo só acontece se a casa não existe; `plan_limit` recebe null e
  -- devolve null, então não há limite a aplicar.
  v_limit := public.plan_limit(v_plan.id, p_key);

  v_used := case p_key
    when 'max_products' then (select count(*) from public.products where restaurant_id = p_restaurant_id)
    when 'max_tables' then (select count(*) from public.tables where restaurant_id = p_restaurant_id)
    when 'max_users' then (select count(*) from public.restaurant_users where restaurant_id = p_restaurant_id and status = 'active')
    when 'max_categories' then (select count(*) from public.categories where restaurant_id = p_restaurant_id)
    when 'max_orders_month' then (select count(*) from public.orders where restaurant_id = p_restaurant_id and created_at >= date_trunc('month', now()))
    else 0
  end;

  return jsonb_build_object(
    'key', p_key, 'plan_id', v_plan.id, 'used', v_used, 'limit', v_limit,
    'allowed', v_limit is null or v_used < v_limit
  );
end;
$$;

/** Recurso do plano. Antes: revelava as features de outra casa. */
create or replace function public.has_feature(p_restaurant_id uuid, p_feature text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan public.plans;
begin
  if not public.can_read_tenant(p_restaurant_id) then
    return false;
  end if;

  v_plan := public.restaurant_plan(p_restaurant_id);
  if v_plan.id is null then
    return false;
  end if;

  return coalesce(v_plan.features ? lower(coalesce(p_feature, '')), false);
end;
$$;

/** Dias restantes de assinatura. Antes: vazava a validade da casa alheia. */
create or replace function public.subscription_days_left(p_restaurant_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer;
begin
  if not public.can_read_tenant(p_restaurant_id) then
    return null;
  end if;

  select case
    when s.id is null then null
    when s.status = 'trial' and s.trial_end is not null
      then greatest(0, ceil(extract(epoch from (s.trial_end - now())) / 86400))::integer
    when s.current_period_end is not null
      then greatest(0, ceil(extract(epoch from (s.current_period_end - now())) / 86400))::integer
    else null
  end
  into v_days
  from public.subscriptions s
  where s.restaurant_id = p_restaurant_id and s.cancelled_at is null;

  return v_days;
end;
$$;

/**
 * Acesso por cliente às auxiliares: revogado.
 *
 * Mantê-las acessíveis era a causa do vazamento. Quem precisa delas é o banco
 * (trigger de limite, policy, RPC DEFINER) e essas chamadas não dependem de
 * grant. Se algum dia uma tela precisar do número, a RPC certa é `my_subscription`
 * ou `restaurant_usage` **com** a guarda acima, exposta por uma função com nome
 * próprio — não um helper genérico aberto.
 */
revoke all on function public.restaurant_plan(uuid) from public, anon, authenticated;
revoke all on function public.restaurant_usage(uuid) from public, anon, authenticated;
revoke all on function public.subscription_days_left(uuid) from public, anon, authenticated;

/*
 * `check_plan_limit` e `has_feature` **continuam** disponíveis ao cliente:
 * `src/lib/data/billing.ts` (`getPlanLimitCheck`) e `src/actions/theme.ts`
 * dependem delas para desabilitar botão e para saber se o tema está no plano.
 * O que muda é o conteúdo: com a guarda `can_read_tenant`, a própria casa passa
 * e a casa alheia recebe `forbidden` / `false` — antes qualquer uuid devolvia o
 * dado do vizinho. Testar antes de revogar é o que separa endurecer de quebrar.
 */
grant execute on function public.check_plan_limit(uuid, text) to authenticated;
grant execute on function public.has_feature(uuid, text) to authenticated;

/**
 * `next_order_number` também era chamável por cliente e recebia o uuid da casa:
 * dava para "queimar" a numeração de pedidos de outra casa (grava no contador).
 * O único chamador legítimo é `create_order` (DEFINER).
 */
revoke all on function public.next_order_number(uuid) from public, anon, authenticated;
grant execute on function public.next_order_number(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- B. Auditoria: só o banco escreve
-- ----------------------------------------------------------------------------

/**
 * `log_admin_action` deixa de ser chamável por cliente.
 *
 * Era o furo (2): qualquer usuário logado gravava a ação que quisesse, contra
 * a casa que quisesse, com o metadata que quisesse — e o master lia aquilo
 * como histórico confiável. Os chamadores legítimos são triggers e RPCs
 * `SECURITY DEFINER`, que não dependem de EXECUTE do cliente.
 */
revoke all on function public.log_admin_action(text, text, uuid, uuid, jsonb) from public, anon, authenticated;

/**
 * Append-only reforçado.
 *
 * Sem policy de UPDATE/DELETE a RLS já barrava o cliente, mas `authenticated`
 * ainda tinha o GRANT de tabela herdado — e um GRANT sem policy só não é
 * explorável enquanto ninguém adicionar uma policy ampla depois. Revogar o
 * privilégio é a garantia que não depende de política futura.
 */
revoke insert, update, delete, truncate on public.admin_audit_log from public, anon, authenticated;
grant select on public.admin_audit_log to authenticated;

/**
 * Guarda de linha: nem o dono da tabela reescreve o passado pela via normal.
 *
 * `admin_confirm_payment` e afins só inserem; nenhum fluxo legítimo atualiza ou
 * apaga auditoria. Se um dia precisar (retenção/LGPD), a rotina roda como
 * `service_role` com a GUC abaixo, e o próprio uso fica explícito no código.
 */
create or replace function public.admin_audit_log_append_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('menuvo.audit_retention', true), '') = 'on' then
    return coalesce(old, new);
  end if;
  raise exception 'audit_log_append_only' using errcode = '42501';
end;
$$;

drop trigger if exists admin_audit_log_no_update on public.admin_audit_log;
create trigger admin_audit_log_no_update
  before update or delete on public.admin_audit_log
  for each row execute function public.admin_audit_log_append_only();

comment on function public.admin_audit_log_append_only() is
  'Recusa UPDATE/DELETE em admin_audit_log. Retenção/LGPD precisa setar menuvo.audit_retention = on na sessão.';

-- ----------------------------------------------------------------------------
-- C. Registro da migration
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, name)
values ('20261122140000', 'stage20_security_hardening')
on conflict (version) do nothing;
