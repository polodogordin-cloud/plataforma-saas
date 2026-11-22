-- ============================================================================
-- ETAPA 21 · ONBOARDING AUTOMÁTICO DO RESTAURANTE
--
-- O problema que este arquivo resolve
-- -----------------------------------
-- Até a Etapa 20, "configurar o restaurante" era um formulário só (nome, slug,
-- descrição, telefone) e o resto ficava espalhado em telas de configuração que
-- o dono novo não sabe que existem. Quem criava a conta caía no painel sem
-- cardápio, sem mesa e sem saber o que fazer em seguida.
--
-- A Etapa 21 transforma isso em um passo a passo com progresso salvo. Este
-- arquivo entrega a **parte de baixo**: o lugar onde o progresso vive, o
-- segmento do estabelecimento e a função que cria as categorias sugeridas —
-- com a garantia de que tudo é do tenant autenticado.
--
-- Decisões que valem registro
-- ---------------------------
-- 1. **Não existe tabela nova de "categorias sugeridas".** O modelo sugerido é
--    dado de apresentação (nome + ordem), não entidade de negócio. Ele mora em
--    `src/lib/onboarding.ts`, versionado no Git, e vira linhas reais em
--    `categories` só quando o dono confirma. Menos tabela, menos migration,
--    menos divergência entre o que a tela sugere e o que o banco guarda.
--
-- 2. **O progresso não tem coluna por etapa.** `onboarding` é `jsonb` com um
--    mapa `{ "informacoes": "done", ... }`. Coluna por etapa exigiria migration
--    a cada ajuste do wizard e transformaria "pular por enquanto" (estado
--    legítimo) num terceiro valor de enum.
--
-- 3. **O banco não confia no cliente para saber quem é o restaurante.** As
--    funções recebem `p_restaurant_id`, mas todas passam por
--    `can_read_tenant()`-style guard (`assert_restaurant_owner`). Um id de
--    outra casa não vira escrita: vira `onboarding_forbidden`. RLS não basta
--    aqui porque `security definer` roda como dono das tabelas.
--
-- 4. **O segmento é validado no banco também.** `restaurant_segment` existe como
--    domínio fechado; texto livre entraria como "hamburgueria " e a sugestão
--    de categorias nunca casaria.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Segmento do estabelecimento
-- ----------------------------------------------------------------------------
-- Enum e não `text` com check: o segmento vai ser usado para sugerir categorias,
-- tema e (no futuro) relatório por tipo de casa. Um domínio fechado evita
-- "pizzaria" conviver com "Pizzaria" e "pizza" na mesma coluna.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'restaurant_segment') then
    create type public.restaurant_segment as enum (
      'restaurante',
      'lanchonete',
      'pizzaria',
      'hamburgueria',
      'bar',
      'cafeteria',
      'sorveteria',
      'padaria',
      'acai',
      'delivery',
      'outro'
    );
  end if;
end $$;

alter table public.restaurants
  add column if not exists segment public.restaurant_segment;

comment on column public.restaurants.segment is
  'Segmento do estabelecimento (Etapa 21). Nulo = onboarding ainda não perguntou. '
  'Usado para sugerir categorias e, no futuro, tema e relatórios.';

-- ----------------------------------------------------------------------------
-- 2. Estado do onboarding
-- ----------------------------------------------------------------------------
-- `onboarding` guarda duas coisas que andam juntas:
--
--   { "steps": { "informacoes": "done", "aparencia": "skipped" }, "completed_at": null }
--
-- Um `jsonb` e não uma tabela de progresso porque o wizard é uma tela; o dado é
-- um par chave/valor pequeno lido sempre junto com o restaurante. Tabela
-- separada custaria um join em toda abertura do painel para economizar nada.
--
-- Estados por etapa (vocabulário fechado, validado na função):
--   pending  → ainda não visitada (ausência da chave)
--   done     → concluída
--   skipped  → pulada de propósito ("Pular por enquanto")
--
-- `completed_at` é separado do mapa: "terminei o wizard" é um fato com data,
-- não a soma das etapas. Quem concluiu com uma etapa pulada continua concluído.

alter table public.restaurants
  add column if not exists onboarding_completed boolean not null default false;

