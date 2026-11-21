-- ============================================================================
-- Etapa 10 · Painel master do administrador da plataforma
-- ============================================================================
-- Até aqui havia um único tipo de usuário: quem pertence a um restaurante
-- (`restaurant_users`). Esta etapa introduz o segundo tipo — o administrador
-- da PLATAFORMA — e a regra mais importante do arquivo:
--
--   **ser admin da plataforma não é um papel de restaurante.**
--
-- Por isso a autorização mora em uma tabela separada (`platform_admins`), e não
-- como mais um valor em `restaurant_member_role`. Se "admin" fosse um papel de
-- restaurante, um dono que criasse o próprio vínculo com esse papel ganharia
-- poder global — exatamente o que o escopo proíbe.
--
-- Decisões que este arquivo toma, e por quê:
--
--   1. **Nenhuma policy nova abre as tabelas para o admin global.** Leitura do
--      painel passa por funções `security definer` com guarda
--      `is_platform_admin()` que devolvem listas já recortadas. RLS continua
--      fechada por tenant: um admin global não "vira" membro de ninguém, ele
--      consulta por um caminho explícito e auditável.
--   2. **Suspender é um cadeado de verdade.** Se o status virasse só mais um
--      valor do enum, o dono suspenso poderia dar `update restaurants set
--      status='published'` na própria linha (a policy de update permite) e
--      escapar. O trigger `guard_restaurant_admin_fields` fecha isso no banco.
--   3. **Status da plataforma ≠ status comercial do dono.** O dono publica e
--      pausa (`published`/`paused`); só a plataforma suspende. `suspended` é o
--      único valor que o trigger deixa fora do alcance do tenant.
--   4. **Plano é coluna, cobrança não existe.** `plan_id` e
--      `subscription_*` entram agora para que a Etapa 11 (planos) não precise
--      migrar dados às pressas; nenhuma regra de negócio é escrita aqui.
--   5. **Auditoria é tabela append-only.** Sem policy de insert/update/delete:
--      quem registra são as funções e triggers `security definer`. Nem o
--      próprio admin global consegue reescrever o histórico pelo cliente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums
--
-- `alter type ... add value` precisa rodar fora da transação que já usa o
-- valor novo, então cada um vem isolado e os blocos seguintes são separados.
-- ----------------------------------------------------------------------------
alter type public.restaurant_status add value if not exists 'suspended';

alter type public.restaurant_member_role add value if not exists 'manager';

comment on type public.restaurant_status is
  'draft/published/paused = decisão do dono; suspended = decisão da plataforma.';

-- ----------------------------------------------------------------------------
-- 2. Planos (modelo, sem cobrança)
-- ----------------------------------------------------------------------------
create table if not exists public.plans (
  id            text primary key check (id ~ '^[a-z0-9-]{2,32}$'),
  name          text not null,
  description   text,
  price_monthly numeric(10, 2) not null default 0 check (price_monthly >= 0),
  /** Limites futuros (mesas, produtos). Vazio = sem regra nesta etapa. */
  limits        jsonb not null default '{}'::jsonb,
  features      jsonb not null default '[]'::jsonb,
  is_active     boolean not null default true,
  position      integer not null default 0,
  created_at    timestamptz not null default now()
);

comment on table public.plans is
  'Catálogo de planos. A Etapa 11 implementa assinatura e cobrança; aqui só existe o modelo.';

insert into public.plans (id, name, description, price_monthly, position, features)
values
  ('free', 'Grátis', 'Para começar e testar o cardápio digital.', 0, 0,
   '["Cardápio público", "QR Code e NFC", "Pedidos na mesa"]'::jsonb),
  ('pro', 'Pro', 'Para casas com movimento alto.', 0, 1,
   '["Tudo do Grátis", "Personalização visual", "Painel master"]'::jsonb)
on conflict (id) do nothing;

alter table public.plans enable row level security;

drop policy if exists plans_select_authenticated on public.plans;
create policy plans_select_authenticated on public.plans
  for select to authenticated
  using (true);

grant select on public.plans to authenticated;
revoke all on public.plans from anon;

-- ----------------------------------------------------------------------------
-- 3. Restaurantes: assinatura + suspensão
-- ----------------------------------------------------------------------------
alter table public.restaurants
  add column if not exists plan_id text references public.plans (id) default 'free',
  add column if not exists subscription_status text not null default 'none'
    check (subscription_status in ('none', 'trialing', 'active', 'past_due', 'canceled')),
  add column if not exists subscription_start timestamptz,
  add column if not exists subscription_end   timestamptz,
  add column if not exists suspended_at    timestamptz,
  add column if not exists suspended_reason text
    check (suspended_reason is null or char_length(suspended_reason) <= 280);

