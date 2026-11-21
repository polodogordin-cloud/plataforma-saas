-- =============================================================================
-- Menuvo · Etapa 4 · Mesas e QR Codes
-- =============================================================================
-- Cada mesa recebe:
--   * um `name` visível (rótulo) — "Mesa 01", "Varanda 02";
--   * um `code` interno opcional, para a equipe;
--   * um `public_token` opaco e permanente, base da URL do QR Code e do NFC.
--
-- Por que token e não o id nem o número:
--   * O número é rótulo humano: muda quando o dono reorganiza o salão.
--   * O id (uuid) vaza contagem e permite enumerar por ordem de criação.
--   * O token é aleatório (~119 bits), não sequencial, e é o único dado da
--     mesa que chega ao cliente.
--
-- O QUE O TOKEN *NÃO* FAZ: o cardápio nunca é embutido na URL. A rota da mesa
-- resolve (restaurante, mesa) e então renderiza o cardápio atual. Por isso
-- mudar preço, nome, foto ou disponibilidade não exige reimprimir QR Code.
--
-- PREPARAÇÃO (sem implementar):
--   * NFC (Etapa 5): nada a migrar — a URL do token já serve para QR e TAG.
--   * Pedidos (Etapa 6): `orders.table_id` referencia `tables.id`; o campo
--     `status` de ocupação já existe, separado de `is_active`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enum: ocupação no salão (diferente de visibilidade)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'table_status') then
    create type public.table_status as enum ('free', 'occupied', 'reserved', 'inactive');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Gerador de token — precisa existir ANTES do DEFAULT da tabela
-- -----------------------------------------------------------------------------
create or replace function public.generate_table_token()
returns text
language sql
volatile
set search_path = public, extensions
as $$
  -- 24 caracteres base32 sem letras ambíguas (sem 0/O, 1/I/L),
  -- a partir de 24 bytes aleatórios do pgcrypto (~119 bits de entropia).
  select string_agg(
           substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ',
                  1 + (get_byte(b.bytes, gs.i) % 31), 1),
           '' order by gs.i)
  from (select extensions.gen_random_bytes(24) as bytes) b,
       generate_series(0, 23) as gs(i);
$$;

comment on function public.generate_table_token() is
  'Gera um public_token aleatório de 24 caracteres (base32, ~119 bits).';

-- `tables.public_token` tem DEFAULT generate_table_token(). Em PostgreSQL,
-- avaliar o default exige EXECUTE no role que faz o INSERT: sem o grant para
-- `authenticated`, criar mesa pelo painel falha com 42501. Já `anon` nunca
-- cria mesa, então segue sem acesso.
revoke all on function public.generate_table_token() from public;
revoke all on function public.generate_table_token() from anon;
grant execute on function public.generate_table_token() to authenticated;

