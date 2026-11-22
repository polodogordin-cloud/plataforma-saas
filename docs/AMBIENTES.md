# Ambientes, domínio e deploy

Documento interno. Explica **o que configurar e por quê**; não contém valor de
segredo nenhum. Para os valores reais, o lugar é o painel da Vercel (Settings →
Environment Variables) e o cofre de senhas do time.

---

## 1. Os três ambientes

| | development | staging | production |
| --- | --- | --- | --- |
| Onde roda | máquina do dev | preview da Vercel / branch | domínio próprio |
| `NEXT_PUBLIC_APP_ENV` | `development` | `staging` | `production` |
| Banco | projeto Supabase de dev (ou o mesmo, com dados fictícios) | **o mesmo de produção** (não há banco separado ainda) | produção |
| HSTS | não | **não** | sim |
| `www.` → apex | não | não | sim |
| Indexação (`robots.txt`) | livre | `Disallow: /` recomendado | livre |
| Dados reais de cliente | **nunca** | evitar | sim |

### Por que `NEXT_PUBLIC_APP_ENV` existe

A Vercel roda **staging com `NODE_ENV=production`**. Sem uma variável explícita,
um deploy de preview se comportaria como produção: mandaria `Strict-Transport-Security`
com `includeSubDomains` e redirecionaria `www`. HSTS é uma promessa de um ano que
o navegador guarda — num domínio de teste que ainda não tem todos os subdomínios
em HTTPS, isso tranca o time fora.

`resolveAppEnv()` (em `src/lib/env.ts`) lê essa variável primeiro e só cai em
`NODE_ENV` quando ela está vazia.

### Staging compartilha o banco de produção

Isso é uma dívida consciente, não um descuido: o projeto Supabase está no plano
gratuito e não há branch de banco. Consequência prática:

- **nunca** rodar migration destrutiva a partir de um preview;
- **nunca** testar exclusão em staging usando o restaurante de um cliente;
- um bug de escrita em staging aparece em produção.

Quando houver orçamento, o caminho é `supabase branches` ou um segundo projeto —
e aí `NEXT_PUBLIC_SUPABASE_URL` passa a variar por ambiente, que é exatamente
para isso que ela já vem de variável.

---

## 2. Variáveis de ambiente

Obrigatórias estão marcadas. O restante tem padrão de fallback e o app sobe sem
elas — mas o `/api/health` mostra cada uma como `missing`.

| Variável | Obrigatória | Pública? | Para que serve |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | sim | sim | Endpoint do Supabase. Vai no bundle. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | sim | sim | Chave anon. Protegida por RLS, não por segredo. |
| `NEXT_PUBLIC_SITE_URL` | em produção | sim | Base de QR Code, `canonical`, sitemap e e-mails. |
| `NEXT_PUBLIC_APP_ENV` | em staging | sim | Distingue staging de produção. |
| `TRUSTED_EXTRA_HOSTS` | não | não | Hosts extras aceitos ao montar URL pública. |
| `HEALTH_CHECK_SECRET` | não | não | Protege `/api/health` com Bearer token. |
| `PAYMENT_PROVIDER` | não | não | Reservado. Nenhum gateway implementado. |
| `WHATSAPP_PROVIDER` | não | não | Reservado. Ausente = link `wa.me`. |

### A `service_role` não é usada

Todo acesso a dados passa pela chave `anon` + cookies de sessão, e portanto por
RLS. A `service_role` ignora RLS: usá-la em qualquer lugar do app transformaria
um bug de consulta em vazamento entre restaurantes. Se ela aparecer numa
variável `NEXT_PUBLIC_*`, é incidente — `NEXT_PUBLIC_` vai para o navegador.

### Como o app descobre o próprio domínio

`src/lib/env.ts` → `resolveSiteOrigin()`:

1. `NEXT_PUBLIC_SITE_URL`, se válida;
2. o host da requisição, **se confiável** (domínio configurado, `*.vercel.app`,
   localhost ou `TRUSTED_EXTRA_HOSTS`);
3. nada — e o chamador decide.

O passo 2 existe para que esquecer a variável não gere um QR Code apontando para
`menuvo.app`. O passo 3 existe porque devolver um domínio que não é o nosso é
pior que devolver nada: QR Code errado só se descobre impresso.

---

## 3. Banco de dados

