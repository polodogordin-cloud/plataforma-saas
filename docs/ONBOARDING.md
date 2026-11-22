# Onboarding automático do restaurante — Etapa 21

Como um restaurante novo sai de "acabei de criar a conta" para "cardápio no ar
e QR Code na mesa", sem precisar entender a parte técnica.

---

## 1. O percurso

```
criar conta → /onboarding (nome + link da casa) → /app/onboarding (wizard 1..8) → /app
```

`createRestaurant` redireciona direto para o wizard: quem cria a casa cai no
passo a passo, não no painel vazio.

| # | Etapa | O que o dono faz | Pode pular? | Grava em |
| --- | --- | --- | --- | --- |
| 1 | Informações | Logo, nome, descrição | **Não** | `restaurants`, bucket `restaurant-assets` |
| 2 | Aparência | Escolhe um dos 6 temas prontos | Sim | `restaurant_themes` (RPC `save_restaurant_theme`) |
| 3 | Segmento | Escolhe entre 11 tipos | Sim | `restaurants.segment` (RPC `set_restaurant_segment`) |
| 4 | Categorias | "Usar configuração sugerida" ou criar do zero | Sim | `categories` (RPC `apply_suggested_categories`) |
| 5 | Produtos | Atalho para a tela de cadastro | Sim | `products` (action normal) |
| 6 | Mesas | Atalho para a tela de mesas | Sim | `tables` (action normal) |
| 7 | QR Code | Prévia do QR da primeira mesa ativa | Sim | nada (derivado do token da mesa) |
| 8 | WhatsApp | Atalho para a configuração do canal | Sim | `whatsapp_settings` (action normal) |

Por que as etapas 5, 6 e 8 são atalhos e não formulários novos: cadastro de
produto, de mesa e de WhatsApp já existem desde as Etapas 2/4/13 com validação,
limite de plano e prévia. Reimplementar dentro do wizard faria as duas telas
divergirem na primeira correção. O wizard conduz; a tela completa executa.

---

## 2. Onde o progresso mora

Em `restaurants` (migration `0022_onboarding.sql`):

```jsonc
{
  "segment": "hamburgueria",
  "onboarding_completed": false,
  "onboarding": {
    "steps": { "informacoes": "done", "aparencia": "skipped" },
    "completed_at": null
  }
}
```

- **`steps`** — mapa fechado: `done` | `skipped` | `pending`. Chave desconhecida
  ou valor inválido é recusado pelo banco (`unknown_onboarding_step`,
  `invalid_onboarding_state`).
- **`onboarding_completed`** — o dono chegou ao fim. Não implica cardápio
  publicado.
- Casas que já existiam antes desta etapa recebem `completed = true` e a marca
  `legacy`, para não aparecerem como "incompletas" no painel sem motivo.

**Retomar de onde parou:** o wizard abre na **primeira etapa não resolvida**
(nem `done`, nem `skipped`), não na última visitada. Quem volta para corrigir
algo retoma na lacuna real.

---

## 3. Dois progressos, e por que não são o mesmo número

| | Wizard (`/app/onboarding`) | Dashboard (`SetupProgressCard`) |
| --- | --- | --- |
| Mede | telas percorridas | dados que a casa realmente tem |
| Fonte | `onboarding.steps` | `categories`, `products`, `tables`, `whatsapp_settings`, `logo` |
| Fecha com | "Continuar" / "Pular" | o dado existir |
| Percentual | `progresso do wizard` | `Configuração: 85% concluída` |

O número do dashboard vem do **checklist de dados reais**. Se olhasse o mapa de
etapas, bastaria marcar tudo como feito para o painel dizer 100% com cardápio
vazio — e o inverso também vale: apagar a logo depois de marcar a etapa faz o
checklist voltar a acusar, o que é o comportamento correto.

Checklist (7 itens): Informações · Logo · Categorias · Produtos · Mesas · QR
Code · WhatsApp.

Duas regras que evitam mentira no número:

- **QR Code** exige **mesa ativa** (`activeTables > 0`). Mesa desativada não tem
  token válido, logo não tem QR que funcione.
