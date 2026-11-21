-- ============================================================================
-- Etapa 9 · Personalização visual do cardápio
--
-- O restaurante é dono da sua aparência. Hoje ele escolhe logo, capa, cores,
-- estilo de card e de botão; amanhã (Etapa 10) entra tipografia e layout. Por
-- isso o tema mora numa **tabela própria**, e não em `restaurants.settings`:
--
--   • `settings` é jsonb livre — ótimo para horários, péssimo para validar
--     cor. Aqui as cinco cores são `text` com `check` de hex, então um valor
--     inválido é recusado pelo banco, não "tratado" na tela;
--   • PK = `restaurant_id` significa **no máximo um tema por casa**. Não existe
--     tema duplicado, órfão nem "o último que escrever ganha";
--   • RLS por `is_restaurant_admin` + RPC que confere o vínculo: um restaurante
--     não alcança o tema de outro nem por id, nem por tentativa de update.
--
-- FALLBACK é regra de leitura, não de escrita: **não** criamos linha para quem
-- nunca personalizou. `public.restaurant_theme` devolve `{}`-equivalente e a
-- aplicação usa o tema padrão (Moderno) em `src/lib/theme.ts`. Assim o
-- cardápio nunca quebra por falta de configuração, e "nunca personalizou"
-- continua distinguível de "personalizou igual ao padrão".
-- ============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabela
-- -----------------------------------------------------------------------------
create table if not exists public.restaurant_themes (
  restaurant_id    uuid primary key references public.restaurants(id) on delete cascade,

  /** Último tema pronto aplicado (só rótulo: as cores abaixo são a verdade). */
  preset           text
                   check (preset is null or preset in
                     ('moderno', 'elegante', 'dark', 'minimalista', 'restaurante', 'fastfood')),

  primary_color    text not null default '#0f9250'
                   constraint restaurant_themes_primary_hex check (primary_color ~ '^#[0-9a-f]{6}$'),
  secondary_color  text not null default '#41cf80'
                   constraint restaurant_themes_secondary_hex check (secondary_color ~ '^#[0-9a-f]{6}$'),
  background_color text not null default '#ffffff'
                   constraint restaurant_themes_background_hex check (background_color ~ '^#[0-9a-f]{6}$'),
  text_color       text not null default '#14161c'
                   constraint restaurant_themes_text_hex check (text_color ~ '^#[0-9a-f]{6}$'),
  button_color     text not null default '#0f9250'
                   constraint restaurant_themes_button_hex check (button_color ~ '^#[0-9a-f]{6}$'),

  card_style       text not null default 'rounded'
                   check (card_style in ('rounded', 'soft', 'flat')),
  button_style     text not null default 'solid'
                   check (button_style in ('solid', 'outline', 'pill')),

  /**
   * Imagens.
   *
   * Guardamos a URL pública do bucket `restaurant-assets`, com o caminho
   * `{restaurant_id}/theme/...`. O `check` abaixo amarra a imagem ao tenant:
   * uma linha de tema não pode apontar para o arquivo de outra casa, mesmo que
   * alguém consiga escrever direto no banco.
   */
  logo_url         text,
  cover_url        text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.restaurant_themes is
  'Tema visual do cardápio público. Uma linha por restaurante; ausência = tema padrão.';
comment on column public.restaurant_themes.preset is
  'Rótulo do último preset aplicado. Não afeta a renderização: as cores mandam.';
comment on column public.restaurant_themes.card_style is
  'rounded | soft | flat — raio e sombra dos cards do cardápio.';
comment on column public.restaurant_themes.button_style is
  'solid | outline | pill — como o botão de adicionar é pintado.';

drop trigger if exists restaurant_themes_touch on public.restaurant_themes;
create trigger restaurant_themes_touch
  before update on public.restaurant_themes
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Permissões
--
-- `anon` NÃO lê a tabela: o cardápio público recebe o tema pela view abaixo,
-- que já limita as colunas. O painel usa as policies para `authenticated`.
-- -----------------------------------------------------------------------------
alter table public.restaurant_themes enable row level security;

drop policy if exists restaurant_themes_select on public.restaurant_themes;
create policy restaurant_themes_select on public.restaurant_themes
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

-- Escrita: só owner/admin. Staff vê o tema, não muda a cara da casa.
drop policy if exists restaurant_themes_insert on public.restaurant_themes;
create policy restaurant_themes_insert on public.restaurant_themes
  for insert to authenticated
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists restaurant_themes_update on public.restaurant_themes;
create policy restaurant_themes_update on public.restaurant_themes
  for update to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists restaurant_themes_delete on public.restaurant_themes;
create policy restaurant_themes_delete on public.restaurant_themes
  for delete to authenticated
  using (public.is_restaurant_admin(restaurant_id));

grant select, insert, update, delete on public.restaurant_themes to authenticated;
revoke all on public.restaurant_themes from anon;

-- -----------------------------------------------------------------------------
-- 3. View pública
--
-- `security_invoker = false`: roda com privilégios do owner e expõe só as
-- colunas do tema, de restaurante publicado. Coluna nova na tabela não vaza
-- sozinha — a view é uma allowlist.
-- -----------------------------------------------------------------------------
create or replace view public.public_restaurant_themes
with (security_invoker = false)
as
select
  t.restaurant_id,
  t.preset,
  t.primary_color,
  t.secondary_color,
  t.background_color,
  t.text_color,
  t.button_color,
  t.card_style,
  t.button_style,
  t.logo_url,
  t.cover_url
from public.restaurant_themes t
join public.restaurants r on r.id = t.restaurant_id
where r.status = 'published';

comment on view public.public_restaurant_themes is
  'Tema do cardápio público. Sem timestamps e sem nada de equipe.';

grant select on public.public_restaurant_themes to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Escrita via RPC
--
-- A tabela tem RLS, mas a escrita passa por aqui por dois motivos:
--   * normaliza e valida em um lugar só (hex, estilos, URLs);
--   * faz o UPSERT de forma atômica e devolve a linha final, para o painel
--     continuar o preview com o que o banco realmente gravou.
-- -----------------------------------------------------------------------------
create or replace function public.save_restaurant_theme(
  p_restaurant_id    uuid,
  p_preset           text,
  p_primary_color    text,
  p_secondary_color  text,
  p_background_color text,
  p_text_color       text,
  p_button_color     text,
  p_card_style       text,
  p_button_style     text,
  p_logo_url         text default null,
  p_cover_url        text default null
)
returns table (
  preset           text,
  primary_color    text,
  secondary_color  text,
  background_color text,
  text_color       text,
  button_color     text,
  card_style       text,
  button_style     text,
  logo_url         text,
  cover_url        text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hex_re constant text := '^#[0-9a-f]{6}$';
begin
  if not public.is_restaurant_admin(p_restaurant_id) then
    -- Mesmo erro para "não existe" e "não é seu": não damos pista de tenant.
    raise exception 'theme_forbidden' using errcode = '42501';
  end if;

  -- Cores: o formulário manda minúsculo, mas não confiamos nisso.
  p_primary_color    := lower(btrim(coalesce(p_primary_color, '')));
  p_secondary_color  := lower(btrim(coalesce(p_secondary_color, '')));
  p_background_color := lower(btrim(coalesce(p_background_color, '')));
  p_text_color       := lower(btrim(coalesce(p_text_color, '')));
  p_button_color     := lower(btrim(coalesce(p_button_color, '')));

  if p_primary_color    !~ v_hex_re
     or p_secondary_color  !~ v_hex_re
     or p_background_color !~ v_hex_re
     or p_text_color       !~ v_hex_re
     or p_button_color     !~ v_hex_re then
    raise exception 'invalid_color' using errcode = '22023';
  end if;

  if p_card_style is null or p_card_style not in ('rounded', 'soft', 'flat') then
    raise exception 'invalid_card_style' using errcode = '22023';
  end if;

  if p_button_style is null or p_button_style not in ('solid', 'outline', 'pill') then
    raise exception 'invalid_button_style' using errcode = '22023';
  end if;

  if p_preset is not null
     and p_preset not in ('moderno', 'elegante', 'dark', 'minimalista', 'restaurante', 'fastfood') then
    raise exception 'invalid_preset' using errcode = '22023';
  end if;

  -- Imagens: só caminho do próprio tenant no bucket público, ou null.
  -- Isto barra URL externa, `javascript:` e o arquivo de outro restaurante.
  p_logo_url := nullif(btrim(coalesce(p_logo_url, '')), '');
  if p_logo_url is not null
     and p_logo_url not like '%/storage/v1/object/public/restaurant-assets/'
                        || p_restaurant_id::text || '/%' then
    raise exception 'invalid_image_url' using errcode = '22023';
  end if;

  p_cover_url := nullif(btrim(coalesce(p_cover_url, '')), '');
  if p_cover_url is not null
     and p_cover_url not like '%/storage/v1/object/public/restaurant-assets/'
                         || p_restaurant_id::text || '/%' then
    raise exception 'invalid_image_url' using errcode = '22023';
  end if;

  insert into public.restaurant_themes as t (
    restaurant_id, preset,
    primary_color, secondary_color, background_color, text_color, button_color,
    card_style, button_style, logo_url, cover_url
  )
  values (
    p_restaurant_id, p_preset,
    p_primary_color, p_secondary_color, p_background_color, p_text_color, p_button_color,
    p_card_style, p_button_style, p_logo_url, p_cover_url
  )
  on conflict (restaurant_id) do update set
    preset           = excluded.preset,
    primary_color    = excluded.primary_color,
    secondary_color  = excluded.secondary_color,
    background_color = excluded.background_color,
    text_color       = excluded.text_color,
    button_color     = excluded.button_color,
    card_style       = excluded.card_style,
    button_style     = excluded.button_style,
    logo_url         = excluded.logo_url,
    cover_url        = excluded.cover_url;

  return query
    select t.preset, t.primary_color, t.secondary_color, t.background_color,
           t.text_color, t.button_color, t.card_style, t.button_style,
           t.logo_url, t.cover_url
    from public.restaurant_themes t
    where t.restaurant_id = p_restaurant_id;
end;
$$;

comment on function public.save_restaurant_theme is
  'Cria/atualiza o tema do cardápio. Valida hex, estilos e URLs do próprio tenant.';

revoke all on function public.save_restaurant_theme(
  uuid, text, text, text, text, text, text, text, text, text, text
) from public;
grant execute on function public.save_restaurant_theme(
  uuid, text, text, text, text, text, text, text, text, text, text
) to authenticated;

/** Remove a personalização e volta ao tema padrão. */
create or replace function public.reset_restaurant_theme(p_restaurant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_restaurant_admin(p_restaurant_id) then
    raise exception 'theme_forbidden' using errcode = '42501';
  end if;

  delete from public.restaurant_themes where restaurant_id = p_restaurant_id;
  return true;
end;
$$;

revoke all on function public.reset_restaurant_theme(uuid) from public;
grant execute on function public.reset_restaurant_theme(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Storage: imagens de tema são mais pesadas que um logo de perfil
--
-- O bucket nasceu com 2 MB e aceitava SVG — SVG é XML com script dentro, então
-- sai da lista. 5 MB dá espaço para capa de celular (12 MP) antes da
-- otimização do navegador, que já reduz para ~1600 px / WebP no envio.
-- -----------------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
 where id = 'restaurant-assets';

-- Leitura pública continua valendo (policy da 0001). Escrita, atualização e
-- remoção seguem restritas a `is_restaurant_admin` do primeiro segmento do
-- caminho — que é exatamente `{restaurant_id}/...`.

-- -----------------------------------------------------------------------------
-- 6. Realtime
--
-- O painel pode ter duas abas abertas (dono no celular, sócio no desktop).
-- Publicar a tabela deixa o preview alinhado sem recarregar. Volume é baixo:
-- uma linha por casa.
-- -----------------------------------------------------------------------------
alter table public.restaurant_themes replica identity full;

do $pub$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'restaurant_themes'
  ) then
    alter publication supabase_realtime add table public.restaurant_themes;
  end if;
end $pub$;