alter table public.restaurants
  add column if not exists onboarding_completed_at timestamptz;

alter table public.restaurants
  add column if not exists onboarding jsonb not null default '{"steps":{}}'::jsonb
  constraint restaurants_onboarding_shape check (
    jsonb_typeof(onboarding) = 'object'
    and onboarding ? 'steps'
    and jsonb_typeof(onboarding -> 'steps') = 'object'
  );

comment on column public.restaurants.onboarding_completed is
  'Etapa 21: o dono chegou ao fim do wizard. Não implica cardápio publicado.';
comment on column public.restaurants.onboarding is
  'Etapa 21: mapa de progresso por etapa + metadados do wizard. Nunca contém segredo.';

-- Quem já existia não pode aparecer como "onboarding pendente" no dashboard:
-- essas casas foram criadas antes deste wizard e já passaram pelo cadastro
-- manual. A marca `legacy` deixa o histórico explícito em vez de fingir que
-- alguém percorreu oito etapas que não existiam.
--
-- O checklist do dashboard **não** usa esta flag para decidir o que mostrar: ele
-- lê os dados reais (categorias, produtos, mesas...). Assim uma casa antiga com
-- cardápio incompleto continua vendo o que falta, que é o comportamento útil.
update public.restaurants
   set onboarding_completed = true,
       onboarding_completed_at = coalesce(onboarding_completed_at, created_at),
       onboarding = jsonb_build_object('steps', '{}'::jsonb, 'legacy', true)
 where onboarding_completed = false;

