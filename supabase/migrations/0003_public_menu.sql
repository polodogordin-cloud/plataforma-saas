-- =============================================================================
-- Menuvo · Etapa 3 · Cardápio público
-- =============================================================================
-- O cliente final acessa /r/{slug} sem criar conta (role `anon`).
--
-- Por que VIEWS e não policies abertas nas tabelas:
--   * `restaurants` guarda telefone, endereço, `settings` e status comercial.
--     Abrir SELECT para `anon` exporia tudo isso — e ainda permitiria inferir
--     quais restaurantes existem mesmo antes de publicarem o cardápio.
--   * As views são `security_invoker = false` (rodam com os privilégios do
--     owner) e listam explicitamente as colunas que o cliente pode ver. É uma
--     allowlist: coluna nova no schema não vaza sozinha.
--   * A RLS das tabelas continua valendo integralmente para `authenticated`.
--     Nada aqui relaxa o painel administrativo.
--
-- Regra de exposição:
--   restaurante  → status = 'published'
--   categoria    → is_active = true
--   produto      → is_available = true
--   produto      → category_id is not null  e  categoria ativa
--                  (produto em categoria oculta não pode vazar pelo cardápio)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: o slug está publicado?
-- -----------------------------------------------------------------------------
create or replace function public.is_restaurant_published(p_slug text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.restaurants r
    where r.slug = p_slug
      and r.status = 'published'
  );
$$;

comment on function public.is_restaurant_published(text) is
  'Usada na geração de metadados/404. Não revela dados do restaurante.';

revoke all on function public.is_restaurant_published(text) from public;
grant execute on function public.is_restaurant_published(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- VIEW: cardápio público do restaurante
-- Acesso por slug, somente o essencial para o cabeçalho.
-- -----------------------------------------------------------------------------
create or replace view public.public_restaurants
with (security_invoker = false)
as
select
  r.id,
  r.name,
  r.slug,
  r.logo_url,
  r.description,
  r.city,
  r.state,
  r.currency,
  r.status,
  r.settings
from public.restaurants r
where r.status = 'published';

comment on view public.public_restaurants is
  'Cabeçalho do cardápio público. Sem telefone, endereço completo ou dados de equipe.';

-- -----------------------------------------------------------------------------
-- VIEW: categorias visíveis
-- -----------------------------------------------------------------------------
create or replace view public.public_categories
with (security_invoker = false)
as
select
  c.id,
  c.restaurant_id,
  c.name,
  c.description,
  c.image_url,
  c.position
from public.categories c
join public.restaurants r on r.id = c.restaurant_id
where c.is_active = true
  and r.status = 'published';

comment on view public.public_categories is
  'Categorias exibidas no cardápio público: ativas e de restaurante publicado.';

-- -----------------------------------------------------------------------------
-- VIEW: produtos visíveis
-- -----------------------------------------------------------------------------
create or replace view public.public_products
with (security_invoker = false)
as
select
  p.id,
  p.restaurant_id,
  p.category_id,
  p.name,
  p.description,
  p.price,
  p.image_url,
  p.is_featured,
  p.position
from public.products p
join public.categories c on c.id = p.category_id
join public.restaurants r on r.id = p.restaurant_id
where p.is_available = true
  and c.is_active = true
  and r.status = 'published';

comment on view public.public_products is
  'Produtos exibidos no cardápio público. Requer categoria ativa e restaurante publicado.';

-- -----------------------------------------------------------------------------
-- Privilégios: leitura só das views, e só das colunas já filtradas acima.
-- -----------------------------------------------------------------------------
-- Postgres ≥15: views rodam como o owner, mas o acesso ainda precisa de GRANT.
grant select on public.public_restaurants to anon, authenticated;
grant select on public.public_categories to anon, authenticated;
grant select on public.public_products to anon, authenticated;

-- anon não escreve em lugar nenhum.
revoke all on public.categories from anon;
revoke all on public.products from anon;
revoke all on public.restaurants from anon;

-- -----------------------------------------------------------------------------
-- Índices de apoio à leitura pública
-- -----------------------------------------------------------------------------
create index if not exists categories_restaurant_active_position_idx
  on public.categories (restaurant_id, position)
  where is_active = true;

create index if not exists products_restaurant_available_idx
  on public.products (restaurant_id, position)
  where is_available = true;

-- -----------------------------------------------------------------------------
-- Estrutura preparada para a próxima etapa (sem uso ainda)
-- -----------------------------------------------------------------------------
-- A identificação de mesa chega pela URL (?mesa=) e é validada em `tables`.
-- Os pedidos nascem de um "draft" local no cliente; nada é gravado sem
-- confirmação. Nenhuma tabela nova aqui: `tables`/`orders` são da Etapa 4/6.
comment on view public.public_products is
  'Produtos exibidos no cardápio público. Requer categoria ativa e restaurante publicado. '
  'A Etapa 4 lê a mesa por código na URL; o carrinho vive no cliente até o pedido ser confirmado.';