- **Projeto**: Supabase, região `sa-east-1` (São Paulo).
- **Migrations**: `supabase/migrations/*.sql`, aplicadas **em ordem**. Algumas
  foram aplicadas direto pelo painel nas etapas iniciais; o diretório é a fonte
  de verdade a partir da `0014`.
- **Verificar pendências**:

  ```sql
  select version from supabase_migrations.schema_migrations order by version;
  ```

- **Nada de `service_role` no app.** As RPCs `security definer` são a única
  fronteira que ignora RLS, e todas chamam `is_platform_admin()`,
  `is_restaurant_admin()` ou validam um token antes de fazer qualquer coisa.

### Pagamentos e analytics (Etapa 16)

Duas coisas mudaram no banco nesta etapa e ambas precisam existir no ambiente
antes de a tela abrir:

1. **`order_payments`** — o livro de dinheiro recebido. Antes dele o banco não
   registrava pagamento nenhum, então "valor efetivamente pago" não era uma
   consulta: era um palpite. Escrita só por RPC (`record_order_payment`,
   `refund_order_payment`); a tabela tem `select` para membros da casa e nada
   mais. Um pedido pago **é derivado** da soma dos lançamentos, nunca de uma
   coluna `paid` digitada à mão.
2. **As dez funções de agregação** — `analytics_period` /
   `analytics_previous_period` (resolvedores de janela), sete
   `restaurant_analytics_*` (uma por bloco da tela), `admin_analytics` e
   `admin_analytics_daily`.

Aplicar `0016_analytics.sql` inteiro. Ele é idempotente (`create table if not
exists`, `create or replace function`, `create index if not exists`), então
reaplicar num banco já migrado não quebra nada nem duplica dados.

```sql
-- conferir que a etapa 16 está aplicada
select count(*) as funcoes
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like 'restaurant_analytics%'
       or p.proname in ('admin_analytics','admin_analytics_daily',
                        'analytics_period','analytics_previous_period',
                        'record_order_payment','refund_order_payment',
                        'list_order_payments'));
-- esperado: 15
```

**Staging compartilha o banco de produção** (ver §1). Como a `0016` só cria
objetos novos e não toca em dado existente, aplicá-la em staging já migra
produção junto — não há uma segunda janela de migration depois.

**Nenhuma variável de ambiente nova.** A tela usa o mesmo cliente Supabase do
resto do app; sem `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`
o erro aparece na abertura de `/app/analytics` como
`Your project's URL and Key are required to create a Supabase client`. Se essa
frase aparecer num 500, é env faltando no ambiente, não a migration.

### Cozinha e papéis (Etapa 17)

`0017_kitchen.sql` adiciona dois valores ao enum `restaurant_member_role`
(`kitchen`, `waiter`) e as tabelas do KDS. **Aplicar em dois passos**, e isso não
é preferência: `alter type ... add value` não pode rodar na mesma transação em
que o valor novo é usado (erro `55P04`). Num `supabase db push` isso costuma
passar porque cada statement ganha sua transação; por MCP ou psql com `-1`,
aplicar em blocos.

Passo 1 (sozinho, uma vez):

```sql
alter type public.restaurant_member_role add value if not exists 'kitchen';
alter type public.restaurant_member_role add value if not exists 'waiter';
```

Passo 2: o resto do arquivo. É idempotente (`create or replace`,
`if not exists`, `drop policy if exists`).

```sql
-- conferir que a etapa 17 está aplicada
select count(*) as funcoes
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like 'kds_can_%'
       or p.proname in ('list_kitchen_orders', 'list_kitchen_stations',
                        'get_kitchen_settings', 'set_kitchen_settings'));
-- esperado: 8
```

**Nenhuma variável de ambiente nova.** O KDS usa o mesmo cliente Supabase. O
som é gerado por Web Audio no navegador; não há arquivo de áudio para servir nem
`media-src` para liberar na CSP.

**Realtime:** `order_items` entra na publicação `supabase_realtime`. Se o KDS
aparecer vazio e só atualizar ao recarregar, o primeiro lugar a olhar é a
publicação:

```sql
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public';
-- precisa conter orders, order_items, order_status_events
```

**Atribuir o papel:** o suporte faz em `/admin/restaurantes/<id>` → Equipe →
Alterar papel, ou via `admin_set_member_role`. O usuário precisa sair e entrar
de novo (ou recarregar) porque o papel é lido do vínculo a cada requisição.

### Impressão (Etapa 18)

