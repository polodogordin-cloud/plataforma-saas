# Fidelidade e clientes

Etapa 24. Substitui nada: **adiciona** uma camada de relacionamento sobre os
pedidos que já existiam. O cardápio, a cozinha, o salão e o painel continuam
funcionando exatamente como antes — inclusive sem ninguém se identificar.

---

## O que o dono ganha

| Tela | Endereço | O que resolve |
| --- | --- | --- |
| Clientes | `/app/clientes` | Quem voltou, quanto gastou, quando foi a última vez e quantos pontos tem |
| Ficha do cliente | `/app/clientes/[id]` | Histórico, extrato de pontos, ajuste manual, bônus e exclusão |
| Fidelidade | `/app/clientes/fidelidade` | Regra do programa: pontos por real, bônus, valor do resgate, mensagem |

Todas abrem pelo celular, e todas começam no painel (`/app` → **Clientes e
fidelidade**).

## O que o cliente ganha

No cardápio público (`/r/[slug]/table/[token]`), dois pontos de contato:

1. **Ao pedir** — um bloco opcional "Quero acumular pontos" no carrinho, com
   nome e WhatsApp. Fechado por padrão; quem não abrir pede anonimamente.
2. **Ao consultar** — o botão "Consultar meus pontos", no fim do cardápio, abre
   um campo de WhatsApp e devolve **nome, saldo e a regra do programa**.

Não existe app, senha, e-mail de confirmação nem cadastro prévio. Também não
existe envio de mensagem: nem confirmação, nem aviso, nem promoção. O que o
cliente vê é o que ele pediu para ver.

---

## As regras que valem dinheiro

### Acúmulo

```
pontos = floor(total_do_pedido × pontos_por_real)
```

Piso, nunca arredondamento para cima — arredondar para cima em cada pedido
pequeno infla o passivo da casa sem que ninguém perceba.

- Só **pedido entregue** credita. `pending`, `confirmed`, `preparing` e `ready`
  não valem ponto; `cancelled` também não.
- Um pedido credita **uma vez só**. Garantido por índice único
  (`loyalty_ledger_order_earn_unique`) **e** por checagem na função: se o
  pedido for marcado como entregue duas vezes (o painel reenvia, a rede
  repete), o segundo crédito é ignorado.
- Programa desligado não credita. O saldo já acumulado **não** é apagado.

### Saldo

`saldo = sum(delta)` do extrato. Não existe coluna `points_balance` em
`customers` de propósito: duas fontes para o mesmo número divergem no primeiro
bug, e a divergência aparece como "o cliente jura que tinha 80 pontos".

### Resgate

`redeem_value` é quanto vale 1 ponto em reais. O padrão é **0 = desligado**:
o saldo acumula, o cardápio mostra quanto ele valeria, mas a troca é feita pelo
atendente no balcão. Prometer troca automática sem caixa integrado faria o
cliente cobrar algo que a casa nunca combinou.

### Bônus

- **Cadastro** (`signup_bonus`) — no primeiro pedido identificado.
- **Aniversário** (`birthday_bonus`) — disparado pelo dono na ficha do cliente,
  **uma vez por ano**, exigindo `birth_date` preenchida.

### Ajuste manual

O dono pode somar ou subtrair pontos na ficha, com motivo de até 200
caracteres. Todo ajuste entra no extrato como `adjust/manual` — não há edição
nem remoção de lançamento, nem pelo painel nem pelo banco
(`authenticated` não tem `insert/update/delete` em `loyalty_ledger`).

---

## Privacidade (LGPD)

### O que é coletado

Só o necessário para reconhecer a pessoa: **nome** e **WhatsApp**. E-mail é
opcional e não é pedido em nenhum formulário do fluxo de pedido. Data de
nascimento só serve ao bônus de aniversário e é preenchida pelo dono, se quiser.

Nada de CPF, endereço, gênero, data de nascimento obrigatória ou histórico de
navegação.

### Consentimento

A identificação exige aceite explícito (`consent: true`). Sem ele o pedido
**não falha** — segue anônimo, e os campos de nome/telefone são descartados no
servidor. O checkbox nunca vem marcado.

O aceite é gravado com três campos:

| Campo | Para quê |
| --- | --- |
| `consent_at` | Quando a pessoa aceitou |
| `consent_version` | Sob qual texto (`v1`) — se o texto mudar, o histórico continua provando o que foi aceito |
| `consent_revoked_at` | Quando pediu para sair |

### Exclusão

`erase_customer()` **anonimiza**, não apaga a linha:

- `name`, `phone`, `phone_normalized`, `email`, `birth_date` → `null`
- `consent_revoked_at` → `now()`
- cópia de `customer_name` nos pedidos → `null`
- `erased_at` → `now()`

Os **pedidos continuam** existindo na casa (faturamento, relatórios), agora sem
dono. A linha fica para que o dono consiga abrir a ficha e ver que a exclusão
foi feita — sumir da lista faria parecer que o pedido se perdeu. Não há
`DELETE` em `customers` para `authenticated`: nem policy, nem grant.

A exclusão pede **dois toques** no painel. É irreversível.

### O que o cardápio público nunca mostra

`customer_points` devolve **apenas** nome, saldo e o texto do programa. Nunca
telefone, e-mail, extrato ou histórico. A credencial é **token da mesa +
telefone** — o mesmo raciocínio da Etapa 6 (mesa + número do pedido), e não
finge ser autenticação forte: por isso a resposta é mínimo necessário.

Número desconhecido devolve a mesma mensagem sempre. Um restaurante jamais
enxerga cliente de outro: toda RPC de painel checa `is_restaurant_member`.

---

## Segurança

