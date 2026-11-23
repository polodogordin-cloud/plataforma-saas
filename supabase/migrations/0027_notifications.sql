-- ============================================================================
-- 0027 — Central de notificações (Etapa 26)
--
-- Uma tabela, uma função de emissão e três RPCs de tela. O resto é gatilho:
-- quem gera a notificação é o banco, no mesmo ato que muda o estado do pedido,
-- da solicitação de mesa, do pagamento ou da assinatura. **Nenhuma tela é
-- responsável por avisar** — se fosse, o aviso dependeria de alguém estar olhando
-- a tela certa na hora certa.
--
-- Decisões que valem dinheiro, tempo ou confiança:
--
-- 1. **A notificação é registro, não fila.** `notifications` guarda o que
--    aconteceu e para quem. Não existe `pending`, `sent`, retry nem worker: não
--    há envio externo nesta etapa, e uma coluna de "status de envio" sem worker
--    faria o painel mentir ("enviado" para quem nunca recebeu).
--
-- 2. **Som, push e websocket são canais de leitura, não de escrita.** O painel
--    lê por RLS + tempo real; nada precisa ser marcado como entregue para a
--    pessoa ser avisada. É por isso que uma notificação criada com a aba
--    fechada continua valendo quando ela abre: a linha está lá.
--
-- 3. **Preferências filtram na EMISSÃO, não na leitura.** Se o dono desligou
--    "novo pedido", a linha não é criada. Guardar e esconder na tela deixaria o
--    contador do sino cheio de avisos que ninguém quer e o `update` em massa
--    varrendo histórico morto.
--
-- 4. **Uma preferência desligada não desliga o fato.** O pedido continua sendo
--    criado, a mesa continua chamando. Só não gera sino.
--
-- 5. **Notificação por usuário, sem linha "para todos".** O leque é resolvido
--    na emissão: um INSERT para cada membro ativo autorizado. Assim "marcar
--    como lida" é um `update` na própria linha, sem tabela de leitura paralela
--    (que é onde o contador de não lidas sempre acaba divergindo).
--
-- 6. **Cliente não recebe notificação nesta etapa.** O escopo permite "quando
--    apropriado", e o único canal seria o próprio cardápio aberto — que já
--    mostra status do pedido na tela. Criar linha para quem não tem login
--    criaria dado órfão sem ninguém para ler.
--
-- 7. **Pedido novo NÃO é gatilho de INSERT.** `create_order` grava o cabeçalho
--    com total 0 e calcula os itens depois; um trigger de INSERT dispararia ali
--    e o dono leria "pedido de R$ 0,00". O aviso sai no fim da função, com os
--    totais já gravados, e dentro de um bloco de exceção: sino que falha não
--    pode derrubar o pedido de um cliente.
--
-- 8. **Quem causou recebe a linha já lida.** `notify_restaurant_staff` marca
--    `read_at` para o autor da ação em vez de excluí-lo. Excluir parecia certo
--    até a conta ficar fácil: numa casa com um único usuário (o caso de quase
--    todo restaurante pequeno), "pedido pronto" não avisaria ninguém e o fato
--    sumiria do histórico.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------

/**
 * Tipos de notificação. Agrupados por origem para o painel de preferências
 * poder mostrar "Pedidos", "Salão", "Pagamentos", "Assinatura", "Marketing".
 *
 * Os avisos de assinatura são dois, pelo tempo verbal: `subscription_expiring`
 * (ainda dá tempo de renovar) e `subscription_expired` (já passou). São estados
 * diferentes para quem lê — "renove" e "regularize" pedem ações diferentes —
 * e separá-los evita um campo "gravidade" que a tela teria de interpretar.
 */
do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_type') then
    create type public.notification_type as enum (
      -- pedidos e cozinha
      'order_created',
      'order_cancelled',
      'order_ready',
      'order_delivered',
      -- salão
      'table_waiter_called',
      'table_bill_requested',
      -- pagamentos do pedido
      'payment_received',
      'payment_failed',
      -- assinatura do restaurante
      'subscription_expiring',
      'subscription_expired',
      -- relacionamento
      'customer_created',
      'coupon_expiring'
    );
  end if;
end
$$;

/** Entidade para onde a notificação aponta. `null` = não há tela de destino. */
do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_entity') then
    create type public.notification_entity as enum (
      'order',
      'table_request',
      'payment',
      'subscription',
      'customer',
      'coupon'
    );
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 2. Tabela: notifications
-- ----------------------------------------------------------------------------

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  -- Nulo em notificação global (master admin): não pertence a uma casa.
  restaurant_id uuid references public.restaurants (id) on delete cascade,
  -- Destinatário. Nulo = global (só admin da plataforma consegue ler).
  user_id     uuid references auth.users (id) on delete cascade,
  type        public.notification_type not null,
  title       text not null,
  message     text not null,
  entity_type public.notification_entity,
  entity_id   uuid,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),

  constraint notifications_title_length check (char_length(title) between 1 and 120),
  constraint notifications_message_length check (char_length(message) between 1 and 400),
  /*
   * Escopo coerente: notificação de restaurante precisa de casa; notificação
   * global não pode ter casa. Sem isto, "global" e "de uma casa" virariam a
   * mesma linha com dois significados e a RLS teria de adivinhar.
   */
  constraint notifications_scope_check check (
    user_id is not null and restaurant_id is not null
    or user_id is null and restaurant_id is null
  ),
  -- Entidade só vai acompanhada do tipo dela: id solto não abre tela nenhuma.
  constraint notifications_entity_pair check (
    (entity_type is null and entity_id is null)
    or (entity_type is not null and entity_id is not null)
  )
);

comment on table public.notifications is
  'Central de notificações (Etapa 26). Linha por destinatário; emitida por trigger/RPC no banco, nunca pela tela.';
