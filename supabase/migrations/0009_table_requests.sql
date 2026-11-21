-- ============================================================================
-- Etapa 8 · Chamar garçom e pedir a conta
--
-- O cliente está sentado, com o celular na mão. O que ele quer neste momento
-- não é um produto — é **atenção**: alguém para anotar, ou a conta para ir
-- embora. Sem canal, ele levanta e procura; ou pior, vai embora sem pagar.
--
-- Modelo: uma linha em `table_requests` por pedido de atenção. Três decisões
-- carregam o desenho todo:
--
--  1. **A solicitação tem ciclo de vida próprio, separado do pedido.** Chamar
--     garçom não é um pedido, não tem valor e não deve aparecer na cozinha.
--     Por isso a tabela é outra, e não uma linha em `orders` com tipo estranho.
--
--  2. **Cooldown no banco, não só na tela.** O botão "já enviado" é
--     conveniência; a regra mora aqui, num índice único parcial: mesa + tipo
--     enquanto a solicitação está pendente ou atendida. Assim dois toques
--     simultâneos (ou uma chamada direta à API) não criam duas solicitações.
--     E o cooldown temporal (padrão 120s) cobre o caso de tocar de novo logo
--     depois de resolvida — o mesmo cliente que pediu a conta duas vezes em
--     30 segundos.
--
--  3. **A mesa vem do token, sempre.** O cliente nunca envia `table_id`; quem
--     envia `table_id` para o banco é `create_table_request`, a partir de
--     `resolve_table_token`. Chamada com token de outra mesa não existe.
--
-- Tempo real: entra na publicação `supabase_realtime`, para o painel do salão
-- reagir no instante do toque — mesmo mecanismo já usado pelos pedidos.
-- ============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'table_request_type') then
    create type public.table_request_type as enum ('waiter', 'bill');
  end if;

  if not exists (select 1 from pg_type where typname = 'table_request_status') then
    create type public.table_request_status as enum ('pending', 'acknowledged', 'resolved', 'cancelled');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Tabela
-- -----------------------------------------------------------------------------
create table if not exists public.table_requests (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  table_id        uuid not null references public.tables(id) on delete cascade,
  type            public.table_request_type not null,
  status          public.table_request_status not null default 'pending',
  /** Anotação opcional do cliente (ex.: "trazer gelo"). */
  note            text,
  created_at      timestamptz not null default now(),
  /** Quando a equipe viu/atendeu. */
  acknowledged_at timestamptz,
  resolved_at     timestamptz,
  /** Quem atendeu — null quando resolvido por sistema ou antes do login. */
  actor_id        uuid references auth.users(id) on delete set null,
  constraint table_requests_note_len check (note is null or char_length(note) <= 200)
);

comment on table public.table_requests is
  'Pedidos de atenção da mesa (garçom, conta). Independentes de orders: não têm valor nem entram na cozinha.';

-- Consulta do painel: solicitações vivas por casa, mais antigas primeiro
-- (quem chamou primeiro é atendido primeiro).
create index if not exists table_requests_open_idx
  on public.table_requests (restaurant_id, created_at)
  where status in ('pending', 'acknowledged');

-- Histórico por mesa.
create index if not exists table_requests_table_idx
  on public.table_requests (table_id, created_at desc);

/*
 * Anti-duplicata: no máximo UMA solicitação viva por (mesa, tipo).
 *
 * É o coração do item 5 do escopo. Parcial (`where status in …`) para não
 * bloquear para sempre: resolvida ou cancelada, a mesa pode chamar de novo.
 * E é índice, não checagem em código: dois toques que chegam juntos passam
 * pelas duas leituras, mas só um insert vence.
 */
create unique index if not exists table_requests_one_live_idx
  on public.table_requests (table_id, type)
  where status in ('pending', 'acknowledged');

-- -----------------------------------------------------------------------------
-- 3. Cooldown temporal
-- -----------------------------------------------------------------------------
/**
 * Segundos mínimos entre duas solicitações do mesmo tipo na mesma mesa.
 *
 * O índice único já impede duplicata viva; isto impede a metralhadora:
 * chamar, cancelar, chamar, cancelar em 10 segundos. 120s é curto o bastante
 * para não atrapalhar quem realmente precisa e longo o bastante para conter
 * toque repetido e script trivial.
 */
create or replace function public.table_request_cooldown_seconds()
returns integer
language sql
immutable
as $$ select 120 $$;

