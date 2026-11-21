-- =============================================================================
-- Menuvo · Etapa 5 · NFC das mesas
-- =============================================================================
-- O NFC reaproveita a URL pública já criada na Etapa 4:
--
--     /r/{slug}/table/{public_token}
--
-- Não existe "URL de NFC". Existe uma URL por mesa, e o QR Code e a TAG são
-- dois meios de abrir a mesma coisa. Isso tem consequência prática: reimprimir
-- QR ou regravar TAG nunca depende do cardápio, e o cliente cai no mesmo
-- lugar — com a mesa já identificada na sessão.
--
-- O QUE O SISTEMA FAZ: administra a URL, o estado de cada TAG e o histórico.
-- O QUE O SISTEMA NÃO FAZ: gravar na TAG. Navegador não escreve NTAG213/215/216
-- de forma confiável (Web NFC só existe em Chrome Android e não é padrão), e
-- mesmo lá o usuário precisa encostar o celular na TAG. Quem grava é um app
-- dedicado (NFC Tools, TagWriter). Nossa função é entregar a URL pronta — e
-- nunca prometer o que a plataforma não faz.
--
-- MODELO:
--   public.table_nfc_tags     → uma linha por TAG física (permite várias por
--                               mesa: placa com duas TAGs, TAG reserva);
--   public.table_nfc_events   → histórico append-only, escrito por trigger;
--   public.table_nfc_overview → superfície de leitura já com `nfc_url`.
--
-- Sobre `nfc_url`: NÃO é coluna. Guardar a URL em uma coluna cria uma segunda
-- cópia de (slug, token) que envelhece sozinha — mudar o slug do restaurante ou
-- rotacionar o token deixaria a coluna mentindo. A view `table_nfc_overview`
-- entrega o campo `nfc_url` sempre calculado a partir dos dados atuais.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enum: estado da TAG
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'nfc_status') then
    create type public.nfc_status as enum (
      'not_configured',  -- ninguém gravou ainda
      'configured',      -- URL gravada, sem confirmação de leitura
      'tested',          -- alguém encostou o celular e abriu o cardápio
      'disabled'         -- TAG fora de uso (perdida, danificada, substituída)
    );
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Coluna de controle: quando o token mudou pela última vez
-- -----------------------------------------------------------------------------
-- Sem isso não há como avisar que uma TAG "configurada" aponta para uma URL
-- que deixou de existir. O aviso é derivado, não é um status novo: a TAG
-- continua `configured`, mas o painel diz que precisa ser regravada.
alter table public.tables
  add column if not exists token_rotated_at timestamptz;

comment on column public.tables.token_rotated_at is
  'Última rotação do public_token. TAGs gravadas antes disto apontam para URL inválida.';

-- -----------------------------------------------------------------------------
-- TABELAS: TAGs físicas
-- -----------------------------------------------------------------------------
create table if not exists public.table_nfc_tags (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants (id) on delete cascade,
  table_id          uuid not null references public.tables (id) on delete cascade,

  -- Rótulo humano opcional: "TAG da placa", "TAG reserva".
  label             text,

  -- UID da TAG, quando o dono quiser registrar. NUNCA obrigatório: exigir o
  -- número físico da TAG travaria a maioria dos casos, porque a maioria dos
  -- apps de gravação mostra o UID num lugar diferente.
  tag_identifier    text,

  status            public.nfc_status not null default 'not_configured',
  is_active         boolean not null default true,

  configured_at     timestamptz,
  tested_at         timestamptz,

  -- Substituição: a TAG nova aponta para a que ela substituiu. Mantém o
  -- encadeamento para auditoria sem apagar histórico.
  replaced_tag_id   uuid references public.table_nfc_tags (id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint table_nfc_tags_label_check
    check (label is null or char_length(btrim(label)) <= 60),
  constraint table_nfc_tags_identifier_check
    check (tag_identifier is null or char_length(btrim(tag_identifier)) <= 64),
  constraint table_nfc_tags_label_not_blank
    check (label is null or char_length(btrim(label)) > 0)
);

comment on table public.table_nfc_tags is
  'Uma TAG NFC física por linha. A URL gravada é sempre a da mesa (Etapa 4).';

create index if not exists table_nfc_tags_table_idx
  on public.table_nfc_tags (table_id, created_at);

create index if not exists table_nfc_tags_restaurant_idx
  on public.table_nfc_tags (restaurant_id);

-- O mesmo UID físico não pode estar em duas TAGs do mesmo restaurante
-- (cadastro duplicado). Entre restaurantes é permitido, como o nome da mesa.
create unique index if not exists table_nfc_tags_identifier_key
  on public.table_nfc_tags (restaurant_id, lower(btrim(tag_identifier)))
  where tag_identifier is not null;

-- -----------------------------------------------------------------------------
-- TABELA: histórico
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'nfc_event_type') then
    create type public.nfc_event_type as enum (
      'created',
      'status_changed',
      'identifier_changed',
      'activated',
      'deactivated',
      'replaced',
      'url_rotated'
    );
  end if;
