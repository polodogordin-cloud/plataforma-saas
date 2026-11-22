-- ============================================================================
-- Etapa 18 · Impressão de pedidos (térmica 58mm / 80mm)
-- ============================================================================
-- Restaurante imprime pedido em impressora térmica. O ponto que este arquivo
-- não pode errar:
--
--   1. **O navegador não controla impressora térmica.** Nenhuma API web abre a
--      COM/USB de uma térmica, manda ESC/POS ou fala com a fila do sistema.
--      O que existe é `window.print()` — que abre a caixa de diálogo e depende
--      do driver instalado. Tudo neste módulo é desenhado sabendo disso: o
--      layout sai pronto para papel térmico, e o *envio* é declarado como
--      responsabilidade de um provedor (navegador hoje; bridge/Web Print
--      amanhã). Nada aqui finge ter impresso.
--
--   2. **Perfil de impressão não é uma segunda tabela de pedidos.** COZINHA,
--      BALCÃO, BAR e CAIXA são *destinos de impressão*: nome, papel, cópias e
--      se está ativo. O que cada um recebe fica em `print_settings` (pedidos,
--      comandas, cozinha, balcão) — um lugar só, não uma matriz por perfil. A
--      divisão por tipo de item por perfil é evolução futura, e a chave
--      `kind` já está lá para isso.
--
--   3. **O log do que foi pedido é honesto.** `print_jobs` grava a
--      *solicitação* ("o app pediu para imprimir o pedido 1042 no perfil
--      Cozinha, provedor navegador"), não a confirmação de que o papel saiu.
--      Chamar isso de "impresso" seria inventar um dado que ninguém tem.
--
--   4. **Isolamento por restaurante em todas as tabelas**, com RLS e guarda
--      dentro de cada RPC — como no resto do projeto. Configuração de
--      impressão vaza nome de impressora, IP da bridge e endereço da cozinha;
--      não é dado público.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tipos
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'print_paper_width') then
    -- Largura nominal do rolo. Texto e não inteiro porque é isso que o dono
    -- lê na bobina ("58mm"), e porque 58/80 são padrões de mercado, não medidas
    -- exatas (a área imprimível real é ~48mm e ~72mm).
    create type public.print_paper_width as enum ('58', '80');
  end if;

  if not exists (select 1 from pg_type where typname = 'print_profile_kind') then
    create type public.print_profile_kind as enum ('kitchen', 'counter', 'bar', 'cashier');
  end if;

  if not exists (select 1 from pg_type where typname = 'print_mode') then
    -- `auto` é intenção configurada, não promessa de papel saindo sozinho:
    -- sem gesto do usuário o navegador bloqueia `window.print()`. A tela diz
    -- isso com todas as letras.
    create type public.print_mode as enum ('manual', 'auto');
  end if;

  if not exists (select 1 from pg_type where typname = 'print_provider_kind') then
    -- browser   → window.print() com driver do sistema
    -- os        → fila do sistema operacional (futuro)
    -- web_print → Web Print / CUPS/IPP via serviço (futuro)
    -- bridge    → aplicativo local que fala ESC/POS (futuro)
    -- service   → serviço de impressão em nuvem (futuro)
    create type public.print_provider_kind as enum (
      'browser', 'os', 'web_print', 'bridge', 'service'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'print_job_status') then
    -- `requested` é o único que este app consegue afirmar hoje.
    create type public.print_job_status as enum (
      'requested', 'printed', 'failed', 'unsupported'
    );
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 2. Quem configura e quem imprime
--
-- Configurar é mexer em endereço de impressora e em como a casa opera: só
-- admin operacional. Imprimir um pedido é trabalho de turno: todos os papéis
-- que enxergam a cozinha também imprimem — inclusive `kitchen`, que é quem
-- mais precisa do papel na bancada.
-- ----------------------------------------------------------------------------
create or replace function public.print_can_configure(target_restaurant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_restaurant_admin(target_restaurant_id);
$$;

create or replace function public.print_can_view(target_restaurant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.has_restaurant_role(
    target_restaurant_id,
    array['owner', 'admin', 'manager', 'kitchen', 'staff', 'waiter']::public.restaurant_member_role[]
  );
$$;

comment on function public.print_can_configure(uuid) is
  'Configurar impressão (perfis, impressoras, modo): owner/admin/manager.';
comment on function public.print_can_view(uuid) is
  'Imprimir pedido e ver a config: todos os papéis operacionais.';

revoke all on function public.print_can_configure(uuid) from public;
revoke all on function public.print_can_view(uuid) from public;
grant execute on function public.print_can_configure(uuid) to authenticated;
grant execute on function public.print_can_view(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Configuração da casa
-- ----------------------------------------------------------------------------
create table if not exists public.print_settings (
  restaurant_id       uuid primary key references public.restaurants (id) on delete cascade,
  mode                public.print_mode not null default 'manual',
  default_paper_width public.print_paper_width not null default '80',
  -- Os quatro interruptores do escopo. Existem separados porque são decisões
  -- diferentes: a cozinha quer o papel sem preço; o balcão quer com preço; a
  -- comanda é para o cliente conferir.
  print_orders        boolean not null default true,
  print_tickets       boolean not null default true,
  print_kitchen       boolean not null default true,
  print_counter       boolean not null default true,
  copies              integer not null default 1 check (copies between 1 and 3),
  -- Rodapé livre: "Obrigado pela preferência", CNPJ, telefone.
  footer_note         text check (footer_note is null or char_length(footer_note) <= 120),
  updated_at          timestamptz not null default now()
);

comment on table public.print_settings is
  'Como a casa imprime: modo, papel padrão, o que sai e quantas cópias. Uma linha por restaurante.';
comment on column public.print_settings.mode is
  'Intenção de impressão automática. Com provedor navegador o disparo depende de gesto do usuário.';

alter table public.print_settings enable row level security;

drop policy if exists print_settings_select_member on public.print_settings;
create policy print_settings_select_member on public.print_settings
  for select to authenticated
  using (public.print_can_view(restaurant_id));

drop policy if exists print_settings_write_admin on public.print_settings;
create policy print_settings_write_admin on public.print_settings
  for all to authenticated
  using (public.print_can_configure(restaurant_id))
  with check (public.print_can_configure(restaurant_id));

grant select, insert, update on public.print_settings to authenticated;
revoke all on public.print_settings from anon;

-- ----------------------------------------------------------------------------
-- 4. Perfis de impressão (COZINHA / BALCÃO / BAR / CAIXA)
-- ----------------------------------------------------------------------------
create table if not exists public.print_profiles (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null check (char_length(trim(name)) between 1 and 40),
  -- Estável em URL e em código: "cozinha", "balcao". Não muda quando o dono
  -- renomeia o perfil para "Cozinha quente".
  slug          text not null check (slug ~ '^[a-z0-9-]{2,32}$'),
  kind          public.print_profile_kind not null default 'kitchen',
  paper_width   public.print_paper_width not null default '80',
  copies        integer not null default 1 check (copies between 1 and 3),
  is_active     boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, slug)
);

comment on table public.print_profiles is
  'Destinos de impressão da casa (cozinha, balcão, bar, caixa). Não guarda pedidos.';
comment on column public.print_profiles.kind is
  'Natureza do destino. Hoje é rótulo; a divisão de itens por perfil é evolução futura.';

create index if not exists print_profiles_restaurant_idx
  on public.print_profiles (restaurant_id, sort_order);

alter table public.print_profiles enable row level security;

drop policy if exists print_profiles_select_member on public.print_profiles;
create policy print_profiles_select_member on public.print_profiles
  for select to authenticated
  using (public.print_can_view(restaurant_id));

drop policy if exists print_profiles_write_admin on public.print_profiles;
create policy print_profiles_write_admin on public.print_profiles
  for all to authenticated
  using (public.print_can_configure(restaurant_id))
  with check (public.print_can_configure(restaurant_id));

grant select, insert, update, delete on public.print_profiles to authenticated;
revoke all on public.print_profiles from anon;

-- ----------------------------------------------------------------------------
-- 5. Impressoras
--
-- A linha descreve o **equipamento físico** e como ele é alcançado. `provider`
-- é o que decide se o app consegue falar com ela sozinho. `browser` é o único
-- que funciona hoje, e mesmo ele só pela caixa de diálogo do sistema.
-- ----------------------------------------------------------------------------
create table if not exists public.printers (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  -- Perfil dono da impressora. `null` = impressora avulsa, sem destino fixo.
  profile_id    uuid references public.print_profiles (id) on delete set null,
  name          text not null check (char_length(trim(name)) between 1 and 60),
  provider      public.print_provider_kind not null default 'browser',
  -- Nome da fila no sistema, IP:porta, serial ou identificador da bridge.
  identifier    text check (identifier is null or char_length(identifier) <= 120),
  paper_width   public.print_paper_width not null default '80',
  is_default    boolean not null default false,
  is_active     boolean not null default true,
  notes         text check (notes is null or char_length(notes) <= 200),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.printers is
  'Impressora térmica cadastrada. O provedor define se o app alcança o equipamento sozinho.';
comment on column public.printers.identifier is
  'Fila do sistema, IP:porta ou identificador da bridge. Não é segredo, mas não é público.';

create index if not exists printers_restaurant_idx
  on public.printers (restaurant_id, is_default desc);

-- Uma impressora padrão por casa. Índice parcial: o banco recusa a segunda em
-- vez de a tela fingir que existe um padrão.
create unique index if not exists printers_one_default_idx
  on public.printers (restaurant_id) where is_default;

alter table public.printers enable row level security;

drop policy if exists printers_select_member on public.printers;
create policy printers_select_member on public.printers
  for select to authenticated
  using (public.print_can_view(restaurant_id));

drop policy if exists printers_write_admin on public.printers;
create policy printers_write_admin on public.printers
  for all to authenticated
  using (public.print_can_configure(restaurant_id))
  with check (public.print_can_configure(restaurant_id));

grant select, insert, update, delete on public.printers to authenticated;
revoke all on public.printers from anon;

-- ----------------------------------------------------------------------------
-- 6. Registro das solicitações de impressão
--
-- Serve a duas perguntas reais: "o pedido foi mandado para a cozinha?" e "por
-- que nada saiu?" (status `unsupported` com o provedor que não está pronto).
-- ----------------------------------------------------------------------------
create table if not exists public.print_jobs (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  order_id      uuid references public.orders (id) on delete set null,
  profile_id    uuid references public.print_profiles (id) on delete set null,
  printer_id    uuid references public.printers (id) on delete set null,
  provider      public.print_provider_kind not null default 'browser',
  paper_width   public.print_paper_width not null default '80',
  copies        integer not null default 1 check (copies between 1 and 3),
  status        public.print_job_status not null default 'requested',
  -- "printed" aqui significa "o provedor confirmou". O navegador nunca confirma.
  detail        text check (detail is null or char_length(detail) <= 200),
  requested_by  uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

comment on table public.print_jobs is
  'Solicitações de impressão. Registra o pedido de impressão, não a confirmação do papel.';

create index if not exists print_jobs_restaurant_idx
  on public.print_jobs (restaurant_id, created_at desc);
create index if not exists print_jobs_order_idx
  on public.print_jobs (order_id, created_at desc);

alter table public.print_jobs enable row level security;

-- Sem policy de escrita: o cliente não inventa nem apaga histórico de
-- impressão. A escrita é só pela RPC `log_print_job`.
drop policy if exists print_jobs_select_member on public.print_jobs;
create policy print_jobs_select_member on public.print_jobs
  for select to authenticated
  using (public.print_can_view(restaurant_id));

grant select on public.print_jobs to authenticated;
revoke all on public.print_jobs from anon;

-- ----------------------------------------------------------------------------
-- 7. Leitura da configuração — uma chamada para a tela inteira
-- ----------------------------------------------------------------------------
create or replace function public.get_print_config(p_restaurant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_result jsonb;
begin
  if p_restaurant_id is null or not public.print_can_view(p_restaurant_id) then
    raise exception 'print_forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'settings', jsonb_build_object(
      'mode', coalesce(s.mode, 'manual'::public.print_mode),
      'default_paper_width', coalesce(s.default_paper_width, '80'::public.print_paper_width),
      'print_orders', coalesce(s.print_orders, true),
      'print_tickets', coalesce(s.print_tickets, true),
      'print_kitchen', coalesce(s.print_kitchen, true),
      'print_counter', coalesce(s.print_counter, true),
      'copies', coalesce(s.copies, 1),
      'footer_note', s.footer_note
    ),
    'profiles', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', p.id,
                 'name', p.name,
                 'slug', p.slug,
                 'kind', p.kind,
                 'paper_width', p.paper_width,
                 'copies', p.copies,
                 'is_active', p.is_active,
                 'sort_order', p.sort_order
               )
               order by p.sort_order, p.name
             )
      from public.print_profiles p
      where p.restaurant_id = p_restaurant_id
    ), '[]'::jsonb),
    'printers', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', pr.id,
                 'profile_id', pr.profile_id,
                 'name', pr.name,
                 'provider', pr.provider,
                 'identifier', pr.identifier,
                 'paper_width', pr.paper_width,
                 'is_default', pr.is_default,
                 'is_active', pr.is_active,
                 'notes', pr.notes
               )
               order by pr.is_default desc, pr.name
             )
      from public.printers pr
      where pr.restaurant_id = p_restaurant_id
    ), '[]'::jsonb),
    -- Se a pessoa pode salvar. A tela esconde o botão; quem decide é a RPC de
    -- escrita, de novo.
    'can_configure', public.print_can_configure(p_restaurant_id)
  )
    into v_result
  from (select p_restaurant_id as rid) base
  left join public.print_settings s on s.restaurant_id = base.rid;

  return v_result;