-- -----------------------------------------------------------------------------
-- 4. Criação (cliente, via token da mesa)
-- -----------------------------------------------------------------------------
create or replace function public.create_table_request(
  p_token text,
  p_type  public.table_request_type,
  p_note  text default null
)
returns table (
  request_id    uuid,
  table_name    text,
  type          public.table_request_type,
  status        public.table_request_status,
  created_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant uuid;
  v_table      uuid;
  v_table_name text;
  v_note       text;
  v_live       integer;
  v_recent     integer;
  v_request    uuid;
  v_created    timestamptz;
begin
  -- A mesa vem do token. Token inválido, mesa inativa ou restaurante fora do
  -- ar: mesmo erro, sem revelar qual foi o caso.
  select r.restaurant_id, r.table_id, r.table_name
    into v_restaurant, v_table, v_table_name
  from public.resolve_table_token(p_token) r;

  if v_table is null or v_restaurant is null then
    raise exception 'table_unavailable' using errcode = '22023';
  end if;

  if p_type is null then
    raise exception 'invalid_type' using errcode = '22023';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;

  -- 1. Já existe uma solicitação viva deste tipo? Então não é erro do cliente:
  --    ele só tocou de novo. Devolvemos a que já está na fila, para a tela
  --    mostrar "solicitação já enviada" com o horário original.
  select count(*) into v_live
  from public.table_requests tr
  where tr.table_id = v_table
    and tr.type = p_type
    and tr.status in ('pending', 'acknowledged');

  if v_live > 0 then
    return query
      select tr.id, v_table_name, tr.type, tr.status, tr.created_at
      from public.table_requests tr
      where tr.table_id = v_table
        and tr.type = p_type
        and tr.status in ('pending', 'acknowledged')
      order by tr.created_at desc
      limit 1;
    return;
  end if;

  -- 2. Cooldown: a última solicitação deste tipo saiu há menos de 120s?
  select count(*) into v_recent
  from public.table_requests tr
  where tr.table_id = v_table
    and tr.type = p_type
    and tr.created_at > now() - make_interval(secs => public.table_request_cooldown_seconds());

  if v_recent > 0 then
    raise exception 'request_cooldown' using errcode = '54000';
  end if;

  -- `returning` com lista de colunas colidiria com o OUT param `created_at`
  -- (42702): o PL/pgSQL não distingue a coluna do parâmetro de saída. Insere,
  -- depois lê o carimbo de tempo por uma consulta qualificada.
  insert into public.table_requests (restaurant_id, table_id, type, status, note)
  values (v_restaurant, v_table, p_type, 'pending', v_note)
  returning table_requests.id into v_request;

  select tr.created_at into v_created
  from public.table_requests tr
  where tr.id = v_request;

  return query
    select v_request, v_table_name, p_type, 'pending'::public.table_request_status, v_created;
end;
$$;

comment on function public.create_table_request(text, public.table_request_type, text) is
  'Cliente chama garçom ou pede a conta pelo token da mesa. Cooldown e anti-duplicata aplicados aqui.';

revoke all on function public.create_table_request(text, public.table_request_type, text) from public;
grant execute on function public.create_table_request(text, public.table_request_type, text) to anon, authenticated;

/**
 * Situação da mesa agora, para a tela do cliente saber o que mostrar:
 *
 *   - se já existe solicitação viva, mostra "já enviada" em vez de oferecer
 *     outro botão igual;
 *   - se está em cooldown, diz quanto falta.
 *
 * Lê pelo token (não por `table_id`): o cliente não manipula id de mesa.
 */
create or replace function public.get_table_request_state(p_token text)
returns table (
  waiter_status  public.table_request_status,
  waiter_since   timestamptz,
  bill_status    public.table_request_status,
  bill_since     timestamptz,
  cooldown_until timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_table uuid;
begin
  select r.table_id into v_table from public.resolve_table_token(p_token) r;
  if v_table is null then
    return;
  end if;

  return query
    select
      (select tr.status from public.table_requests tr
        where tr.table_id = v_table and tr.type = 'waiter'
          and tr.status in ('pending', 'acknowledged')
        order by tr.created_at desc limit 1),
      (select tr.created_at from public.table_requests tr
        where tr.table_id = v_table and tr.type = 'waiter'
          and tr.status in ('pending', 'acknowledged')
        order by tr.created_at desc limit 1),
      (select tr.status from public.table_requests tr
        where tr.table_id = v_table and tr.type = 'bill'
          and tr.status in ('pending', 'acknowledged')
        order by tr.created_at desc limit 1),
      (select tr.created_at from public.table_requests tr
        where tr.table_id = v_table and tr.type = 'bill'
          and tr.status in ('pending', 'acknowledged')
        order by tr.created_at desc limit 1),
      (select tr.created_at + make_interval(secs => public.table_request_cooldown_seconds())
        from public.table_requests tr
        where tr.table_id = v_table
        order by tr.created_at desc limit 1);
end;
$$;

revoke all on function public.get_table_request_state(text) from public;
grant execute on function public.get_table_request_state(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Atendimento no painel
-- -----------------------------------------------------------------------------
/*
 * pending → acknowledged → resolved
 * e `cancelled` a partir de pending/acknowledged (a equipe cancela, ou o
 * cliente desiste pelo telefone — a linha fica para auditoria).
 *
 * Resolver direto de `pending` é permitido de propósito: numa casa pequena o
 * garçom já chega na mesa e resolve; obrigar o passo "atender" só para
 * registrar seria burocracia que ninguém cumpre.
 */
create or replace function public.set_table_request_status(
  p_request_id uuid,
  p_status     public.table_request_status
)
returns table (
  request_id uuid,
  status     public.table_request_status,
  table_name text,
  type       public.table_request_type,
  resolved_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant uuid;
  v_from       public.table_request_status;
begin
  select tr.restaurant_id, tr.status
    into v_restaurant, v_from
  from public.table_requests tr
  where tr.id = p_request_id
    and public.is_restaurant_member(tr.restaurant_id);

  if v_restaurant is null then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;

  -- Daqui em diante é tudo transição de saída de um estado vivo; a matriz é
  -- curta o suficiente para ficar explícita em vez de virar tabela.
  if v_from = 'resolved' or v_from = 'cancelled' then
    raise exception 'already_closed' using errcode = '22023';
  end if;

  if p_status not in ('acknowledged', 'resolved', 'cancelled') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  if v_from = 'acknowledged' and p_status = 'acknowledged' then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  update public.table_requests tr
     set status = p_status,
         acknowledged_at = case
           when p_status = 'acknowledged' and tr.acknowledged_at is null then now()
           else tr.acknowledged_at
         end,
         resolved_at = case
           when p_status in ('resolved', 'cancelled') then now()
           else tr.resolved_at
         end,
         actor_id = coalesce(auth.uid(), tr.actor_id)
   where tr.id = p_request_id;

  return query
    select tr.id, tr.status, t.name, tr.type, tr.resolved_at
    from public.table_requests tr
    join public.tables t on t.id = tr.table_id
    where tr.id = p_request_id;
end;
$$;

comment on function public.set_table_request_status(uuid, public.table_request_status) is
  'Atende/resolve/cancela solicitação da mesa. Só membro ativo do restaurante.';

revoke all on function public.set_table_request_status(uuid, public.table_request_status) from public;
grant execute on function public.set_table_request_status(uuid, public.table_request_status) to authenticated;

/**
 * Lista para o painel: solicitações vivas + últimas resolvidas.
 *
 * `p_open_only` separa a fila de trabalho do histórico. Limite duro porque
 * ninguém precisa rolar 500 chamadas de garçom antigas.
 */
create or replace function public.list_table_requests(
  p_restaurant_id uuid,
  p_open_only     boolean default true,
  p_limit         integer default 30
)
returns table (
  id              uuid,
  restaurant_id   uuid,
  table_id        uuid,
  table_name      text,
  type            public.table_request_type,
  status          public.table_request_status,
  note            text,
  created_at      timestamptz,
  acknowledged_at timestamptz,
  resolved_at     timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    tr.id, tr.restaurant_id, tr.table_id, t.name, tr.type, tr.status, tr.note,
    tr.created_at, tr.acknowledged_at, tr.resolved_at
  from public.table_requests tr
  join public.tables t on t.id = tr.table_id
  where tr.restaurant_id = p_restaurant_id
    and public.is_restaurant_member(p_restaurant_id)
    and (
      case
        when p_open_only then tr.status in ('pending', 'acknowledged')
        else true
      end
    )
  order by
    -- Vivas primeiro, e entre elas a mais antiga primeiro: quem chamou há mais
    -- tempo está esperando há mais tempo.
    case when tr.status in ('pending', 'acknowledged') then 0 else 1 end,
    case when tr.status in ('pending', 'acknowledged') then tr.created_at end asc,
    tr.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

revoke all on function public.list_table_requests(uuid, boolean, integer) from public;
grant execute on function public.list_table_requests(uuid, boolean, integer) to authenticated;

/** Contadores para o dashboard e para o selo do painel. */
create or replace function public.table_request_counts(p_restaurant_id uuid)
returns table (pending integer, acknowledged integer, bills integer)
language sql
security definer
set search_path = public
stable
as $$
  select
    count(*) filter (where tr.status = 'pending')::integer,
    count(*) filter (where tr.status = 'acknowledged')::integer,
    -- "Contas" no sentido de fila: mesa esperando para fechar.
    count(*) filter (where tr.type = 'bill' and tr.status in ('pending', 'acknowledged'))::integer
  from public.table_requests tr
  where tr.restaurant_id = p_restaurant_id
    and public.is_restaurant_member(p_restaurant_id);
$$;

revoke all on function public.table_request_counts(uuid) from public;
grant execute on function public.table_request_counts(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. RLS
-- -----------------------------------------------------------------------------
alter table public.table_requests enable row level security;

-- A equipe lê as suas. Cliente (anon) não lê a tabela: usa `get_table_request_state`.
drop policy if exists table_requests_select_member on public.table_requests;
create policy table_requests_select_member on public.table_requests
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

grant select on public.table_requests to authenticated;
revoke all on public.table_requests from anon;

-- -----------------------------------------------------------------------------
-- 7. Tempo real
-- -----------------------------------------------------------------------------
-- `replica identity full` para o evento trazer a linha inteira (o painel
-- filtra por restaurant_id sem consulta extra).
alter table public.table_requests replica identity full;

do $pub$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'table_requests'
  ) then
    alter publication supabase_realtime add table public.table_requests;
  end if;
end $pub$;
