# Operação: backup, restauração e monitoramento

> **Estado real em 2026-11-22, sem enfeite:** **não existe backup automático
> configurado neste projeto.** O Supabase mantém os backups do plano contratado
> na própria infraestrutura dele, e a Vercel mantém o histórico de deployments —
> mas nada disso foi verificado, agendado ou testado por nós, e este documento
> **não** afirma que existe. O que está escrito abaixo é o procedimento para
> criar, verificar e restaurar backup; a parte "isto está pronto" só vale depois
> de alguém executar e registrar a evidência no fim do arquivo.

Este documento cobre os itens 8 (backup) e 9 (monitoramento) da Etapa 20.

---

## 1. O que precisa de backup, e por quê

O sistema tem **duas fontes de verdade** e um monte de coisa derivada. Só o que
não pode ser reconstruído precisa de backup.

| O quê | Onde vive | Precisa de backup? | Como reconstruir sem backup |
| --- | --- | --- | --- |
| Cardápios, pedidos, mesas, usuários | Postgres (Supabase) | **Sim — crítico** | Impossível. É o negócio do cliente. |
| Configurações de tema/identidade visual | Postgres + linhas no bucket | **Sim** | Refeito à mão, um cliente por vez |
| Imagens enviadas (logos, produtos, comprovantes) | Supabase Storage | **Sim** | Perdida para sempre se o bucket cair |
| Código da aplicação | Git (`polodogordin-cloud/plataforma-saas`) | Já está no GitHub | `git clone` |
| Variáveis de ambiente | Vercel (projeto `menuvo`) | **Sim — fora do banco** | Recriadas à mão conferindo `src/lib/env.ts` |
| Migrations | `supabase/migrations/*.sql` no repo | Já está no Git | Aplicar em ordem |
| `schema_migrations` | Postgres | Não (derivado) | Reaplicar as migrations |
| Sessões/auth | Supabase Auth | Não | Usuário faz login de novo |
| Logs de auditoria | Postgres (`admin_audit_log`) | **Sim** | Impossível, por definição |

Três consequências que costumam ser esquecidas:

1. **Backup do banco sem backup do Storage é backup pela metade.** O banco guarda
   o *caminho* da imagem, não a imagem. Restaurar o banco e não o bucket dá um
   cardápio com imagens quebradas e comprovantes de PIX que ninguém consegue
   abrir.
2. **Backup do banco sem as variáveis de ambiente não sobe.** A aplicação
   precisa delas para conectar. Guarde-as em cofre de senhas (nunca no
   repositório, nunca em issue, nunca em chat).
3. **A auditoria é append-only** (`admin_audit_log` tem trigger que recusa
   `UPDATE`; `DELETE` é revogado). Um `pg_dump` normal restaura os dados, mas se
   alguém restaurar com `--data-only` por cima de uma base viva, o trigger não
   protege contra *sobrescrever* a tabela — restaure sempre em base vazia.

---

## 2. Estratégia de backup (o que fazer)

### 2.1 Banco — dump lógico periódico

`pg_dump` é o caminho porque a restauração é verificável e não depende do painel
do provedor. Rodar de um ambiente com as credenciais de leitura (nunca do
navegador, nunca de um endpoint da aplicação):

```bash
# Uma vez por dia. Formato custom (comprimido, permite --list e restauração
# seletiva por tabela).
pg_dump "$SUPABASE_DB_URL" \
  --format=custom \
  --no-owner --no-privileges \
  --file="menuvo-$(date -u +%Y%m%dT%H%M%SZ).dump"

# Conferir que o arquivo é um dump válido e ver o que tem dentro.
pg_restore --list menuvo-*.dump | head -30
```

- `--no-owner --no-privileges`: os papéis do Supabase (`anon`,
  `authenticated`, `service_role`, `postgres`) não podem ser recriados por quem
  não é superusuário; sem essas flags a restauração para no primeiro `GRANT`.
  As permissões voltam a ser aplicadas pelas *migrations*, que são versionadas.