end
$$;

create table if not exists public.table_nfc_events (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  table_id       uuid not null references public.tables (id) on delete cascade,
  -- on delete set null, não cascade: histórico é auditoria e não pode
  -- desaparecer quando a TAG é removida.
  tag_id         uuid references public.table_nfc_tags (id) on delete set null,
  event          public.nfc_event_type not null,
  from_status    public.nfc_status,
  to_status      public.nfc_status,
  note           text,
  actor_id       uuid references public.users (id) on delete set null,
  created_at     timestamptz not null default now()
);

comment on table public.table_nfc_events is
  'Histórico append-only das TAGs NFC. Escrito por trigger, nunca pela aplicação.';

create index if not exists table_nfc_events_table_idx
  on public.table_nfc_events (table_id, created_at desc);

-- -----------------------------------------------------------------------------
-- TRIGGERS
-- -----------------------------------------------------------------------------
create or replace function public.table_nfc_tags_before_write()
returns trigger
language plpgsql
security invoker
set search_path = 'public'
as $$
begin
  new.label := nullif(btrim(new.label), '');
  new.tag_identifier := nullif(btrim(new.tag_identifier), '');

  -- Carimba a data de configuração na primeira vez em que a TAG sai de
  -- "não configurada", inclusive quando o usuário marca direto como testada.
  if tg_op = 'INSERT' then
    if new.status = 'configured' or new.status = 'tested' then
      new.configured_at := coalesce(new.configured_at, now());
    end if;
    if new.status = 'tested' then
      new.tested_at := coalesce(new.tested_at, now());
    end if;
  else
    if new.status in ('configured', 'tested')
       and old.status in ('not_configured', 'disabled')
       and new.configured_at is null then
      new.configured_at := now();
    end if;
    if new.status = 'tested' and old.status <> 'tested' then
      new.tested_at := now();
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists table_nfc_tags_before_write on public.table_nfc_tags;
create trigger table_nfc_tags_before_write
  before insert or update on public.table_nfc_tags
  for each row execute function public.table_nfc_tags_before_write();

/**
 * Histórico automático.
 *
 * SECURITY DEFINER porque o ator que escreve na TAG é `authenticated` e não tem
 * (nem deve ter) INSERT em `table_nfc_events`. Assim o histórico não pode ser
 * forjado ou apagado pelo painel.
 */
create or replace function public.log_table_nfc_event()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_event public.nfc_event_type;
  v_actor uuid;
begin
  select id into v_actor from public.users where id = auth.uid();

  if tg_op = 'INSERT' then
    v_event := 'created';
  elsif new.status is distinct from old.status then
    v_event := 'status_changed';
  elsif new.is_active is distinct from old.is_active then
    v_event := case when new.is_active then 'activated' else 'deactivated' end;
  elsif new.tag_identifier is distinct from old.tag_identifier then
    v_event := 'identifier_changed';
  elsif new.replaced_tag_id is distinct from old.replaced_tag_id then
    v_event := 'replaced';
  else
    return new;
  end if;

  insert into public.table_nfc_events (
    restaurant_id, table_id, tag_id, event, from_status, to_status, actor_id
  )
  values (
    new.restaurant_id,
    new.table_id,
    new.id,
    v_event,
    case when tg_op = 'UPDATE' then old.status else null end,
    new.status,
    v_actor
  );

  return new;
end;
$$;

drop trigger if exists table_nfc_tags_log_event on public.table_nfc_tags;
create trigger table_nfc_tags_log_event
  after insert or update on public.table_nfc_tags
  for each row execute function public.log_table_nfc_event();

-- Uma TAG por mesa no primeiro cadastro é o caso comum, mas várias são
-- permitidas. O limite fica na aplicação (UX), não no banco.