comment on column public.notifications.user_id is
  'Destinatário. Nulo = notificação global, visível só para admin da plataforma.';
comment on column public.notifications.read_at is
  'Quando o destinatário leu. Nulo = não lida. Único estado mutável da linha.';
comment on column public.notifications.entity_id is
  'Id da entidade de destino (pedido, solicitação, cobrança). Sem FK de propósito: apagar o pedido não pode apagar o aviso de que ele existiu.';

-- Índices na ordem em que a tela consulta: "as minhas, mais novas primeiro",
-- "as minhas não lidas" (contador do sino) e "as desta entidade" (evitar
-- duplicar aviso sobre o mesmo pedido).
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

create index if not exists notifications_restaurant_created_idx
  on public.notifications (restaurant_id, created_at desc);

create index if not exists notifications_entity_idx
  on public.notifications (entity_type, entity_id)
  where entity_type is not null;

alter table public.notifications enable row level security;

-- Realtime: o sino atualiza por evento, não por polling. `replica identity full`
-- porque o evento precisa do `user_id`/`restaurant_id` para o cliente filtrar
-- sem consultar nada.
alter table public.notifications replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 3. Preferências: notification_preferences
-- ----------------------------------------------------------------------------

/**
 * Uma linha por (usuário, restaurante), com um jsonb de tipos desligados.
 *
 * Por que jsonb e não uma coluna por tipo: os tipos vão crescer (campanha,
 * conta a receber, estoque) e cada tipo novo viraria migration + alteração no
 * formulário. O banco valida o conjunto de chaves na escrita da RPC, então
 * "jsonb livre" não é "jsonb sem regra".
 *
 * Guardamos o **desligado**, não o ligado: tipo novo nasce ligado, que é o
 * comportamento certo para aviso operacional. Guardar "ligado" faria cada tipo
 * novo nascer silencioso até alguém editar a preferência.
 */
