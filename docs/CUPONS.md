# Cupons e promoções

Etapa 25. **Adiciona** desconto sobre o pedido que já existia. Nada do que veio
antes mudou de contrato: o cardápio, a mesa, a cozinha e o painel continuam
funcionando, e pedir **sem** cupom é exatamente o mesmo caminho de antes.

O princípio que organiza tudo aqui é um só:

> **O cliente escolhe um código. O servidor escolhe o desconto.**

Nenhum valor em dinheiro sai do navegador em direção ao banco. O carrinho manda
o código e uma prévia; o banco recalcula subtotal, desconto e total a partir dos
itens gravados e devolve o número final.

---

## O que o dono ganha

| Tela | Endereço | O que resolve |
| --- | --- | --- |
| Marketing | `/app/marketing` | Hub: Cupons, Clientes e fidelidade, Divulgação |
| Cupons | `/app/marketing/cupons` | Lista com código, tipo, valor, validade, limite, uso atual e status |
| Novo cupom | `/app/marketing/cupons/novo` | Formulário de criação, com código gerado se quiser |
| Ficha do cupom | `/app/marketing/cupons/[id]` | Desempenho, quem usou e edição |

Chega-se também por **Configurações → Marketing** e por um cartão no painel
inicial. O menu inferior continua com **seis abas** — cupom não é uma sétima
tela principal, é ferramenta de venda.

Tudo é de coluna única, com alvos de toque de 44px e sem tabela: dá para criar,
editar e desligar um cupom no celular.

## O que o cliente ganha

No carrinho do cardápio público, entre a lista de itens e o resumo:

```
┌──────────────────────────────────┐
│ 🎟  Tenho um cupom            ▾  │
└──────────────────────────────────┘
        ↓ abre
┌──────────────────────────────────┐
│ [ BEMVINDO10        ]  Aplicar   │
│ ✓ 10% de desconto                │
└──────────────────────────────────┘

Subtotal                        R$ 30,00
Desconto (−10%)                − R$  3,00
Total estimado                  R$ 27,00
```

O código é conferido **ao digitar "Aplicar"**, não no envio. Isso é conveniência:
se a pessoa esperar dez minutos com o carrinho aberto e o cupom expirar nesse
meio-tempo, o envio é recusado com o motivo em português — e o pedido não é
criado pela metade.

---

## Os tipos de desconto

| Tipo | Como funciona | Situação |
| --- | --- | --- |
| `percentage` | Percentual do subtotal, com teto opcional em reais | Entregue |
| `fixed` | Valor fixo, limitado ao subtotal (nunca deixa o pedido negativo) | Entregue |
| `free_shipping` | Abateria a taxa de entrega | **Preparado, não entregue** |

`free_shipping` existe no enum, o formulário cria o cupom e o banco o aceita —
mas não há delivery nesta versão, então o cupom **não abate nada** e a tela
avisa isso em amarelo. É deliberado: um tipo que promete frete grátis sem taxa
nenhuma é propaganda enganosa se não disser que não vale ainda.

## As regras que valem dinheiro

### Cálculo

```
subtotal  = soma dos itens gravados no pedido
desconto  = percentage: min(subtotal × valor/100, teto)   se teto existir
            fixed:      min(valor, subtotal)
            free_shipping: 0
total     = subtotal − desconto + taxas
```

O desconto é sempre **limitado ao subtotal** em dois lugares independentes: no
cálculo (`least`) e no banco (`orders_discount_within_subtotal`). Um cupom de
R$ 50 num pedido de R$ 10 abate R$ 10 — e o cliente paga R$ 0, nunca −R$ 40.

### Normalização do código

`BEMVINDO10`, `bem vindo 10` e `  bem-vindo-10  ` são **o mesmo cupom**. A regra
é a mesma no TypeScript do app e na função `normalize_coupon_code` do banco:

1. remove acentos (`promoção` → `PROMOCAO`);
2. sobe para maiúsculas;
3. mantém apenas `A–Z` e `0–9` (`_`, `-`, espaço, `%`, `/` caem);
4. comprimento útil de 3 a 24 caracteres.