-- ----------------------------------------------------------------------------
-- 3. Guarda de tenant — reutilizável pelas funções desta migration
-- ----------------------------------------------------------------------------
-- Mesma lógica de `can_read_tenant` (Etapa 20), mas no sentido de escrita:
-- dono/admin do restaurante, ou admin da plataforma. `null` devolve `false`
-- em vez de estourar: função que decide acesso não deve levantar exceção por
-- entrada inválida — quem chama trata o booleano.
create or replace function public.is_restaurant_owner(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_restaurant_id is null then false
    when auth.uid() is null then false
    else public.is_platform_admin() or public.is_restaurant_admin(p_restaurant_id)
  end;
$$;

comment on function public.is_restaurant_owner(uuid) is
  'Etapa 21: o usuário logado pode configurar este restaurante? Não levanta exceção.';

revoke all on function public.is_restaurant_owner(uuid) from public, anon;
grant execute on function public.is_restaurant_owner(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Salvar o segmento
-- ----------------------------------------------------------------------------
-- Separado do progresso de propósito: o segmento é dado de negócio (vai para
-- relatório), o progresso é estado de interface. Misturar os dois faria um
-- "pular por enquanto" apagar o segmento escolhido.
create or replace function public.set_restaurant_segment(
  p_restaurant_id uuid,
  p_segment public.restaurant_segment
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_restaurant_id is null or not public.is_restaurant_owner(p_restaurant_id) then
    raise exception 'onboarding_forbidden' using errcode = '42501';
  end if;

  update public.restaurants
     set segment = p_segment,
         -- O segmento é a etapa `informacoes` na prática; mas não marcamos
         -- `done` aqui: quem marca é a função de progresso, com o mapa que a
         -- tela enviou. Assim o registro fica num lugar só.
         updated_at = now()
   where id = p_restaurant_id;

  if not found then
    raise exception 'restaurant_not_found' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.set_restaurant_segment(uuid, public.restaurant_segment) is
  'Etapa 21: grava o segmento do estabelecimento. Recusa tenant alheio com 42501.';

revoke all on function public.set_restaurant_segment(uuid, public.restaurant_segment) from public, anon;
grant execute on function public.set_restaurant_segment(uuid, public.restaurant_segment) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Salvar progresso do wizard
-- ----------------------------------------------------------------------------
-- Recebe o mapa inteiro em vez de "esta etapa" porque o wizard salva ao trocar
-- de passo: um único round-trip, e o servidor tem a foto completa. O banco
-- **valida o vocabulário** — um cliente adulterado não grava lixo em jsonb que
-- a tela vai ler depois.
--
-- `p_complete` marca a conclusão; é idempotente de propósito (o dono pode
-- revisitar etapas depois de finalizar sem "desfinalizar" o wizard).
create or replace function public.save_onboarding_progress(
  p_restaurant_id uuid,
  p_steps jsonb,
  p_complete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed text[] := array[
    'informacoes', 'aparencia', 'segmento', 'categorias',
    'produtos', 'mesas', 'qrcode', 'whatsapp'
  ];
  v_steps jsonb := coalesce(p_steps, '{}'::jsonb);
  v_key text;
  v_value text;
  v_row public.restaurants;
begin
  if p_restaurant_id is null or not public.is_restaurant_owner(p_restaurant_id) then
    raise exception 'onboarding_forbidden' using errcode = '42501';
  end if;

  if jsonb_typeof(v_steps) <> 'object' then
    raise exception 'invalid_onboarding_steps' using errcode = '22023';
  end if;

  -- Vocabulário fechado: chave desconhecida e valor desconhecido são recusados.
  -- Sem isso, `{"x": 1}` entraria no jsonb e a tela mostraria 100% sem nada
  -- configurado.
  for v_key, v_value in select key, value #>> '{}' from jsonb_each(v_steps) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'unknown_onboarding_step' using errcode = '22023';
    end if;
    if v_value not in ('done', 'skipped', 'pending') then
      raise exception 'invalid_onboarding_state' using errcode = '22023';
    end if;
  end loop;

  update public.restaurants
     set onboarding = jsonb_build_object(
           'steps', v_steps,
           -- Preserva a data da primeira conclusão; reabrir o wizard não
           -- reescreve o histórico.
           'completed_at', case
             when p_complete then coalesce(onboarding -> 'completed_at', to_jsonb(now()))
             else onboarding -> 'completed_at'
           end
         ),
         onboarding_completed = onboarding_completed or p_complete,
         onboarding_completed_at = case
           when p_complete then coalesce(onboarding_completed_at, now())
           else onboarding_completed_at
         end,
         updated_at = now()
   where id = p_restaurant_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'restaurant_not_found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'onboarding', v_row.onboarding,
    'completed', v_row.onboarding_completed,
    'completed_at', v_row.onboarding_completed_at
  );
end;
$$;

comment on function public.save_onboarding_progress(uuid, jsonb, boolean) is
  'Etapa 21: grava o mapa de progresso do wizard (vocabulário fechado) e a conclusão.';

revoke all on function public.save_onboarding_progress(uuid, jsonb, boolean) from public, anon;
grant execute on function public.save_onboarding_progress(uuid, jsonb, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Aplicar as categorias sugeridas do segmento
-- ----------------------------------------------------------------------------
-- A lista chega do cliente **de propósito**: é o modelo do segmento que o
-- arquivo `src/lib/onboarding.ts` define, e o servidor precisa poder evoluir a
-- sugestão (ex.: adicionar "Combos" em hamburgueria) sem migration.
--
-- O que o banco garante, então? Três coisas que a aplicação sozinha não
-- garantiria se alguém falasse direto com o PostgREST:
--
--   • só grava no tenant de quem chama (`is_restaurant_owner`);
--   • normaliza e **deduplica** por `name_key` — a mesma casa não ganha
--     "Bebidas" duas vezes, mesmo em duas chamadas concorrentes;
--   • limita a 40 nomes e o tamanho de cada um, para um cliente hostil não
--     usar a função como amplificador de escrita.
create or replace function public.apply_suggested_categories(
  p_restaurant_id uuid,
  p_names text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_key text;
  v_seen text[] := array[]::text[];
  v_position integer;
  v_created integer := 0;
  v_skipped integer := 0;
begin
  if p_restaurant_id is null or not public.is_restaurant_owner(p_restaurant_id) then
    raise exception 'onboarding_forbidden' using errcode = '42501';
  end if;

  if p_names is null or array_length(p_names, 1) is null then
    return jsonb_build_object('created', 0, 'skipped', 0);
  end if;

  if array_length(p_names, 1) > 40 then
    raise exception 'too_many_categories' using errcode = '22023';
  end if;

  select coalesce(max(position), -1) + 1 into v_position
    from public.categories where restaurant_id = p_restaurant_id;

  foreach v_name in array p_names loop
    v_name := trim(coalesce(v_name, ''));

    -- Nome vazio ou absurdamente longo: ignora em vez de abortar a lista
    -- inteira. O dono que confirmou seis categorias não deve perder cinco
    -- porque uma veio estranha.
    continue when char_length(v_name) = 0 or char_length(v_name) > 80;

    v_key := public.name_key(v_name);
    continue when v_key = any (v_seen);
    v_seen := v_seen || v_key;

    -- Já existe nesta casa (índice único por name_key): conta como pulada.
    if exists (
      select 1 from public.categories
       where restaurant_id = p_restaurant_id
         and public.name_key(name) = v_key
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.categories (restaurant_id, name, position, is_active)
    values (p_restaurant_id, v_name, v_position, true);

    v_position := v_position + 1;
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end;
$$;

comment on function public.apply_suggested_categories(uuid, text[]) is
  'Etapa 21: cria as categorias do modelo sugerido, sem duplicar as existentes.';

revoke all on function public.apply_suggested_categories(uuid, text[]) from public, anon;
grant execute on function public.apply_suggested_categories(uuid, text[]) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. RPC de leitura do painel de onboarding
-- ----------------------------------------------------------------------------
-- Uma leitura só para a tela toda: restaurante (nome, slug, logo, descrição,
-- segmento), progresso, e os contadores que o checklist precisa. Fazer isso em
-- seis consultas separadas no Server Component é seis idas ao banco numa tela
-- que abre em 4G.
--
-- Não devolve nada de outro tenant: `p_restaurant_id` é conferido e o retorno é
-- `null` quando não é do usuário (a aplicação trata como 404, não como 403 —
-- mesma decisão das telas de erro na Etapa 20).
create or replace function public.onboarding_overview(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.restaurants;
  v_categories integer;
  v_products integer;
  v_tables integer;
  v_active_tables integer;
  v_has_whatsapp boolean;
begin
  if p_restaurant_id is null or not public.is_restaurant_owner(p_restaurant_id) then
    return null;
  end if;

  select * into v_row from public.restaurants where id = p_restaurant_id;
  if v_row.id is null then
    return null;
  end if;

  select count(*) into v_categories from public.categories where restaurant_id = p_restaurant_id;
  select count(*) into v_products from public.products where restaurant_id = p_restaurant_id;

  select count(*), count(*) filter (where is_active)
    into v_tables, v_active_tables
    from public.tables where restaurant_id = p_restaurant_id;

  select exists (
    select 1 from public.whatsapp_settings
     where restaurant_id = p_restaurant_id and phone is not null
  ) into v_has_whatsapp;

  return jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', v_row.id,
      'name', v_row.name,
      'slug', v_row.slug,
      'logo_url', v_row.logo_url,
      'description', v_row.description,
      'phone', v_row.phone,
      'segment', v_row.segment,
      'status', v_row.status
    ),
    'onboarding', v_row.onboarding,
    'completed', v_row.onboarding_completed,
    'completed_at', v_row.onboarding_completed_at,
    'counts', jsonb_build_object(
      'categories', v_categories,
      'products', v_products,
      'tables', v_tables,
      'active_tables', v_active_tables,
      'whatsapp', v_has_whatsapp
    )
  );
end;
$$;

comment on function public.onboarding_overview(uuid) is
  'Etapa 21: tudo que o wizard/checklist precisa numa consulta. Null para tenant alheio.';

revoke all on function public.onboarding_overview(uuid) from public, anon;
grant execute on function public.onboarding_overview(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. Registro da migration
-- ----------------------------------------------------------------------------
-- A tabela de controle é a do próprio Supabase (`supabase_migrations`), como nas
-- Etapas 19 e 20. Não existe `public.schema_migrations` neste projeto.
insert into supabase_migrations.schema_migrations (version, name)
values ('20261122150000', 'stage21_onboarding')
on conflict (version) do nothing;

-- ----------------------------------------------------------------------------
-- 9. Fim
-- ----------------------------------------------------------------------------
-- Nenhuma policy nova em `restaurants`: quem escreve é a RPC `security definer`
-- com guarda própria. Dar UPDATE direto em `restaurants` para o dono editar
-- `onboarding` abriria caminho para gravar jsonb arbitrário na coluna.
