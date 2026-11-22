-- ============================================================================
-- Etapa 19 · Cobrança manual via PIX
-- ============================================================================
-- O cliente paga no PIX do dono da plataforma; o administrador confere e
-- confirma à mão. Não há gateway, não há webhook e **nada** neste arquivo
-- finge confirmação automática:
--
--   1. **PIX manual é um pedido, não um pagamento.** `payment_requests` guarda
--      a *solicitação* ("a casa Famintos quer o plano Profissional por
--      R$ 99,90 mensais em MANUAL_PIX"). Ela nasce PENDING e só sai disso por
--      decisão de um administrador da plataforma. Nenhum caminho do banco
--      marca CONFIRMED por tempo, por upload de comprovante ou por chamada do
--      restaurante.
--
--   2. **O valor vem do banco.** `request_plan_payment` aceita `plan_id` e
--      intervalo — nunca `amount`. O preço é lido de `plans` e congelado em
--      `payment_requests.amount` (histórico preserva o preço da época, mesmo
--      que o catálogo mude depois).
--
--   3. **Confirmar pagamento ≠ escrever status.** Confirmar é uma RPC guardada
--      por `is_platform_admin()` que (a) fecha a solicitação, (b) escreve a
--      assinatura em `subscriptions` — a mesma estrutura da Etapa 11, sem
--      segunda tabela de assinaturas — e (c) grava auditoria
--      `MANUAL_PAYMENT_CONFIRMED`. Se qualquer passo falhar, nada acontece.
--
--   4. **O restaurante só lê e só pede.** As RPCs do cliente criam a
--      solicitação, anexam comprovante (opcional) e devolvem a lista. Não
--      existe policy de update em `payment_requests` para `authenticated`:
--      o status é intocável pelo cliente, inclusive o próprio cancelamento,
--      que é decisão da plataforma.
--
--   5. **Configuração do PIX é global e fechada.** Uma linha só em
--      `payment_settings`, mutável apenas por `is_platform_owner()`
--      (MASTER_ADMIN) e lida pelo restaurante via RPC que devolve **somente**
--      os campos de recebimento — nada de credencial, nada de infra.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tipos
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_request_status') then
    -- Valores em maiúsculas porque são o vocabulário do escopo desta etapa
    -- (PENDING/CONFIRMED/REJECTED/CANCELLED), diferentes do enum de estado de
    -- assinatura — que descreve o contrato, não a solicitação de pagamento.
    create type public.payment_request_status as enum (
      'PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_request_method') then
    -- Um valor só, de propósito. `MANUAL_PIX` é o que existe de verdade hoje;
    -- cartão/transferência entram aqui no dia em que existirem, e o provedor
    -- real (Stripe/MP/Asaas) ganha um valor próprio em vez de fingir ser PIX.
    create type public.payment_request_method as enum ('MANUAL_PIX');
  end if;
end
$$;

comment on type public.payment_request_status is
  'Ciclo da solicitação de pagamento. Só um administrador da plataforma sai de PENDING.';
comment on type public.payment_request_method is
  'Forma de pagamento da assinatura. Hoje apenas MANUAL_PIX (confirmação humana).';

-- ----------------------------------------------------------------------------
-- 2. Configuração global do PIX (linha única)
-- ----------------------------------------------------------------------------
create table if not exists public.payment_settings (
  -- Linha única: `id` booleano com `check (id)` impede a segunda linha sem
  -- precisar de trigger. Ler é `select ... where id`.
  id              boolean primary key default true check (id),
  recipient_name  text check (recipient_name is null or char_length(btrim(recipient_name)) between 2 and 80),
  pix_key         text check (pix_key is null or char_length(btrim(pix_key)) between 3 and 140),
  -- Tipo da chave é só rótulo para a tela ("CPF", "CNPJ", "e-mail", "telefone",
  -- "aleatória"). O banco não valida formato de chave PIX: formatos mudam por
  -- instituição e uma validação errada bloquearia um PIX que funciona.
  pix_key_type    text check (pix_key_type is null or pix_key_type in ('cpf', 'cnpj', 'email', 'phone', 'random')),
  instructions    text check (instructions is null or char_length(instructions) <= 600),
  -- QR Code é opcional: o caminho é do bucket `payment-assets`, servido
  -- publicamente. Sem QR, a tela mostra a chave copiável (que é o que resolve).
  qr_code_url     text,
  is_active       boolean not null default false,
  updated_by      uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.payment_settings is
  'Dados de recebimento PIX da plataforma (Etapa 19). Linha única; escrita só por MASTER_ADMIN.';

insert into public.payment_settings (id) values (true) on conflict (id) do nothing;

alter table public.payment_settings enable row level security;

-- Sem policy de select/insert/update: nem o restaurante nem o admin leem a
-- tabela direto. Leitura e escrita passam pelas RPCs abaixo, que já recortam o
-- que cada papel pode ver. Isso evita uma policy "any authenticated" que
-- exporia `updated_by` e qualquer coluna futura sem ninguém notar.
revoke all on public.payment_settings from anon, authenticated;

drop trigger if exists payment_settings_touch_updated_at on public.payment_settings;
create trigger payment_settings_touch_updated_at
  before update on public.payment_settings
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Solicitações de pagamento
-- ----------------------------------------------------------------------------
create table if not exists public.payment_requests (
  id                    uuid primary key default gen_random_uuid(),
  restaurant_id         uuid not null references public.restaurants (id) on delete cascade,
  -- Quem pediu. `set null` para o histórico sobreviver à exclusão da conta.
  user_id               uuid references public.users (id) on delete set null,
  plan_id               text not null references public.plans (id),
  -- Snapshot do nome: renomear o plano depois não reescreve o passado.
  plan_name             text not null,
  billing_interval      public.billing_interval not null default 'monthly',
  -- Valor oficial lido de `plans` no momento da solicitação.
  amount                numeric(10, 2) not null check (amount >= 0),
  payment_method        public.payment_request_method not null default 'MANUAL_PIX',
  status                public.payment_request_status not null default 'PENDING',
  -- Comprovante é opcional e **não** confirma nada: só dá ao admin o que olhar.
  receipt_path          text,
  receipt_note          text check (receipt_note is null or char_length(receipt_note) <= 280),
  receipt_uploaded_at   timestamptz,
  -- Referência informada pelo admin ao conferir (id fim-a-fim do PIX, etc.).
  transaction_reference text check (transaction_reference is null or char_length(transaction_reference) <= 140),
  notes                 text check (notes is null or char_length(notes) <= 500),
  rejection_reason      text check (rejection_reason is null or char_length(rejection_reason) <= 280),
  paid_at               timestamptz,
  confirmed_at          timestamptz,
  confirmed_by          uuid references public.users (id) on delete set null,
  -- Preenchida na confirmação: qual assinatura este pagamento ativou.
  subscription_id       uuid references public.subscriptions (id) on delete set null,
  -- Quantos dias o período concedido teve (30 mensal / 365 anual, ou ajuste
  -- manual do admin com auditoria).
  period_days           integer check (period_days is null or period_days between 1 and 3660),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint payment_requests_confirmed_check
    check (status <> 'CONFIRMED' or (confirmed_at is not null and confirmed_by is not null)),
  constraint payment_requests_rejected_check
    check (status <> 'REJECTED' or rejection_reason is not null)
);

comment on table public.payment_requests is
  'Pedido de pagamento manual da assinatura (Etapa 19). Valor vem de plans; status só sai de PENDING pela plataforma.';

comment on column public.payment_requests.amount is
  'Preço oficial do plano no momento da solicitação. O frontend nunca informa valor.';

-- Uma solicitação pendente por casa: pedir de novo substitui a anterior em vez
-- de acumular pedidos que o admin teria de conferir um por um.
create unique index if not exists payment_requests_one_pending_uidx
  on public.payment_requests (restaurant_id)
  where status = 'PENDING';

create index if not exists payment_requests_restaurant_idx
  on public.payment_requests (restaurant_id, created_at desc);
create index if not exists payment_requests_status_idx
  on public.payment_requests (status, created_at desc);

drop trigger if exists payment_requests_touch_updated_at on public.payment_requests;
create trigger payment_requests_touch_updated_at
  before update on public.payment_requests
  for each row execute function public.touch_updated_at();

alter table public.payment_requests enable row level security;

-- Membro da casa lê o histórico da própria casa. Nenhuma policy de insert,
-- update ou delete: quem escreve são as RPCs `security definer` — inclusive o
-- upload de comprovante, que revalida o vínculo e o prefixo do caminho.
drop policy if exists payment_requests_select_member on public.payment_requests;
create policy payment_requests_select_member on public.payment_requests
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

grant select on public.payment_requests to authenticated;
revoke insert, update, delete on public.payment_requests from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Vínculo da assinatura com o pagamento
-- ----------------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists payment_request_id uuid references public.payment_requests (id) on delete set null,
  add column if not exists payment_method public.payment_request_method,
  add column if not exists activated_by uuid references public.users (id) on delete set null,
  add column if not exists activated_at timestamptz;

comment on column public.subscriptions.payment_request_id is
  'Solicitação de pagamento que ativou/renovou este período (nulo em trial e em mudança sem cobrança).';
comment on column public.subscriptions.activated_by is
  'Quem confirmou o pagamento. Preenchido só em ativação manual (Etapa 19).';

create index if not exists subscriptions_payment_request_idx
  on public.subscriptions (payment_request_id);

-- ----------------------------------------------------------------------------
-- 5. Storage: QR Code do PIX
-- ----------------------------------------------------------------------------
-- Bucket separado do `restaurant-assets` porque lá a escrita é por tenant e o
-- QR do PIX é da plataforma: reaproveitar o bucket exigiria abrir uma exceção
-- para o admin global dentro de uma policy de restaurante.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-assets',
  'payment-assets',
  true,
  524288, -- 512 KB: um QR Code PNG cabe em poucos KB
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do nothing;

drop policy if exists payment_assets_public_read on storage.objects;
create policy payment_assets_public_read on storage.objects
  for select to public
  using (bucket_id = 'payment-assets');

drop policy if exists payment_assets_admin_write on storage.objects;
create policy payment_assets_admin_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payment-assets' and public.is_platform_admin());

drop policy if exists payment_assets_admin_update on storage.objects;
create policy payment_assets_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'payment-assets' and public.is_platform_admin());

-- ----------------------------------------------------------------------------
-- 5b. Storage: comprovantes (privado)
-- ----------------------------------------------------------------------------
-- Comprovante é dado financeiro: fica em bucket **privado**, com caminho
-- `{restaurant_id}/receipts/...`. O primeiro segmento é o tenant, como no
-- bucket de imagens, e é ele que a policy confere — um restaurante não
-- consegue escrever no diretório de outro nem listar o que não é seu.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-receipts',
  'payment-receipts',
  false,
  5242880, -- 5 MB
  array['image/png','image/jpeg','image/webp','application/pdf']
)
on conflict (id) do nothing;

