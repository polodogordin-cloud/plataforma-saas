-- ============================================================================
-- ETAPA 22 · GERADOR DE QR CODES E PLAQUINHAS
--
-- O que esta migration resolve
-- ----------------------------
-- A Etapa 4 já gera o QR Code de cada mesa e a Etapa 5 já registra TAGs NFC.
-- Faltava o **arquivo final**: a placa impressa, com logo, nome da mesa, texto e
-- NFC — e a possibilidade de guardar a preferência de arte da casa para não
-- remontar a placa mesa por mesa toda vez.
--
-- Duas coisas entram aqui:
--
--   1. `restaurants.qr_place_style` — a arte escolhida (cores, tamanho, margem,
--      formato, modelo). Guardar evita que o dono reajuste 20 placas à mão e
--      mantém a gráfica coerente entre as mesas.
--   2. Um limite de sanidade no jsonb: a validação forte é do TypeScript
--      (`normalizePlaceStyle`), mas o banco não aceita objeto arbitrário na
--      coluna — se alguém falar direto com o PostgREST, ainda precisa gravar
--      algo com a forma esperada.
--
-- Por que não uma tabela `qr_place_settings`: a arte é 1:1 com o restaurante e é
-- lida junto com ele em toda a tela de QR. Tabela separada custaria um join em
-- toda abertura para separar um punhado de chaves.
--
-- O que NÃO entra aqui
-- --------------------
-- Nada de coluna para "QR Code salvo" e nenhuma cópia da URL. A URL é sempre
-- calculada (`/r/{slug}/table/{public_token}`, o mesmo caminho de `nfc_url` na
-- Etapa 5): guardar uma cópia é como se cria QR Code apontando para endereço
-- velho depois de trocar o slug.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Arte da plaquinha
-- ----------------------------------------------------------------------------
alter table public.restaurants
  add column if not exists qr_place_style jsonb;

comment on column public.restaurants.qr_place_style is
  'Etapa 22: arte padrão da plaquinha de QR (cores, tamanho, margem, formato, modelo). '
  'Nulo = padrão da aplicação. A URL do QR nunca é guardada aqui.';

-- Forma mínima: objeto com as chaves conhecidas, sem nada de segredo.
-- A faixa numérica e o contraste de cor são validados em `normalizePlaceStyle`.
alter table public.restaurants
  drop constraint if exists restaurants_qr_place_style_shape;

alter table public.restaurants
  add constraint restaurants_qr_place_style_shape check (
    qr_place_style is null
    or (
      jsonb_typeof(qr_place_style) = 'object'
      and (qr_place_style ? 'format') is not null
    )
  );

-- ----------------------------------------------------------------------------
-- 2. Gravar a arte
-- ----------------------------------------------------------------------------
-- `security definer` com guarda própria: o dono **pode** atualizar `restaurants`
-- pela RLS, mas `restaurants_update_admin` permite qualquer coluna. Uma RPC
-- dedicada deixa a escrita num único ponto auditável e impede que a coluna vire
-- porta de entrada para gravar qualquer jsonb.
create or replace function public.save_qr_place_style(
  p_restaurant_id uuid,
  p_style jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.restaurants;
begin
  if p_restaurant_id is null or not public.is_restaurant_owner(p_restaurant_id) then
    raise exception 'qr_style_forbidden' using errcode = '42501';
  end if;

  if p_style is not null and jsonb_typeof(p_style) <> 'object' then
    raise exception 'invalid_qr_style' using errcode = '22023';
  end if;

  -- Tamanho máximo: um objeto de arte tem ~10 chaves curtas. 4 KB é folga
  -- enorme e evita que a coluna vire depósito de arquivo.
  if p_style is not null and octet_length(p_style::text) > 4096 then
    raise exception 'qr_style_too_large' using errcode = '22023';
  end if;

  update public.restaurants
     set qr_place_style = p_style,
         updated_at = now()
   where id = p_restaurant_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'restaurant_not_found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('qr_place_style', v_row.qr_place_style);
end;
$$;

comment on function public.save_qr_place_style(uuid, jsonb) is
  'Etapa 22: grava a arte padrão da plaquinha de QR do tenant autenticado.';

revoke all on function public.save_qr_place_style(uuid, jsonb) from public, anon;
grant execute on function public.save_qr_place_style(uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Leitura para o gerador
-- ----------------------------------------------------------------------------
-- Uma chamada devolve tudo que a tela `/app/mesas/qrcodes` precisa: mesas com o
-- token atual, estado de publicação da casa, slug e a arte salva. A tela abre em
-- 4G no celular do dono; seis consultas em série dariam seis esperas.
--
-- O token **sai** daqui, e isso é intencional: o dono precisa dele para montar a
-- URL que vai para o QR e para o NFC. Não é segredo — é o identificador público
-- que já está impresso na mesa dele. O `security definer` garante que só quem é
-- dono/admin da casa recebe a lista.
create or replace function public.qr_place_overview(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.restaurants;
  v_tables jsonb;
begin
  if p_restaurant_id is null or not public.is_restaurant_owner(p_restaurant_id) then
    return null;
  end if;

  select * into v_row from public.restaurants where id = p_restaurant_id;
  if v_row.id is null then
    return null;
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', t.id,
               'name', t.name,
               'code', t.code,
               'public_token', t.public_token,
               'is_active', t.is_active,
               'status', t.status,
               'has_stale_token', t.previous_token is not null
                 and t.previous_token_expires_at is not null
                 and t.previous_token_expires_at > now()
             )
             order by t.name
           ),
           '[]'::jsonb
         )
    into v_tables
    from public.tables t
   where t.restaurant_id = p_restaurant_id;

  return jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', v_row.id,
      'name', v_row.name,
      'slug', v_row.slug,
      'logo_url', v_row.logo_url,
      'status', v_row.status,
      'qr_place_style', v_row.qr_place_style
    ),
    'tables', v_tables
  );
end;
$$;

comment on function public.qr_place_overview(uuid) is
  'Etapa 22: mesas + slug + arte salva numa consulta. Null para tenant alheio.';

revoke all on function public.qr_place_overview(uuid) from public, anon;
grant execute on function public.qr_place_overview(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Registro
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, name)
values ('20261122160000', 'stage22_qr_places')
on conflict (version) do nothing;