- **Retenção sugerida:** 7 dumps diários + 4 semanais + 12 mensais. Diário
  cobre o erro humano (apagou o cardápio errado); mensal cobre o "descobrimos em
  março que algo sumiu em janeiro".
- **Onde guardar:** fora do provedor do banco (outro provedor de objeto com
  versionamento e trava de exclusão). Backup no mesmo provedor do dado não
  protege contra perda de conta.
- **Cifrar:** o dump contém dados pessoais de clientes (nome, telefone em
  pedidos) e hashes de senha. `age`/`gpg` com chave fora do servidor.

### 2.2 Storage — espelhar o bucket

```bash
# Cópia incremental dos objetos (logos, produtos, comprovantes).
aws s3 sync "s3://$BUCKET_ORIGEM" "s3://$BUCKET_BACKUP" --endpoint-url "$SUPABASE_S3_ENDPOINT"
```

Bucket de comprovante de PIX é dado financeiro: acesso restrito, retenção pelo
mesmo prazo da obrigação contábil, e **nunca** público.

### 2.3 Configurações

- Lista de variáveis de ambiente: exportar do painel da Vercel para o cofre de
  senhas a cada mudança (nome, valor, ambiente). O código já reporta nomes
  ausentes em `/admin/diagnostico` → "Ambiente e variáveis", então dá para
  conferir sem abrir o painel.
- Domínios, DNS e certificados: registrar em documento de operação.

### 2.4 Frequência e janela

| Dado | Frequência | Janela aceitável de perda |
| --- | --- | --- |
| Banco completo | diária | 24 h |
| Storage | diária (incremental) | 24 h |
| Variáveis/config | a cada alteração | 0 (é manual e raro) |

Se um dia houver cliente pagante com volume alto, a janela de 24 h deixa de ser
aceitável e o caminho é PITR (point-in-time recovery) do provedor — que é
recurso de plano pago e exige verificação, não suposição.

---

## 3. Restauração — procedimento testado em ordem

Restaurar não é "rodar o comando". É uma sequência em que cada passo falha
rápido se o anterior estiver errado.

### 3.1 Restaurar em base nova (o caminho normal)

```bash
# 1. Criar um projeto/base VAZIA. Nunca restaurar por cima da produção.
# 2. Aplicar as migrations na ordem — o schema vem do código, não do dump.
for f in supabase/migrations/*.sql; do
  psql "$NOVA_DB_URL" -v ON_ERROR_STOP=1 -f "$f"
done

# 3. Restaurar os dados (só dados: o schema já veio do passo 2).
pg_restore --data-only --no-owner --no-privileges \
  --dbname "$NOVA_DB_URL" menuvo-XXXX.dump

# 4. Conferir contagens contra o backup (o dump sabe o que deveria haver).
pg_restore --list menuvo-XXXX.dump | wc -l
psql "$NOVA_DB_URL" -c "select count(*) from orders;"
psql "$NOVA_DB_URL" -c "select count(*) from products;"
```

Por que migrations primeiro: um dump `--data-only` sobre schema vazio falha;
sobre schema antigo, insere em colunas que não existem mais. O schema é código
versionado — o dump só precisa trazer as linhas.

### 3.2 Restaurar o Storage

```bash
aws s3 sync "s3://$BUCKET_BACKUP" "s3://$BUCKET_NOVO" --endpoint-url "$SUPABASE_S3_ENDPOINT"
```

Depois: conferir que as *policies* do bucket foram aplicadas pelas migrations
(bucket privado, dono lê o que é seu) e que um comprovante aberto pelo dono
certo funciona.

### 3.3 Apontar a aplicação

1. Trocar `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` no
   ambiente da Vercel;
2. Redeploy (variável `NEXT_PUBLIC_*` é embutida no bundle, **exige** rebuild —
   não basta reiniciar);