drop policy if exists payment_receipts_admin_read on storage.objects;
create policy payment_receipts_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'payment-receipts' and public.is_platform_admin());

drop policy if exists payment_receipts_member_read on storage.objects;
create policy payment_receipts_member_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-receipts'
    and public.is_restaurant_owner_admin(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists payment_receipts_member_write on storage.objects;
create policy payment_receipts_member_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payment-receipts'
    and public.is_restaurant_owner_admin(((storage.foldername(name))[1])::uuid)
  );

-- ----------------------------------------------------------------------------
-- 6. Quem é MASTER_ADMIN
-- ----------------------------------------------------------------------------
/**
 * Dono da plataforma.
 *
 * `is_platform_admin()` abre o painel inteiro (Etapa 10). Mexer no **dado de
 * recebimento do dinheiro** é um degrau acima: só quem está como `owner` em
 * `platform_admins`. Um admin operacional confirma pagamentos e enxerga o PIX,
 * mas não troca a chave para a própria conta.
 */
create or replace function public.is_platform_owner()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = auth.uid() and pa.role = 'owner'
  );
$$;

comment on function public.is_platform_owner() is
  'true quando o usuário é MASTER_ADMIN (role owner em platform_admins).';

revoke all on function public.is_platform_owner() from public;
grant execute on function public.is_platform_owner() to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Dias do período por intervalo
-- ----------------------------------------------------------------------------
/**
 * Duração de um ciclo de cobrança em dias.
 *
 * Mensal = 30, anual = 365 (o escopo é explícito). Não usamos `interval '1
 * month'` porque o mesmo "mês" tem 28, 30 ou 31 dias e o cliente que paga em
 * 31/01 não pode perder um dia sem ninguém entender por quê.
 */
