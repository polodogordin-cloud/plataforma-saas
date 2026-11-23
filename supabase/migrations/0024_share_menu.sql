-- ============================================================================
-- ETAPA 23 · COMPARTILHAMENTO E DIVULGAÇÃO DO CARDÁPIO
--
-- O que esta migration resolve
-- ----------------------------
-- A Etapa 22 entregou o QR Code de cada mesa. Faltava o **material de
-- divulgação**: o link do cardápio para mandar no WhatsApp, colar na bio do
-- Instagram, imprimir um QR geral na porta e conferir o que aparece quando
-- alguém compartilha.
--
-- Três coisas entram aqui:
--
--   1. `restaurants.share_headline` — a chamada que o dono edita ("Confira nosso
--      cardápio digital", "Peça sem fila pelo celular"). Fica no restaurante e
--      não em `settings` porque é conteúdo público usado em toda divulgação; em
--      `settings` ele ficaria perdido no meio de preferências internas.
--   2. `share_overview()` — uma leitura só para a tela `/app/divulgar`: link
--      público, QR geral, mesas com token e últimos pedidos com link de
--      acompanhamento.
--   3. `save_share_headline()` — gravação da chamada, com a mesma guarda de
--      dono/admin das outras RPCs de configuração.
--
-- O que NÃO entra aqui
-- --------------------
-- Nenhuma coluna de "link compartilhado", nenhum contador de cliques e nenhum
-- log de envio. O app não sabe se o dono enviou a mensagem: depois do
-- `wa.me`, quem abre a conversa é o WhatsApp. Guardar "compartilhado: 12" seria
-- inventar dado — a mesma regra que a Etapa 13 seguiu no botão do WhatsApp.
--
-- Também não entra tabela de "redes sociais conectadas": não existe publicação
-- automática no escopo, e uma tabela dessas sugeriria que existe.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Chamada de compartilhamento
-- ----------------------------------------------------------------------------
-- `null` = usar a padrão da aplicação (`DEFAULT_SHARE_HEADLINE`). Guardar o
-- texto padrão no banco criaria duas fontes para o mesmo valor: no dia em que a
-- chamada padrão mudasse, as casas antigas continuariam com a velha sem que
-- ninguém tivesse escolhido isso.
alter table public.restaurants
  add column if not exists share_headline text;

comment on column public.restaurants.share_headline is
  'Etapa 23: chamada usada na divulgação (WhatsApp, redes, OG). Nulo = padrão do app. Máx. 160 caracteres.';

-- Limite de 160 caracteres no banco, além da validação do app: a tela pode ser
-- contornada com um PATCH direto no PostgREST, e uma chamada de 4 KB sairia
-- truncada no `wa.me` sem o dono entender por quê.
alter table public.restaurants
  drop constraint if exists restaurants_share_headline_length;
alter table public.restaurants
  add constraint restaurants_share_headline_length
  check (share_headline is null or char_length(share_headline) <= 160);

-- ----------------------------------------------------------------------------
-- 2. Gravar a chamada
-- ----------------------------------------------------------------------------
create or replace function public.save_share_headline(
  p_restaurant_id uuid,
  p_headline text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.restaurants;
  v_clean text;
begin
  if p_restaurant_id is null or not public.is_restaurant_owner(p_restaurant_id) then
    raise exception 'share_forbidden' using errcode = '42501';
  end if;

  -- Espaço colapsado também no banco: a mensagem vai para uma URL e quebra de
  -- linha vira `%0A` literal em alguns aparelhos Android.
  v_clean := nullif(btrim(regexp_replace(coalesce(p_headline, ''), '\s+', ' ', 'g')), '');

  if v_clean is not null and char_length(v_clean) > 160 then
    raise exception 'share_headline_too_long' using errcode = '22023';
  end if;

  update public.restaurants
     set share_headline = v_clean,
         updated_at = now()
   where id = p_restaurant_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'restaurant_not_found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('share_headline', v_row.share_headline);
end;
$$;

comment on function public.save_share_headline(uuid, text) is
  'Etapa 23: salva a chamada de divulgação. Exige dono/admin; texto vazio limpa e volta ao padrão.';

revoke all on function public.save_share_headline(uuid, text) from public, anon;
grant execute on function public.save_share_headline(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Leitura da tela de divulgação
-- ----------------------------------------------------------------------------
-- Uma ida ao banco para três assuntos: restaurante (slug, logo, status,
-- chamada), mesas ativas (token para link/QR) e os últimos pedidos de cada mesa
-- (número para o link de acompanhamento).
--
-- `security definer` porque a função precisa devolver a logo e o status mesmo
-- que a policy de `restaurants` mude; a guarda é `is_restaurant_owner(id)`.
-- `stable` para poder ser chamada duas vezes no mesmo render sem custo extra.
create or replace function public.share_overview(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.restaurants;
  v_tables jsonb;
  v_orders jsonb;
begin
  if p_restaurant_id is null or not public.is_restaurant_owner(p_restaurant_id) then
    return null;
  end if;

  select * into v_row from public.restaurants where id = p_restaurant_id;
  if v_row.id is null then
    return null;
  end if;

  -- Mesas: só o necessário para montar o link. `previous_token` não entra —
  -- link antigo não deve ser divulgado, e a tela não precisa dele.
  select coalesce(jsonb_agg(row_to_json(t) order by t.name), '[]'::jsonb)
    into v_tables
    from (
      select
        tb.id,
        tb.name,
        tb.code,
        tb.public_token,
        tb.is_active,
        tb.status::text as status
      from public.tables tb
      where tb.restaurant_id = p_restaurant_id
    ) t;

  -- Últimos pedidos por mesa: o link de acompanhamento precisa do número, e o
  -- número só existe por pedido. Limitado a 20 para a tela não crescer com a
  -- história do restaurante; a lista completa é do painel de pedidos.
  select coalesce(jsonb_agg(row_to_json(o) order by o.created_at desc), '[]'::jsonb)
    into v_orders
    from (
      select
        od.id,
        od.order_number,
        od.status::text as status,
        od.created_at,
        od.table_id,
        tb.name as table_name,
        tb.public_token
      from public.orders od
      join public.tables tb on tb.id = od.table_id
      where od.restaurant_id = p_restaurant_id
      order by od.created_at desc
      limit 20
    ) o;

  return jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', v_row.id,
      'name', v_row.name,
      'slug', v_row.slug,
      'logo_url', v_row.logo_url,
      'description', v_row.description,
      'status', v_row.status,
      'share_headline', v_row.share_headline
    ),
    'tables', v_tables,
    'orders', v_orders
  );
end;
$$;

comment on function public.share_overview(uuid) is
  'Etapa 23: dados da tela de divulgação. Devolve null para restaurante de outro tenant.';

revoke all on function public.share_overview(uuid) from public, anon;
grant execute on function public.share_overview(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Registro
-- ----------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, name)
values ('20261123100000', 'stage23_share')
on conflict (version) do nothing;
