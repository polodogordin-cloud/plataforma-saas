# Segurança — Etapa 20

Registro do que foi verificado, do que foi corrigido e do que **continua em
aberto**. Este arquivo é o complemento de `docs/OPERACAO.md` (backup e
monitoramento) e `docs/AMBIENTES.md` (variáveis, harnesses e verificação SQL).

> Regra de leitura: nesta etapa, "fechado" sempre tem **evidência** (consulta no
> banco, harness com contagem, arquivo com caminho). Itens sem evidência estão
> na seção 7 como pendência, não como concluído.

---

## 1. Multi-tenant (item 1)

**Modelo.** O isolamento é por `restaurant_id` e vive no Postgres, não na
aplicação:

- `has_restaurant_role(restaurant_id, roles[])` e `is_restaurant_member(restaurant_id)`
  são `SECURITY DEFINER` com `search_path` fixo;
- toda tabela de dados de cliente tem RLS com `using (is_restaurant_member(restaurant_id))`;
- o app nunca decide o tenant a partir da URL: vem de `getActiveRestaurant()`,
  que resolve pela sessão (`restaurant_users` do `auth.uid()`).

**O que a Etapa 20 corrigiu.** As funções de plano eram `language sql` com
`case`. O planejador pode avaliar o ramo negado **antes** do `case` — e a junção
com `restaurants` levantava `permission denied` para quem não era membro, o que
era um erro com cara de bug e, pior, um sinal de existência. Reescritas em
`plpgsql` com `if`, a guarda roda antes de qualquer acesso a tabela.

**Evidência (banco de produção, `fjrvjnhnvjkpowxzxiez`).**

| Teste | Resultado |
| --- | --- |
| restaurante A lê produtos de B | 0 linhas |
| dono lê o próprio pedido | 1 linha |
| `has_function_privilege('authenticated','restaurant_plan(uuid)')` | `false` |
| `has_function_privilege('authenticated','check_plan_limit(text,integer)')` | `true` (a própria casa) |
| `my_subscription()` do dono | `basico` |

Harness estático correspondente: `.arena-test/tenant-audit.cjs` (29 asserções).

---

## 2. RBAC (item 2)

Papéis em `restaurant_users.role`: `owner`, `manager`, `kitchen`, `waiter`
(operacionais) e, na plataforma, `platform_admins` com `master_admin` / `admin`.

- Quem responde "esta pessoa pode?" é o banco. `src/lib/types.ts` só dá nome ao
  vocabulário; a camada de dados consulta os helpers (`tenant-audit.cjs` vigia
  que ninguém reimplemente a regra em TypeScript).
- O uso de `role === "kitchen"` em layout/badge é **apresentação** (qual aba
  mostrar, cor do badge) e não autoriza dado.
- A área `/admin` exige `isPlatformAdmin()` no layout; a tela de diagnóstico
  exige `isPlatformOwner()` para o bloco operacional.

---

## 3. Autenticação (item 3)

- Login, cadastro, recuperação e logout em `src/actions/auth.ts`, todos com
  balde de rate limit próprio.
- Sessão via `@supabase/ssr`; `src/lib/supabase/middleware.ts` renova o cookie em
  toda navegação e o middleware exige sessão nas rotas privadas.
- **Corrigido nesta etapa:** a origem dos links de e-mail (confirmação de
  cadastro e redefinição de senha) usava o header `Origin` como fonte. Header é
  entrada do cliente — numa action pública de cadastro isso permitia escolher
  para qual domínio o link apontaria. Agora a ordem é: `NEXT_PUBLIC_SITE_URL` →
  host validado por `resolveSiteOrigin()` (allowlist de hosts) → `null`, e nesse
  caso o Supabase usa o `site_url` do projeto.
- `/auth/callback` aceita apenas caminho interno em `next` (`safeRedirectPath`),
  bloqueando `//host`, `/\host` e `esquema:`.
- Recuperação de senha responde de forma neutra (não revela se o e-mail existe).

---

## 4. API e entradas (itens 4 e 5)

- **Validação:** toda Server Action que grava importa um schema Zod de
  `src/lib/validation.ts` (verificado por `tenant-audit.cjs`). O schema é a
  primeira instrução; o banco valida de novo (constraint + RPC).
- **Rate limit:** `src/lib/rate-limit.ts`, baldes por IP e por regra
  (`signIn` < `publicMenu`). Aplicado nas actions e no middleware para rotas de
  API equivalentes.
- **XSS:** único ponto de HTML cru é o JSON-LD do cardápio, agora serializado
  por `jsonForScript()`. Todo o resto passa por JSX (escape automático).
  CSP com `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` e
  nonce nas rotas dinâmicas.
- **CSRF:** as mutações são Server Actions do Next, protegidas por
  `Origin`/`Host` no framework. As rotas GET (`/auth/callback`, QR, health) não
  mutam estado. Não há `Route Handler` de escrita aberto.
- **SQL injection:** não há SQL concatenado; tudo passa pelo cliente Supabase
  (PostgREST) ou por RPC com parâmetros tipados.
- **Manipulação de IDs:** IDs da URL nunca autorizam — a consulta filtra por
  tenant do servidor e a RLS barra o resto. Pedido de outra casa é 404, não 403
  (não revela existência).
- **Erros:** nenhuma action devolve `error.message` do driver para a tela
  (decisão tomada por `.includes()` sobre a mensagem, com frase fixa em
  português). `tenant-audit.cjs` vigia o padrão.