create or replace function public.billing_period_days(p_interval public.billing_interval)
returns integer
language sql
immutable
as $$
  select case when p_interval = 'yearly' then 365 else 30 end;
$$;

revoke all on function public.billing_period_days(public.billing_interval) from public;
grant execute on function public.billing_period_days(public.billing_interval) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. Restaurante: ler instruções e pedir o pagamento
-- ----------------------------------------------------------------------------

/**
 * Instruções de PIX para o cliente.
 *
 * Devolve **apenas** os campos de recebimento: nome do recebedor, chave, tipo,
 * instruções e URL do QR. Nada de `updated_by`, nada de outra configuração da
 * plataforma. `is_active = false` desliga a cobrança: a tela mostra que o PIX
 * não está disponível e a solicitação é recusada abaixo.
 */
create or replace function public.my_payment_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.payment_settings;
begin
  if auth.uid() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_row from public.payment_settings where id;

  if v_row.id is null then
    return jsonb_build_object('is_active', false);
  end if;

  return jsonb_build_object(
    'is_active', v_row.is_active,
    'recipient_name', v_row.recipient_name,
    'pix_key', v_row.pix_key,
    'pix_key_type', v_row.pix_key_type,
    'instructions', v_row.instructions,
    'qr_code_url', v_row.qr_code_url,
    -- "Configurado" ≠ "ligado": sem chave não há para onde pagar, mesmo com
    -- is_active = true por engano.
    'is_configured', v_row.pix_key is not null and btrim(v_row.pix_key) <> ''
  );
end;
$$;

revoke all on function public.my_payment_settings() from public;
grant execute on function public.my_payment_settings() to authenticated;

/**
 * Cria a solicitação de pagamento de um plano.
 *
 * Regras:
 *   • só owner/admin da casa (ou admin da plataforma) pede;
 *   • plano precisa existir, estar ativo e ter preço > 0 — plano grátis se
 *     contrata por `change_plan`, não por PIX;
 *   • **o valor é lido de `plans`**, nunca do payload (anual = 12 mensalidades,
 *     porque não existe coluna de preço anual no catálogo);
 *   • PIX precisa estar ligado e configurado, senão a tela mandaria o cliente
 *     pagar para uma chave vazia;
 *   • uma pendente por casa: a nova substitui a antiga, em vez de acumular.
 */
create or replace function public.request_plan_payment(
  p_plan_id       text,
  p_interval      public.billing_interval default 'monthly',
  p_restaurant_id uuid default null
)
returns public.payment_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rest   uuid := coalesce(p_restaurant_id, (select restaurant_id from public.restaurant_users
                                               where user_id = auth.uid() and status = 'active'
                                               order by created_at limit 1));
  v_plan   public.plans;
  v_amount numeric(10, 2);
  v_settings public.payment_settings;
  v_row    public.payment_requests;