-- -----------------------------------------------------------------------------
-- Rotação de token também marca as TAGs
-- -----------------------------------------------------------------------------
-- Reaproveita a função da Etapa 4 e acrescenta `token_rotated_at` + evento
-- `url_rotated` por TAG existente. A TAG continua com o status que tinha: quem
-- avisa que ela morreu é a comparação `configured_at < token_rotated_at`.
create or replace function public.rotate_table_token(p_table_id uuid, p_grace_minutes integer default 30)
returns public.tables
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_table public.tables;
  v_restaurant uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select restaurant_id into v_restaurant from public.tables where id = p_table_id;
  if v_restaurant is null then
    raise exception 'table_not_found' using errcode = '22023';
  end if;
  if not public.is_restaurant_admin(v_restaurant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform set_config('menuvo.token_rotation', 'on', true);

  update public.tables
     set public_token              = public.generate_table_token(),
         previous_token            = public_token,
         previous_token_expires_at = now() + make_interval(mins => greatest(0, p_grace_minutes)),
         token_rotated_at          = now()
   where id = p_table_id
  returning * into v_table;

  insert into public.table_nfc_events (
    restaurant_id, table_id, tag_id, event, from_status, to_status, actor_id, note
  )
  select
    t.restaurant_id,
    t.table_id,
    t.id,
    'url_rotated',
    t.status,
    t.status,
    (select id from public.users where id = auth.uid()),
    'URL da mesa mudou: a TAG precisa ser regravada'
  from public.table_nfc_tags t
  where t.table_id = p_table_id;

  return v_table;
end;
$$;

-- -----------------------------------------------------------------------------
-- VIEW DE LEITURA: já com a URL pronta
-- -----------------------------------------------------------------------------
create or replace view public.table_nfc_overview
with (security_invoker = true)
as
select
  tag.id                                                  as tag_id,
  tag.restaurant_id,
  tag.table_id,
  tag.label,
  tag.tag_identifier,
  tag.status,
  tag.is_active,
  tag.configured_at,
  tag.tested_at,
  tag.replaced_tag_id,
  tag.created_at,
  tag.updated_at,

  tbl.name                                                as table_name,
  r.slug                                                  as restaurant_slug,

  -- Campo pedido no escopo, calculado em vez de armazenado.
  '/r/' || r.slug || '/table/' || tbl.public_token         as nfc_url,

  (tag.is_active and tbl.is_active)                        as nfc_enabled,

  -- TAG "morta": token rotacionado depois da gravação.
  (tag.configured_at is not null
    and tbl.token_rotated_at is not null
    and tbl.token_rotated_at > tag.configured_at)          as needs_rerecord

from public.table_nfc_tags tag
join public.tables tbl on tbl.id = tag.table_id
join public.restaurants r on r.id = tag.restaurant_id;

comment on view public.table_nfc_overview is
  'TAG + URL pública calculada. security_invoker: RLS de table_nfc_tags decide as linhas.';

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.table_nfc_tags enable row level security;
alter table public.table_nfc_events enable row level security;

-- Leitura: qualquer membro ativo (a equipe precisa ver as TAGs do salão).
drop policy if exists table_nfc_tags_select_member on public.table_nfc_tags;
create policy table_nfc_tags_select_member on public.table_nfc_tags
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

-- Escrita: owner/admin, como o resto do salão.
drop policy if exists table_nfc_tags_insert_admin on public.table_nfc_tags;
create policy table_nfc_tags_insert_admin on public.table_nfc_tags
  for insert to authenticated
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists table_nfc_tags_update_admin on public.table_nfc_tags;
create policy table_nfc_tags_update_admin on public.table_nfc_tags
  for update to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists table_nfc_tags_delete_admin on public.table_nfc_tags;
create policy table_nfc_tags_delete_admin on public.table_nfc_tags
  for delete to authenticated
  using (public.is_restaurant_admin(restaurant_id));

-- Histórico: membros leem. Ninguém escreve pelo painel (só o trigger).
drop policy if exists table_nfc_events_select_member on public.table_nfc_events;
create policy table_nfc_events_select_member on public.table_nfc_events
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

grant select, insert, update, delete on public.table_nfc_tags to authenticated;
grant select on public.table_nfc_events to authenticated;
grant select on public.table_nfc_overview to authenticated;

-- Visitante não tem nada aqui: a URL pública é a rota da Etapa 4, que resolve
-- o token no servidor. O NFC não abre superfície nova.
revoke all on public.table_nfc_tags from anon;
revoke all on public.table_nfc_events from anon;
revoke all on public.table_nfc_overview from anon;

grant execute on function public.table_nfc_tags_before_write() to authenticated;
grant execute on function public.log_table_nfc_event() to authenticated;
revoke all on function public.log_table_nfc_event() from anon, public;

-- -----------------------------------------------------------------------------
-- CHECK: a TAG pertence ao mesmo restaurante da mesa
-- -----------------------------------------------------------------------------
-- Sem isto, um INSERT com restaurant_id próprio + table_id de outro tenant
-- passaria pela policy (que valida só o restaurant_id da linha nova).
create or replace function public.assert_nfc_tag_tenant()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not exists (
    select 1 from public.tables
     where id = new.table_id
       and restaurant_id = new.restaurant_id
  ) then
    raise exception 'table_not_found' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists table_nfc_tags_assert_tenant on public.table_nfc_tags;
create trigger table_nfc_tags_assert_tenant
  before insert or update of table_id, restaurant_id on public.table_nfc_tags
  for each row execute function public.assert_nfc_tag_tenant();

revoke all on function public.assert_nfc_tag_tenant() from anon, public;
grant execute on function public.assert_nfc_tag_tenant() to authenticated;
