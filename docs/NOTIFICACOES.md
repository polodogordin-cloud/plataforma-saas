# Central de notificações

Etapa 26. **Adiciona** um sino no painel. Nada do que veio antes mudou de
contrato: pedido, mesa, cozinha, pagamento, plano e cupom continuam funcionando
exatamente como antes — e continuam funcionando **com o sino desligado**.

O princípio que organiza tudo aqui é um só:

> **A notificação é registro de um fato, não uma mensagem que a tela escolhe enviar.**

Nenhum caminho do aplicativo cria notificação. Quem cria é o banco, dentro do
mesmo `trigger` que grava o pedido, a chamada de garçom ou o pagamento. Se o app
pudesse emitir, a autorização viveria no cliente — e um usuário poderia avisar
outro com texto arbitrário, dentro do próprio painel.

---

## O que o dono ganha

| Tela | Endereço | O que resolve |
| --- | --- | --- |
| Sino | cabeçalho de toda tela de `/app` e `/admin` | O que aconteceu, em ordem, com contador de não lidas |
| Preferências | `/app/notificacoes` | O que eu quero saber |

Chega-se às preferências por **Configurações → Avisos → Notificações** e pelo
rodapé do próprio painel do sino. O menu inferior continua com **seis abas** — o
sino não é uma sétima tela principal, é presença permanente no cabeçalho.

### O sino

```
┌──────────────────────────────────────────┐
│  Notificações              Famintos · …  │
│  3 não lidas        Atualizar  Marcar…   │
├──────────────────────────────────────────┤
│ 🧾  Novo pedido #1007              Há 3 min │
│     2 itens · R$ 28,00 · Mesa 01 · pix   │
├──────────────────────────────────────────┤
│ 🔔  Garçom chamado                Há 12 min │
│     Mesa 04 está chamando o garçom        │
├──────────────────────────────────────────┤
│ 🧾  Pagamento recebido              Há 1 h │
│     R$ 28,00 em pix                       │
├──────────────────────────────────────────┤
│ ⚙  O que eu quero receber                │
└──────────────────────────────────────────┘
```

Cada item leva ao lugar onde a pessoa **age**:

| Entidade | Destino no painel | Destino no master |
| --- | --- | --- |
| `order` | `/app/pedidos?pedido=<id>` (abre o detalhe) | — |
| `table_request` | `/app/pedidos?aba=salao` (rola até o salão) | — |
| `payment` | `/app/plano` | `/admin/pagamentos` |
| `subscription` | `/app/plano` | `/admin/pagamentos` |
| `customer` | `/app/clientes/<id>` | — |
| `coupon` | `/app/marketing/cupons` | — |
| qualquer (global) | — | `/admin/pagamentos` |

Item sem destino conhecido não vira link: um toque que termina em 404 ensina que
o sistema está quebrado.

### O contador

O número nasce **certo**: o layout de `/app` e o de `/admin` leem a contagem no
servidor e entregam ao componente. Sem isso, o sino apareceria apagado em toda
navegação e só acenderia depois de abrir — o oposto do que ele serve.

Depois disso, o número segue três fontes, nesta ordem:

1. **evento de tempo real** (`INSERT`/`UPDATE` em `notifications`);
2. **toque em marcar** — otimista, com uma linha só de estado para lista e
   contador, então uma reentrega do evento não infla nem desconta duas vezes;
3. **releitura** ao abrir o painel e ao reconectar o canal.

Não há polling. Sem evento, zero consultas.

Acima de nove o círculo mostra `9+` (o sino tem 18px), mas o rótulo acessível
continua dizendo o número real: *"Notificações, 12 não lidas"*.

---

## Os tipos e quem recebe

Doze tipos, todos no enum `notification_type`:

| Grupo | Tipo | Quem recebe |
| --- | --- | --- |
| Pedidos | `order_created` | cozinha, garçom, balcão |
| | `order_cancelled` | cozinha, balcão |
| | `order_ready` | cozinha, garçom, balcão |
| | `order_delivered` | balcão |
| Salão | `table_waiter_called` | garçom, balcão |
| | `table_bill_requested` | garçom, balcão |
| Pagamentos | `payment_received` | balcão |
| | `payment_failed` | balcão |
| Assinatura | `subscription_expiring` | dono, admin, gerente |
| | `subscription_expired` | dono, admin, gerente |
| Clientes | `customer_created` | balcão |
| Marketing | `coupon_expiring` | balcão |

"Balcão" é `owner`, `admin`, `staff`, `manager` — quem responde pela casa. A
cozinha recebe **só** o que é de cozinha e o garçom **só** o salão e o "pronto":
pedido novo e pagamento são do balcão, e encher o celular de quem serve mesa com
aviso de caixa é o caminho mais curto para ele desligar tudo.

Membro inativo não recebe nada.

**Quem causou recebe a linha já lida.** O dono que registrou a chamada de mesa
pelo painel vê o registro, mas o sino não acende por algo que ele mesmo fez.
Excluir o autor seria pior: numa casa de um único usuário, ele não veria nada do
que aconteceu.

---

## Preferências

`/app/notificacoes`, um interruptor por tipo, agrupado por assunto.

1. **Nasce tudo ligado.** O banco guarda o que está *desligado*; ausência de
   preferência = recebe. Tipo novo no enum aparece ligado sem deploy.
2. **Salvar explícito.** Trocar cinco interruptores em 3G não dispara cinco
   escritas: a pessoa toca, confere e salva uma vez.