`0018_printing.sql` é **um arquivo só, sem passo separado**: os tipos novos
(`print_paper_width`, `print_profile_kind`, `print_mode`, `print_provider_kind`,
`print_job_status`) são criados em blocos `do $$ ... if not exists` e nenhum é
*lido* pela mesma transação que o cria — diferente do enum de papel da Etapa 17,
que exigiu dois passos.

```sql
-- conferir que a etapa 18 está aplicada
select count(*) as tabelas
from information_schema.tables
where table_schema = 'public'
  and table_name in ('print_settings', 'print_profiles', 'printers', 'print_jobs');
-- esperado: 4

select count(*) as funcoes
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('print_can_view', 'print_can_configure', 'get_print_config',
                    'save_print_settings', 'save_print_profile', 'delete_print_profile',
                    'seed_default_print_profiles', 'save_printer', 'delete_printer',
                    'get_print_order', 'log_print_job');
-- esperado: 11
```

**Nenhuma variável de ambiente nova.** A impressão usa o mesmo cliente Supabase,
e o único caminho de saída hoje é `window.print()` no navegador — não há serviço
externo, chave de API nem endpoint para configurar.

**Ensaio rápido no banco** (transação descartável, trocando o `sub` pelo usuário
que se quer testar):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"<uuid-do-usuario>","role":"authenticated"}', true);

select public.seed_default_print_profiles('<restaurant_id>'::uuid);  -- 4 na 1ª vez, 0 depois
select public.get_print_config('<restaurant_id>'::uuid) -> 'settings';

rollback;
```

`kitchen` deve receber `print_forbidden` em qualquer uma das funções de escrita
(`save_print_settings`, `save_print_profile`, `save_printer`,
`seed_default_print_profiles`) e `true` em `print_can_view`. Se `kitchen`
conseguir salvar, a Etapa 18 está aplicada pela metade.

**Nada de Realtime aqui.** Impressão não assina canal: o cupom é montado no
servidor a cada abertura da rota, e a configuração é lida com `force-dynamic`.

### Ao criar migration nova

1. arquivo `NNNN_nome.sql` em `supabase/migrations/`;
2. testar num branch de banco ou à mão em transação;
3. aplicar com `create_migration` (MCP) ou `supabase db push`;
4. rodar os testes de RLS (`scripts/` e os harnesses em `.arena-test/`);
5. só depois abrir PR.

---

## 4. Storage

Bucket público `restaurant-assets`, servido por
`https://<ref>.supabase.co/storage/v1/object/public/**`.

- **Logo, capa, foto de produto**: leitura pública, escrita só pelo dono
  (policy por `restaurant_id` no path).
- O `next.config.ts` libera **apenas** esse caminho em `images.remotePatterns` —
  domínio de terceiro não é aceito, o que evita o Next virar proxy de imagem
  para qualquer URL.
- Upload de tema passa por validação no cliente (`src/lib/theme-upload.ts`:
  tipo, dimensão, tamanho) **e** a policy do bucket. Validação de cliente é
  conveniência; a que vale é a do servidor.

---

## 5. Autenticação

Supabase Auth, e-mail + senha.

- Sessão em cookie `HttpOnly`, renovada pelo middleware em cada requisição.
- **Redirect URLs** precisam estar cadastradas no Supabase (Authentication →
  URL Configuration). Para cada ambiente:

  ```
  https://<domínio>/auth/callback
  http://localhost:3000/auth/callback
  https://*-<time>.vercel.app/auth/callback   (previews)
  ```

  Faltando a URL, o link de confirmação/recuperação abre numa página de erro do
  Supabase — e o sintoma parece "o e-mail não chegou".

- **Rate limiting**: `src/lib/rate-limit.ts` conta por IP em memória do
  processo. Ver a nota de limitação no topo do arquivo: é limite de rajada, não
  de cota. Para garantia, plugar Redis atrás da mesma interface.
- O primeiro administrador da plataforma é criado por
  `claim_first_platform_admin()` — só funciona para o usuário mais antigo e só
  se ainda não existir nenhum. Depois disso, papéis são geridos em `/admin`.

---

## 6. Deploy

Plataforma atual: **Vercel**, projeto `menuvo`, região `gru1` (São Paulo).

```
git push origin main  →  build automático  →  produção
git push (outra branch)  →  preview com URL própria
```