comment on column public.restaurants.plan_id is
  'Plano contratado (Etapa 11). Sem cobrança nesta etapa.';
comment on column public.restaurants.subscription_status is
  'none | trialing | active | past_due | canceled — reservado para a Etapa 11.';
comment on column public.restaurants.suspended_at is
  'Quando a plataforma suspendeu a casa. Preenchido só por admin global.';
comment on column public.restaurants.suspended_reason is
  'Motivo mostrado ao dono. Nunca apagado pelo próprio restaurante.';

create index if not exists restaurants_plan_idx on public.restaurants (plan_id);

-- ----------------------------------------------------------------------------
-- 4. Administrador da plataforma
-- ----------------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id    uuid primary key references public.users (id) on delete cascade,
  role       text not null default 'admin' check (role in ('owner', 'admin')),
  notes      text,
  created_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'Quem enxerga a plataforma inteira. Separado de restaurant_users de propósito.';

/**
 * A guarda que todo o painel usa.
 *
 * SECURITY DEFINER para poder ler `platform_admins` sem depender de policy
 * (a tabela é fechada), STABLE para o planner reaproveitar dentro de uma
 * consulta, e `coalesce(..., false)` porque em contexto anônimo `auth.uid()`
 * é nulo e `exists` com `= null` nunca casa — queremos `false`, não `null`.
 */
create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
  );
$$;

comment on function public.is_platform_admin() is
  'true quando o usuário logado está em platform_admins. Base de todo o /admin.';

revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated;

alter table public.platform_admins enable row level security;

-- Cada admin vê a lista (quem é admin da plataforma), ninguém mais.
drop policy if exists platform_admins_select_admin on public.platform_admins;
create policy platform_admins_select_admin on public.platform_admins
  for select to authenticated
  using (public.is_platform_admin());

grant select on public.platform_admins to authenticated;
revoke all on public.platform_admins from anon;

-- Bootstrap: o primeiro usuário da instalação vira admin da plataforma.
-- Roda uma única vez (tabela vazia) e é idempotente depois disso.
do $$
begin
  if not exists (select 1 from public.platform_admins) then
    insert into public.platform_admins (user_id, role, notes)
    select u.id, 'owner', 'Bootstrap: primeiro usuário da instalação.'
    from public.users u
    order by u.created_at asc
    limit 1
    on conflict (user_id) do nothing;
  end if;
end $$;

/**
 * Caminho de bootstrap para uma instalação nova.
 *
 * Só funciona enquanto **não existe nenhum admin** e só para o usuário mais
 * antigo da base — ou seja, é o mesmo critério da migração, mas acionável sem
 * acesso ao SQL editor. Depois do primeiro admin, a função vira no-op.
 */
create or replace function public.claim_first_platform_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_oldest uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if exists (select 1 from public.platform_admins) then
    return false;
  end if;

  select u.id into v_oldest
  from public.users u
  order by u.created_at asc
  limit 1;

  if v_oldest is distinct from v_uid then
    return false;
  end if;

  insert into public.platform_admins (user_id, role, notes)
  values (v_uid, 'owner', 'Bootstrap via claim_first_platform_admin().')
  on conflict (user_id) do nothing;

  return true;
end;
$$;