begin
  if v_rest is null then
    raise exception 'restaurant_not_found' using errcode = 'P0002';
  end if;

  if not (public.is_platform_admin() or public.is_restaurant_owner_admin(v_rest)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_plan from public.plans where id = p_plan_id and is_active;
  if v_plan.id is null then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;

  if v_plan.price_monthly <= 0 then
    raise exception 'plan_is_free' using errcode = '22023';
  end if;

  select * into v_settings from public.payment_settings where id;
  if v_settings.id is null
     or not v_settings.is_active
     or v_settings.pix_key is null
     or btrim(v_settings.pix_key) = '' then
    raise exception 'pix_not_configured' using errcode = '22023';
  end if;

  -- Anual sem coluna de preço próprio: 12 mensalidades, sem inventar desconto.
  v_amount := case
    when p_interval = 'yearly' then round(v_plan.price_monthly * 12, 2)
    else v_plan.price_monthly
  end;

  -- Substitui a pendente anterior (se houver) em vez de deixar duas.
  update public.payment_requests
     set status = 'CANCELLED',
         notes = coalesce(notes || ' · ', '') || 'substituída por nova solicitação'
   where restaurant_id = v_rest and status = 'PENDING';

  insert into public.payment_requests (
    restaurant_id, user_id, plan_id, plan_name, billing_interval,
    amount, payment_method, status
  )
  values (
    v_rest, auth.uid(), v_plan.id, v_plan.name, p_interval,
    v_amount, 'MANUAL_PIX', 'PENDING'
  )
  returning * into v_row;

  perform public.log_admin_action(
    'payment.requested', 'payment_request', v_row.id, v_rest,
    jsonb_build_object(
      'plan_id', v_plan.id,
      'plan_name', v_plan.name,
      'amount', v_amount,
      'method', 'MANUAL_PIX',
      'interval', p_interval::text
    )
  );

  return v_row;
end;
$$;

revoke all on function public.request_plan_payment(text, public.billing_interval, uuid) from public;
grant execute on function public.request_plan_payment(text, public.billing_interval, uuid) to authenticated;

/**
 * Anexa comprovante a uma solicitação pendente.
 *
 * O arquivo é enviado pelo navegador para o bucket privado `payment-receipts`,
 * no caminho `{restaurant_id}/receipts/...`; aqui só guardamos a referência e
 * conferimos que o caminho é do próprio tenant. Comprovante **não** confirma
 * pagamento — quem confirma é gente, olhando o extrato.
 */
create or replace function public.attach_payment_receipt(
  p_request_id uuid,
  p_path       text,
  p_note       text default null
)
returns public.payment_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payment_requests;
begin
  select * into v_row from public.payment_requests where id = p_request_id;

  if v_row.id is null then
    raise exception 'payment_request_not_found' using errcode = 'P0002';
  end if;

  if not (public.is_platform_admin() or public.is_restaurant_owner_admin(v_row.restaurant_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_row.status <> 'PENDING' then
    raise exception 'payment_not_pending' using errcode = '22023';
  end if;

  if p_path is null
     or p_path not like v_row.restaurant_id::text || '/receipts/%'
     or p_path !~ '\.(png|jpg|jpeg|webp|pdf)$' then
    raise exception 'invalid_receipt_path' using errcode = '22023';
  end if;

  if p_note is not null and char_length(p_note) > 280 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;

  update public.payment_requests
     set receipt_path = p_path,
         receipt_note = nullif(btrim(coalesce(p_note, '')), ''),
         receipt_uploaded_at = now()
   where id = p_request_id
  returning * into v_row;

  perform public.log_admin_action(
    'payment.receipt_uploaded', 'payment_request', v_row.id, v_row.restaurant_id,
    jsonb_build_object('receipt_path', p_path)
  );

  return v_row;
end;
$$;

revoke all on function public.attach_payment_receipt(uuid, text, text) from public;
grant execute on function public.attach_payment_receipt(uuid, text, text) to authenticated;

/**
 * Painel de pagamentos do restaurante logado.
 *
 * Junta, numa chamada só: instruções de PIX, a solicitação pendente (se houver),
 * as cinco últimas do histórico e o estado comercial da assinatura. É o que a
 * tela de pagamento e o cartão do dashboard precisam para dizer em qual dos
 * seis estados o cliente está — sem o cliente calcular nada.
 */
create or replace function public.my_payment_panel(p_restaurant_id uuid default null)
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
  v_settings public.payment_settings;
  v_pending  public.payment_requests;
  v_sub      public.subscriptions;
  v_pending_count integer := 0;
begin
  if v_rest is null or not (public.is_restaurant_member(v_rest) or public.is_platform_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_settings from public.payment_settings where id;
  select * into v_pending from public.payment_requests
   where restaurant_id = v_rest and status = 'PENDING'
   order by created_at desc limit 1;

  select * into v_sub from public.subscriptions
   where restaurant_id = v_rest and cancelled_at is null;

  select count(*) into v_pending_count
   from public.payment_requests where restaurant_id = v_rest and status = 'PENDING';

  return jsonb_build_object(
    'restaurant_id', v_rest,
    'pix', jsonb_build_object(
      'is_active', coalesce(v_settings.is_active, false),
      'is_configured', coalesce(v_settings.pix_key is not null and btrim(v_settings.pix_key) <> '', false),
      'recipient_name', v_settings.recipient_name,
      'pix_key', v_settings.pix_key,
      'pix_key_type', v_settings.pix_key_type,
      'instructions', v_settings.instructions,
      'qr_code_url', v_settings.qr_code_url
    ),
    'pending', case when v_pending.id is null then null else jsonb_build_object(
      'id', v_pending.id,
      'plan_id', v_pending.plan_id,
      'plan_name', v_pending.plan_name,
      'amount', v_pending.amount,
      'billing_interval', v_pending.billing_interval::text,
      'payment_method', v_pending.payment_method::text,
      'status', v_pending.status::text,
      'receipt_path', v_pending.receipt_path,
      'receipt_note', v_pending.receipt_note,
      'created_at', v_pending.created_at
    ) end,
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pr.id,
        'plan_id', pr.plan_id,
        'plan_name', pr.plan_name,
        'amount', pr.amount,
        'billing_interval', pr.billing_interval::text,
        'payment_method', pr.payment_method::text,
        'status', pr.status::text,
        'receipt_path', pr.receipt_path,
        'rejection_reason', pr.rejection_reason,
        'created_at', pr.created_at,
        'confirmed_at', pr.confirmed_at
      ) order by pr.created_at desc)
      from (
        select * from public.payment_requests
        where restaurant_id = v_rest and status <> 'PENDING'
        -- `id` desempata só para o resultado ser **determinístico** quando duas
        -- linhas têm o mesmo `created_at` (só acontece dentro de uma mesma
        -- transação, porque `now()` é o início da transação — em uso normal
        -- cada RPC tem timestamp próprio).
        order by created_at desc, id desc limit 5
      ) pr
    ), '[]'::jsonb),
    'subscription', jsonb_build_object(
      'status', coalesce(v_sub.status::text, 'expired'),
      'has_subscription', v_sub.id is not null,
      'plan_id', v_sub.plan_id,
      'period_start', v_sub.current_period_start,
      'period_end', v_sub.current_period_end,
      'trial_end', v_sub.trial_end,
      'days_left', case
        when v_sub.id is null then null
        when v_sub.status = 'trial' and v_sub.trial_end is not null
          then greatest(0, ceil(extract(epoch from (v_sub.trial_end - now())) / 86400))::integer
        when v_sub.current_period_end is not null
          then greatest(0, ceil(extract(epoch from (v_sub.current_period_end - now())) / 86400))::integer
        else null
      end
    )
  );