---

## 5. Uploads (item 6)

`src/lib/theme-upload.ts` é o único caminho de upload de imagem:

1. **tipo** — `ACCEPTED_MIME` + `sniffImageType()` (magic bytes, não o `accept`
   do input nem o `File.type`);
2. **tamanho** — `MAX_UPLOAD_BYTES` (8 MB) antes de decodificar;
3. **nome** — gerado internamente a partir de `kind` + `version`; o nome do
   arquivo do usuário nunca entra no caminho do bucket;
4. **otimização** — redimensionamento e reencode (WebP quando suportado) antes
   de subir: logo 320 px, capa 1600×900;
5. **acesso** — bucket privado com policy por tenant; a RPC só aceita caminho
   do próprio restaurante.

Comprovante de PIX segue as mesmas regras e o bucket é privado (dado
financeiro).

---

## 6. Auditoria (item 7)

Tabela `admin_audit_log` (equivalente ao `AUDIT_LOGS` do escopo), com
`actor_id`, `restaurant_id`, `action`, `entity`, `entity_id`, `metadata`,
`created_at`.

**Endurecida nesta etapa (migration `0021_security_hardening.sql`):**

- `log_admin_action` teve `EXECUTE` revogado de `authenticated` — antes, um
  usuário logado podia **forjar** evento de auditoria em nome de outro ator;
- `admin_audit_log` é **append-only**: `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`
  revogados de `public`, `anon` e `authenticated`, mais trigger
  `admin_audit_log_no_update` que recusa `UPDATE` e `DELETE`;
- retenção declarada por GUC `menuvo.audit_retention = 'on'`;
- registro `('20261122140000','stage20_security_hardening')` em
  `schema_migrations`.

**Nunca registrado:** senha, hash de senha, token de sessão, chave de API,
cabeçalho `Authorization`, cookie, segredo de webhook. O harness
`tenant-audit.cjs` verifica que nenhuma chave do payload de auditoria é um
desses campos.

**Evidência (banco).** Quatro ataques negados (`forjar auditoria`,
`insert direto`, `update`, `delete`); auditoria limpa = 0 eventos forjados.

---

## 7. Backups e monitoramento (itens 8 e 9)

Documentados em **`docs/OPERACAO.md`**, incluindo a afirmação explícita de que
**não existe backup automático configurado** e que nenhum ensaio de restauração
foi executado ainda.

`GET /api/health` publica `{ ok, state, env, version, revision, checkedAt }`,
`200`/`503`, `no-store`; o detalhe por peça exige
`Authorization: Bearer $HEALTH_CHECK_SECRET` (comparação em tempo constante). A
mesma informação aparece em `/admin/diagnostico` (Área técnica).

Pendências honestas: monitor externo de uptime **não configurado**; realtime
fica `unknown` e webhooks `disabled` por decisão (não são medidos, e a tela diz
isso).

---

## 8. Tratamento de erros (item 10)

| Estado | Onde | Observação |
| --- | --- | --- |
| 404 | `src/app/not-found.tsx` | global |
| 404 cardápio | `src/app/r/[slug]/not-found.tsx` | |
| mesa inválida | `r/[slug]/table/[token]/not-found.tsx` | mesma tela para token inválido, mesa desativada e casa fechada |
| pedido inválido | `app/pedidos/[id]/imprimir` → `notFound()` | pedido de outra casa também é 404 |
| 403 | `src/app/sem-acesso/page.tsx` | explica permissão, não nega a existência da área |
| 403 no painel | `/app?aviso=sem-acesso-admin` | mensagem adicionada nesta etapa (antes o aviso não existia na lista) |
| 500 | `error.tsx` por segmento + `global-error.tsx` | |
| restaurante suspenso | `MenuUnavailable reason="suspended"` | |
| cardápio não publicado | `reason="unpublished"` | |
| pedido não encontrado (cliente) | `reason="order"` | adicionado nesta etapa |

Nenhuma tela renderiza `error.stack`, `error.message` ou `JSON.stringify(error)`.
O usuário vê um `digest`; a stack vai para o log. Verificado por
`.arena-test/error-states.cjs` (65 asserções).

---

## 9. Privacidade (item 12)

- Dados públicos (nome do restaurante, cardápio, preço) servidos pelo cardápio
  público; dados privados (pedidos, telefone) só para membros do tenant;
  administrativos (auditoria, assinatura) só para plataforma; financeiros
  (chave PIX, comprovante) em bucket privado e tabela fora do cardápio.
- `tenant-audit.cjs` garante que a área pública (`src/app/r/`,
  `src/components/public/`) não importa nem consulta tabela financeira.
- Nenhuma chave `service_role` no projeto: o app usa a chave anon + sessão, e
  toda elevação passa por RPC/RPC `SECURITY DEFINER` com guarda.

---

## 10. Pendências desta etapa (não fechar como concluído)

1. **Monitor externo de uptime** — endpoint pronto, monitor não criado.
2. **Backup automático** — não configurado; só o procedimento documentado.
3. **Ensaio de restauração** — nunca executado; RTO/RPO são estimativa.
4. **`pwa-nav`** — harness quebrado desde antes da Etapa 19 (falha de bundle),
   mantido no repositório.
5. **`kitchen-ui`** — uma asserção depende de `Date.now()`; passa fora de uma
   janela estreita do dia.