revoke all on function public.claim_first_platform_admin() from public;
grant execute on function public.claim_first_platform_admin() to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Papéis de restaurante: MANAGER entra agora, com escopo controlado
--
-- `manager` passa a valer como admin **operacional** (cardápio, mesas, pedidos,
-- tema) redefinindo `is_restaurant_admin` num lugar só. O que ele NÃO pode é
-- mexer na equipe — por isso as policies de `restaurant_users` passam a usar a
-- nova `is_restaurant_owner_admin`. Sem isso, um gerente poderia se promover.
-- ----------------------------------------------------------------------------
create or replace function public.is_restaurant_admin(target_restaurant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.has_restaurant_role(
    target_restaurant_id,
    array['owner', 'admin', 'manager']::public.restaurant_member_role[]
  );
$$;

comment on function public.is_restaurant_admin(uuid) is
  'Admin operacional do restaurante: owner, admin ou manager (Etapa 10).';

create or replace function public.is_restaurant_owner_admin(target_restaurant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.has_restaurant_role(
    target_restaurant_id,
    array['owner', 'admin']::public.restaurant_member_role[]
  );
$$;

comment on function public.is_restaurant_owner_admin(uuid) is
  'Quem pode mexer na equipe e nos papéis. Manager fica de fora de propósito.';

revoke all on function public.is_restaurant_admin(uuid) from public;
revoke all on function public.is_restaurant_owner_admin(uuid) from public;
grant execute on function public.is_restaurant_admin(uuid) to authenticated;
grant execute on function public.is_restaurant_owner_admin(uuid) to authenticated;

drop policy if exists restaurant_users_insert_admin on public.restaurant_users;
create policy restaurant_users_insert_admin on public.restaurant_users
  for insert to authenticated
  with check (public.is_restaurant_owner_admin(restaurant_id));

drop policy if exists restaurant_users_update_admin on public.restaurant_users;
create policy restaurant_users_update_admin on public.restaurant_users
  for update to authenticated
  using (public.is_restaurant_owner_admin(restaurant_id))
  with check (public.is_restaurant_owner_admin(restaurant_id));

drop policy if exists restaurant_users_delete_admin on public.restaurant_users;
create policy restaurant_users_delete_admin on public.restaurant_users
  for delete to authenticated
  using (public.is_restaurant_owner_admin(restaurant_id));

-- ----------------------------------------------------------------------------
-- 6. Cadeado da suspensão e dos campos de assinatura
--
-- Roda antes de qualquer update em `restaurants`. Quem é admin global passa
-- direto; o resto não toca em `suspended` nem nos campos de plano.
-- ----------------------------------------------------------------------------
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

  if new.status is distinct from old.status then
    if old.status = 'suspended' or new.status = 'suspended' then
      -- Nem sair da suspensão, nem entrar nela. O dono não se auto-desbloqueia.
      raise exception 'restaurant_suspended_locked' using errcode = '42501';
    end if;
  end if;

  if new.plan_id             is distinct from old.plan_id
     or new.subscription_status is distinct from old.subscription_status
     or new.subscription_start  is distinct from old.subscription_start
     or new.subscription_end    is distinct from old.subscription_end
     or new.suspended_at        is distinct from old.suspended_at
     or new.suspended_reason    is distinct from old.suspended_reason then
    raise exception 'restaurant_plan_locked' using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_restaurant_admin_fields() is
  'Só admin da plataforma suspende/dessuspende ou mexe em plano e assinatura.';

drop trigger if exists restaurants_guard_admin_fields on public.restaurants;
create trigger restaurants_guard_admin_fields
  before update on public.restaurants
  for each row execute function public.guard_restaurant_admin_fields();

-- ----------------------------------------------------------------------------
-- 7. Auditoria
-- ----------------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id             uuid primary key default gen_random_uuid(),
  /** Quem fez. `set null` para o histórico sobreviver à exclusão da conta. */
  actor_id       uuid references public.users (id) on delete set null,
  /** Snapshot: e-mail pode mudar, o registro do que aconteceu não. */
  actor_email    text,
  /** Ex.: restaurant.suspended, product.updated, user.role_changed. */
  action         text not null check (char_length(action) between 3 and 64),
  resource_type  text not null check (char_length(resource_type) between 3 and 32),
  resource_id    uuid,
  restaurant_id  uuid references public.restaurants (id) on delete set null,
  /** Detalhes livres: de/para, motivo da suspensão, nome do item… */
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

comment on table public.admin_audit_log is
  'Histórico append-only de ações administrativas relevantes (Etapa 10).';

create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_restaurant_idx
  on public.admin_audit_log (restaurant_id, created_at desc);
create index if not exists admin_audit_log_actor_idx
  on public.admin_audit_log (actor_id, created_at desc);

alter table public.admin_audit_log enable row level security;

-- Só admin global lê. Sem policy de insert/update/delete: escrita apenas por
-- funções e triggers SECURITY DEFINER — o cliente não reescreve o passado.
drop policy if exists admin_audit_log_select_admin on public.admin_audit_log;
create policy admin_audit_log_select_admin on public.admin_audit_log
  for select to authenticated
  using (public.is_platform_admin());

grant select on public.admin_audit_log to authenticated;
revoke all on public.admin_audit_log from anon;

/**
 * Registro de uma ação administrativa.
 *
 * `security definer` porque o cliente não tem (nem deve ter) INSERT na tabela.
 * O ator sai de `auth.uid()` — nunca de um parâmetro, senão daria para forjar
 * autoria. Retorna o id para quem quiser correlacionar.
 */
create or replace function public.log_admin_action(
  p_action        text,
  p_resource_type text,
  p_resource_id   uuid default null,
  p_restaurant_id uuid default null,
  p_metadata      jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_email text;
begin
  select u.email::text into v_email from public.users u where u.id = auth.uid();

  insert into public.admin_audit_log (
    actor_id, actor_email, action, resource_type, resource_id, restaurant_id, metadata
  )
  values (
    auth.uid(), v_email, p_action, p_resource_type, p_resource_id, p_restaurant_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.log_admin_action is
  'Grava uma linha em admin_audit_log. Autor sempre auth.uid(), nunca o payload.';

revoke all on function public.log_admin_action(text, text, uuid, uuid, jsonb) from public;

/**
 * Auditoria automática de produto (exemplo do escopo: "produto alterado").
 *
 * Trigger: registra em toda mudança de produto, com quem fez (auth.uid()).
 * Um restaurante alterando o próprio cardápio também entra no histórico — é o
 * tipo de evento que o suporte precisa ver quando alguém reclama de preço.
 */
create or replace function public.audit_product_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_meta jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'product.created';
    v_meta := jsonb_build_object('name', new.name, 'price', new.price);
  elsif tg_op = 'UPDATE' then
    v_action := 'product.updated';
    v_meta := jsonb_build_object(
      'name', new.name,
      'from', jsonb_build_object(
        'name', old.name, 'price', old.price, 'is_available', old.is_available
      ),
      'to', jsonb_build_object(
        'name', new.name, 'price', new.price, 'is_available', new.is_available
      )
    );
    -- Ruído zero: update que não mudou nada de relevante não entra no log.
    if old.name = new.name
       and old.price = new.price
       and old.is_available = new.is_available
       and old.is_featured = new.is_featured then
      return new;
    end if;
  else
    v_action := 'product.deleted';
    v_meta := jsonb_build_object('name', old.name, 'price', old.price);
  end if;

  perform public.log_admin_action(
    v_action, 'product', coalesce(new.id, old.id), coalesce(new.restaurant_id, old.restaurant_id), v_meta
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists products_audit_change on public.products;
create trigger products_audit_change
  after insert or update or delete on public.products
  for each row execute function public.audit_product_change();

-- Mudança de status do restaurante também é auditada (suspender, reativar,
-- pausar). Fica no banco, e não na aplicação, para valer em qualquer caminho.
create or replace function public.audit_restaurant_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    perform public.log_admin_action(
      'restaurant.status_changed',
      'restaurant',
      new.id,
      new.id,
      jsonb_build_object(
        'from', old.status,
        'to', new.status,
        'reason', new.suspended_reason
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists restaurants_audit_status on public.restaurants;
create trigger restaurants_audit_status
  after update on public.restaurants
  for each row execute function public.audit_restaurant_status_change();

-- ----------------------------------------------------------------------------
-- 8. Busca e contagem — auxiliares
-- ----------------------------------------------------------------------------

/** Remove acentos e baixa a caixa: "Pão" e "pao" casam na busca do painel. */
create or replace function public.search_key(value text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    lower(translate(
      coalesce(value, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
      'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
    )),
    '\s+', ' ', 'g'
  );
$$;

comment on function public.search_key(text) is
  'Normaliza texto para busca tolerante a acento e caixa.';

grant execute on function public.search_key(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. Leitura do painel (todas as funções guardadas por is_platform_admin)
-- ----------------------------------------------------------------------------

/**
 * Métricas do dashboard.
 *
 * Devolve **uma linha**, com as contagens que a tela mostra. "Hoje" usa o
 * fuso de São Paulo (padrão do produto) em vez de UTC: às 21h de Brasília o
 * dia ainda é hoje, enquanto em UTC já seria amanhã.
 */
create or replace function public.admin_dashboard()
returns table (
  restaurants_total   integer,
  restaurants_active  integer,
  restaurants_inactive integer,
  restaurants_suspended integer,
  products_total      integer,
  tables_total        integer,
  orders_total        integer,
  orders_today        integer,
  users_total         integer
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  return query
  select
    (select count(*)::integer from public.restaurants),
    (select count(*)::integer from public.restaurants r where r.status = 'published'),
    (select count(*)::integer from public.restaurants r
      where r.status in ('draft', 'paused', 'closed')),
    (select count(*)::integer from public.restaurants r where r.status = 'suspended'),
    (select count(*)::integer from public.products),
    (select count(*)::integer from public.tables),
    (select count(*)::integer from public.orders),
    (select count(*)::integer from public.orders o
      where (o.created_at at time zone 'America/Sao_Paulo')::date
            = (now() at time zone 'America/Sao_Paulo')::date),
    (select count(*)::integer from public.users);
end;
$$;

comment on function public.admin_dashboard() is
  'Contadores globais do /admin. Uma consulta, uma linha, guardado por is_platform_admin.';

revoke all on function public.admin_dashboard() from public;
grant execute on function public.admin_dashboard() to authenticated;

/**
 * Lista de restaurantes com contadores e responsável.
 *
 * Busca por nome, slug, telefone **e e-mail/nome do responsável** — os quatro
 * campos do item 5 do escopo. O responsável é o primeiro owner ativo; casas sem
 * owner (possível após exclusão de conta) aparecem com `null` em vez de sumir
 * da lista.
 */
create or replace function public.admin_list_restaurants(
  p_search text default null,
  p_status text default null
)
returns table (
  id                 uuid,
  name               text,
  slug               text,
  status             public.restaurant_status,
  phone              text,
  created_at         timestamptz,
  products_count     integer,
  tables_count       integer,
  members_count      integer,
  orders_count       integer,
  owner_name         text,
  owner_email        text,
  plan_id            text,
  subscription_status text,
  suspended_reason   text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_key text := nullif(public.search_key(p_search), '');
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  if p_status is not null
     and p_status not in ('draft', 'published', 'paused', 'closed', 'suspended') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  return query
  select
    r.id,
    r.name,
    r.slug::text,
    r.status,
    r.phone,
    r.created_at,
    (select count(*)::integer from public.products p where p.restaurant_id = r.id),
    (select count(*)::integer from public.tables t where t.restaurant_id = r.id),
    (select count(*)::integer from public.restaurant_users ru where ru.restaurant_id = r.id),
    (select count(*)::integer from public.orders o where o.restaurant_id = r.id),
    owner.full_name,
    owner.email::text,
    r.plan_id,
    r.subscription_status,
    r.suspended_reason
  from public.restaurants r
  left join lateral (
    select u.full_name, u.email
    from public.restaurant_users ru
    join public.users u on u.id = ru.user_id
    where ru.restaurant_id = r.id
      and ru.role = 'owner'
    order by ru.created_at asc
    limit 1
  ) owner on true
  where
    p_status is null or r.status = p_status::public.restaurant_status
  and (
    v_key is null
    or public.search_key(r.name) like '%' || v_key || '%'
    or public.search_key(r.slug::text) like '%' || v_key || '%'
    or public.search_key(r.phone) like '%' || v_key || '%'
    or public.search_key(owner.email::text) like '%' || v_key || '%'
    or public.search_key(owner.full_name) like '%' || v_key || '%'
  )
  order by
    -- Suspensos primeiro (é o que o suporte precisa ver), depois por cadastro.
    case r.status when 'suspended' then 0 else 1 end,
    r.created_at desc;
end;
$$;

comment on function public.admin_list_restaurants(text, text) is
  'Lista global com busca por nome, slug, telefone e responsável.';

revoke all on function public.admin_list_restaurants(text, text) from public;
grant execute on function public.admin_list_restaurants(text, text) to authenticated;

/**
 * Detalhe de um restaurante em uma ida ao banco.
 *
 * Um `jsonb` porque o painel mostra sete blocos (informações, usuários,
 * produtos, categorias, mesas, pedidos, configurações) e sete round-trips por
 * página aberta seria desperdício — especialmente no celular em 4G.
 */
create or replace function public.admin_restaurant_detail(p_restaurant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  if not exists (select 1 from public.restaurants r where r.id = p_restaurant_id) then
    raise exception 'restaurant_not_found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'restaurant', (
      select jsonb_build_object(
        'id', r.id, 'name', r.name, 'slug', r.slug::text, 'status', r.status,
        'description', r.description, 'phone', r.phone,
        'address_line', r.address_line, 'address_number', r.address_number,
        'district', r.district, 'city', r.city, 'state', r.state,
        'postal_code', r.postal_code, 'timezone', r.timezone, 'currency', r.currency,
        'logo_url', r.logo_url, 'settings', r.settings,
        'plan_id', r.plan_id, 'subscription_status', r.subscription_status,
        'subscription_start', r.subscription_start, 'subscription_end', r.subscription_end,
        'suspended_at', r.suspended_at, 'suspended_reason', r.suspended_reason,
        'created_at', r.created_at, 'updated_at', r.updated_at
      )
      from public.restaurants r where r.id = p_restaurant_id
    ),
    'counts', jsonb_build_object(
      'products', (select count(*)::integer from public.products p where p.restaurant_id = p_restaurant_id),
      'categories', (select count(*)::integer from public.categories c where c.restaurant_id = p_restaurant_id),
      'tables', (select count(*)::integer from public.tables t where t.restaurant_id = p_restaurant_id),
      'orders', (select count(*)::integer from public.orders o where o.restaurant_id = p_restaurant_id),
      'orders_today', (
        select count(*)::integer from public.orders o
        where o.restaurant_id = p_restaurant_id
          and (o.created_at at time zone 'America/Sao_Paulo')::date
              = (now() at time zone 'America/Sao_Paulo')::date
      ),
      'members', (select count(*)::integer from public.restaurant_users ru where ru.restaurant_id = p_restaurant_id)
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', u.id, 'email', u.email::text, 'full_name', u.full_name,
        'role', ru.role, 'status', ru.status, 'created_at', ru.created_at
      ) order by ru.created_at)
      from public.restaurant_users ru
      join public.users u on u.id = ru.user_id
      where ru.restaurant_id = p_restaurant_id
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'price', p.price,
        'is_available', p.is_available, 'category_name', c.name
      ) order by p.position, p.name)
      from public.products p
      left join public.categories c on c.id = p.category_id
      where p.restaurant_id = p_restaurant_id
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'is_active', c.is_active,
        'products_count', (select count(*)::integer from public.products p where p.category_id = c.id)
      ) order by c.position, c.name)
      from public.categories c
      where c.restaurant_id = p_restaurant_id
    ), '[]'::jsonb),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'is_active', t.is_active,
        'public_token', t.public_token
      ) order by t.name)
      from public.tables t
      where t.restaurant_id = p_restaurant_id
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(row_to_json(o)::jsonb order by o.created_at desc)
      from (
        select o.id, o.order_number, o.status, o.total, o.created_at, tb.name as table_name
        from public.orders o
        left join public.tables tb on tb.id = o.table_id
        where o.restaurant_id = p_restaurant_id
        order by o.created_at desc
        limit 20
      ) o
    ), '[]'::jsonb),
    'theme', (
      select jsonb_build_object(
        'primary_color', t.primary_color, 'secondary_color', t.secondary_color,
        'background_color', t.background_color, 'text_color', t.text_color,
        'button_color', t.button_color, 'card_style', t.card_style,
        'button_style', t.button_style, 'logo_url', t.logo_url, 'cover_url', t.cover_url,
        'preset', t.preset, 'updated_at', t.updated_at
      )
      from public.restaurant_themes t where t.restaurant_id = p_restaurant_id
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.admin_restaurant_detail(uuid) is
  'Visão de suporte de um restaurante: dados, equipe, cardápio, mesas, pedidos e tema.';

revoke all on function public.admin_restaurant_detail(uuid) from public;
grant execute on function public.admin_restaurant_detail(uuid) to authenticated;

/**
 * Usuários da plataforma.
 *
 * Uma linha por usuário, com os vínculos agregados em `restaurants`. Um dono
 * com duas casas aparece uma vez, não duas. `is_platform_admin` diz se a pessoa
 * também enxerga o /admin.
 */
create or replace function public.admin_list_users(p_search text default null)
returns table (
  user_id           uuid,
  email             text,
  full_name         text,
  phone             text,
  created_at        timestamptz,
  is_platform_admin boolean,
  platform_role     text,
  restaurants       jsonb
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_key text := nullif(public.search_key(p_search), '');
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  return query
  select
    u.id,
    u.email::text,
    u.full_name,
    u.phone,
    u.created_at,
    (pa.user_id is not null),
    pa.role,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'restaurant_id', r.id,
        'name', r.name,
        'slug', r.slug::text,
        'role', ru.role,
        'status', ru.status
      ) order by r.name)
      from public.restaurant_users ru
      join public.restaurants r on r.id = ru.restaurant_id
      where ru.user_id = u.id
    ), '[]'::jsonb)
  from public.users u
  left join public.platform_admins pa on pa.user_id = u.id
  where
    v_key is null
    or public.search_key(u.email::text) like '%' || v_key || '%'
    or public.search_key(u.full_name) like '%' || v_key || '%'
    or exists (
      select 1
      from public.restaurant_users ru
      join public.restaurants r on r.id = ru.restaurant_id
      where ru.user_id = u.id
        and public.search_key(r.name) like '%' || v_key || '%'
    )
  order by u.created_at desc;
