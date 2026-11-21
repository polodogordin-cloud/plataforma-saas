-- =============================================================================
-- Menuvo · Etapa 5 (correções) · "TAG desatualizada" e evento de substituição
-- =============================================================================
-- Dois bugs encontrados nos testes da 0005:
--
-- 1) `needs_rerecord` era derivado de `token_rotated_at > configured_at`.
--    Além de depender de dois relógios, os dois carimbos podem receber o MESMO
--    `now()` (que é fixo por transação), e a comparação falha: uma TAG gravada e
--    um token rotacionado no mesmo lote ficaria "em dia" para sempre.
--    Agora o estado é explícito: `is_stale`, marcado pela rotação e limpo quando
--    a TAG é regravada. Sem adivinhação.
--
-- 2) Substituir uma TAG (INSERT com `replaced_tag_id`) era registrado como
--    'created'. Passa a registrar 'replaced', que é o que o histórico precisa
--    mostrar.
--
-- 3) `table_nfc_events.tag_id` era ON DELETE CASCADE: excluir a TAG apagava o
--    histórico dela. Auditoria não pode sumir; virou ON DELETE SET NULL.
--
-- 4) Regravar sem mudar o status (o caso comum: só regravei a TAG) não limpava
--    `is_stale`. Agora regravar com o status atual já limpa o aviso.
-- =============================================================================

alter table public.table_nfc_tags
  add column if not exists is_stale boolean not null default false;

comment on column public.table_nfc_tags.is_stale is
  'URL mudou (token rotacionado) depois desta gravação: a TAG precisa ser regravada.';

-- -----------------------------------------------------------------------------
-- Gravação / regravação limpa o aviso
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

  if tg_op = 'INSERT' then
    if new.status in ('configured', 'tested') then
      new.configured_at := coalesce(new.configured_at, now());
    end if;
    if new.status = 'tested' then
      new.tested_at := coalesce(new.tested_at, now());
    end if;
  else
    -- Sai de "não configurada"/"desativada" para configurada ou testada:
    -- é uma gravação nova.
    -- Nova gravação: sai de 'not_configured'/'disabled' para configurada ou
    -- testada, OU a TAG estava desatualizada e o dono regravou.
    if new.status in ('configured', 'tested')
       and (old.status in ('not_configured', 'disabled') or old.is_stale) then
      new.configured_at := now();
      new.is_stale := false;
    end if;

    if new.status = 'tested' and old.status <> 'tested' then
      new.tested_at := now();
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rotação marca as TAGs como desatualizadas
-- -----------------------------------------------------------------------------
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

  -- Toda TAG já gravada passa a apontar para uma URL que não existe mais.
  update public.table_nfc_tags
     set is_stale = true,
         updated_at = now()
   where table_id = p_table_id
     and configured_at is not null;

  insert into public.table_nfc_events (
    restaurant_id, table_id, tag_id, event, from_status, to_status, actor_id, note
  )
  select t.restaurant_id, t.table_id, t.id, 'url_rotated', t.status, t.status,
         (select id from public.users where id = auth.uid()),
         'URL da mesa mudou: a TAG precisa ser regravada'
  from public.table_nfc_tags t
  where t.table_id = p_table_id;

  return v_table;
end;
$$;

-- -----------------------------------------------------------------------------
-- Histórico: substituição não é criação
-- -----------------------------------------------------------------------------
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
    v_event := case when new.replaced_tag_id is not null then 'replaced' else 'created' end;
  elsif new.status is distinct from old.status then
    v_event := 'status_changed';
  elsif new.replaced_tag_id is distinct from old.replaced_tag_id then
    v_event := 'replaced';
  elsif new.is_active is distinct from old.is_active then
    v_event := case when new.is_active then 'activated' else 'deactivated' end;
  elsif new.tag_identifier is distinct from old.tag_identifier then
    v_event := 'identifier_changed';
  else
    return new;
  end if;

  insert into public.table_nfc_events (
    restaurant_id, table_id, tag_id, event, from_status, to_status, actor_id
  )
  values (
    new.restaurant_id, new.table_id, new.id, v_event,
    case when tg_op = 'UPDATE' then old.status else null end,
    new.status, v_actor
  );

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- View: aviso derivado do flag explícito
-- -----------------------------------------------------------------------------
-- `create or replace view` não aceita coluna nova no meio (42P16): recriar.
drop view if exists public.table_nfc_overview;

create view public.table_nfc_overview
with (security_invoker = true)
as
select
  tag.id                                       as tag_id,
  tag.restaurant_id,
  tag.table_id,
  tag.label,
  tag.tag_identifier,
  tag.status,
  tag.is_active,
  tag.is_stale,
  tag.configured_at,
  tag.tested_at,
  tag.replaced_tag_id,
  tag.created_at,
  tag.updated_at,
  tbl.name                                     as table_name,
  tbl.is_active                                as table_is_active,
  r.slug                                       as restaurant_slug,
  '/r/' || r.slug || '/table/' || tbl.public_token as nfc_url,
  (tag.is_active and tbl.is_active)            as nfc_enabled,
  -- Só faz sentido falar em "regravar" quando existe URL gravada de fato.
  (tag.is_stale and tag.configured_at is not null) as needs_rerecord
from public.table_nfc_tags tag
join public.tables tbl on tbl.id = tag.table_id
join public.restaurants r on r.id = tag.restaurant_id;

grant select on public.table_nfc_overview to authenticated;
revoke all on public.table_nfc_overview from anon;