-- -----------------------------------------------------------------------------
-- TABLES (mesas)
-- -----------------------------------------------------------------------------
create table if not exists public.tables (
  id                        uuid primary key default gen_random_uuid(),
  restaurant_id             uuid not null references public.restaurants (id) on delete cascade,

  -- Rótulo humano: "Mesa 01", "Varanda 01", "Balcão 01".
  name                      text not null check (char_length(trim(name)) between 1 and 60),

  -- Identificação opcional para a equipe (ex.: "Perto da janela").
  code                      text check (code is null or char_length(trim(code)) <= 40),

  -- Observação livre da mesa (ex.: "6 lugares, banco corrido").
  notes                     text check (notes is null or char_length(notes) <= 300),

  -- Base da URL pública (QR Code e, na Etapa 5, a TAG NFC).
  public_token              text not null default public.generate_table_token(),

  -- Token anterior, aceito até expirar: evita derrubar quem já escaneou.
  previous_token            text,
  previous_token_expires_at timestamptz,

  -- Visibilidade para o cliente. Desativada, o link responde 404.
  is_active                 boolean not null default true,

  -- Ocupação no salão. Independente de is_active (que é visibilidade).
  status                    public.table_status not null default 'free',

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.tables is
  'Mesas do salão. O public_token é a base do QR Code e da TAG NFC.';
comment on column public.tables.public_token is
  'Token opaco e permanente usado na URL pública. Trocar invalida QR Codes impressos.';
comment on column public.tables.status is
  'Ocupação no salão (livre/ocupada/reservada). Separado de is_active.';
comment on column public.tables.is_active is
  'Mesa desativada não recebe acesso público, mas o histórico dela permanece.';
comment on column public.tables.previous_token is
  'Token anterior, aceito até previous_token_expires_at após uma rotação.';

-- -----------------------------------------------------------------------------
-- Unicidade e índices
-- -----------------------------------------------------------------------------
-- Token é único globalmente: é a chave da URL pública.
create unique index if not exists tables_public_token_key
  on public.tables (public_token);

-- Nome único por restaurante: dois "Mesa 01" no mesmo salão confundiriam a
-- equipe. Restaurantes diferentes repetem o número à vontade (regra 7).
create unique index if not exists tables_restaurant_name_key
  on public.tables (restaurant_id, public.name_key(name));

-- Mesma lógica para o código interno, quando informado.
create unique index if not exists tables_restaurant_code_key
  on public.tables (restaurant_id, lower(trim(code)))
  where code is not null;

create index if not exists tables_restaurant_idx
  on public.tables (restaurant_id, is_active);

create index if not exists tables_previous_token_idx
  on public.tables (previous_token)
  where previous_token is not null;

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------
drop trigger if exists tables_touch_updated_at on public.tables;
create trigger tables_touch_updated_at
  before update on public.tables
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Proteção do token
-- -----------------------------------------------------------------------------
-- O token só nasce do DEFAULT e só muda pela RPC de rotação. Sem isso, um
-- UPDATE malicioso (ou um bug) trocaria a URL de uma mesa já impressa.
create or replace function public.guard_table_token()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.public_token is distinct from old.public_token then
    if coalesce(current_setting('menuvo.token_rotation', true), '') <> 'on' then
      raise exception 'public_token_immutable' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tables_guard_token on public.tables;
create trigger tables_guard_token
  before update on public.tables
  for each row execute function public.guard_table_token();

-- O trigger roda como o role que faz o UPDATE; `authenticated` precisa do grant
-- (a rotação continua barrada pelo flag `menuvo.token_rotation`).
revoke all on function public.guard_table_token() from public;
revoke all on function public.guard_table_token() from anon;
grant execute on function public.guard_table_token() to authenticated;

-- -----------------------------------------------------------------------------
-- RPC: regenerar o token (com janela de tolerância)
-- -----------------------------------------------------------------------------
-- "Gerar novamente" é destrutivo: todo QR Code e TAG já gravados param de
-- funcionar. Para não derrubar quem está lendo o cardápio neste instante, o
-- token anterior continua aceito por `p_grace_minutes`.
create or replace function public.rotate_table_token(
  p_table_id uuid,
  p_grace_minutes integer default 30
)
returns public.tables
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table public.tables;
  v_restaurant uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select restaurant_id into v_restaurant
  from public.tables where id = p_table_id;

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
         previous_token_expires_at = now() + make_interval(mins => greatest(0, p_grace_minutes))
   where id = p_table_id
  returning * into v_table;

  return v_table;
end;
$$;

-- Só quem administra o restaurante rotaciona token; `anon` nem alcança a função
-- (o body também recusa, mas fechar no grant é mais uma barreira).
revoke all on function public.rotate_table_token(uuid, integer) from public;
revoke all on function public.rotate_table_token(uuid, integer) from anon;
grant execute on function public.rotate_table_token(uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- =============================================================================
-- Leitura: qualquer membro ativo (a equipe precisa ver o salão).
-- Escrita: owner/admin. Staff consulta, não reorganiza o salão.
-- -----------------------------------------------------------------------------
alter table public.tables enable row level security;

drop policy if exists tables_select_member on public.tables;
create policy tables_select_member on public.tables
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

drop policy if exists tables_insert_admin on public.tables;
create policy tables_insert_admin on public.tables
  for insert to authenticated
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists tables_update_admin on public.tables;
create policy tables_update_admin on public.tables
  for update to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists tables_delete_admin on public.tables;
create policy tables_delete_admin on public.tables
  for delete to authenticated
  using (public.is_restaurant_admin(restaurant_id));

grant select, insert, update, delete on public.tables to authenticated;
revoke all on public.tables from anon;

-- -----------------------------------------------------------------------------
-- VIEW PÚBLICA: resolução do QR Code
-- -----------------------------------------------------------------------------
-- Entrega o mínimo para (1) descobrir o restaurante, (2) confirmar que a mesa
-- está ativa e (3) exibir o rótulo. Não expõe id interno, observações,
-- ocupação nem código da equipe.
--
-- Não decide se o cardápio pode ser visto: isso continua sendo papel de
-- `public_restaurants` (status = 'published').
create or replace view public.public_table_context
with (security_invoker = false)
as
select
  t.public_token,
  t.restaurant_id,
  t.name,
  t.is_active
from public.tables t
join public.restaurants r on r.id = t.restaurant_id
where r.status = 'published';

comment on view public.public_table_context is
  'Resolve o token do QR/NFC para (restaurante, rótulo). Sem dados internos.';

grant select on public.public_table_context to anon, authenticated;

-- -----------------------------------------------------------------------------
-- RPC pública: resolver token (inclui a janela de tolerância)
-- -----------------------------------------------------------------------------
-- A view não cobre o token rotacionado. Esta função SECURITY DEFINER resolve
-- os dois casos e devolve só o essencial.
create or replace function public.resolve_table_token(p_token text)
returns table (restaurant_id uuid, table_id uuid, table_name text, is_active boolean)
language sql
security definer
set search_path = public
stable
as $$
  select t.restaurant_id, t.id, t.name, t.is_active
  from public.tables t
  join public.restaurants r on r.id = t.restaurant_id
  where r.status = 'published'
    and (
      t.public_token = p_token
      or (
        t.previous_token = p_token
        and t.previous_token_expires_at is not null
        and t.previous_token_expires_at > now()
      )
    )
  limit 1;
$$;

comment on function public.resolve_table_token(text) is
  'Resolve o token do QR/NFC, aceitando o token anterior dentro da tolerância.';

revoke all on function public.resolve_table_token(text) from public;
grant execute on function public.resolve_table_token(text) to anon, authenticated;
