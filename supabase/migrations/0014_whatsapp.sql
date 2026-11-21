-- ============================================================================
-- Etapa 13 · Configuração e preparação para WhatsApp
--
-- Objetivo: o restaurante liga um WhatsApp, escreve uma mensagem inicial, e o
-- cardápio público ganha um botão "Falar no WhatsApp". O botão abre o `wa.me`
-- com a mensagem já escrita. **Nada é enviado pelo sistema.**
--
-- Decisões deste arquivo, e por quê:
--
--   1. **Tabela própria, não `restaurants.settings`.** Mesmo raciocínio do tema
--      (Etapa 9): `settings` é jsonb livre e aceita qualquer lixo. Aqui o número
--      é validado por `check` e normalizado por RPC, o interruptor é `boolean`
--      e o PK é `restaurant_id` — no máximo uma configuração por casa, sem
--      duplicata, sem órfão, sem "o último que escrever ganha".
--
--   2. **O número é gravado normalizado (só dígitos, com DDI).** A tela aceita
--      "(11) 99999-0000", mas o banco guarda `5511999990000`. Assim o link é
--      montado sem reinterpretar o que o dono digitou e um valor antigo inválido
--      não aparece no dia em que o cliente toca no botão.
--
--   3. **Ausência de linha = botão inexistente.** Não criamos configuração para
--      quem nunca abriu a tela. O cardápio trata "sem linha" e "desligado" do
--      mesmo jeito: não mostra o botão. Nada quebra por falta de configuração.
--
--   4. **`whatsapp_messages` é fila de intenção, não de envio.** O escopo pede
--      preparação para mensagens automáticas, confirmação, status, marketing e
--      recuperação de clientes — e proíbe implementá-las. A tabela guarda o que
--      *precisaria* sair, com `status = 'queued'` e `provider = 'link'`. Nenhum
--      processo lê essa fila. É o registro que a Cloud API vai consumir quando
--      existir, e o lugar onde a auditoria vai olhar o que foi pedido.
--
--   5. **Sem token, sem segredo, sem chamada de rede.** Não há integração com a
--      API oficial nesta etapa. Credencial de WhatsApp Business (token da Meta,
--      app secret) mora em variável de ambiente do servidor, nunca no banco e
--      nunca no frontend — o mesmo princípio da Etapa 11 com o gateway.
--
--   6. **O plano é consultado, não embutido.** `plans.features` já lista a chave
--      `whatsapp` (Etapa 11). Esta migração **não** mexe em plano nenhum: quem
--      tem o recurso vê o botão, quem não tem vê o caminho de upgrade. Mudar o
--      catálogo comercial é decisão de negócio, tomada no /admin.
-- ============================================================================