| Camada | Regra |
| --- | --- |
| Tabelas | `customers`, `loyalty_settings` e `loyalty_ledger` com RLS ligada; `anon` sem acesso |
| Escrita de configuração | `is_restaurant_owner` dentro de `save_loyalty_settings` |
| Leitura de painel | `is_restaurant_member` dentro de cada RPC |
| Edge de cliente | `customer_points` só por token de mesa válido |
| `service_role` | Não aparece em nenhum arquivo de `src/` |

`restaurant_id` **nunca** vem da URL ou do formulário: as actions pegam o
restaurante da sessão (`getActiveRestaurant()`) e passam como argumento para a
RPC, que confere o vínculo de novo.

### Funções

```
create_order(p_token, p_items, p_notes,
             p_customer_name, p_customer_phone, p_consent)   -- 6 args
save_loyalty_settings(p_restaurant_id, p_enabled, p_points_per_currency,
                      p_signup_bonus, p_birthday_bonus, p_redeem_value,
                      p_program_note)
update_customer(p_restaurant_id, p_customer_id, p_name, p_email, p_birth_date)
adjust_customer_points(p_restaurant_id, p_customer_id, p_delta, p_note) → int
award_birthday_bonus(p_restaurant_id, p_customer_id) → int
erase_customer(p_restaurant_id, p_customer_id) → bool
list_restaurant_customers(p_restaurant_id, p_search, p_limit, p_offset)
customer_overview(p_restaurant_id, p_customer_id) → jsonb
customer_points(p_token, p_phone) → jsonb          -- anon
public_loyalty_settings(p_restaurant_id) → jsonb   -- anon
```

A versão de 3 argumentos de `create_order` é **removida** (`drop function if
exists`). Duas versões convivendo fazem o PostgREST escolher por contagem e o
cliente cair na função errada.

### Telefone

`normalize_phone()` (SQL) e `normalizePhone()` (TS) implementam a **mesma**
regra, de propósito: `+55 (85) 99999-8888`, `85999998888`, `0 85 99999-8888` e
`85.99999.8888` viram todos `5585999998888`. O harness de paridade roda a
tabela de 16 casos do banco contra a implementação TypeScript.

O bug que existiu aqui: o `0` de discagem nacional só sai quando o que sobra tem
tamanho de número brasileiro. A primeira versão testava `length > 11` e deixava
`085 3232-1010` sair como `5508532321010` — um número que não existe e que
nunca casaria com o mesmo cliente digitado de outro jeito.

---

## O que ficou preparado, e não entregue

Estes campos e enums existem no banco **sem** código usando, para a próxima
etapa não precisar de migration destrutiva:

| Preparação | Onde | Por que ainda não |
| --- | --- | --- |
| `cashback_percent` | `loyalty_settings` | Cashback exige caixa/repasse; não há como honrar hoje |
| `tags text[]` | `customers` | Segmentação pronta para "aniversariante", "sumido", "VIP" |
| enums `campaign`/`cashback` | `loyalty_ledger.kind` | Lançamento de campanha precisa de campanha |
| `birth_date` | `customers` | Alimenta o bônus de aniversário manual |

**Não existe** fila de mensagens, `outbox`, cron de envio nem integração com
WhatsApp. Um campo ou tabela sugerindo envio automático faria o dono confiar
numa promessa que ninguém está cumprindo.

---

## Testes

```bash
node .arena-test/loyalty-lib.cjs        # 115: regra pura, telefone, pontos, rótulos
node .arena-test/loyalty-security.cjs   # 125: RLS, consentimento, LGPD, regressões
node .arena-test/loyalty-ui.cjs         # 118: as quatro telas renderizadas
```

| Harness | O que protege |
| --- | --- |
| `loyalty-lib` | Paridade de telefone com o banco, piso dos pontos, rótulos humanos, frequência, consentimento, formulário de configuração |
| `loyalty-security` | `service_role`, tenant vindo do cliente, dado pessoal em view pública, identificação obrigatória (regressão da Etapa 6), extrato append-only, ausência de disparo automático |
| `loyalty-ui` | Primeiro paint das quatro telas: dado mascarado, exclusão em dois toques, área de toque, sem `<table>`, nada de promessa de envio |

### Verificado no banco (projeto `fjrvjnhnvjkpowxzxiez`)

- pedido identificado → `customers` com telefone normalizado e consentimento `v1`;
- pedido levado até `delivered` → `earn` de 30 + bônus de cadastro de 50 = saldo 80;
- mesmo pedido entregue duas vezes → **um** lançamento;
- `customer_points` por `anon` com token da mesa → nome, saldo, regra;
- `customer_points` com telefone desconhecido → `null`;
- outro dono tentando `save_loyalty_settings` → `loyalty_forbidden` (42501);
- `loyalty_ledger` imutável para `authenticated`; cascade de exclusão de
  restaurante continua funcionando (o trigger barra `UPDATE`, não `DELETE`).

---

## Arquivos

```
supabase/migrations/0025_loyalty_customers.sql      schema, RPCs, RLS
src/lib/loyalty.ts                                  regra compartilhada cliente/servidor
src/lib/data/loyalty.ts                             leituras de painel (server-only)
src/lib/data/customers-client.ts                    busca/paginação no navegador
src/actions/loyalty.ts                              configuração, cliente, consulta pública
src/app/app/clientes/page.tsx                       lista
src/app/app/clientes/[id]/page.tsx                  ficha
src/app/app/clientes/fidelidade/page.tsx            regra do programa
src/components/customers/customers-list.tsx         lista com busca e paginação
src/components/customers/customer-detail.tsx        ficha com extrato e ações
src/components/customers/loyalty-settings-form.tsx  formulário com prévia
src/components/public/my-points-sheet.tsx           "meus pontos" no cardápio
```