end;
$$;

comment on function public.admin_list_users(text) is
  'Usuários com papéis por restaurante e papel de plataforma.';

revoke all on function public.admin_list_users(text) from public;
grant execute on function public.admin_list_users(text) to authenticated;

/** Pedidos recentes de toda a plataforma (aba Pedidos do /admin). */
create or replace function public.admin_list_orders(p_limit integer default 30)
returns table (
  id            uuid,
  restaurant_id uuid,
  restaurant_name text,
  table_name    text,
  order_number  integer,
  status        public.order_status,
  total         numeric,
  created_at    timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  return query
  select o.id, o.restaurant_id, r.name, tb.name, o.order_number, o.status, o.total, o.created_at
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  left join public.tables tb on tb.id = o.table_id
  order by o.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

revoke all on function public.admin_list_orders(integer) from public;
grant execute on function public.admin_list_orders(integer) to authenticated;

/** Últimos eventos de auditoria (com o nome do restaurante, quando houver). */
create or replace function public.admin_list_audit(p_limit integer default 50)
returns table (
  id            uuid,
  actor_email   text,
  action        text,
  resource_type text,
  resource_id   uuid,
  restaurant_id uuid,
  restaurant_name text,
  metadata      jsonb,
  created_at    timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  return query
  select a.id, a.actor_email, a.action, a.resource_type, a.resource_id,
         a.restaurant_id, r.name, a.metadata, a.created_at
  from public.admin_audit_log a
  left join public.restaurants r on r.id = a.restaurant_id
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.admin_list_audit(integer) from public;
grant execute on function public.admin_list_audit(integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 10. Escrita administrativa
-- ----------------------------------------------------------------------------

/**
 * Ativa, desativa ou suspende um restaurante.
 *
 * `p_reason` é obrigatório para suspender e é exibido ao dono. Desbloquear
 * limpa `suspended_at`/`suspended_reason` — sem isso o motivo ficaria eterno
 * numa casa que já voltou.
 */
create or replace function public.admin_set_restaurant_status(
  p_restaurant_id uuid,
  p_status public.restaurant_status,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.restaurant_status;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  if p_status not in ('published', 'paused', 'suspended') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select r.status into v_old from public.restaurants r where r.id = p_restaurant_id;
  if v_old is null then
    raise exception 'restaurant_not_found' using errcode = 'P0002';
  end if;

  if p_status = 'suspended' and v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  if v_reason is not null and char_length(v_reason) > 280 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;

  update public.restaurants
     set status = p_status,
         suspended_at = case when p_status = 'suspended' then now() else null end,
         suspended_reason = case when p_status = 'suspended' then v_reason else null end
   where id = p_restaurant_id;

  -- A trigger `restaurants_audit_status` já registra a mudança; aqui só
  -- acrescentamos o motivo quando é suspensão (contexto que o log genérico
  -- não tem como adivinhar).
  if p_status = 'suspended' then
    perform public.log_admin_action(
      'restaurant.suspended', 'restaurant', p_restaurant_id, p_restaurant_id,
      jsonb_build_object('reason', v_reason)
    );
  end if;

  return true;
end;
$$;

comment on function public.admin_set_restaurant_status(uuid, public.restaurant_status, text) is
  'Ativa/suspende uma casa. Suspender exige motivo; o resto é limpo ao reativar.';

revoke all on function public.admin_set_restaurant_status(uuid, public.restaurant_status, text) from public;
grant execute on function public.admin_set_restaurant_status(uuid, public.restaurant_status, text) to authenticated;

/**
 * Edição administrativa dos dados cadastrais.
 *
 * Não mexe em status nem em plano (têm RPC própria). O slug é validado no
 * mesmo formato do cadastro e a unique do banco decide conflito — devolvemos
 * `slug_unavailable` em vez de estourar um 23505 cru na tela.
 */
create or replace function public.admin_update_restaurant(
  p_restaurant_id uuid,
  p_name          text,
  p_slug          text,
  p_phone         text default null,
  p_description   text default null,
  p_plan_id       text default null
)
returns public.restaurants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.restaurants;
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  if p_name is null or char_length(trim(p_name)) < 2 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or char_length(v_slug) > 48 then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;

  if p_plan_id is not null and not exists (select 1 from public.plans pl where pl.id = p_plan_id) then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;

  begin
    update public.restaurants
       set name = trim(p_name),
           slug = v_slug,
           phone = nullif(btrim(coalesce(p_phone, '')), ''),
           description = nullif(btrim(coalesce(p_description, '')), ''),
           plan_id = coalesce(p_plan_id, plan_id)
     where id = p_restaurant_id
     returning * into v_row;
  exception when unique_violation then
    raise exception 'slug_unavailable' using errcode = '23505';
  end;

  if v_row.id is null then
    raise exception 'restaurant_not_found' using errcode = 'P0002';
  end if;

  perform public.log_admin_action(
    'restaurant.updated', 'restaurant', p_restaurant_id, p_restaurant_id,
    jsonb_build_object('name', v_row.name, 'slug', v_row.slug, 'plan_id', v_row.plan_id)
  );

  return v_row;
end;
$$;

revoke all on function public.admin_update_restaurant(uuid, text, text, text, text, text) from public;
grant execute on function public.admin_update_restaurant(uuid, text, text, text, text, text) to authenticated;

/**
 * Troca o papel de um usuário dentro de um restaurante.
 *
 * Protege o último owner: uma casa sem owner fica órfã (ninguém consegue
 * gerenciar equipe), e isso não é algo que o suporte deva conseguir fazer por
 * acidente.
 */
create or replace function public.admin_set_member_role(
  p_restaurant_id uuid,
  p_user_id       uuid,
  p_role          public.restaurant_member_role
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.restaurant_member_role;
  v_owners integer;
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  select ru.role into v_current
  from public.restaurant_users ru
  where ru.restaurant_id = p_restaurant_id and ru.user_id = p_user_id;

  if v_current is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  if v_current = 'owner' and p_role <> 'owner' then
    select count(*) into v_owners
    from public.restaurant_users ru
    where ru.restaurant_id = p_restaurant_id
      and ru.role = 'owner'
      and ru.status = 'active';

    if v_owners <= 1 then
      raise exception 'last_owner' using errcode = '23514';
    end if;
  end if;

  update public.restaurant_users ru
     set role = p_role
   where ru.restaurant_id = p_restaurant_id and ru.user_id = p_user_id;

  perform public.log_admin_action(
    'member.role_changed', 'member', p_user_id, p_restaurant_id,
    jsonb_build_object('from', v_current, 'to', p_role)
  );

  return true;
end;
$$;

revoke all on function public.admin_set_member_role(uuid, uuid, public.restaurant_member_role) from public;
grant execute on function public.admin_set_member_role(uuid, uuid, public.restaurant_member_role) to authenticated;

/** Ativa, suspende ou reativa o vínculo de um usuário com a casa. */
create or replace function public.admin_set_member_status(
  p_restaurant_id uuid,
  p_user_id       uuid,
  p_status        public.restaurant_member_status
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.restaurant_member_status;
  v_role public.restaurant_member_role;
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  select ru.status, ru.role into v_current, v_role
  from public.restaurant_users ru
  where ru.restaurant_id = p_restaurant_id and ru.user_id = p_user_id;

  if v_current is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  -- Não deixa desativar o último owner ativo: a casa ficaria sem ninguém.
  if v_role = 'owner' and p_status <> 'active' then
    if (select count(*) from public.restaurant_users ru
         where ru.restaurant_id = p_restaurant_id
           and ru.role = 'owner'
           and ru.status = 'active') <= 1 then
      raise exception 'last_owner' using errcode = '23514';
    end if;
  end if;

  update public.restaurant_users ru
     set status = p_status
   where ru.restaurant_id = p_restaurant_id and ru.user_id = p_user_id;

  perform public.log_admin_action(
    'member.status_changed', 'member', p_user_id, p_restaurant_id,
    jsonb_build_object('from', v_current, 'to', p_status)
  );

  return true;
end;
$$;

revoke all on function public.admin_set_member_status(uuid, uuid, public.restaurant_member_status) from public;
grant execute on function public.admin_set_member_status(uuid, uuid, public.restaurant_member_status) to authenticated;

/**
 * Acesso de suporte explícito.
 *
 * O admin global já consegue **ver** a casa pelo painel master. Este registro
 * existe para o caso de ele abrir o cardápio público ou orientar o cliente:
 * fica uma linha na auditoria dizendo quem entrou, quando e por quê. Acesso
 * silencioso é o que o escopo quer evitar.
 */
create or replace function public.admin_log_support_access(
  p_restaurant_id uuid,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;

  perform public.log_admin_action(
    'support.access', 'restaurant', p_restaurant_id, p_restaurant_id,
    jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), ''))
  );

  return true;
end;
$$;

revoke all on function public.admin_log_support_access(uuid, text) from public;
grant execute on function public.admin_log_support_access(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 11. Estado público do slug (mensagem certa em vez de 404 seco)
--
-- O cardápio continua lendo `public_restaurants`, que só devolve publicado.
-- Esta função existe apenas para a página distinguir "nunca existiu" de
-- "existe, mas está suspenso/pausado" e mostrar a mensagem adequada.
-- Devolve **só** o status: nada de telefone, equipe ou configurações.
-- ----------------------------------------------------------------------------
create or replace function public.public_restaurant_state(p_slug text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select r.status::text
  from public.restaurants r
  where r.slug = lower(btrim(coalesce(p_slug, '')))
  limit 1;
$$;

comment on function public.public_restaurant_state(text) is
  'Status do slug para a mensagem pública. Não expõe nenhum dado do restaurante.';

revoke all on function public.public_restaurant_state(text) from public;
grant execute on function public.public_restaurant_state(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 12. Realtime
--
-- O painel master mostra contadores globais; com a publicação de `restaurants`
-- a lista de suspensos/ativos se ajusta sem recarregar quando outro admin age.
-- ----------------------------------------------------------------------------
do $pub$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'restaurants'
  ) then
    alter publication supabase_realtime add table public.restaurants;
  end if;
end $pub$;