O harness `coupon-lib.cjs` compara os dois lado a lado com 17 casos que foram
executados no projeto Supabase real. Se alguém mudar um dos lados, o teste
quebra — não o cupom da padaria.

### Quando o cupom vale

O status é decidido **no banco** (`coupon_status_of`), nunca na tela:

| Status | Condição |
| --- | --- |
| `scheduled` | `começa em` está no futuro |
| `expired` | `termina em` já passou |
| `exhausted` | usos ≥ limite total |
| `inactive` | desligado pelo dono |
| `active` | nenhuma das acima |

Motivos de recusa, todos com frase em português na tela:
`coupon_not_found`, `coupon_inactive`, `coupon_not_started`, `coupon_expired`,
`coupon_exhausted`, `customer_limit_reached`, `below_minimum`,
`table_unavailable`.

---

## Segurança

As cinco portas que esta etapa fecha, e como:

### 1. Desconto vindo do cliente

O schema de entrada do pedido **não tem campo de dinheiro**. Só `couponCode`:

```ts
couponCode: z.string().trim().max(COUPON_CODE_MAX).optional()
```

Não existe `discount`, `total`, `subtotal` nem `price` no corpo aceito. O
`orderInputSchema` é a fronteira, e o harness `coupon-security.cjs` falha se
algum desses nomes aparecer ali. A RPC `create_order` também não recebe valor:
ela lê `p_coupon_code`, resolve o cupom e recalcula.

### 2. Cupom de outra casa

O token da mesa resolve o restaurante:

```sql
select r.restaurant_id into v_restaurant
from public.resolve_table_token(p_table_token) r;
...
where c.restaurant_id = v_restaurant and upper(c.code) = v_code
```

Um código igual em duas casas não vaza entre elas, porque a busca é filtrada pelo
restaurante do token antes de qualquer cálculo. O painel inteiro passa por
`is_restaurant_member` e o restaurante vem de `getActiveRestaurant()`, nunca de
um `formData` ou de uma prop do cliente.

### 3. Uso duplicado

Três travas, em ordem:

- `coupon_redemptions_order_unique (order_id)` — um pedido, uma redenção;
- `select … for update` na linha do cupom dentro de `create_order` — duas
  requisições simultâneas não veem o mesmo `used_count`;
- `validate_coupon(..., p_ignore_order)` — ao **recalcular** um pedido existente,
  a contagem ignora a própria redenção dele.

Cancelar o pedido apaga a redenção (o cupom volta a valer) e **mantém** o
snapshot no pedido: o histórico de um pedido cancelado continua mostrando qual
cupom ele usou.

### 4. Limite por cliente

Contado por telefone normalizado. Só vale para quem se identificou no pedido —
pedido anônimo não tem como ser contado, e **o cupom não é negado por isso**
(regressão da Etapa 6: identificação continua opcional).

Sem a etiqueta de cliente, um mesmo número pode usar o cupom apenas
`max_uses_per_customer` vezes; o próprio cliente recebe o valor `1` como padrão.

### 5. Pedido alterado depois de validado

O pedido guarda **snapshot**: `coupon_code`, `coupon_type`, `coupon_value`,
`discount`, `coupon_id`. Editar o cupom depois não muda o que foi cobrado, e
apagar o cupom não apaga o histórico (`coupon_id … on delete set null`). A tela
de detalhe e a via impressa leem o snapshot, não a tabela.

Não há policy de `delete` em `coupons` e `authenticated` só lê
`coupon_redemptions` — não existe caminho de escrita em redenção para o app.

---

## Preparado e não entregue

Escopo pedido explicitamente como "futuro", registrado aqui para não virar
promessa disfarçada:

| Preparação | Onde | Por que ainda não |
| --- | --- | --- |
| `free_shipping` | enum `coupon_discount_type` | Não existe taxa de entrega para abater |
| `coupon_type` fechado no banco | `coupons.discount_type` | Campanha por produto/categoria/combos reusa o mesmo tipo com escopo |
| `coupon_redemptions.amount` | tabela de redenções | Base pronta para relatório por escopo (produto, categoria) |
| Snapshot de origem no pedido | `orders.coupon_*` | Permite saber de onde veio o desconto sem reprocessar |