3. Abrir `/admin/diagnostico` e conferir banco/auth/storage em `up`;
4. Abrir `/api/health` e confirmar `200`.

### 3.4 Verificação pós-restauração (checklist mínimo)

- [ ] `create_order` anônimo funciona numa mesa publicada
- [ ] dono vê os pedidos da própria casa (RLS não ficou aberta)
- [ ] um restaurante **não** vê produto de outro
- [ ] `admin_audit_log` tem o histórico esperado e recusa `UPDATE`
- [ ] `has_function_privilege('authenticated','public.next_order_number(uuid)',…)` = `false`
- [ ] imagens do cardápio público carregam

### 3.5 Tempo de recuperação

Não prometa RTO/RPO medidos: **nenhum teste de restauração completa foi
executado ainda**. A meta razoável para o porte atual é RPO ≤ 24 h e RTO ≤ 2 h,
mas isso é previsão, não resultado. Registre o tempo real quando rodar o
primeiro ensaio.

---

## 4. Monitoramento

### 4.1 Health check — o que existe hoje

`GET /api/health`:

- `200` quando banco, autenticação e ambiente estão de pé;
- `503` quando alguma peça **essencial** cai;
- corpo público: `{ ok, state, env, version, revision, checkedAt }` — **sem**
  qual peça falhou (não dá mapa de infraestrutura a quem descobre a URL);
- com `Authorization: Bearer $HEALTH_CHECK_SECRET`, devolve o relatório
  completo por peça (comparação em tempo constante);
- fora de produção, devolve o detalhe sem segredo (para desenvolvimento);
- `Cache-Control: no-store`, `force-dynamic` — nunca serve resposta velha.

O mesmo relatório aparece na tela `/admin/diagnostico` (Área técnica), restrita a
`isPlatformOwner`.

**O que o health NÃO mede, e é honesto sobre isso:** realtime
(`unknown` — exigiria abrir canal e receber evento) e webhooks (`disabled` — a
cobrança é manual por PIX, não existe provedor com entrega assíncrona).

### 4.2 Uptime externo (a fazer)

O health check é a peça, mas o monitor não é. Para ter alerta de indisponibilidade
é preciso um serviço externo batendo no endpoint:

1. criar monitor HTTP em `/api/health` a cada 1–5 min;
2. alerta quando `status != 200` por 2 verificações seguidas (evita alarme por
   cold start da Vercel);
3. alerta separado para "restaurante sem pedido há X horas" — indisponibilidade
   silenciosa (banco de pé, ninguém consegue pedir) não aparece no health.

**Status: não configurado.** Hoje quem descobre uma queda é o cliente ligando.

### 4.3 Logs

| Fonte | Onde | Retenção |
| --- | --- | --- |
| Função serverless (erro, digest, tempo) | Vercel → Logs | plano da Vercel |
| Erros de borda do app | `console.error` com `digest` | idem |
| Ações administrativas | `admin_audit_log` (banco) | definida por `menuvo.audit_retention` |

O `error.tsx` de cada segmento registra `digest` + mensagem no servidor e mostra
**só o digest** ao usuário. É por esse código que se acha a stack no log — o
usuário nunca vê stack.

### 4.4 O que observar

- **Falhas de API**: 5xx em `/api/health` e nas server actions (aparecem no log
  da Vercel).
- **Falhas de pagamento**: hoje são humanos (PIX conferido à mão). O sinal é
  `plan_payments` parado em `pending` além do razoável.
- **Falhas de webhook**: não aplicável — não há webhook.
- **Disponibilidade**: health externo (item 4.2).

---

## 5. Registro de ensaios

Preencha **somente depois de executar**. Sem linha aqui, não existe backup
verificado.

| Data | O que foi testado | Resultado | Tempo | Quem |
| --- | --- | --- | --- | --- |
| — | — | *nenhum ensaio executado* | — | — |