end;
$$;

comment on function public.get_print_config(uuid) is
  'Configuração de impressão + perfis + impressoras numa ida ao banco.';

revoke all on function public.get_print_config(uuid) from public;
grant execute on function public.get_print_config(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. Escrita da configuração
-- ----------------------------------------------------------------------------
create or replace function public.save_print_settings(
  p_restaurant_id       uuid,
  p_mode                public.print_mode,
  p_default_paper_width public.print_paper_width,
  p_print_orders        boolean,
  p_print_tickets       boolean,
  p_print_kitchen       boolean,
  p_print_counter       boolean,
  p_copies              integer,
  p_footer_note         text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.print_can_configure(p_restaurant_id) then
    raise exception 'print_forbidden' using errcode = '42501';
  end if;

  insert into public.print_settings as ps (
    restaurant_id, mode, default_paper_width,
    print_orders, print_tickets, print_kitchen, print_counter,
    copies, footer_note, updated_at
  )
  values (
    p_restaurant_id,
    coalesce(p_mode, 'manual'),
    coalesce(p_default_paper_width, '80'),
    coalesce(p_print_orders, true),
    coalesce(p_print_tickets, true),
    coalesce(p_print_kitchen, true),
    coalesce(p_print_counter, true),
    -- O check do banco continua sendo a última palavra; aqui só evitamos erro
    -- cru por um número que veio de teclado numérico de celular.
    greatest(1, least(coalesce(p_copies, 1), 3)),
    nullif(trim(coalesce(p_footer_note, '')), ''),
    now()
  )
  on conflict (restaurant_id) do update
    set mode                = excluded.mode,
        default_paper_width = excluded.default_paper_width,
        print_orders        = excluded.print_orders,
        print_tickets       = excluded.print_tickets,
        print_kitchen       = excluded.print_kitchen,
        print_counter       = excluded.print_counter,
        copies              = excluded.copies,
        footer_note         = excluded.footer_note,
        updated_at          = now();

  return public.get_print_config(p_restaurant_id);
end;
$$;

revoke all on function public.save_print_settings(
  uuid, public.print_mode, public.print_paper_width, boolean, boolean, boolean, boolean, integer, text
) from public;
grant execute on function public.save_print_settings(
  uuid, public.print_mode, public.print_paper_width, boolean, boolean, boolean, boolean, integer, text
) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. Perfis — upsert e remoção
-- ----------------------------------------------------------------------------
create or replace function public.save_print_profile(
  p_restaurant_id uuid,
  p_profile_id    uuid,
  p_name          text,
  p_kind          public.print_profile_kind,
  p_paper_width   public.print_paper_width,
  p_copies        integer,
  p_is_active     boolean,
  p_sort_order    integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_slug text;
begin
  if not public.print_can_configure(p_restaurant_id) then
    raise exception 'print_forbidden' using errcode = '42501';
  end if;

  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'invalid_profile_name' using errcode = '22023';
  end if;

  if p_profile_id is null then
    -- Slug a partir do nome, com sufixo numérico se colidir. Feito aqui e não
    -- na tela: quem chamar a RPC direto também precisa de slug válido.
    v_slug := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug := trim(both '-' from v_slug);
    if v_slug = '' or char_length(v_slug) < 2 then
      v_slug := 'perfil';
    end if;
    v_slug := left(v_slug, 28);

    -- Colisão é resolvida com contador, não com erro: o dono digitou
    -- "Cozinha" duas vezes e espera dois perfis, não uma mensagem.
    while exists (
      select 1 from public.print_profiles pp
      where pp.restaurant_id = p_restaurant_id and pp.slug = v_slug
    ) loop
      v_slug := left(v_slug, 26) || '-' || floor(random() * 900 + 100)::text;
    end loop;

    insert into public.print_profiles (
      restaurant_id, name, slug, kind, paper_width, copies, is_active, sort_order
    )
    values (
      p_restaurant_id, trim(p_name), v_slug,
      coalesce(p_kind, 'kitchen'), coalesce(p_paper_width, '80'),
      greatest(1, least(coalesce(p_copies, 1), 3)),
      coalesce(p_is_active, true),
      coalesce(p_sort_order, 0)
    )
    returning id into v_id;
  else
    update public.print_profiles pp
       set name        = trim(p_name),
           kind        = coalesce(p_kind, pp.kind),
           paper_width = coalesce(p_paper_width, pp.paper_width),
           copies      = greatest(1, least(coalesce(p_copies, 1), 3)),
           is_active   = coalesce(p_is_active, pp.is_active),
           sort_order  = coalesce(p_sort_order, pp.sort_order),
           updated_at  = now()
     where pp.id = p_profile_id
       and pp.restaurant_id = p_restaurant_id
    returning pp.id into v_id;

    if v_id is null then
      raise exception 'profile_not_found' using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_print_profile(
  uuid, uuid, text, public.print_profile_kind, public.print_paper_width, integer, boolean, integer
) from public;
grant execute on function public.save_print_profile(
  uuid, uuid, text, public.print_profile_kind, public.print_paper_width, integer, boolean, integer
) to authenticated;

create or replace function public.delete_print_profile(p_restaurant_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.print_can_configure(p_restaurant_id) then
    raise exception 'print_forbidden' using errcode = '42501';
  end if;

  -- As impressoras do perfil ficam sem destino (`on delete set null`) em vez de
  -- serem apagadas: o equipamento continua existindo na parede.
  delete from public.print_profiles pp
  where pp.id = p_profile_id
    and pp.restaurant_id = p_restaurant_id;
end;
$$;

revoke all on function public.delete_print_profile(uuid, uuid) from public;
grant execute on function public.delete_print_profile(uuid, uuid) to authenticated;

/**
 * Cria os quatro perfis do escopo em um toque.
 *
 * Idempotente por slug: tocar duas vezes não duplica. Existe porque montar
 * COZINHA, BALCÃO, BAR e CAIXA à mão no celular é o tipo de tarefa que ninguém
 * termina — e a tela fica vazia parecendo não funcionar.
 */
create or replace function public.seed_default_print_profiles(p_restaurant_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created integer := 0;
  v_row     record;
begin
  if not public.print_can_configure(p_restaurant_id) then
    raise exception 'print_forbidden' using errcode = '42501';
  end if;

  for v_row in
    select * from (values
      ('Cozinha', 'cozinha', 'kitchen'::public.print_profile_kind, 0),
      ('Balcão',  'balcao',  'counter'::public.print_profile_kind, 1),
      ('Bar',     'bar',     'bar'::public.print_profile_kind,     2),
      ('Caixa',   'caixa',   'cashier'::public.print_profile_kind, 3)
    ) as t(name, slug, kind, sort_order)
  loop
    insert into public.print_profiles as pp (
      restaurant_id, name, slug, kind, is_active, sort_order
    )
    values (p_restaurant_id, v_row.name, v_row.slug, v_row.kind, true, v_row.sort_order)
    on conflict (restaurant_id, slug) do nothing;

    if found then
      v_created := v_created + 1;
    end if;
  end loop;

  return v_created;
end;
$$;

revoke all on function public.seed_default_print_profiles(uuid) from public;
grant execute on function public.seed_default_print_profiles(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 10. Impressoras — upsert e remoção
-- ----------------------------------------------------------------------------
create or replace function public.save_printer(
  p_restaurant_id uuid,
  p_printer_id    uuid,
  p_profile_id    uuid,
  p_name          text,
  p_provider      public.print_provider_kind,
  p_identifier    text,
  p_paper_width   public.print_paper_width,
  p_is_default    boolean,
  p_is_active     boolean,
  p_notes         text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.print_can_configure(p_restaurant_id) then
    raise exception 'print_forbidden' using errcode = '42501';
  end if;

  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'invalid_printer_name' using errcode = '22023';
  end if;

  -- Perfil de outro restaurante não pode virar dono desta impressora. Sem isto,
  -- um uuid copiado de outra casa ligaria as duas.
  if p_profile_id is not null and not exists (
    select 1 from public.print_profiles pp
    where pp.id = p_profile_id and pp.restaurant_id = p_restaurant_id
  ) then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  -- Desmarca o padrão anterior antes de marcar o novo: o índice parcial recusa
  -- duas linhas, e o certo é trocar o padrão, não recusar a gravação.
  if coalesce(p_is_default, false) then
    update public.printers pr
       set is_default = false, updated_at = now()
     where pr.restaurant_id = p_restaurant_id
       and pr.is_default
       and (p_printer_id is null or pr.id <> p_printer_id);
  end if;

  if p_printer_id is null then
    insert into public.printers (
      restaurant_id, profile_id, name, provider, identifier,
      paper_width, is_default, is_active, notes
    )
    values (
      p_restaurant_id, p_profile_id, trim(p_name),
      coalesce(p_provider, 'browser'),
      nullif(trim(coalesce(p_identifier, '')), ''),
      coalesce(p_paper_width, '80'),
      coalesce(p_is_default, false),
      coalesce(p_is_active, true),
      nullif(trim(coalesce(p_notes, '')), '')
    )
    returning id into v_id;
  else
    update public.printers pr
       set profile_id  = p_profile_id,
           name        = trim(p_name),
           provider    = coalesce(p_provider, pr.provider),
           identifier  = nullif(trim(coalesce(p_identifier, '')), ''),
           paper_width = coalesce(p_paper_width, pr.paper_width),
           is_default  = coalesce(p_is_default, pr.is_default),
           is_active   = coalesce(p_is_active, pr.is_active),
           notes       = nullif(trim(coalesce(p_notes, '')), ''),
           updated_at  = now()
     where pr.id = p_printer_id
       and pr.restaurant_id = p_restaurant_id
    returning pr.id into v_id;

    if v_id is null then
      raise exception 'printer_not_found' using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_printer(
  uuid, uuid, uuid, text, public.print_provider_kind, text, public.print_paper_width, boolean, boolean, text
) from public;
grant execute on function public.save_printer(
  uuid, uuid, uuid, text, public.print_provider_kind, text, public.print_paper_width, boolean, boolean, text
) to authenticated;

create or replace function public.delete_printer(p_restaurant_id uuid, p_printer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.print_can_configure(p_restaurant_id) then
    raise exception 'print_forbidden' using errcode = '42501';
  end if;

  delete from public.printers pr
  where pr.id = p_printer_id
    and pr.restaurant_id = p_restaurant_id;
end;
$$;

revoke all on function public.delete_printer(uuid, uuid) from public;
grant execute on function public.delete_printer(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 11. O pedido como documento de impressão
--
-- Uma RPC devolve tudo o que o papel precisa — restaurante, fuso, pedido,
-- itens, adicionais, observações, totais, forma de pagamento **quando existir**
-- e a configuração de papel da casa. A tela de impressão não faz quatro
-- consultas nem decide sozinha se pode ver o pedido.
--
-- Forma de pagamento: `order_payments` é a verdade (Etapa 16). Pedido sem
-- pagamento registrado volta `payments: []` e o layout **omite a linha** em vez
-- de escrever "Não pago" no papel da cozinha, que não é assunto dela.
-- ----------------------------------------------------------------------------
create or replace function public.get_print_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_restaurant uuid;
  v_result     jsonb;
begin
  select o.restaurant_id into v_restaurant
  from public.orders o
  where o.id = p_order_id
    and public.print_can_view(o.restaurant_id);

  if v_restaurant is null then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'phone', r.phone,
      'address', nullif(concat_ws(', ', nullif(r.address_line, ''), nullif(r.address_number, '')), ''),
      'city', r.city,
      'timezone', r.timezone
    ),
    'settings', jsonb_build_object(
      'mode', coalesce(s.mode, 'manual'::public.print_mode),
      'default_paper_width', coalesce(s.default_paper_width, '80'::public.print_paper_width),
      'copies', coalesce(s.copies, 1),
      'footer_note', s.footer_note,
      -- Preço no papel da cozinha é ruído: ela separa por item, não por valor.
      'show_prices', coalesce(s.print_orders, true) and coalesce(s.print_tickets, true)
    ),
    'order', jsonb_build_object(
      'id', o.id,
      'order_number', o.order_number,
      'status', o.status,
      'channel', o.channel,
      'table_name', t.name,
      'subtotal', o.subtotal,
      'fees', o.fees,
      'discount', o.discount,
      'total', o.total,
      'notes', o.notes,
      'created_at', o.created_at,
      'updated_at', o.updated_at,
      'items', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'name', i.product_name_snapshot,
                   'quantity', i.quantity,
                   'unit_price', i.unit_price_snapshot,
                   'subtotal', i.subtotal,
                   'notes', i.notes,
                   'options', coalesce((
                     select jsonb_agg(
                              jsonb_build_object(
                                'group_name', oio.group_name,
                                'name', oio.option_name,
                                'price_delta', oio.price_delta,
                                'quantity', oio.quantity
                              )
                              order by oio.group_name, oio.option_name
                            )
                     from public.order_item_options oio
                     where oio.item_id = i.id
                   ), '[]'::jsonb)
                 )
                 order by i.position
               )
        from public.order_items i
        where i.order_id = o.id
      ), '[]'::jsonb),
      'payments', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'method', pay.method,
                   'amount', pay.amount,
                   'paid_at', pay.paid_at
                 )
                 order by pay.created_at
               )
        from public.order_payments pay
        where pay.order_id = o.id
          and pay.status = 'paid'
      ), '[]'::jsonb)
    )
  )
    into v_result
  from public.orders o
  join public.tables t on t.id = o.table_id
  join public.restaurants r on r.id = o.restaurant_id
  left join public.print_settings s on s.restaurant_id = o.restaurant_id
  where o.id = p_order_id;

  return v_result;