end;
$$;

revoke all on function public.my_payment_panel(uuid) from public;
grant execute on function public.my_payment_panel(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. Administrador: listar, ver, confirmar, rejeitar
-- ----------------------------------------------------------------------------

/** Lista de solicitações para o painel master. `p_status` nulo = todas. */
create or replace function public.admin_list_payment_requests(
  p_status text default null,
  p_search text default null
)
returns table (
  id                    uuid,
  restaurant_id         uuid,
  restaurant_name       text,
  restaurant_slug       text,
  requester_name        text,
  requester_email       text,
  plan_id               text,
  plan_name             text,
  billing_interval      public.billing_interval,
  amount                numeric,
  payment_method        public.payment_request_method,
  status                public.payment_request_status,
  receipt_path          text,
  receipt_uploaded_at   timestamptz,
  transaction_reference text,
  rejection_reason      text,
  created_at            timestamptz,
  confirmed_at          timestamptz,
  period_days           integer,
  subscription_id       uuid,
  confirmed_by_email    text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_status public.payment_request_status;
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  if p_status is not null and btrim(p_status) <> '' then
    -- Cast explícito: valor inválido vira erro conhecido em vez de lista vazia
    -- silenciosa (que faria o admin achar que não há pagamento pendente).
    begin
      v_status := p_status::public.payment_request_status;
    exception when invalid_text_representation then
      raise exception 'invalid_status' using errcode = '22023';
    end;
  end if;

  return query
  select
    pr.id, pr.restaurant_id, r.name::text, r.slug::text,
    coalesce(u.full_name, split_part(coalesce(u.email::text, ''), '@', 1)),
    u.email::text,
    pr.plan_id, pr.plan_name, pr.billing_interval, pr.amount,
    pr.payment_method, pr.status,
    pr.receipt_path, pr.receipt_uploaded_at, pr.transaction_reference,
    pr.rejection_reason, pr.created_at, pr.confirmed_at, pr.period_days,
    pr.subscription_id, cb.email::text
  from public.payment_requests pr
  join public.restaurants r on r.id = pr.restaurant_id
  left join public.users u on u.id = pr.user_id
  left join public.users cb on cb.id = pr.confirmed_by
  where (v_status is null or pr.status = v_status)
    and (
      v_search is null
      or public.search_key(r.name) like '%' || public.search_key(v_search) || '%'
      or public.search_key(coalesce(u.full_name, '')) like '%' || public.search_key(v_search) || '%'
      or public.search_key(coalesce(u.email::text, '')) like '%' || public.search_key(v_search) || '%'
      or public.search_key(pr.plan_name) like '%' || public.search_key(v_search) || '%'
    )
  order by
    case pr.status when 'PENDING' then 0 else 1 end,
    pr.created_at desc
  limit 200;
end;
$$;

revoke all on function public.admin_list_payment_requests(text, text) from public;
grant execute on function public.admin_list_payment_requests(text, text) to authenticated;

/** Detalhe de uma solicitação + estado atual da assinatura da casa. */
create or replace function public.admin_payment_request(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_req public.payment_requests;
  v_rest public.restaurants;
  v_sub public.subscriptions;
  v_req_user public.users;
  v_confirmed_by public.users;
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  select * into v_req from public.payment_requests where id = p_id;
  if v_req.id is null then
    raise exception 'payment_request_not_found' using errcode = 'P0002';
  end if;

  select * into v_rest from public.restaurants where id = v_req.restaurant_id;
  select * into v_sub from public.subscriptions
   where restaurant_id = v_req.restaurant_id and cancelled_at is null;
  select * into v_req_user from public.users where id = v_req.user_id;
  select * into v_confirmed_by from public.users where id = v_req.confirmed_by;

  return jsonb_build_object(
    'id', v_req.id,
    'restaurant_id', v_req.restaurant_id,
    'restaurant_name', v_rest.name,
    'restaurant_slug', v_rest.slug,
    'requester_name', coalesce(v_req_user.full_name, split_part(coalesce(v_req_user.email::text, ''), '@', 1)),
    'requester_email', v_req_user.email::text,
    'plan_id', v_req.plan_id,
    'plan_name', v_req.plan_name,
    'billing_interval', v_req.billing_interval::text,
    'amount', v_req.amount,
    'payment_method', v_req.payment_method::text,
    'status', v_req.status::text,
    'receipt_path', v_req.receipt_path,
    'receipt_note', v_req.receipt_note,
    'receipt_uploaded_at', v_req.receipt_uploaded_at,
    'transaction_reference', v_req.transaction_reference,
    'rejection_reason', v_req.rejection_reason,
    'notes', v_req.notes,
    'created_at', v_req.created_at,
    'paid_at', v_req.paid_at,
    'confirmed_at', v_req.confirmed_at,
    'confirmed_by_email', v_confirmed_by.email::text,
    'period_days', v_req.period_days,
    'subscription_id', v_req.subscription_id,
    'subscription', jsonb_build_object(
      'status', coalesce(v_sub.status::text, 'expired'),
      'plan_id', v_sub.plan_id,
      'period_start', v_sub.current_period_start,
      'period_end', v_sub.current_period_end,
      'trial_end', v_sub.trial_end
    )
  );
end;
$$;

revoke all on function public.admin_payment_request(uuid) from public;
grant execute on function public.admin_payment_request(uuid) to authenticated;

/**
 * Confirma o pagamento e ativa/renova a assinatura.
 *
 * É a única porta que transforma dinheiro em acesso. Passos, todos na mesma
 * transação — se um falhar, nenhum vale:
 *
 *   1. guarda de plataforma e status PENDING (confirmar duas vezes não dobra
 *      período nem reescreve a data);
 *   2. fecha a solicitação com autor, data e referência;
 *   3. fecha a assinatura corrente (se houver) e abre a nova em
 *      `subscriptions`, com preço congelado, vínculo ao pedido e
 *      `payment_method = MANUAL_PIX`;
 *   4. registra `MANUAL_PAYMENT_CONFIRMED` no `admin_audit_log`.
 *
 * `p_period_days` é o ajuste manual do MASTER_ADMIN (ex.: conceder 5 dias de
 * bônus por um atraso nosso). Sem ele, o período vem do intervalo do plano:
 * 30 dias mensal, 365 anual.
 */
create or replace function public.admin_confirm_payment(
  p_id            uuid,
  p_reference     text default null,
  p_period_days   integer default null,
  p_note          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req      public.payment_requests;
  v_sub      public.subscriptions;
  v_new      public.subscriptions;
  v_days     integer;
  v_start    timestamptz := now();
  v_end      timestamptz;
  v_plan     public.plans;
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  select * into v_req from public.payment_requests where id = p_id for update;
  if v_req.id is null then
    raise exception 'payment_request_not_found' using errcode = 'P0002';
  end if;

  if v_req.status <> 'PENDING' then
    raise exception 'payment_not_pending' using errcode = '22023';
  end if;

  if p_reference is not null and char_length(btrim(p_reference)) > 140 then
    raise exception 'reference_too_long' using errcode = '22023';
  end if;

  -- Ajuste de período é privilégio do MASTER_ADMIN: um admin operacional
  -- confirma, mas não decide quantos dias o cliente ganha.
  if p_period_days is not null and not public.is_platform_owner() then
    raise exception 'period_override_forbidden' using errcode = '42501';
  end if;

  v_days := coalesce(p_period_days, public.billing_period_days(v_req.billing_interval));
  if v_days < 1 or v_days > 3660 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;

  select * into v_plan from public.plans where id = v_req.plan_id;

  update public.payment_requests
     set status = 'CONFIRMED',
         confirmed_at = now(),
         confirmed_by = auth.uid(),
         paid_at = coalesce(paid_at, now()),
         transaction_reference = coalesce(nullif(btrim(coalesce(p_reference, '')), ''), transaction_reference),
         notes = coalesce(nullif(btrim(coalesce(p_note, '')), ''), notes),
         period_days = v_days
   where id = v_req.id
  returning * into v_req;

  -- Assinatura corrente vira histórico; a nova nasce ativa com o período pago.
  update public.subscriptions
     set cancelled_at = now(),
         cancel_reason = 'replaced_by_payment',
         status = case when status = 'active' then 'cancelled' else status end,
         updated_at = now()
   where restaurant_id = v_req.restaurant_id
     and cancelled_at is null;

  v_end := v_start + make_interval(days => v_days);

  insert into public.subscriptions (
    restaurant_id, plan_id, status, billing_interval,
    current_period_start, current_period_end,
    price_snapshot, provider, notes,
    payment_request_id, payment_method, activated_by, activated_at
  )
  values (
    v_req.restaurant_id, v_req.plan_id, 'active', v_req.billing_interval,
    v_start, v_end,
    v_req.amount, 'manual_pix',
    'ativada pela confirmação do pagamento ' || v_req.id::text,
    v_req.id, 'MANUAL_PIX', auth.uid(), now()
  )
  returning * into v_new;

  update public.payment_requests
     set subscription_id = v_new.id
   where id = v_req.id;

  perform public.log_admin_action(
    'MANUAL_PAYMENT_CONFIRMED',
    'payment_request',
    v_req.id,
    v_req.restaurant_id,
    jsonb_build_object(
      'admin_user_id', auth.uid(),
      'restaurant_id', v_req.restaurant_id,
      'payment_request_id', v_req.id,
      'subscription_id', v_new.id,
      'amount', v_req.amount,
      'plan_id', v_req.plan_id,
      'plan_name', coalesce(v_plan.name, v_req.plan_name),
      'method', v_req.payment_method::text,
      'period_days', v_days,
      'period_override', p_period_days is not null,
      'period_start', v_start,
      'period_end', v_end,
      'confirmed_at', now()
    )
  );

  return jsonb_build_object(
    'payment_request_id', v_req.id,
    'status', 'CONFIRMED',
    'subscription_id', v_new.id,
    'subscription_status', v_new.status::text,
    'period_start', v_new.current_period_start,
    'period_end', v_new.current_period_end,
    'period_days', v_days
  );
end;
$$;

revoke all on function public.admin_confirm_payment(uuid, text, integer, text) from public;
grant execute on function public.admin_confirm_payment(uuid, text, integer, text) to authenticated;

/**
 * Rejeita a solicitação. Não ativa nada, não toca na assinatura.
 *
 * O motivo é obrigatório: rejeitar sem dizer por quê deixa o cliente sem saber
 * se errou a chave, o valor ou o comprovante.
 */
create or replace function public.admin_reject_payment(
  p_id     uuid,
  p_reason text
)
returns public.payment_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payment_requests;
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  if char_length(btrim(p_reason)) > 280 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;

  select * into v_row from public.payment_requests where id = p_id for update;
  if v_row.id is null then
    raise exception 'payment_request_not_found' using errcode = 'P0002';
  end if;

  if v_row.status <> 'PENDING' then
    raise exception 'payment_not_pending' using errcode = '22023';
  end if;

  update public.payment_requests
     set status = 'REJECTED',
         rejection_reason = btrim(p_reason)
   where id = p_id
  returning * into v_row;

  perform public.log_admin_action(
    'payment.rejected', 'payment_request', v_row.id, v_row.restaurant_id,
    jsonb_build_object('reason', v_row.rejection_reason, 'amount', v_row.amount, 'plan_id', v_row.plan_id)
  );

  return v_row;
end;
$$;

revoke all on function public.admin_reject_payment(uuid, text) from public;
grant execute on function public.admin_reject_payment(uuid, text) to authenticated;

/**
 * Cancela uma solicitação pendente (plataforma).
 *
 * O restaurante **não** cancela sozinho: cancelar é mexer em status, e o
 * escopo desta etapa dá ao cliente apenas leitura, criação e comprovante.
 */
create or replace function public.admin_cancel_payment(
  p_id     uuid,
  p_reason text default null
)
returns public.payment_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payment_requests;
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  select * into v_row from public.payment_requests where id = p_id for update;
  if v_row.id is null then
    raise exception 'payment_request_not_found' using errcode = 'P0002';
  end if;

  if v_row.status <> 'PENDING' then
    raise exception 'payment_not_pending' using errcode = '22023';
  end if;

  update public.payment_requests
     set status = 'CANCELLED',
         notes = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), notes)
   where id = p_id
  returning * into v_row;

  perform public.log_admin_action(
    'payment.cancelled', 'payment_request', v_row.id, v_row.restaurant_id,
    jsonb_build_object('reason', p_reason)
  );

  return v_row;
end;
$$;

revoke all on function public.admin_cancel_payment(uuid, text) from public;
grant execute on function public.admin_cancel_payment(uuid, text) to authenticated;

/* ----------------------------------------------------------------------------
 * 10. Administrador: configuração global do PIX
 * ---------------------------------------------------------------------------- */

/** Leitura completa para o painel (inclui `is_active` e quem alterou por último). */
create or replace function public.admin_payment_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.payment_settings;
  v_who public.users;
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  select * into v_row from public.payment_settings where id;
  select * into v_who from public.users where id = v_row.updated_by;

  return jsonb_build_object(
    'is_active', coalesce(v_row.is_active, false),
    'recipient_name', v_row.recipient_name,
    'pix_key', v_row.pix_key,
    'pix_key_type', v_row.pix_key_type,
    'instructions', v_row.instructions,
    'qr_code_url', v_row.qr_code_url,
    'updated_at', v_row.updated_at,
    'updated_by_email', v_who.email::text,
    -- A tela precisa saber se o usuário atual é MASTER_ADMIN para habilitar
    -- (ou não) o formulário — a decisão de verdade continua na guarda abaixo.
    'can_edit', public.is_platform_owner()
  );
end;
$$;

revoke all on function public.admin_payment_settings() from public;
grant execute on function public.admin_payment_settings() to authenticated;

/**
 * Salva a configuração do PIX. **Só MASTER_ADMIN.**
 *
 * Ligar sem chave é recusado: um PIX "ativo" para chave vazia faria a tela
 * mandar o cliente pagar para ninguém.
 */
create or replace function public.admin_save_payment_settings(
  p_recipient_name text,
  p_pix_key        text,
  p_pix_key_type   text default null,
  p_instructions   text default null,
  p_qr_code_url    text default null,
  p_is_active      boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key   text := nullif(btrim(coalesce(p_pix_key, '')), '');
  v_name  text := nullif(btrim(coalesce(p_recipient_name, '')), '');
  v_type  text := nullif(btrim(coalesce(p_pix_key_type, '')), '');
  v_instr text := nullif(btrim(coalesce(p_instructions, '')), '');
  v_qr    text := nullif(btrim(coalesce(p_qr_code_url, '')), '');
begin
  if not public.is_platform_owner() then
    raise exception 'master_admin_forbidden' using errcode = '42501';
  end if;

  if v_name is not null and (char_length(v_name) < 2 or char_length(v_name) > 80) then
    raise exception 'invalid_recipient_name' using errcode = '22023';
  end if;

  if v_key is not null and (char_length(v_key) < 3 or char_length(v_key) > 140) then
    raise exception 'invalid_pix_key' using errcode = '22023';
  end if;

  if v_type is not null and v_type not in ('cpf', 'cnpj', 'email', 'phone', 'random') then
    raise exception 'invalid_pix_key_type' using errcode = '22023';
  end if;

  if v_instr is not null and char_length(v_instr) > 600 then
    raise exception 'instructions_too_long' using errcode = '22023';
  end if;

  if coalesce(p_is_active, false) and v_key is null then
    raise exception 'pix_key_required' using errcode = '22023';
  end if;

  -- QR é opcional, mas se vier tem de ser do nosso bucket: URL arbitrária na
  -- tela de pagamento é vetor de phishing, e a imagem apareceria sob o selo
  -- "Menuvo".
  if v_qr is not null and v_qr not like '%/storage/v1/object/public/payment-assets/%' then
    raise exception 'invalid_qr_url' using errcode = '22023';
  end if;

  update public.payment_settings
     set recipient_name = v_name,
         pix_key = v_key,
         pix_key_type = v_type,
         instructions = v_instr,
         qr_code_url = v_qr,
         is_active = coalesce(p_is_active, false),
         updated_by = auth.uid(),
         updated_at = now()
   where id;

  perform public.log_admin_action(
    'payment.settings_updated', 'payment_settings', null, null,
    jsonb_build_object(
      'is_active', coalesce(p_is_active, false),
      -- Nunca a chave inteira no log: auditoria lê e-mail de quem mexeu, não
      -- precisa replicar um dado de recebimento em outra tabela.
      'pix_key_tail', case when v_key is null then null else right(v_key, 4) end,
      'pix_key_type', v_type,
      'has_qr', v_qr is not null
    )
  );

  return public.admin_payment_settings();
end;
$$;

revoke all on function public.admin_save_payment_settings(text, text, text, text, text, boolean) from public;
grant execute on function public.admin_save_payment_settings(text, text, text, text, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 11. Contador para o dashboard master
-- ----------------------------------------------------------------------------
/** Quantos pagamentos esperam conferência — o card do `/admin`. */
create or replace function public.admin_payment_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pending   integer := 0;
  v_confirmed integer := 0;
  v_rejected  integer := 0;
  v_month     numeric := 0;
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  select count(*) into v_pending from public.payment_requests where status = 'PENDING';
  select count(*) into v_confirmed from public.payment_requests where status = 'CONFIRMED';
  select count(*) into v_rejected from public.payment_requests where status = 'REJECTED';

  select coalesce(sum(amount), 0) into v_month
  from public.payment_requests
  where status = 'CONFIRMED' and confirmed_at >= date_trunc('month', now());

  return jsonb_build_object(
    'pending', v_pending,
    'confirmed', v_confirmed,
    'rejected', v_rejected,
    'confirmed_amount_month', v_month
  );
end;
$$;

revoke all on function public.admin_payment_summary() from public;
grant execute on function public.admin_payment_summary() to authenticated;

-- ----------------------------------------------------------------------------
-- 12. Aviso de vencimento (dias restantes) para o painel do restaurante
-- ----------------------------------------------------------------------------
/**
 * Dias até o fim do período pago (ou do trial), nunca negativo.
 *
 * Fica em função própria porque a regra "avise em X dias" aparece em mais de
 * uma tela (dashboard, meu plano, pagamento) e não pode divergir entre elas.
 */
create or replace function public.subscription_days_left(p_restaurant_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when s.id is null then null
    when s.status = 'trial' and s.trial_end is not null
      then greatest(0, ceil(extract(epoch from (s.trial_end - now())) / 86400))::integer
    when s.current_period_end is not null
      then greatest(0, ceil(extract(epoch from (s.current_period_end - now())) / 86400))::integer
    else null
  end
  from public.subscriptions s
  where s.restaurant_id = p_restaurant_id and s.cancelled_at is null;
$$;

comment on function public.subscription_days_left(uuid) is
  'Dias restantes do período vigente. null quando não há assinatura corrente.';

revoke all on function public.subscription_days_left(uuid) from public;
grant execute on function public.subscription_days_left(uuid) to authenticated;