- **Pronto para publicar** não é "100%": é ter categoria + produto + mesa. Logo
  e WhatsApp são refinamento, não pré-requisito.

---

## 4. Segmento e modelo sugerido

11 segmentos: Restaurante, Lanchonete, Hamburgueria, Pizzaria, Bar, Cafeteria,
Sorveteria, Padaria, Açaí, Delivery, Outro (enum `restaurant_segment` no banco).

Cada segmento sugere **categorias** (em `src/lib/onboarding.ts`) e um **tema**
(pré-seleção visual, nunca aplicado sozinho).

> **Nenhum produto de exemplo é criado.** O escopo é explícito, e a razão é
> prática: produto fictício com preço aparece no cardápio público e o cliente
> tenta pedir. Categoria vazia não engana — ela desaparece da vitrine enquanto
> não tiver item.

Exemplo — Hamburgueria:

```
Hambúrgueres · Combos · Porções · Bebidas · Sobremesas
```

Aplicar é idempotente: a RPC compara por `name_key` (sem acento, minúsculo), então
"Hambúrgueres" e "hamburgueres" não viram duas linhas. Rodar duas vezes cria só
o que falta.

---

## 5. Tela final

"Seu cardápio está pronto." mostra link público, QR Code da primeira mesa ativa,
botão de visualizar, copiar link, compartilhar (Web Share API com fallback para
copiar) e abrir painel.

Quando o cardápio ainda está em rascunho, o botão principal é **"Publicar meu
cardápio"** em vez de "Visualizar": mandar o dono abrir um 404 na primeira
experiência é o tipo de detalhe que faz desistir.

---

## 6. Segurança

Toda escrita passa por RPC `security definer` com `is_restaurant_owner()`:
dono/admin da casa ou admin da plataforma. Verificado contra o banco de
produção — 6 ataques, todos negados:

| Ataque | Resultado |
| --- | --- |
| `save_onboarding_progress` em tenant alheio | `onboarding_forbidden` (42501) |
| `set_restaurant_segment` em tenant alheio | 42501 |
| `apply_suggested_categories` em tenant alheio | 42501 |
| Etapa inventada no mapa | `unknown_onboarding_step` |
| Estado inventado (`"hackeado"`) | `invalid_onboarding_state` |
| 41 categorias numa chamada | `too_many_categories` |

`onboarding_overview()` devolve `null` (não exceção) para tenant alheio — a tela
trata como "não encontrado", sem revelar existência. Verificado: o dono de uma
casa vê `null` na outra (`other_overview_null = true`), e o admin da plataforma
vê as duas, que é o papel dele.

A logo enviada precisa apontar para `…/restaurant-assets/{restaurant_id}/…`;
qualquer outro caminho é recusado antes de gravar.

---

## 7. Integração com o que já existia

Salvar tema, criar categoria, criar produto, criar mesa e conectar WhatsApp
**fora do wizard** também marca a etapa correspondente
(`trackOnboardingStep`, em `src/lib/onboarding-progress.ts`). É best-effort: se a
anotação falhar, a ação original não falha nem mostra erro — o trabalho do dono
já está salvo, e o dashboard lê o dado real de qualquer forma.

Pontos de entrada do wizard:

- depois de criar a conta (`createRestaurant`);
- cartão de progresso no dashboard ("Continuar");
- Ajustes → "Passo a passo da configuração";
- `/onboarding` para quem já tem casa (redireciona para o wizard, não para o
  painel).

---

## 8. Verificação

| Harness | Asserções | Cobre |
| --- | --- | --- |
| `onboarding-lib` | 112 | etapas, progresso, retomada, modelos por segmento, checklist |
| `onboarding-ssr` | 87 | HTML de cada etapa, cabeçalho, card de progresso |

SQL (banco de produção `fjrvjnhnvjkpowxzxiez`): 6 ataques negados, dedupe
idempotente verificado (aplicar duas vezes → 6 criadas e 2 puladas, sem
duplicata de acento), `anon` sem acesso às RPCs (`has_function_privilege` =
false).