3. **A preferência filtra na emissão**, não na leitura. Se o dono desligou
   "novo pedido", a linha não é criada — não existe uma notificação escondida
   esperando ele mudar de ideia.

### Desligar o sino não desliga o restaurante

Esta é a parte que importa, e a tela diz isso em palavras:

> Desligar um aviso não muda o funcionamento do restaurante: o pedido continua
> entrando, a chamada continua chegando. Só o sino fica quieto.

Nenhum gatilho consulta preferência antes de gravar o fato; a preferência só
decide se haverá **linha no sino**.

---

## O que ainda não existe

Canais externos — push, e-mail, WhatsApp, SMS — aparecem na tela de preferências
marcados como **planejados**, com o aviso de que ainda não existem. Não há
integração de envio, fila, cron nem coluna de status de entrega no banco. Quando
existirem, serão canal de leitura do mesmo registro — nunca uma segunda fonte de
verdade.

A revisão do dia (assinatura vencendo/vencida, cupom expirando) **não é cron**: é
chamada quando o dono abre o painel, e o próprio banco impede duplicidade por
dia. Inventar um worker que ninguém mantém faria o aviso depender de uma peça de
infraestrutura que pode estar parada justamente no dia do vencimento.

---

## Segurança

| Porta | Como está fechada |
| --- | --- |
| Emitir notificação pela tela | `notify_restaurant_staff` tem `revoke` de `public, anon, authenticated`; nenhuma action chama criação |
| Ler a caixa de outro | RPC filtra por `auth.uid()`; RLS repete a regra; notificação global só por `is_platform_admin()` |
| Marcar a de outro | `mark_notification_read(uuid)` exige id e confere o dono no `where`; id invisível não encontra linha |
| Limpar o sino com id forjado | função separada `mark_all_notifications_read()`, sem parâmetro — o `p_id` opcional foi a armadilha original |
| Escrever na tabela | `authenticated` só tem `select` e `update (read_at)`; sem policy de `insert`/`delete` |
| Preferência como autorização | preferência nunca bloqueia o fato; `save_notification_preferences` exige vínculo com a casa |
| Vazamento entre casas | `restaurant_id` sempre do servidor; RLS por `is_restaurant_member` |

O canal de tempo real é filtrado por `user_id` no cliente — não como segurança,
mas para o evento de outra pessoa não chegar nem a ser entregue.

---

## Correção que veio junto

Esta etapa encontrou e corrigiu um bug **da Etapa 25**, que não tinha nada a ver
com o sino:

> Todo pedido **sem cupom** estava sendo recusado com
> `55000 record "v_coupon" is not assigned yet`.

`create_order` usava `case when v_discount > 0 then v_coupon.x end` no `update`;
o Postgres avalia as duas pernas do `case` e o `record` não atribuído derrubava a
transação. A correção guarda o cupom em variáveis escalares (`v_coupon_id`,
`v_coupon_code`, `v_coupon_type`, `v_coupon_value`) antes do `update`.
`create_order` foi reintroduzida **inteira** na migration 0027, e o harness de
segurança trava a regressão: nenhum `case` lendo `v_coupon` pode voltar.

---

## Banco de dados

`supabase/migrations/0027_notifications.sql` — espelho do que está aplicado.

| Objeto | Papel |
| --- | --- |
| `notifications` | uma linha por destinatário; `read_at` nulo = não lida |
| `notification_preferences` | tipos **desligados** por usuário e casa |
| `list_notifications(limit, offset, unread_only)` | lista + `unread_count` na mesma chamada |
| `unread_notification_count()` | só o número, para o layout |
| `mark_notification_read(uuid)` | marca uma; nulo é erro `22023` |
| `mark_all_notifications_read()` | marca todas as minhas, menos as globais |
| `my_notification_preferences(uuid)` | desligados + catálogo rotulado |
| `save_notification_preferences(uuid, text[])` | grava; tipo desconhecido é `22023` |
| `run_notification_review(uuid)` | assinatura e cupom, uma vez por dia |
| `notify_restaurant_staff(...)` | única porta de emissão (interna) |
| `notify_platform_admins(...)` | aviso global |
| `refresh_global_notification(...)` | atualiza um aviso global existente |

Lista e contador saem **da mesma chamada** de propósito: duas consultas abrem
uma janela em que chega notificação entre uma e outra, e o contador passa a
mentir.

Publicação `supabase_realtime` com `replica identity full`: o payload traz a
linha inteira, e o sino não precisa consultar nada para atualizar o contador.

---

## Testes

| Harness | Checks | O que cobre |
| --- | --- | --- |
| `.arena-test/notification-lib.cjs` | 117 | paridade com o enum, rotas de destino, tempo relativo, contador, normalização, agrupamento, canais |
| `.arena-test/notification-security.cjs` | 120 | emissão só pelo banco, caixa de cada um, id forjado, preferência como filtro, `service_role`, regressão do pedido sem cupom, escopo por papel, tempo real sem polling, integração |
| `.arena-test/notification-ui.cjs` | 91 | jsdom com os componentes reais: contador do servidor, lista, marcar uma/todas, falha ao marcar, chegada e reentrega de evento, reconexão, modo offline, vazio, `9+`, slot sem provider, preferências |

Rodar:

```bash
npm install --no-save esbuild jsdom
./node_modules/.bin/tsc --noEmit
for f in .arena-test/*.cjs; do node "$f"; done
```