-- -----------------------------------------------------------------------------
-- 1. Configuração da casa
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_settings (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,

  /**
   * Número normalizado: só dígitos, começando pelo DDI. `null` = não informado.
   *
   * O `check` é a última linha de defesa. Aceita 8 a 15 dígitos (faixa do
   * E.164) e nada mais — nem "+", nem espaço, nem parêntese. Quem normaliza é
   * `save_whatsapp_settings`, e a aplicação tem a mesma regra em
   * `src/lib/whatsapp.ts` (testada nos dois lados).
   */
  phone text
        constraint whatsapp_settings_phone_digits check (
          phone is null or (phone ~ '^[1-9][0-9]{7,14}$')
        ),

  /** Mensagem inicial. Vazia cai no padrão da aplicação na leitura. */
  message text not null default 'Olá! Gostaria de fazer um pedido.'
          constraint whatsapp_settings_message_len check (char_length(message) <= 350),

  /** Interruptor do dono. Sem número válido, o cardápio ignora este `true`. */
  is_active boolean not null default false,

  /**
   * Marca de quando o dono confirmou os termos de uso do canal.
   *
   * Não é burocracia: mensagem em massa pelo WhatsApp sem consentimento é o
   * caminho mais rápido para o número ser banido. Guardar o aceite agora evita
   * ter que reconstruir isso quando marketing entrar (item 7 do escopo).
   */
  terms_accepted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.whatsapp_settings is
  'WhatsApp do restaurante (Etapa 13). Uma linha por casa; ausência = botão desligado.';
comment on column public.whatsapp_settings.phone is
  'Número normalizado (dígitos com DDI, ex.: 5511999990000). Nunca o texto digitado.';
comment on column public.whatsapp_settings.message is
  'Mensagem inicial do botão do cardápio. Máximo 350 caracteres (cabe na URL do wa.me).';
comment on column public.whatsapp_settings.is_active is
  'Interruptor do dono. Só vale com número válido; quem decide é a leitura pública.';
comment on column public.whatsapp_settings.terms_accepted_at is
  'Aceite de uso do canal. Preparação para campanhas futuras (consentimento).';

drop trigger if exists whatsapp_settings_touch on public.whatsapp_settings;
create trigger whatsapp_settings_touch
  before update on public.whatsapp_settings
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Permissões
--
-- `anon` não lê a tabela: o cardápio público recebe o que precisa pela view
-- abaixo, que já limita as colunas. Nem `terms_accepted_at` nem timestamps
-- saem para o cliente.
-- -----------------------------------------------------------------------------
alter table public.whatsapp_settings enable row level security;

drop policy if exists whatsapp_settings_select on public.whatsapp_settings;
create policy whatsapp_settings_select on public.whatsapp_settings
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

-- Escrita só para owner/admin: staff atende o salão, não muda o canal da casa.
drop policy if exists whatsapp_settings_insert on public.whatsapp_settings;
create policy whatsapp_settings_insert on public.whatsapp_settings
  for insert to authenticated
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists whatsapp_settings_update on public.whatsapp_settings;
create policy whatsapp_settings_update on public.whatsapp_settings
  for update to authenticated
  using (public.is_restaurant_admin(restaurant_id))
  with check (public.is_restaurant_admin(restaurant_id));

drop policy if exists whatsapp_settings_delete on public.whatsapp_settings;
create policy whatsapp_settings_delete on public.whatsapp_settings
  for delete to authenticated
  using (public.is_restaurant_admin(restaurant_id));

grant select, insert, update, delete on public.whatsapp_settings to authenticated;
revoke all on public.whatsapp_settings from anon;

-- -----------------------------------------------------------------------------
-- 3. View pública
--
-- `security_invoker = false`: roda com privilégios do owner e expõe só o que o
-- cardápio precisa. A view é uma allowlist — coluna nova na tabela não vaza
-- sozinha. Casa suspensa/pausada não aparece: quem foi bloqueado pela
-- plataforma não segue recebendo pedido por um canal lateral.
-- -----------------------------------------------------------------------------
create or replace view public.public_whatsapp_settings
with (security_invoker = false)
as
select
  w.restaurant_id,
  w.phone,
  w.message,
  w.is_active
from public.whatsapp_settings w
join public.restaurants r on r.id = w.restaurant_id
where r.status = 'published';

comment on view public.public_whatsapp_settings is
  'WhatsApp exibido no cardápio público. Sem aceite, timestamps ou dado de equipe.';

grant select on public.public_whatsapp_settings to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Escrita via RPC
--
-- Mesmo desenho de `save_restaurant_theme`: valida no banco (não só no Zod),
-- confere o vínculo e devolve a linha final para a tela continuar com o que o
-- banco realmente gravou.
-- -----------------------------------------------------------------------------
create or replace function public.save_whatsapp_settings(
  p_restaurant_id uuid,
  p_phone         text,
  p_message       text,
  p_is_active     boolean
)
returns table (
  phone     text,
  message   text,
  is_active boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_digits text;
  v_ddd    integer;
begin
  if not public.is_restaurant_admin(p_restaurant_id) then
    -- Mesmo erro para "não existe" e "não é seu": não damos pista de tenant.
    raise exception 'whatsapp_forbidden' using errcode = '42501';
  end if;

  v_digits := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');

  if v_digits is not null then
    -- Zero de discagem nacional não é DDD ("011 99999-0000" é São Paulo).
    if v_digits like '0%' then
      v_digits := ltrim(v_digits, '0');
    end if;

    -- Número nacional (10 ou 11 dígitos) ganha o DDI do Brasil. É a mesma
    -- regra de `normalizeWhatsappNumber` em src/lib/whatsapp.ts.
    if char_length(v_digits) in (10, 11) then
      v_digits := '55' || v_digits;
    end if;

    if v_digits !~ '^[1-9][0-9]{7,14}$' then
      raise exception 'invalid_whatsapp_phone' using errcode = '22023';
    end if;

    -- Brasil: DDD válido é 11–99 e não é múltiplo de 10.
    if v_digits like '55%' and char_length(v_digits) in (12, 13) then
      v_ddd := substring(v_digits from 3 for 2)::integer;
      if v_ddd < 11 or v_ddd > 99 or v_ddd % 10 = 0 then
        raise exception 'invalid_whatsapp_phone' using errcode = '22023';
      end if;
    end if;
  end if;

  if char_length(coalesce(p_message, '')) > 350 then
    raise exception 'invalid_whatsapp_message' using errcode = '22023';
  end if;

  -- Ligar sem número é configuração inválida: o cardápio mostraria um botão
  -- que abre o WhatsApp sem destinatário.
  if coalesce(p_is_active, false) and v_digits is null then
    raise exception 'whatsapp_phone_required' using errcode = '22023';
  end if;

  insert into public.whatsapp_settings as w (
    restaurant_id, phone, message, is_active, terms_accepted_at
  )
  values (
    p_restaurant_id,
    v_digits,
    coalesce(nullif(btrim(coalesce(p_message, '')), ''), 'Olá! Gostaria de fazer um pedido.'),
    coalesce(p_is_active, false),
    -- Ligar o canal registra o aceite. Não sobrescreve um aceite anterior.
    case when coalesce(p_is_active, false) then now() else null end
  )
  on conflict (restaurant_id) do update
    set phone             = excluded.phone,
        message           = excluded.message,
        is_active         = excluded.is_active,
        terms_accepted_at = coalesce(w.terms_accepted_at, excluded.terms_accepted_at),
        updated_at        = now()
  returning w.phone, w.message, w.is_active
  into phone, message, is_active;

  return next;
end;
$$;

comment on function public.save_whatsapp_settings(uuid, text, text, boolean) is
  'Normaliza e grava o WhatsApp da casa. Recusa número inválido e ativo sem número.';

revoke all on function public.save_whatsapp_settings(uuid, text, text, boolean) from public;
grant execute on function public.save_whatsapp_settings(uuid, text, text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Preparação: fila de mensagens
--
-- O escopo pede estrutura preparada para WhatsApp Business API, mensagens
-- automáticas, confirmação, status, marketing e recuperação de clientes — e
-- proíbe implementar. Esta tabela é a estrutura, sem nenhum processo que a
-- consuma.
--
-- Por que uma fila, e não só o contrato em TypeScript: quando a Cloud API
-- entrar, ela vai precisar de (a) histórico do que foi pedido, (b) retentativa
-- e (c) idempotência para não mandar "pedido confirmado" duas vezes. Sem tabela,
-- isso viraria estado em memória de uma lambda — que desaparece.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'whatsapp_message_kind') then
    create type public.whatsapp_message_kind as enum (
      'contact',        -- conversa iniciada pelo cliente (o botão de hoje)
      'order_created',  -- "seu pedido #1042 chegou"
      'order_status',   -- mudança de status do pedido
      'order_confirmed',-- confirmação da cozinha
      'marketing',      -- campanha (exige consentimento)
      'winback'         -- recuperação de cliente inativo
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'whatsapp_message_status') then
    create type public.whatsapp_message_status as enum (
      'queued',   -- registrada, aguardando um provedor que saiba enviar
      'sent',     -- entregue ao provedor
      'failed',   -- falhou no envio
      'skipped'   -- não devia ser enviada (sem consentimento, sem número)
    );
  end if;
end
$$;

create table if not exists public.whatsapp_messages (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,

  kind           public.whatsapp_message_kind not null,
  status         public.whatsapp_message_status not null default 'queued',

  /** Destinatário normalizado: dígitos com DDI. */
  to_phone       text not null
                 constraint whatsapp_messages_phone_digits check (to_phone ~ '^[1-9][0-9]{7,14}$'),

  /** Corpo já renderizado. Guardar o texto final evita depender do código. */
  body           text not null
                 constraint whatsapp_messages_body_len check (char_length(body) between 1 and 1200),

  /**
   * Referência ao pedido, quando a mensagem é sobre um. `on delete set null`
   * porque apagar um pedido não deve apagar o histórico de comunicação.
   */
  order_id       uuid references public.orders (id) on delete set null,

  /** `link` hoje; `cloud` quando a API oficial existir. */
  provider       text not null default 'link'
                 constraint whatsapp_messages_provider check (provider in ('link', 'cloud')),

  /** Id da mensagem no provedor. `null` no provedor de link: nada foi enviado. */
  external_id    text,

  /** Motivo de falha/omissão, para diagnóstico. */
  error          text,

  /**
   * Chave de idempotência: a mesma mensagem para a mesma pessoa no mesmo
   * contexto não pode sair duas vezes. `null` permite duplicata deliberada
   * (duas campanhas iguais com meses de diferença).
   */
  dedupe_key     text,

  scheduled_for  timestamptz not null default now(),
  sent_at        timestamptz,
  created_at     timestamptz not null default now(),

  constraint whatsapp_messages_dedupe_key unique (restaurant_id, dedupe_key)
);

comment on table public.whatsapp_messages is
  'Fila de mensagens de WhatsApp (Etapa 13). Nenhum processo envia: é a estrutura para a Cloud API.';
comment on column public.whatsapp_messages.body is
  'Texto final renderizado. Guardar o corpo evita que uma mudança de código altere o histórico.';
comment on column public.whatsapp_messages.provider is
  'link = wa.me (quem envia é a pessoa); cloud = API oficial (quando existir).';
comment on column public.whatsapp_messages.dedupe_key is
  'Idempotência: mesma chave na mesma casa não duplica. null = duplicata permitida.';

create index if not exists whatsapp_messages_queue_idx
  on public.whatsapp_messages (restaurant_id, status, scheduled_for)
  where status = 'queued';

create index if not exists whatsapp_messages_order_idx
  on public.whatsapp_messages (order_id)
  where order_id is not null;

alter table public.whatsapp_messages enable row level security;

-- Leitura: membro da casa. Escrita: ninguém pela API pública — a fila é escrita
-- por RPC/trigger no futuro, não pelo navegador. Sem policy de insert/update
-- para `authenticated`, nenhum cliente consegue forjar uma mensagem.
drop policy if exists whatsapp_messages_select on public.whatsapp_messages;
create policy whatsapp_messages_select on public.whatsapp_messages
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

grant select on public.whatsapp_messages to authenticated;
revoke all on public.whatsapp_messages from anon;

-- -----------------------------------------------------------------------------
-- 6. Leitura pública: plano + configuração, em uma chamada
--
-- A view acima entrega o número e a mensagem. O plano **não** vai para o
-- navegador nem para o HTML: quem decide se o botão existe é esta RPC, que
-- devolve `null` quando a casa não tem o recurso `whatsapp` ou está bloqueada.
-- -----------------------------------------------------------------------------
create or replace function public.public_whatsapp_config(p_slug text)
returns table (
  phone     text,
  message   text
)
language sql
stable
security definer
set search_path = public
as $$
  select w.phone, w.message
  from public.whatsapp_settings w
  join public.restaurants r on r.id = w.restaurant_id
  where r.slug = lower(btrim(coalesce(p_slug, '')))
    and r.status = 'published'
    and w.is_active
    and w.phone is not null
    -- Recurso do plano: sem `whatsapp` em features, o botão não existe.
    and public.has_feature(w.restaurant_id, 'whatsapp')
  limit 1;
$$;

comment on function public.public_whatsapp_config(text) is
  'WhatsApp para o cardápio público: só devolve linha quando ativo, com número e no plano.';

revoke all on function public.public_whatsapp_config(text) from public;
grant execute on function public.public_whatsapp_config(text) to anon, authenticated;