end;
$$;

comment on function public.get_print_order(uuid) is
  'Pedido montado para o papel térmico: restaurante, itens, adicionais, totais e pagamentos reais.';

revoke all on function public.get_print_order(uuid) from public;
grant execute on function public.get_print_order(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 12. Registro da solicitação de impressão
--
-- `status` é o que o app **sabe**: navegador manda para a caixa de diálogo e o
-- resto está fora do alcance. Por isso o default e o uso normal são
-- `requested`; `printed` só entra quando um provedor que confirma existir.
-- ----------------------------------------------------------------------------
create or replace function public.log_print_job(
  p_order_id    uuid,
  p_profile_id  uuid,
  p_printer_id  uuid,
  p_provider    public.print_provider_kind,
  p_paper_width public.print_paper_width,
  p_copies      integer,
  p_status      public.print_job_status,
  p_detail      text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant uuid;
  v_id         uuid;
begin
  select o.restaurant_id into v_restaurant
  from public.orders o
  where o.id = p_order_id
    and public.print_can_view(o.restaurant_id);

  if v_restaurant is null then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  -- Perfil e impressora de outro restaurante são ignorados em vez de aceitos:
  -- o log não serve de ponte entre tenants.
  insert into public.print_jobs (
    restaurant_id, order_id, profile_id, printer_id,
    provider, paper_width, copies, status, detail, requested_by
  )
  values (
    v_restaurant,
    p_order_id,
    (select pp.id from public.print_profiles pp
      where pp.id = p_profile_id and pp.restaurant_id = v_restaurant),
    (select pr.id from public.printers pr
      where pr.id = p_printer_id and pr.restaurant_id = v_restaurant),
    coalesce(p_provider, 'browser'),
    coalesce(p_paper_width, '80'),
    greatest(1, least(coalesce(p_copies, 1), 3)),
    coalesce(p_status, 'requested'),
    nullif(trim(coalesce(p_detail, '')), ''),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.log_print_job(
  uuid, uuid, uuid, public.print_provider_kind, public.print_paper_width, integer, public.print_job_status, text
) from public;
grant execute on function public.log_print_job(
  uuid, uuid, uuid, public.print_provider_kind, public.print_paper_width, integer, public.print_job_status, text
) to authenticated;

-- ----------------------------------------------------------------------------
-- 13. Índices de leitura
-- ----------------------------------------------------------------------------
create index if not exists print_profiles_active_idx
  on public.print_profiles (restaurant_id)
  where is_active;

create index if not exists printers_active_idx
  on public.printers (restaurant_id)
  where is_active;
