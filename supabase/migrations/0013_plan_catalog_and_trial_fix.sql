-- ============================================================================
-- Etapa 11 · Correções do catálogo comercial e do teste gratuito
-- ============================================================================
-- Aplicada depois do merge da Etapa 11, ao abrir a produção e ver a vitrine
-- `/planos` real. Três defeitos, todos de dinheiro — nenhum aparecia nos
-- harnesses porque eles partiam de um catálogo que o próprio teste montava:
--
--   1. **Plano sem preço na vitrine.** O plano herdado `pro` (R$ 0,00, limites
--      ilimitados, criado na Etapa 10) estava ativo e aparecia como oferta.
--      Qualquer dono podia escolher "Pro" de graça e ficar sem limite nenhum.
--      A vitrine mostrava 5 planos em vez dos 3 comerciais.
--
--   2. **Acentuação perdida na aplicação.** Os nomes/descrições dos planos
--      novos chegaram ao banco sem acento ("Basico", "Para quem esta
--      comecando"). Os textos foram aplicados com escape unicode para ficarem
--      imunes a reencode de transporte.
--
--   3. **Trial no plano mais caro.** `grant_trial_on_create` escolhia
--      `order by position desc` — o topo da tabela, hoje Premium (ilimitado).
--      Além de entregar o produto mais caro de graça, criava um impasse: ao fim
--      do teste o cliente podia estar acima dos limites do plano que
--      conseguiria pagar, e `change_plan` recusa o downgrade
--      (`plan_downgrade_too_small`). Ele ficava preso entre um plano que não
--      paga e um plano que não consegue comprar.
--
-- Decisões:
--
--   • `free` e `pro` continuam existindo, mas como **planos internos**
--     (`is_active = false`): `restaurant_plan()` ainda precisa de um fallback, e
--     casas antigas podem estar vinculadas a eles. Inativo aqui significa "fora
--     da vitrine", não "inválido".
--
--   • A regra "ativo exige preço" virou **trigger**, não validação de RPC: um
--     insert direto pelo PostgREST com `service_role` também é barrado. A
--     correção não pode depender de todo mundo lembrar de chamar a RPC certa.
--
--   • O plano do teste é **configurável** (`trial_plan_id`) e o padrão é o plano
--     pago **mais barato** — o meio de funil que dá o produto funcionando e cria
--     a razão para subir.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Planos internos saem da vitrine
-- ----------------------------------------------------------------------------
update public.plans
   set is_active = false,
       updated_at = now()
 where id in ('free', 'pro')
   and is_active;

-- ----------------------------------------------------------------------------
-- 2. Acentuação correta dos textos comerciais
--
-- Escape unicode (U&'...') em vez de acento literal: o texto sobrevive a
-- qualquer reencode no caminho até o banco.
-- ----------------------------------------------------------------------------
update public.plans
   set name = U&'B\00e1sico',
       description = U&'Para quem est\00e1 come\00e7ando: card\00e1pio digital, QR Code e pedidos na mesa.',
       updated_at = now()
 where id = 'basico';

update public.plans
   set name = 'Profissional',
       description = U&'A casa em movimento: tema personalizado, NFC, chamar gar\00e7om e pedir a conta.',
       updated_at = now()
 where id = 'profissional';

update public.plans
   set name = 'Premium',
       description = U&'Rede ou casa cheia: limites altos, relat\00f3rios e dom\00ednio pr\00f3prio.',
       updated_at = now()
 where id = 'premium';

-- ----------------------------------------------------------------------------
-- 3. Plano ativo precisa de preço
--
-- Um plano ativo e gratuito com limites ilimitados é uma oferta que ninguém
-- quis fazer. Editar plano inativo continua livre — é assim que se ajusta o
-- fallback interno.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_paid_plan_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_active and new.price_monthly <= 0 then
    raise exception 'invalid_price:plano_ativo_precisa_de_preco' using errcode = '22023';
  end if;
  return new;
end;
$$;

comment on function public.enforce_paid_plan_active() is
  'Plano ativo precisa de preço acima de zero: evita oferecer na vitrine um plano com limites ilimitados de graça.';

drop trigger if exists plans_require_price_when_active on public.plans;
create trigger plans_require_price_when_active
  before insert or update on public.plans
  for each row execute function public.enforce_paid_plan_active();

-- ----------------------------------------------------------------------------
-- 4. Vitrine só com o que é oferta
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
    'trial_plan_id', public.trial_plan(),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pl.id, 'name', pl.name, 'description', pl.description,
        'price', pl.price_monthly, 'interval', pl.billing_interval::text,
        'features', pl.features, 'limits', pl.limits
      ) order by pl.position, pl.created_at)
      from public.plans pl
      where pl.is_active
        and pl.price_monthly > 0
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.public_plans() is
  'Vitrine /planos, sem sessão. Só planos ativos e pagos (o `free` é fallback interno).';

