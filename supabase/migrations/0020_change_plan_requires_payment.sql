-- ============================================================================
-- 0020 — `change_plan` deixa de ativar plano pago sem pagamento
--
-- PROBLEMA QUE ISTO FECHA
-- -----------------------
-- A Etapa 19 colocou a cobrança nas mãos do master: o cliente pede o plano,
-- paga no PIX, o master confere e confirma (`admin_confirm_payment`). Só que a
-- RPC da Etapa 11, `change_plan`, continuava aberta ao dono da casa e inseria a
-- assinatura já como `active`, com o preço congelado do catálogo:
--
--     select public.change_plan('<minha casa>', 'premium', 'monthly');
--     → premium / active / 30 dias, sem nenhum PIX pago
--
-- Ou seja: existia um caminho de um comando para ganhar o plano mais caro. A
-- tela nova não chamava essa RPC, mas RPC acessível ao cliente é contrato —
-- quem chama o PostgREST direto não passa pela tela.
--
-- REGRA NOVA
-- ----------
--   • `change_plan` só faz o que não envolve dinheiro:
--       - migrar entre planos **gratuitos** (`price_monthly = 0`);
--       - continuar num plano gratuito (troca de intervalo);
--       - trocar o intervalo de uma assinatura que **já está** no plano pedido;
--       - quando quem chama é admin da plataforma (suporte/MASTER).
--   • qualquer outra tentativa — sair do grátis, subir de plano, ou entrar num
--     plano pago sem assinatura corrente — volta com
--     `payment_required` (erro `22023`), e o app manda o cliente para
--     `/app/pagamento`.
--   • a autoridade sobre assinatura paga passa a ser `admin_confirm_payment`
--     (Etapa 19), que grava `payment_request_id`, `payment_method` e
--     `activated_by`. Não existe um segundo caminho para "ficar ativo".
--
-- O que NÃO muda: o cálculo de downgrade (limites de uso), a auditoria
-- (`subscription.plan_changed`) e a assinatura da função. Nenhuma interface
-- quebra; só passa a recusar o caso que nunca deveria ter sido aceito.
-- ============================================================================

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
  v_plan     public.plans;
  v_current  public.subscriptions;
  v_row      public.subscriptions;
  v_key      text;
  v_limit    integer;
  v_used     integer;
  v_is_admin boolean := public.is_platform_admin();
begin
  if not (v_is_admin or public.is_restaurant_owner_admin(p_restaurant_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_plan from public.plans where id = p_plan_id and is_active;
  if v_plan.id is null then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;

  select * into v_current
  from public.subscriptions
  where restaurant_id = p_restaurant_id and cancelled_at is null;

  -- ------------------------------------------------------------------------
  -- Porta do dinheiro (Etapa 19 + esta correção).
  --
  -- Só passa sem pagamento quem não está comprando nada:
  --   (a) plano de destino gratuito;
  --   (b) já está no mesmo plano (troca de intervalo, sem mudar de valor);
  --   (c) admin da plataforma agindo em suporte.
  --
  -- `v_current.plan_id = p_plan_id` é comparado antes de olhar o preço porque
  -- uma casa que já paga o plano pode trocar mensal↔anual sem um novo PIX —
  -- a alteração de valor nesse caso é assunto de renovação, não de ativação.
  -- ------------------------------------------------------------------------
  if not v_is_admin
     and v_plan.price_monthly > 0
     and (v_current.id is null or v_current.plan_id <> p_plan_id) then
    raise exception 'payment_required' using errcode = '22023';
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
      'interval', p_interval::text, 'by_admin', v_is_admin
    )
  );

  return v_row;
end;
$$;

revoke all on function public.change_plan(uuid, text, public.billing_interval) from public;
grant execute on function public.change_plan(uuid, text, public.billing_interval) to authenticated;

comment on function public.change_plan(uuid, text, public.billing_interval) is
  'Troca de plano sem cobrança. A partir da 0020 só muda entre planos gratuitos ou o intervalo do plano em que a casa já está; plano pago novo exige admin_confirm_payment (payment_required).';

-- ----------------------------------------------------------------------------
-- Registro
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, name)
values ('20261122130000', 'stage19b_change_plan_requires_payment')
on conflict (version) do nothing;