**Campanhas por produto, por categoria, combo, happy hour e desconto recorrente
não existem.** Não há:
- tabela de campanha nem de escopo (`coupon_products`, `coupon_categories`);
- janela de horário/semana no cupom — só data e hora de início/fim;
- desconto automático por cliente recorrente;
- fila de mensagens, `outbox`, cron nem disparo de WhatsApp.

O hub de Marketing lista os três primeiros itens futuros com o rótulo "Em breve".
Se um deles for implementado, sai dessa lista.

---

## Testes

```bash
node .arena-test/coupon-lib.cjs        # 120: regra pura e paridade com o banco
node .arena-test/coupon-security.cjs   #  91: portas fechadas e regressões
node .arena-test/coupon-ui.cjs         #  59: as telas renderizadas
```

| Harness | O que protege |
| --- | --- |
| `coupon-lib` | Normalização de código contra a tabela do banco, prévia de desconto (teto, fixo > pedido, nada negativo), coerência do formulário, rótulos, ida e volta formulário↔linha |
| `coupon-security` | Desconto vindo do cliente, `service_role`, tenant de fora, uso duplicado, valor negativo, total, snapshot, RLS, regressões das Etapas 6/7/24 |
| `coupon-ui` | HTML real da lista e do formulário: código, status, busca, `inputMode` decimal (teclado do celular), rótulo acessível, frete grátis avisado, pedido sem cupom não bloqueado |

### Verificado no banco (projeto `fjrvjnhnvjkpowxzxiez`)

Tudo em transação com `rollback` — nada ficou gravado nas fixtures.

- `BEMVINDO10` (10%) em R$ 30 → `discount 3.00`, redenção `amount 3.00`;
- `below_minimum`, `coupon_expired`, `coupon_inactive`, `table_unavailable` →
  recusa com `amount 0`, pedido não criado;
- cupom fixo de R$ 50 em pedido de R$ 10 → `amount 10.00` (não 50);
- `customer_limit_reached` só no telefone repetido; outro telefone e pedido sem
  telefone passam;
- cancelar pedido → redenção apagada, `orders.coupon_code` preservado;
- outro dono → `42501 coupon_forbidden`; RLS isola a casa B em listagem e ficha;
- `list_restaurant_coupons` e `coupon_details` devolvem uso, status e últimas 50
  redenções;
- fixtures conferidas depois: 0 cupons, 0 redenções, 0 pedidos com cupom.

---

## Arquivos

```
supabase/migrations/0026_coupons_promotions.sql      schema, RPCs, RLS, grants
src/lib/coupons.ts                                   regra pura (cliente e servidor)
src/lib/data/coupons.ts                              leituras de painel (server-only)
src/actions/coupons.ts                               aplicar, salvar, ligar/desligar, gerar
src/app/app/marketing/page.tsx                       hub
src/app/app/marketing/cupons/page.tsx                lista
src/app/app/marketing/cupons/novo/page.tsx           criação
src/app/app/marketing/cupons/[id]/page.tsx           ficha com desempenho e usos
src/components/marketing/coupons-list.tsx            lista com busca e switch
src/components/marketing/coupon-form.tsx             formulário com prévia
src/components/public/cart-sheet.tsx                 "Tenho um cupom" no carrinho
src/components/public/order-success.tsx              subtotal/desconto no comprovante
```

### Banco

| Objeto | Papel |
| --- | --- |
| `coupons` | Regra do cupom (tipo, valor, validade, limites, ativo) |
| `coupon_redemptions` | Um uso, com valor abatido; append-only pelo app |
| `normalize_coupon_code` | Normalização compartilhada com o TS |
| `coupon_status_of` | Único lugar que decide o status |
| `generate_coupon_code` | Código a partir do nome, com sufixo quando já existe |
| `validate_coupon` | Conferência de disponibilidade (usada pelo painel e pelo pedido) |
| `create_order` | Grava o pedido com desconto calculado e redenção |
| `save_coupon` / `set_coupon_active` | Escrita do painel |
| `list_restaurant_coupons` / `coupon_details` | Leitura do painel, com uso já contado |