- Build: `npm run build` (Next 15, App Router).
- Nenhum comando de migration roda no build — **de propósito**. Um build que
  altera schema é um build que não pode ser revertido com segurança.
- Variáveis por ambiente: Settings → Environment Variables, com escopo
  `Production` / `Preview` / `Development` separado.

### Outra infraestrutura (VPS, Railway, Fly, Docker)

A aplicação é Node padrão, sem dependência exclusiva da Vercel:

```bash
npm ci
npm run build
NEXT_PUBLIC_SITE_URL=https://seu-dominio.com.br npm start   # porta 3000
```

Atrás de proxy, é preciso encaminhar `X-Forwarded-Proto` e `X-Forwarded-Host` —
o app depende deles para montar URL https e aceitar o host como confiável.

---

## 7. Domínio próprio

1. **Apontar DNS** — na Vercel: Settings → Domains → adicionar
   `cardapio.seudominio.com.br`, e criar o CNAME que o painel informar.
2. **`NEXT_PUBLIC_SITE_URL`** = `https://cardapio.seudominio.com.br`
   (com `https`, sem barra no final) no escopo Production.
3. **Redeploy** — a variável entra no build; sem redeploy, o `canonical` e o
   QR Code continuam com o valor anterior.
4. **HTTPS**: a Vercel emite o certificado automaticamente ao validar o DNS.
5. **`www`**: com o domínio configurado, o middleware redireciona
   `www.<domínio>` → `<domínio>` em 308. Isso vale só para o domínio próprio —
   nunca para `*.vercel.app`, senão um preview redirecionaria para fora.
6. **Supabase**: adicionar o domínio em Authentication → URL Configuration
   (Site URL e Redirect URLs), senão login por e-mail quebra.

### Checklist de domínio

- [ ] DNS aponta e o certificado foi emitido
- [ ] `NEXT_PUBLIC_SITE_URL` atualizado + redeploy
- [ ] `/r/<slug>` abre pelo domínio novo com HTTPS
- [ ] QR Code baixado do painel aponta para o domínio novo
- [ ] `https://<domínio>/robots.txt` e `/sitemap.xml` com o domínio novo
- [ ] Supabase Auth com o domínio nas Redirect URLs
- [ ] `www.` redireciona para o apex
- [ ] `http://` redireciona para `https://` (ou é bloqueado pelo proxy)

---

## 8. PWA

- Manifest: `src/app/manifest.webmanifest/route.ts` (gerado de `src/lib/pwa.ts`).
- Service worker: `src/sw-source.js` → servido em `/sw.js` com
  `Cache-Control: max-age=0, must-revalidate`.
- **Trocar domínio invalida a instalação**: o escopo do PWA é a origem. Quem
  instalou em `menuvo-theta.vercel.app` precisa instalar de novo no domínio
  próprio. Avisar antes de trocar.
- Ícones: `scripts/generate-icons.mjs` a partir de `public/icons/`. Rodar depois
  de mexer na marca.

---

## 9. Diagnóstico rápido

```bash
curl -s https://<domínio>/api/health | jq
```

Sem `HEALTH_CHECK_SECRET`, a resposta é mínima (`ok`, `env`). Com o segredo:

```bash
curl -s -H "Authorization: Bearer $HEALTH_CHECK_SECRET" https://<domínio>/api/health | jq
```

Resposta esperada em dia:

```json
{ "ok": true, "env": "production", "database": "up",
  "envVars": [{ "name": "NEXT_PUBLIC_SUPABASE_URL", "state": "set" }, ...] }
```

Se `database` for `"down"`, o campo `databaseError` classifica:

| valor | significa |
| --- | --- |
| `unconfigured` | falta URL ou chave anon |
| `auth_rejected` | URL/chave certas, mas o Supabase recusou (chave rotacionada?) |
| `rpc_missing` | banco acessível, migration não aplicada |
| `query_failed` | banco respondeu erro |
| `unreachable` | DNS/TLS/timeout — rede do processo até o Supabase |

O endpoint **nunca** devolve valor de variável, URL do banco ou mensagem crua do
Postgres: só estado.

---

## Verificação por harness (contagem de referência)

Cada `.arena-test/*.cjs` é independente e sai com código ≠ 0 na primeira falha.
Requer `npm ci` e, para os harnesses de UI/SSR, `npm install esbuild jsdom --no-save`.