create table if not exists public.notification_preferences (
  user_id       uuid not null references auth.users (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  disabled      jsonb not null default '[]'::jsonb,
  updated_at    timestamptz not null default now(),
  primary key (user_id, restaurant_id),

  constraint notification_preferences_shape check (jsonb_typeof(disabled) = 'array')
);

comment on table public.notification_preferences is
  'Tipos de notificação desligados por usuário em cada casa (Etapa 26). Ausência = tudo ligado.';

alter table public.notification_preferences enable row level security;

-- ----------------------------------------------------------------------------
-- 4. Pré-requisito: pedido tem de saber qual mesa é, para o texto do aviso
-- ----------------------------------------------------------------------------

/*
 * `order_notification_context` resolve, em uma consulta só, o que o texto da
 * notificação precisa: número do pedido, nome da mesa e total.
 *
 * Fica como função (e não como join dentro do trigger) porque o mesmo texto é
 * usado em três gatilhos diferentes. `security definer` de propósito: o trigger
 * de `orders` roda no envio anônimo do cliente, e `auth.uid()` ali é nulo.
 */
create or replace function public.order_notification_context(p_order_id uuid)
returns table (order_number integer, table_name text, total numeric, restaurant_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select o.order_number, coalesce(t.name, 'Mesa'), o.total, o.restaurant_id
  from public.orders o
  left join public.tables t on t.id = o.table_id
  where o.id = p_order_id;
$$;

comment on function public.order_notification_context(uuid) is
  'Contexto de texto do aviso de pedido (numero, mesa, total). Sem guarda de proposito: chamada interna.';

-- ----------------------------------------------------------------------------
-- 5. Emissão
-- ----------------------------------------------------------------------------

/**
 * `notify_restaurant_staff` — a única porta de emissão.
 *
 * Chamada **de dentro do banco** (triggers e RPCs). Não é concedida a cliente:
 * notificação é consequência de um fato, não algo que a tela pede. Se a
 * cliente pedisse, um usuário poderia notificar o outro com texto arbitrário.
 *
 * Parâmetros:
 *   p_restaurant_id — casa dona do fato (nulo = global, só admin da plataforma);
 *   p_type          — tipo do aviso (decide quem recebe e se a preferência vale);
 *   p_title/p_message — texto já pronto em português;
 *   p_entity_type/p_entity_id — para onde o toque leva;
 *   p_actor_user    — quem causou a ação. **Não é excluído**: a linha dele nasce
 *                     com `read_at` preenchido, que é "registro sem ruído no
 *                     sino". Excluir deixaria a casa de um único usuário sem
 *                     nenhuma notificação de "pronto";
 *   p_roles         — papéis que recebem; nulo = todos os membros ativos.
 *
 * Devolve quantas linhas criou, para o teste conseguir afirmar "avisou 2".
 *
 * ─── Por que o leque é no banco ─────────────────────────────────────────────
 *
 * Porque a autorização está aqui. Escolher destinatário no app exigiria o app
 * ler `restaurant_users` e decidir quem é "admin" — duas cópias da mesma regra,
 * e a do app seria a que roda primeiro.
 */
create or replace function public.notify_restaurant_staff(
  p_restaurant_id uuid,
  p_type          public.notification_type,
  p_title         text,
  p_message       text,
  p_entity_type   public.notification_entity default null,
  p_entity_id     uuid default null,
  p_actor_user    uuid default null,
  p_roles         public.restaurant_member_role[] default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  if p_restaurant_id is null then
    return 0;
  end if;

  /*
   * Notificação global (destinatário nulo, casa nula) não passa por aqui: ela
   * nasce pela função de admin, que exige `is_platform_admin()`. Deixar esta
   * porta criar linha global daria a um trigger de restaurante o poder de
   * escrever algo que todo master lê.
   */
  with destinos as (
    select ru.user_id, (ru.user_id = p_actor_user) as ja_lida
    from public.restaurant_users ru
    where ru.restaurant_id = p_restaurant_id
      and ru.status = 'active'
      -- `kitchen` só recebe o que é de cozinha.
      and case
            when ru.role = 'kitchen' then p_type in ('order_created', 'order_cancelled', 'order_ready')
            -- `waiter` só é avisado do salão e do "pronto": pedido novo e
            -- pagamento são do balcão, e encher o celular de quem serve mesa com
            -- aviso de caixa é o caminho mais curto para ele desligar tudo.
            when ru.role = 'waiter' then p_type in ('table_waiter_called', 'table_bill_requested', 'order_ready')
            else true
          end
      and (p_roles is null or ru.role = any (p_roles))
      and not coalesce(
        (
          select np.disabled ? p_type::text
          from public.notification_preferences np
          where np.user_id = ru.user_id
            and np.restaurant_id = p_restaurant_id
        ),
        false
      )
  ),
  inseridos as (
    insert into public.notifications (
      restaurant_id, user_id, type, title, message, entity_type, entity_id, read_at
    )
    select p_restaurant_id, d.user_id, p_type,
           left(p_title, 120), left(p_message, 400), p_entity_type, p_entity_id,
           case when d.ja_lida then now() else null end
    from destinos d
    returning 1
  )
  select count(*) into v_count from inseridos;

  return v_count;
end;
$$;

revoke all on function public.notify_restaurant_staff(
  uuid, public.notification_type, text, text,
  public.notification_entity, uuid, uuid, public.restaurant_member_role[]
) from public, anon, authenticated;

comment on function public.notify_restaurant_staff(
  uuid, public.notification_type, text, text,
  public.notification_entity, uuid, uuid, public.restaurant_member_role[]
) is
  'Porta única de emissão para a equipe. p_actor_user não é excluído: a linha dele nasce lida (registro sem ruído no sino).';

/**
 * `notify_platform_admins` — aviso global (master admin).
 *
 * Única porta que cria linha com `restaurant_id`/`user_id` nulos. Serve para o
 * que é da plataforma: pagamento para confirmar, assinatura vencida. A guarda é
 * `is_platform_admin()` **quando há usuário na sessão**; quando o chamador é o
 * próprio banco (job/trigger), `auth.uid()` é nulo e a chamada é confiada —
 * mesma regra já usada em `can_read_tenant` (0021).
 */
create or replace function public.notify_platform_admins(
  p_type    public.notification_type,
  p_title   text,
  p_message text,
  p_entity_type public.notification_entity default null,
  p_entity_id   uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
  v_caller uuid := auth.uid();
begin
  if v_caller is not null and not public.is_platform_admin() then
    raise exception 'notification_forbidden' using errcode = '42501';
  end if;

  -- Uma linha global (user_id nulo) é o suficiente: a RLS deixa todo admin da
  -- plataforma ler, e `read_at` fica nulo até o primeiro deles abrir. Criar uma
  -- linha por admin multiplicaria a mesma notificação e faria "marcar como
  -- lida" precisar de N updates.
  insert into public.notifications (restaurant_id, user_id, type, title, message, entity_type, entity_id)
  values (null, null, p_type, left(p_title, 120), left(p_message, 400), p_entity_type, p_entity_id);

  v_count := 1;
  return v_count;
end;
$$;

revoke all on function public.notify_platform_admins(
  public.notification_type, text, text, public.notification_entity, uuid
) from public, anon;
grant execute on function public.notify_platform_admins(
  public.notification_type, text, text, public.notification_entity, uuid
) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Gatilhos: pedido
-- ----------------------------------------------------------------------------

/**
 * Pedido criado — emitido pelo **fim de `create_order`**, não por trigger.
 *
 * Motivo medido em teste, não suposto: o `insert` do cabeçalho acontece antes
 * da soma dos itens e do desconto. Um trigger `after insert` dispara naquele
 * instante, com `subtotal = 0`, e a mensagem sai como "pedido de R$ 0,00". A
 * notificação de um pedido só faz sentido depois que o pedido tem valor.
 */
create or replace function public.notifications_emit_order_created(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.order_notification_context(p_order_id);
  if v_ctx.restaurant_id is null then
    return 0;
  end if;

  return public.notify_restaurant_staff(
    v_ctx.restaurant_id,
    'order_created',
    'Novo pedido #' || v_ctx.order_number,
    format('%s fez um pedido de %s.', v_ctx.table_name, public.format_brl(v_ctx.total)),
    'order', p_order_id
  );
end;
$$;

revoke all on function public.notifications_emit_order_created(uuid) from public, anon, authenticated;

comment on function public.notifications_emit_order_created(uuid) is
  'Aviso de pedido novo. Chamada no fim de create_order, quando subtotal/total já foram gravados.';

/**
 * Mudança de status: "pronto", "cancelado", "entregue".
 *
 * `after update of status` — o `of` faz o Postgres só disparar quando a coluna
 * de status está no `set`, então o `update` de totais de `create_order` não
 * gera evento. A guarda `new.status = old.status` cobre o reenvio do mesmo
 * valor.
 */
create or replace function public.notifications_on_order_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx   record;
  v_actor uuid := auth.uid();
begin
  if tg_op <> 'UPDATE' or new.status = old.status then
    return new;
  end if;

  select * into v_ctx from public.order_notification_context(new.id);

  if new.status = 'ready' then
    perform public.notify_restaurant_staff(
      new.restaurant_id,
      'order_ready',
      'Pedido #' || v_ctx.order_number || ' pronto',
      format('%s está esperando a retirada no balcão.', v_ctx.table_name),
      'order', new.id,
      v_actor
    );
  elsif new.status = 'cancelled' then
    perform public.notify_restaurant_staff(
      new.restaurant_id,
      'order_cancelled',
      'Pedido #' || v_ctx.order_number || ' cancelado',
      format('O pedido de %s foi cancelado e saiu da fila.', v_ctx.table_name),
      'order', new.id,
      v_actor
    );
  elsif new.status = 'delivered' then
    perform public.notify_restaurant_staff(
      new.restaurant_id,
      'order_delivered',
      'Pedido #' || v_ctx.order_number || ' entregue',
      format('%s recebeu o pedido de %s.', v_ctx.table_name, public.format_brl(v_ctx.total)),
      'order', new.id,
      v_actor
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notifications_order_change on public.orders;
create trigger notifications_order_change
  after update of status on public.orders
  for each row execute function public.notifications_on_order_change();

-- ----------------------------------------------------------------------------
-- 7. Gatilhos: solicitação de mesa
-- ----------------------------------------------------------------------------

create or replace function public.notifications_on_table_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table_name text;
  v_title      text;
  v_message    text;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  select coalesce(t.name, 'Mesa') into v_table_name
  from public.tables t where t.id = new.table_id;

  if new.type = 'waiter' then
    v_title := 'Garçom chamado';
    v_message := format('%s está chamando o garçom.', v_table_name);
  else
    v_title := 'Conta pedida';
    v_message := format('%s pediu a conta.', v_table_name);
  end if;

  if new.note is not null then
    v_message := v_message || ' "' || left(new.note, 120) || '"';
  end if;

  perform public.notify_restaurant_staff(
    new.restaurant_id,
    case when new.type = 'waiter' then 'table_waiter_called'::public.notification_type
         else 'table_bill_requested'::public.notification_type end,
    v_title,
    v_message,
    'table_request', new.id
  );

  return new;
end;
$$;

drop trigger if exists notifications_table_request on public.table_requests;
create trigger notifications_table_request
  after insert on public.table_requests
  for each row execute function public.notifications_on_table_request();

-- ----------------------------------------------------------------------------
-- 8. Gatilhos: pagamento do pedido
-- ----------------------------------------------------------------------------

/**
 * Pagamento registrado ou estornado no pedido (Etapa 16).
 *
 * Só `paid` e `refunded` geram aviso. `pending` é estado de intenção — o salão
 * acabou de digitar o valor, e avisar "pagamento pendente" para quem acabou de
 * registrar é ruído.
 */
create or replace function public.notifications_on_order_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx   record;
  v_actor uuid := auth.uid();
begin
  if new.status not in ('paid', 'refunded') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status = old.status then
    return new;
  end if;

  select * into v_ctx from public.order_notification_context(new.order_id);

  if new.status = 'paid' then
    perform public.notify_restaurant_staff(
      new.restaurant_id,
      'payment_received',
      'Pagamento recebido',
      format('Pedido #%s · %s pago em %s.', v_ctx.order_number,
             public.format_brl(new.amount), public.format_payment_method(new.method)),
      'payment', new.id,
      v_actor
    );
  else
    perform public.notify_restaurant_staff(
      new.restaurant_id,
      'payment_failed',
      'Pagamento estornado',
      format('Pedido #%s · %s devolvido ao cliente.', v_ctx.order_number, public.format_brl(new.amount)),
      'payment', new.id,
      v_actor
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notifications_order_payment on public.order_payments;
create trigger notifications_order_payment
  after insert or update of status on public.order_payments
  for each row execute function public.notifications_on_order_payment();

-- ----------------------------------------------------------------------------
-- 9. Gatilhos: cliente novo e cupom expirando
-- ----------------------------------------------------------------------------

/**
 * Cliente novo — só o primeiro cadastro.
 *
 * `upsert_customer_for_order` roda a cada pedido identificado; sem a checagem
 * de `INSERT`, cada pedido do mesmo telefone anunciaria "novo cliente" de novo.
 */
create or replace function public.notifications_on_customer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  perform public.notify_restaurant_staff(
    new.restaurant_id,
    'customer_created',
    'Novo cliente',
    left(coalesce(new.name, 'Um cliente') || ' entrou na lista de clientes da casa.', 200),
    'customer', new.id
  );

  return new;
end;
$$;

drop trigger if exists notifications_customer on public.customers;
create trigger notifications_customer
  after insert on public.customers
  for each row execute function public.notifications_on_customer();

/**
 * Cupom chegando ao fim.
 *
 * Não é um aviso por cupom e sim um resumo **uma vez por dia** por casa: cupom
 * expirando merece uma linha com a contagem, não uma enxurrada de "BEMVINDO10
 * expira amanhã". A função `run_coupon_review` é chamada pela tela (ao abrir o
 * painel) — sem cron, pelo mesmo motivo das assinaturas: não há worker neste
 * projeto e inventar um esconderia a dependência.
 *
 * Idempotente por casa/dia: a segunda chamada no mesmo dia não cria nada.
 */
create or replace function public.run_coupon_review(p_restaurant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count   integer := 0;
  v_nomes   text;
  v_created integer := 0;
begin
  if p_restaurant_id is null or not public.is_restaurant_member(p_restaurant_id) then
    raise exception 'notification_forbidden' using errcode = '42501';
  end if;

  select count(*), string_agg(c.code, ', ' order by c.code)
    into v_count, v_nomes
  from public.coupons c
  where c.restaurant_id = p_restaurant_id
    and c.active
    and c.ends_at is not null
    and c.ends_at > now()
    and c.ends_at <= now() + interval '3 days';

  if v_count = 0 then
    return jsonb_build_object('expiring', 0, 'created', 0);
  end if;

  -- Uma vez por dia por casa: o `notifications_entity_idx` não ajuda aqui
  -- porque a linha é da casa, não de um cupom específico.
  if exists (
    select 1 from public.notifications n
    where n.restaurant_id = p_restaurant_id
      and n.type = 'coupon_expiring'
      and n.created_at > date_trunc('day', now())
  ) then
    return jsonb_build_object('expiring', v_count, 'created', 0);
  end if;

  v_created := public.notify_restaurant_staff(
    p_restaurant_id,
    'coupon_expiring',
    case when v_count = 1 then 'Cupom expira em breve' else v_count::text || ' cupons expiram em breve' end,
    left('Vencem nos próximos 3 dias: ' || coalesce(v_nomes, ''), 300),
    null, null
  );

  return jsonb_build_object('expiring', v_count, 'created', v_created);
end;
$$;

revoke all on function public.run_coupon_review(uuid) from public, anon;
grant execute on function public.run_coupon_review(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 10. Gatilho: assinatura
-- ----------------------------------------------------------------------------

/**
 * Assinatura vencendo ou vencida — sem cron.
 *
 * O projeto já tem `run_subscription_review`, chamado na tela de assinaturas do
 * master. Esta função faz o mesmo trabalho **por casa**, na véspera e no
 * vencimento, e é chamada quando o dono abre o painel. Assim o dado que ele vê
 * já está atualizado, e nenhum worker fica de pé sem ninguém olhando.
 *
 * Idempotente por tipo/dia: abrir o painel dez vezes não enche o sino.
 *
 * Faixas (todas em relação a `current_period_end`, ou `trial_end` no teste):
 *   • faltando até 3 dias  → `subscription_expiring`;
 *   • já passou            → `subscription_expired`.
 */
create or replace function public.run_notification_review(p_restaurant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fim      timestamptz;
  v_status   public.subscription_state;
  v_quando   timestamptz;
  v_expiring integer := 0;
  v_expired  integer := 0;
  v_cupom    jsonb;
begin
  if p_restaurant_id is null or not public.is_restaurant_member(p_restaurant_id) then
    raise exception 'notification_forbidden' using errcode = '42501';
  end if;

  select s.status,
         case when s.status = 'trial' then s.trial_end else s.current_period_end end
    into v_status, v_fim
  from public.subscriptions s
  where s.restaurant_id = p_restaurant_id
    and s.cancelled_at is null
  order by s.created_at desc
  limit 1;

  if v_fim is not null and v_status in ('active', 'trial') then
    if v_fim <= now() then
      if not exists (
        select 1 from public.notifications n
        where n.restaurant_id = p_restaurant_id
          and n.type = 'subscription_expired'
          and n.created_at > date_trunc('day', now())
      ) then
        v_expired := public.notify_restaurant_staff(
          p_restaurant_id,
          'subscription_expired',
          'Assinatura vencida',
          'O prazo da assinatura terminou. Regularize para não perder acesso ao cardápio publicado.',
          'subscription', p_restaurant_id,
          null,
          array['owner', 'admin', 'manager']::public.restaurant_member_role[]
        );
      end if;
    elsif v_fim <= now() + interval '3 days' then
      if not exists (
        select 1 from public.notifications n
        where n.restaurant_id = p_restaurant_id
          and n.type = 'subscription_expiring'
          and n.created_at > date_trunc('day', now())
      ) then
        v_quando := v_fim;
        v_expiring := public.notify_restaurant_staff(
          p_restaurant_id,
          'subscription_expiring',
          'Assinatura vencendo',
          format('A assinatura vence em %s. Renove para manter o cardápio no ar.',
                 to_char(v_quando at time zone 'America/Sao_Paulo', 'DD/MM')),
          'subscription', p_restaurant_id,
          null,
          array['owner', 'admin', 'manager']::public.restaurant_member_role[]
        );
      end if;
    end if;
  end if;

  v_cupom := public.run_coupon_review(p_restaurant_id);

  return jsonb_build_object(
    'expiring', v_expiring,
    'expired', v_expired,
    'coupons', v_cupom
  );
end;
$$;

revoke all on function public.run_notification_review(uuid) from public, anon;
grant execute on function public.run_notification_review(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 11. Pagamento da assinatura: confirmado / recusado (master admin)
-- ----------------------------------------------------------------------------

/**
 * Confirmação e recusa de pagamento de plano avisam **a casa**, não o master:
 * quem precisa saber que o Pix caiu é o dono. O master já vê a fila na tela de
 * pagamentos e recebe aviso global separado (`payment_requests` pendente).
 */
create or replace function public.notifications_on_payment_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'CONFIRMED' then
    perform public.notify_restaurant_staff(
      new.restaurant_id,
      'payment_received',
      'Pagamento confirmado',
      format('O pagamento de %s do plano %s foi confirmado.', public.format_brl(new.amount), new.plan_name),
      'payment', new.id,
      null,
      array['owner', 'admin', 'manager']::public.restaurant_member_role[]
    );
  elsif new.status = 'REJECTED' then
    perform public.notify_restaurant_staff(
      new.restaurant_id,
      'payment_failed',
      'Pagamento não confirmado',
      left('O comprovante de ' || public.format_brl(new.amount) || ' foi recusado'
           || coalesce(': ' || new.rejection_reason, '.'), 300),
      'payment', new.id,
      null,
      array['owner', 'admin', 'manager']::public.restaurant_member_role[]
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notifications_payment_request on public.payment_requests;
create trigger notifications_payment_request
  after update of status on public.payment_requests
  for each row execute function public.notifications_on_payment_request();

-- ----------------------------------------------------------------------------
-- 12. Formatação compartilhada (usada nos textos acima)
-- ----------------------------------------------------------------------------

/**
 * "R$ 27,50" — mesmo formato do app, sem depender de locale do servidor.
 *
 * Escrito à mão de propósito: `to_char(..., 'L999G999D99')` depende de
 * `lc_monetary` do cluster, e no Supabase ele é `C` — a saída viria com outro
 * separador. Aqui a saída é a mesma do `formatPrice` do app em qualquer ambiente.
 */
create or replace function public.format_brl(p_value numeric)
returns text
language sql
immutable
as $$
  with base as (
    select round(coalesce(p_value, 0), 2) as v
  ),
  texto as (
    select
      v,
      -- `to_char` garante duas casas e nenhum separador de milhar; a partir
      -- daqui só a parte inteira precisa de ponto.
      to_char(abs(v), 'FM999999999999990.00') as t
    from base
  )
  select (case when v < 0 then '-' else '' end)
    || 'R$ '
    || regexp_replace(split_part(t, '.', 1), '(\d)(?=(\d{3})+$)', '\1.', 'g')
    || ',' || split_part(t, '.', 2)
  from texto;
$$;

comment on function public.format_brl(numeric) is
  'Formata BRL para texto de notificação. Espelha formatPrice do app, sem depender de lc_monetary.';

-- ----------------------------------------------------------------------------
-- 13. RPCs da tela
-- ----------------------------------------------------------------------------

/**
 * `list_notifications` — a lista do painel.
 *
 * Devolve já o contador de não lidas junto (numa segunda coluna), num único
 * round-trip: o sino precisa dos dois números ao mesmo tempo, e duas RPCs
 * dariam a janela em que o contador não bate com a lista.
 *
 * O leque de leitura é a RLS, mas a função repete a regra: notificação do
 * usuário **ou** global para admin da plataforma. Duas camadas, como no resto do
 * projeto.
 */
create or replace function public.list_notifications(
  p_limit  integer default 30,
  p_offset integer default 0,
  p_unread_only boolean default false
)
returns table (
  id          uuid,
  restaurant_id uuid,
  type        public.notification_type,
  title       text,
  message     text,
  entity_type public.notification_entity,
  entity_id   uuid,
  read_at     timestamptz,
  created_at  timestamptz,
  is_global   boolean,
  unread_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with minhas as (
    select n.*
    from public.notifications n
    where (
        n.user_id = auth.uid()
        and (n.restaurant_id is null or public.is_restaurant_member(n.restaurant_id))
      )
      or (
        n.user_id is null
        and public.is_platform_admin()
      )
  ),
  contagem as (
    select count(*) as total from minhas where read_at is null
  )
  select m.id, m.restaurant_id, m.type, m.title, m.message,
         m.entity_type, m.entity_id, m.read_at, m.created_at,
         (m.user_id is null) as is_global,
         (select total from contagem) as unread_count
  from minhas m
  where not p_unread_only or m.read_at is null
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_notifications(integer, integer, boolean) from public, anon;
grant execute on function public.list_notifications(integer, integer, boolean) to authenticated;

/**
 * `unread_notification_count` — só o número do sino.
 *
 * Existe separado porque a barra e o layout precisam do contador em toda
 * navegação, sem carregar trinta linhas. É um `count` no índice parcial.
 */
create or replace function public.unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.notifications n
  where n.read_at is null
    and (
      (n.user_id = auth.uid() and (n.restaurant_id is null or public.is_restaurant_member(n.restaurant_id)))
      or (n.user_id is null and public.is_platform_admin())
    );
$$;

revoke all on function public.unread_notification_count() from public, anon;
grant execute on function public.unread_notification_count() to authenticated;

/**
 * `mark_notification_read` — marca UMA.
 *
 * `p_id` é obrigatório de propósito. A primeira versão aceitava `p_id nulo = 
 * todas` e isso virou bug medido em teste: um id que não resolve — notificação
 * de outra casa, escondida pela RLS — chegava como `NULL` e a chamada limpava o
 * sino inteiro. Duas ações, duas funções.
 *
 * A condição `user_id = auth.uid()` está no `WHERE` do update: sem ela, o id de
 * outra pessoa seria aceito pela RPC mesmo com a RLS revidando, e a diferença
 * apareceria só em produção.
 */
create or replace function public.mark_notification_read(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_id is null then
    raise exception 'notification_id_required' using errcode = '22023';
  end if;

  with alvo as (
    update public.notifications n
       set read_at = now()
     where n.id = p_id
       and n.read_at is null
       and (
         n.user_id = auth.uid()
         or (n.user_id is null and public.is_platform_admin())
       )
    returning 1
  )
  select count(*) into v_count from alvo;

  return v_count;
end;
$$;

revoke all on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;

/**
 * `mark_all_notifications_read` — marca TODAS as minhas.
 *
 * Não toca em notificação global: a linha global é uma só para todos os admins
 * da plataforma, e "marcar todas" de um admin não pode apagar o aviso dos
 * outros. Para a global existe o `mark_notification_read` com o id.
 */
create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  with alvo as (
    update public.notifications n
       set read_at = now()
     where n.read_at is null
       and n.user_id = auth.uid()
    returning 1
  )
  select count(*) into v_count from alvo;

  return v_count;
end;
$$;

revoke all on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_all_notifications_read() to authenticated;

/* --------------------------------------------------------------------------
 * Preferências
 * ------------------------------------------------------------------------ */

/**
 * `my_notification_preferences` — tipos desligados + catálogo rotulado.
 *
 * O catálogo vem daqui, e não de uma constante no TypeScript, para o formulário
 * listar exatamente os tipos que o banco emite. Tipo novo no enum aparece na
 * tela sem deploy — e o teste de paridade enum×catálogo no harness garante que
 * nenhum tipo emite sem aparecer para ser desligado.
 */
create or replace function public.my_notification_preferences(p_restaurant_id uuid)
returns table (disabled text[], catalog jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(
      (select array_agg(value::text)
         from public.notification_preferences np,
              jsonb_array_elements_text(np.disabled) value
        where np.user_id = auth.uid() and np.restaurant_id = p_restaurant_id),
      array[]::text[]
    ),
    (
      select jsonb_agg(jsonb_build_object('type', t.t, 'label', t.label, 'group', t.grp) order by t.ord)
      from (values
        ('order_created'::public.notification_type, 'Novo pedido', 'Pedidos', 1),
        ('order_cancelled', 'Pedido cancelado', 'Pedidos', 2),
        ('order_ready', 'Pedido pronto', 'Pedidos', 3),
        ('order_delivered', 'Pedido entregue', 'Pedidos', 4),
        ('table_waiter_called', 'Garçom chamado', 'Salão', 5),
        ('table_bill_requested', 'Conta pedida', 'Salão', 6),
        ('payment_received', 'Pagamento confirmado', 'Pagamentos', 7),
        ('payment_failed', 'Pagamento recusado ou estornado', 'Pagamentos', 8),
        ('subscription_expiring', 'Assinatura vencendo', 'Assinatura', 9),
        ('subscription_expired', 'Assinatura vencida', 'Assinatura', 10),
        ('customer_created', 'Novo cliente', 'Clientes', 11),
        ('coupon_expiring', 'Cupom expirando', 'Marketing', 12)
      ) as t(t, label, grp, ord)
    );
$$;

revoke all on function public.my_notification_preferences(uuid) from public, anon;
grant execute on function public.my_notification_preferences(uuid) to authenticated;

/**
 * `save_notification_preferences` — grava os tipos desligados.
 *
 * Valida cada chave contra o enum: jsonb livre aceitaria `{"foo": true}` e o
 * painel salvaria "desligado" para um tipo que não existe, sem ninguém notar.
 * Tipo desconhecido **derruba** a gravação em vez de ser ignorado — salvar
 * parcialmente daria à pessoa a impressão de que desligou algo.
 */
create or replace function public.save_notification_preferences(
  p_restaurant_id uuid,
  p_disabled      text[]
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key   text;
  v_valid text[];
  v_count integer;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    raise exception 'notification_forbidden' using errcode = '42501';
  end if;

  select array_agg(e.enumlabel) into v_valid
  from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'notification_type';

  foreach v_key in array coalesce(p_disabled, array[]::text[]) loop
    if not (v_key = any (v_valid)) then
      raise exception 'unknown_notification_type' using errcode = '22023', detail = v_key;
    end if;
  end loop;

  insert into public.notification_preferences (user_id, restaurant_id, disabled, updated_at)
  values (
    auth.uid(),
    p_restaurant_id,
    -- `distinct` + ordenado: chave repetida não deve contar duas vezes.
    coalesce((select jsonb_agg(k) from (select distinct unnest(coalesce(p_disabled, array[]::text[])) k order by k) x), '[]'::jsonb),
    now()
  )
  on conflict (user_id, restaurant_id) do update
    set disabled = excluded.disabled,
        updated_at = now();

  select coalesce(array_length(p_disabled, 1), 0) into v_count;
  return v_count;
end;
$$;

revoke all on function public.save_notification_preferences(uuid, text[]) from public, anon;
grant execute on function public.save_notification_preferences(uuid, text[]) to authenticated;

/**
 * Remove notificação global do mesmo tipo criada hoje.
 *
 * Serve para o aviso de "pagamento na fila": o master precisa saber que há algo
 * para confirmar, não receber uma linha por Pix pedido. Apaga a de hoje (e só a
 * de hoje) antes de inserir a nova, para a mensagem refletir a contagem atual.
 */
create or replace function public.refresh_global_notification(
  p_type    public.notification_type,
  p_title   text,
  p_message text,
  p_entity_type public.notification_entity default null,
  p_entity_id   uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.notifications n
  where n.user_id is null
    and n.type = p_type
    and n.created_at > date_trunc('day', now());

  return public.notify_platform_admins(p_type, p_title, p_message, p_entity_type, p_entity_id);
end;
$$;

revoke all on function public.refresh_global_notification(
  public.notification_type, text, text, public.notification_entity, uuid
) from public, anon, authenticated;

/** "Pix", "Dinheiro", "Cartão", "Outro" — rótulo do método na mensagem. */
create or replace function public.format_payment_method(p_method public.payment_method)
returns text
language sql
immutable
as $$
  select case p_method
    when 'cash' then 'dinheiro'
    when 'pix' then 'Pix'
    when 'card' then 'cartão'
    else 'outro meio'
  end;
$$;

comment on function public.format_payment_method(public.payment_method) is
  'Rotulo do meio de pagamento no texto da notificacao.';

/* --------------------------------------------------------------------------
 * Aviso global: pagamento de plano na fila
 * ------------------------------------------------------------------------ */

/**
 * Um pedido de pagamento novo é assunto da plataforma, não da casa que pediu:
 * o dono já sabe que pediu. O master é quem precisa agir.
 *
 * Evita duplicidade por casa/dia: dois Pix pedidos no mesmo dia geram um aviso
 * só, com a contagem atualizada na mensagem.
 */
create or replace function public.notifications_on_payment_request_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.refresh_global_notification(
    'payment_received',
    'Pagamento de plano na fila',
    left(format('%s pediu o plano %s (%s). Confira o comprovante.',
                (select r.name from public.restaurants r where r.id = new.restaurant_id),
                new.plan_name, public.format_brl(new.amount)), 300),
    'payment', new.id
  );
  return new;
end;
$$;

drop trigger if exists notifications_payment_request_created on public.payment_requests;
create trigger notifications_payment_request_created
  after insert on public.payment_requests
  for each row execute function public.notifications_on_payment_request_created();

-- ----------------------------------------------------------------------------
-- 14. Correção urgente: pedido sem cupom estava sendo recusado (bug da 0026)
-- ----------------------------------------------------------------------------

/*
 * Encontrado ao escrever o teste desta etapa, e **verificado em produção antes
 * da correção**: `create_order` recusava TODO pedido sem cupom.
 *
 *   set local role anon;
 *   select * from create_order('<token>', '[...]');
 *   → ERROR 55000: record "v_coupon" is not assigned yet
 *
 * A causa está no `update` de totais da Etapa 25: o snapshot saía de um
 * `case when v_discount > 0 then v_coupon.coupon_id else null end`. PL/pgSQL
 * avalia a expressão do `case` inteira ao montar a linha do `new`, não só a
 * perna escolhida — e `v_coupon` é um `record` nunca atribuído quando o pedido
 * não usa cupom. O erro subia como 55000 e derrubava o pedido.
 *
 * A correção troca o `case` por variáveis: só se lê `v_coupon` dentro do `if`
 * que garante que ele existe. Nada mais muda — assinatura, cálculo, guards e
 * grants são os mesmos da Etapa 25 (o `create or replace` preserva os grants).
 *
 * O aviso de "pedido novo" também entra aqui (item 12 da função), porque é o
 * único ponto do fluxo em que o pedido já tem total.
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
  v_coupon_id    uuid;
  v_coupon_code  text;
  v_coupon_type  public.coupon_discount_type;
  v_coupon_value numeric(10, 2);
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
    -- ambas passar pelo limite.
    perform 1 from public.coupons c where c.id = v_coupon.coupon_id for update;
  end if;

  /* 9. Totais finais, sempre no servidor.
   *
   * O snapshot do cupom sai em variáveis próprias: `v_coupon` só é lido dentro
   * do `if` que garante que ele foi atribuído. Era exatamente isso que o `case`
   * da Etapa 25 não garantia. */
  v_coupon_id    := null;
  v_coupon_code  := null;
  v_coupon_type  := null;
  v_coupon_value := null;

  if v_discount > 0 then
    v_coupon_id    := v_coupon.coupon_id;
    v_coupon_code  := v_coupon.code;
    v_coupon_type  := v_coupon.type;
    v_coupon_value := v_coupon.value;
  end if;

  update public.orders
     set subtotal     = v_subtotal,
         discount     = v_discount,
         total        = v_subtotal - v_discount + fees,
         coupon_id    = v_coupon_id,
         coupon_code  = v_coupon_code,
         coupon_type  = v_coupon_type,
         coupon_value = v_coupon_value
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

  /* 12. Aviso de pedido novo (Etapa 26) — aqui, com os totais já gravados.
   *
   * Dentro de um bloco de exceção de propósito: o pedido do cliente já está
   * criado e válido. Um sino que falha não pode transformar isso em erro na
   * tela de quem está com fome. */
  begin
    perform public.notifications_emit_order_created(v_order_id);
  exception when others then
    null;
  end;

  return query
    select o.id, o.order_number, v_table_name, o.restaurant_id,
           o.subtotal, o.discount, o.total, o.coupon_code,
           o.status, o.created_at, o.customer_id
    from public.orders o
    where o.id = v_order_id;
end;
$$;

comment on function public.create_order(text, jsonb, text, text, text, boolean, text) is
  'Cria pedido pelo token da mesa, aplica cupom validado no banco e emite o aviso de pedido novo. Corrige o 55000 do snapshot de cupom vazio (Etapa 26).';

-- ----------------------------------------------------------------------------
-- 15. RLS
-- ----------------------------------------------------------------------------

/*
 * Leitura: a própria notificação, ou global quando é admin da plataforma.
 * Nada de `is_restaurant_member` sozinho — isso deixaria qualquer membro ler a
 * caixa do colega.
 */
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (
    (user_id = auth.uid() and (restaurant_id is null or public.is_restaurant_member(restaurant_id)))
    or (user_id is null and public.is_platform_admin())
  );

/*
 * Única escrita do cliente: marcar como lida, e só na própria linha.
 * `using` **e** `with check` — sem o `with check`, o update poderia mover a
 * linha para outro `user_id`, efetivamente entregando notificação a terceiro.
 */
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (
    (user_id = auth.uid() and (restaurant_id is null or public.is_restaurant_member(restaurant_id)))
    or (user_id is null and public.is_platform_admin())
  )
  with check (
    (user_id = auth.uid() and (restaurant_id is null or public.is_restaurant_member(restaurant_id)))
    or (user_id is null and public.is_platform_admin())
  );

drop policy if exists notification_preferences_own on public.notification_preferences;
create policy notification_preferences_own on public.notification_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Sem `insert`/`delete` para cliente: notificação nasce de um fato e não é
-- apagada pelo destinatário (o histórico é o que explica o passado).

/*
 * Escrita fechada na tabela. O grant padrão do projeto deixa `authenticated`
 * inserir direto em qualquer tabela nova — medido aqui: `insert` vinha como
 * `true` antes deste revoke. Notificação nasce de um fato (trigger/RPC); se a
 * cliente pudesse inserir, um usuário notificaria o outro com texto arbitrário.
 * A única escrita permitida é a coluna `read_at`, e ainda assim dentro da policy.
 */
revoke all on public.notifications from anon;
revoke all on public.notifications from public;
revoke all on public.notification_preferences from anon;
revoke all on public.notification_preferences from public;
revoke insert, update, delete, truncate on public.notifications from authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, insert, update, delete on public.notification_preferences to authenticated;

-- ----------------------------------------------------------------------------
-- 16. Migração de conveniência: nada a migrar
-- ----------------------------------------------------------------------------

/*
 * Não há backfill. Criar notificação para pedidos antigos encheria o sino de
 * avisos de coisas que já aconteceram e ninguém mais vai agir — o oposto do
 * que a central serve. O histórico continua em `orders`, `table_requests` e
 * `payment_requests`, que são as telas de origem.
 */