-- ----------------------------------------------------------------------------
-- 5. Troca de plano: plano sem preço não é oferta comercial
--
-- O caminho já era bloqueado por `is_active`, mas um plano pago rebaixado a
-- R$ 0,00 continuaria acessível. A checagem explícita documenta a regra e
-- sobrevive a uma reativação acidental. O admin da plataforma ainda pode forçar
-- qualquer plano por `admin_set_subscription`, que é o caminho auditado.
-- ----------------------------------------------------------------------------
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

  if v_plan.price_monthly <= 0 and not public.is_platform_admin() then
    raise exception 'plan_not_offered' using errcode = '22023';
  end if;

  -- Downgrade respeita o uso: sem isso a casa fica acima do próprio plano e o
  -- próximo insert falha com erro de banco sem explicação para o dono.
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
    update public.subscriptions
       set billing_interval = p_interval, updated_at = now()
     where id = v_current.id
    returning * into v_row;
  elsif v_current.id is not null then
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

-- ----------------------------------------------------------------------------
-- 6. Plano do teste gratuito: configurável, padrão no mais barato
-- ----------------------------------------------------------------------------
insert into public.platform_settings (key, value, description)
values (
  'trial_plan_id',
  to_jsonb(coalesce(
    (select id from public.plans where is_active and price_monthly > 0
      order by price_monthly asc, position asc limit 1),
    'basico'
  )),
  'Plano concedido durante o teste gratuito. Vazio = plano pago mais barato.'
)
on conflict (key) do nothing;

create or replace function public.trial_plan()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    -- 1º: plano configurado, se ainda existir, estiver ativo e tiver preço.
    (select pl.id from public.plans pl
      where pl.id = (select value #>> '{}' from public.platform_settings where key = 'trial_plan_id')
        and pl.is_active and pl.price_monthly > 0),
    -- 2º: plano pago mais barato da vitrine.
    (select pl.id from public.plans pl
      where pl.is_active and pl.price_monthly > 0
      order by pl.price_monthly asc, pl.position asc limit 1),
    -- 3º: qualquer ativo — nunca deixa casa nova sem plano.
    (select pl.id from public.plans pl where pl.is_active order by pl.position limit 1),
    'free'
  );
$$;

comment on function public.trial_plan() is
  'Plano concedido no teste gratuito: trial_plan_id se válido, senão o plano pago mais barato. Nunca o mais caro — evita trial ilimitado e downgrade impossível.';

revoke all on function public.trial_plan() from public;
grant execute on function public.trial_plan() to authenticated;

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

  -- 0 dias = trial desligado: a casa nasce no plano interno `free` e precisa
  -- escolher um plano para publicar.
  if v_days <= 0 then
    return new;
  end if;

  v_plan := public.trial_plan();

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

  -- Trial é uma vez só por casa: se já houve qualquer assinatura, não cria outra.
  if exists (select 1 from public.subscriptions s where s.restaurant_id = v_rest) then
    raise exception 'trial_already_used' using errcode = '23505';
  end if;

  select coalesce((value #>> '{}')::integer, 7) into v_days
  from public.platform_settings where key = 'trial_days';
  v_days := coalesce(v_days, 7);

  if v_days <= 0 then
    raise exception 'trial_disabled' using errcode = '23514';
  end if;

  v_plan := coalesce(
    (select pl.id from public.plans pl where pl.id = p_plan_id and pl.is_active),
    public.trial_plan()
  );

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

-- ----------------------------------------------------------------------------
-- 7. Configuração: `trial_plan_id` como texto, dias como número
-- ----------------------------------------------------------------------------
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

  if p_key in ('trial_days', 'grace_days') then
    if jsonb_typeof(v_value) <> 'number'
       or (v_value #>> '{}')::integer < 0
       or (v_value #>> '{}')::integer > 365 then
      raise exception 'invalid_setting' using errcode = '22023';
    end if;
  elsif p_key = 'trial_plan_id' then
    if jsonb_typeof(v_value) <> 'string'
       or not exists (select 1 from public.plans where id = (v_value #>> '{}') and is_active) then
      raise exception 'invalid_setting' using errcode = '22023';
    end if;
  else
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

analyze public.plans;