| Harness | Asserts |
| --- | --- |
| `prod-lib` / `prod-ssr` | 120 / 10 |
| `pwa-lib` / `pwa-security` / `pwa-sw` / `pwa-ssr` / `pwa-ui` | 60 / 15 / 23 / 43 / 26 |
| `whatsapp-lib` / `whatsapp-ui` / `whatsapp-ssr` | 103 / 56 / 51 |
| `billing-lib` / `billing-ui` / `billing-ssr` | 79 / 56 / 41 |
| `analytics-lib` / `analytics-security` / `analytics-ui` | 64 / 95 / 48 |
| `admin-lib` / `admin-ui` / `admin-ssr` / `nav-fit` | 58 / 62 / 25 / 19 |
| `theme-lib` / `theme-ui` / `theme-ssr` / `theme-upload` | 59 / 51 / 18 / 15 |
| `kitchen-lib` / `kitchen-security` / `kitchen-ui` / `kitchen-ssr` | 89 / 70 / 59 / 33 |
| `print-lib` / `print-provider` / `print-security` / `print-ui` / `print-ssr` | 108 / 69 / 67 / 72 / 46 |
| `payments-lib` / `payments-security` / `payments-ui` / `payments-ssr` | 61 / 59 / 66 / 29 |

Total: **2.025 asserções** em 38 arquivos de harness, das quais **2.024 passam**.
As duas únicas exceções são anteriores à Etapa 19: `pwa-nav` não chega a
executar (falha de bundle) e `kitchen-ui` fica em 58/59 — ver a nota abaixo.

> **`pwa-nav` é um harness em manutenção (falha desde antes da Etapa 19).**
> Ele monta a `BottomNav` com `lucide-react` e o bundle recebe `undefined` em um
> dos ícones (`Element type is invalid ... Check the render method of BottomNav`).
> Confirmado por `git stash` na Etapa 19: falha igual sem nenhuma mudança desta
> etapa. A navegação do painel está coberta por `admin-ui` (62) e `pwa-ui` (26),
> então o item não bloqueia build nem deploy — mas o arquivo continua no
> repositório e deve ser corrigido na próxima etapa que mexer na barra inferior.
> **`kitchen-ui` tem 1 falha conhecida e dependente de horário:** o contador de
> tempo (`01:44` num pedido supostamente de 5 min) usa `Date.now()`, e o teste
> compara com um `created_at` fixo; fora de uma janela específica do dia ele
> passa. Também pré-existente à Etapa 19.

---

## Cobrança manual por PIX (Etapa 19) — verificação no banco

Migration `0019_payments.sql` aplicada em `fjrvjnhnvjkpowxzxiez` (registrada em
`supabase_migrations.schema_migrations` como `stage19_payments`). As asserções
abaixo rodaram em `begin … rollback`, com `set local role authenticated` e
`request.jwt.claims` trocado entre o dono da casa de teste e o **MASTER_ADMIN**
real (`87435001-c429-4b5c-951d-f646a4a3a057`).

> **Nota de método:** `set local role authenticated` é obrigatório. Sem ele a
> consulta roda como `postgres`, que **ignora RLS** — e um `update` que deveria
> ser negado passaria, dando falso negativo de segurança.

### Os 8 testes obrigatórios do escopo

| # | Teste | Resultado |
| --- | --- | --- |
| T1 | criar solicitação → `PENDING` | ✅ `PENDING` |
| T2 | restaurante tenta `CONFIRMED` | ✅ negado (`insufficient_privilege`, RLS + sem grant) |
| T3 | restaurante ativa a própria assinatura | ✅ negado (`admin_forbidden`) |
| T4 | usuário comum chama RPC admin | ✅ negado (`admin_forbidden`) |
| T5 | admin confirma → `CONFIRMED` + `ACTIVE` | ✅ `CONFIRMED` / `active` / 30 dias |
| T6 | admin rejeita → `REJECTED`, sem ativação | ✅ `REJECTED`, plano e status intactos |
| T7 | restaurante A vê pagamento de B | ✅ 0 linhas (RLS) e `forbidden` no painel de outra casa |
| T8 | preço adulterado no frontend | ✅ banco grava R$ 99,90 (mensal) e R$ 1.198,80 (anual) |

### Asserções complementares (rodada final: 15/15)

| # | Teste | Esperado → obtido |
| --- | --- | --- |
| 1 | solicitar cria `PENDING` | `PENDING` |
| 2 | valor vem do banco | `99.90` |
| 3 | confirmar | `CONFIRMED` |
| 4 | assinatura ativada | `active` |
| 5 | período mensal | `30` dias |
| 6 | auditoria | 1 linha `MANUAL_PAYMENT_CONFIRMED` |
| 7 | confirmar duas vezes | recusado (`payment_not_pending`) |
| 8 | idempotência do período | período não dobra |
| 9 | cliente confirma | negado |
| 10 | cliente altera status | negado |
| 11 | RPC admin para cliente | negada |
| 12 | rejeitar | `REJECTED` |
| 13 | motivo da rejeição | visível no detalhe |
| 14 | rejeição não troca plano | `profissional` |
| 15 | rejeição não muda status | `active` |

### Outras verificações do banco

- **Anual = 365 dias**: `admin_confirm_payment` devolveu `period_days = 365` e
  `days_left = 365` no painel do cliente.
- **Vinculo**: `payment_requests.subscription_id` preenchido na confirmação;
  `subscriptions.payment_request_id`, `payment_method = MANUAL_PIX`,
  `activated_by` e `activated_at` gravados.
- **MASTER_ADMIN**: dono de restaurante chamando `admin_save_payment_settings`
  recebe `master_admin_forbidden`; o período só é ajustável por `owner`.
- **Comprovante**: caminho fora de `{restaurant_id}/receipts/` é recusado
  (`invalid_receipt_path`); anexo não muda status.
- **PIX desligado**: `request_plan_payment` recusa com `pix_not_configured`.
- **Plano grátis**: recusa com `plan_is_free`.

### Observação sobre o `my_payment_panel`

A ordem do histórico passou a usar `created_at desc, id desc`. Dentro de **uma
mesma transação** `now()` é fixo, então duas solicitações criadas no mesmo bloco
empata no timestamp; o desempate por `id` torna o teste determinístico. Em uso
real cada RPC tem transação própria, e o `id` nunca decide a ordem.

---

## Migration 0020 — `change_plan` não vende mais plano

Aplicada em `fjrvjnhnvjkpowxzxiez` como
`20261122130000 stage19b_change_plan_requires_payment`. Fecha um caminho de
ativação sem pagamento que a Etapa 19 deixou aberto.

**O que estava errado:** `change_plan` (Etapa 11) inseria a assinatura já como
`active`. Um dono de casa, chamando o PostgREST direto, ativava `premium` com um
comando — sem PIX e sem passar pela tela nova.

**Regra agora:** só passa sem pagamento quem não está comprando nada.

| Chamada (dono da casa) | Resultado |
| --- | --- |
| migrar entre planos gratuitos | liberado |
| trocar mensal ↔ anual no mesmo plano | liberado |
| sair do grátis / subir para plano pago | `payment_required` (22023) |
| entrar em plano pago sem assinatura | `payment_required` (22023) |
| as mesmas chamadas como admin da plataforma | liberado, auditado `by_admin=true` |

### Asserções rodadas (9/9 no banco real)

| # | Teste | Esperado → obtido |
| --- | --- | --- |
| 0 | trigger de trial cria a assinatura da casa nova | `1` |
| 1 | dono tenta `change_plan('…','premium')` | `payment_required` |
| 2 | nenhuma assinatura premium criada | `0` |
| 3 | espelho `restaurants.plan_id` continua `basico` | `basico` |
| 4 | troca de intervalo no mesmo plano | `yearly` |
| 5 | upgrade pago (`profissional`) segue bloqueado | `payment_required` |
| 6 | plano inexistente segue recusado | `invalid_plan` |
| 7 | master ajusta plano pago em suporte | `premium` |
| 8 | auditoria separa dono de master | `by_admin=false` × `by_admin=true` (2 eventos) |

> A asserção 8 falhou na primeira rodada como `false`: eu lia "o último evento"
> com `order by created_at desc`, e as duas chamadas estavam na mesma transação —
> `now()` é fixo, então o desempate é o `id`. Contando por ocorrência
> (`by_admin=false` → 1, `by_admin=true` → 1, total → 2) fecha. É o mesmo cuidado
> que a `0019` tomou no `my_payment_panel`.

### Cobertura em código

`billing-lib` passou de 72 para **79 asserções**: leem `0020` e verificam que a
recusa existe, que a troca de intervalo continua livre, que o anti-downgrade e a
autorização não foram perdidos, que o master mantém o ajuste com `by_admin` no
log, e que o texto do erro chega em português à tela.
