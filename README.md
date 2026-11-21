# Menuvo · Cardápios digitais para restaurantes

Plataforma SaaS multi-tenant de cardápios digitais para restaurantes, lanchonetes,
pizzarias, bares e cafeterias.

**Etapa 1 — fundação.** Landing page, autenticação completa, onboarding do
restaurante, dashboard mobile e configurações.

**Etapa 2 — categorias e produtos.** O painel `/app/cardapio` cria, edita, exclui,
ativa/desativa e reordena categorias; cadastra e edita produtos com nome, descrição,
preço, categoria, disponibilidade, destaque e código interno; busca por
nome/descrição/código e filtro por categoria. Arrastar-e-soltar otimizado para toque.

**Etapa 3 — cardápio público (atual).** Cada restaurante publicado tem um cardápio
em `/r/{slug}`, sem login: capa com logo e status de funcionamento, abas de
categoria com rolagem lateral sincronizada com a página, busca instantânea, e
detalhe do produto em tela cheia com quantidade. Nada de tela administrativa.

> 📱 Prioridade absoluta: **mobile**. Cada tela foi desenhada para uso com uma mão
> em telas de 320px a 430px. No desktop o conteúdo é centralizado em uma coluna
> confortável — de propósito, sem reinventar um painel administrativo tradicional.

---

## Stack

| Camada        | Escolha                                             |
| ------------- | --------------------------------------------------- |
| Framework     | Next.js 15 (App Router) + React 19 + TypeScript     |
| Estilo        | Tailwind CSS v4 (design tokens em `@theme`)         |
| Ícones        | lucide-react                                        |
| Validação     | Zod (compartilhada entre formulário e Server Action) |
| Banco / Auth  | Supabase (Postgres + Auth + RLS + Storage)          |
| Deploy        | Vercel                                              |

Sem dependências de UI pesadas: os componentes em `src/components/ui` são próprios,
leves e acessíveis.

---

## Rodando localmente

```bash
npm install
cp .env.example .env.local   # já vem com as chaves públicas do projeto Supabase
npm run dev                  # http://localhost:3000
```

Scripts:

| Comando                | O que faz                                              |
| ---------------------- | ------------------------------------------------------ |
| `npm run dev`          | Servidor de desenvolvimento                            |
| `npm run build`        | Build de produção                                      |
| `npm run typecheck`    | TypeScript estrito, sem emitir                         |
| `node scripts/audit-layout.mjs` | Auditoria mobile (overflow, viewport, alvos de toque) |

### Deploy

Projeto **menuvo** na Vercel, conectado ao repositório
(`polodogordin-cloud/plataforma-saas`). As variáveis `NEXT_PUBLIC_SUPABASE_URL` e
`NEXT_PUBLIC_SUPABASE_ANON_KEY` já estão configuradas para production/preview/development.

```bash
vercel              # deploy de preview
vercel --prod       # deploy de produção
```

Se a URL `*.vercel.app` pedir login da Vercel, desative **Deployment Protection →
Vercel Authentication** nas configurações do projeto.

Antes de publicar em produção, no Supabase:

- **Authentication → URL Configuration**: Site URL = domínio final; Redirect URLs
  devem incluir `https://seu-dominio/**`.
- **Authentication → Email**: ligue a confirmação de e-mail em produção (o fluxo já
  trata o link em `/auth/callback`).

## Variáveis de ambiente

```env
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>   # pública, protegida por RLS
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

A `service_role key` **nunca** é usada na aplicação. Todo acesso a dados passa pelo
cliente anon + cookies de sessão, e portanto por RLS.

---

## Arquitetura multi-tenant

```
auth.users            ← Supabase Auth (senha, sessão, e-mail)
   │ 1:1 (trigger)
   ▼
public.users          ← perfil público
   │ N:N
   ▼
public.restaurant_users  (role: owner | admin | staff, status: active | invited | suspended)
   │ N:1
   ▼
public.restaurants    ← o tenant (id, name, slug, logo_url, description,
                        phone, address_*, status, created_at, ...)
```

- **Cada restaurante é um tenant.** Todo dado futuro (categorias, produtos, mesas,
  pedidos) carrega `restaurant_id` e é protegido por RLS.
- **Um usuário pode pertencer a vários restaurantes**, com papéis diferentes.
- **Isolamento garantido no banco**, não na UI. Funções `security definer`
  (`is_restaurant_member`, `has_restaurant_role`, `is_restaurant_admin`) evitam
  recursão de policy e concentram a regra em um só lugar.
- **Criação de restaurante é atômica e via RPC** (`create_restaurant`), que resolve
  `auth.uid()` no servidor e cria o vínculo `owner` junto. O cliente não escolhe
  `user_id` nem pode inserir direto em `restaurants`.

### Políticas (resumo)

| Tabela             | SELECT                        | INSERT            | UPDATE               | DELETE        |
| ------------------ | ----------------------------- | ----------------- | -------------------- | ------------- |
| `users`            | si mesmo + colegas de tenant   | trigger           | si mesmo             | —             |
| `restaurants`      | membros ativos                 | só via RPC        | owner/admin          | owner         |
| `restaurant_users` | membros ativos                 | owner/admin       | owner/admin          | owner/admin   |

Storage: bucket público `restaurant-assets` para logos/fotos, com escrita restrita a
owner/admin e caminho obrigatório `{restaurant_id}/...`.

Verificado com 19 checagens de isolamento na Etapa 1 e mais 19 na Etapa 2
(estranho, staff, owner, anônimo, membro rebaixado) — todas passando.

### Cardápio (Etapa 2)

```
categories            ← restaurant_id, name, description, image_url,
                        is_active, position    (unique por restaurant_id + name_key)
   │ 1:N (on delete set null)
   ▼
products              ← restaurant_id, category_id, name, description,
                        price numeric(10,2), image_url, is_available,
                        is_featured, internal_code, position
```

- **Preço é `numeric(10,2)`**, nunca float. A formatação `R$ 1.234,56` acontece só na
  apresentação (`formatPrice`); a leitura aceita `32,90`, `32.90`, `R$ 32,90` e
  `1.234,56` (`parsePrice`).
- **Ordem automática:** triggers `assign_category_position` e
  `assign_product_position` numeram ao inserir; `reorder_categories` /
  `reorder_products` regravam a ordem recebida. As funções são `security invoker`,
  então a RLS continua valendo — quem não é owner/admin não reordena nada.
- **Duplicidade em pt-BR:** a unicidade usa `name_key(name)`, que remove acentos,
  caixa e espaços repetidos. `Hambúrgueres` e `hamburgueres` colidem, como deveriam.
- **Excluir categoria não apaga produtos:** eles passam para "Sem categoria"
  (`on delete set null`), e a interface avisa quantos serão movidos.
- **Preparado para o futuro, sem implementar:** `product_option_groups` +
  `product_options` (adicionais, complementos, sabores, tamanhos) e `promotions` +
  `promotion_items` (promoções, combos) já existem com RLS ativa.

### Cardápio público (Etapa 3)

O cliente abre `/r/{slug}` **sem criar conta**. Isso não é feito abrindo as tabelas
para o role `anon` — seria vazar telefone, endereço e `settings` de todo restaurante,
inclusive dos que ainda não publicaram.

Em vez disso, três views com `security_invoker = false` funcionam como allowlist de
colunas e de linhas:

| View | Expõe | Filtro |
| --- | --- | --- |
| `public_restaurants` | nome, slug, logo, descrição, cidade/UF, moeda, `settings` | `status = 'published'` |
| `public_categories` | id, nome, descrição, imagem, ordem | categoria ativa + restaurante publicado |
| `public_products` | id, nome, descrição, preço, imagem, destaque, ordem | disponível + categoria ativa + publicado |

- **Allowlist de colunas:** `phone`, `address_line`, `settings` brutos de terceiros e
  `internal_code` não existem nas views. Coluna nova no schema não vaza sozinha.
- **Rascunho não vaza pelo produto:** um produto só aparece se a **categoria** dele
  estiver ativa. Sem isso, ocultar uma categoria ainda exporia os itens dela.
- **Produto sem categoria não aparece** no cardápio público.
- **Rascunho e inexistente dão a mesma resposta** (404), para não ser possível
  descobrir quais slugs estão cadastrados.
- Pausar o restaurante esconde tudo sem apagar nada; republicar restaura.
- `anon` recebe `select` apenas nas três views; as tabelas base seguem fechadas.

**Horário de funcionamento** vive em `restaurants.settings.opening_hours` (jsonb já
existente, sem migração nova), no formato
`{ "mon": { "closed": false, "open": "18:00", "close": "23:30" }, ... }`.
O cálculo usa o **fuso do restaurante**, trata turno que passa da meia-noite
(18:00 → 02:00) e, sem configuração, o cardápio **não afirma** estar aberto.
"Fechado" nunca diz "abre hoje" com um horário que já passou.

### Mesas e QR Codes (Etapa 4)

Cada mesa do salão ganha um **endereço público próprio**:
`/r/{slug}/table/{token}`. É esse endereço que vai impresso no QR Code.

**Por que um token, e não o número da mesa.** O rótulo ("Mesa 01") é só
apresentação: muda de restaurante para restaurante, pode ser duplicado entre
tenants e o dono pode renomear. A URL usa `tables.public_token` — 24 caracteres
do alfabeto `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (~119 bits), gerado pelo banco,
único e sem sequência previsível. Trocar o número da mesa não invalida o QR
impresso; trocar o token, sim.

| Camada | Papel |
| --- | --- |
| `tables.public_token` | identidade pública permanente (QR e, depois, NFC) |
| `tables.is_active` | liga/desliga o acesso pelo QR sem apagar a mesa |
| `tables.status` | ocupação do salão: `free`, `occupied`, `reserved`, `inactive` |
| `resolve_table_token(token)` | RPC `security definer`: token → restaurante + mesa |
| `public_table_context` | view pública mínima (token, restaurante, nome) |

- **O cardápio nunca é copiado para a mesa.** A página resolve o token e
  renderiza os dados atuais do restaurante. Mudar preço, nome, descrição, foto
  ou disponibilidade **não exige reimprimir o QR Code** — a URL é a mesma.
- **Superfície pública mínima:** `anon` não tem `select` em `tables`. Ele só
  alcança a RPC e a view, que devolvem nome da mesa e restaurante — nada de
  `notes`, `code`, ids internos ou dados de outro tenant.
- **Só resolve mesa utilizável:** a RPC exige restaurante `published` **e**
  `is_active = true`. Mesa desativada ou cardápio pausado respondem a mesma
  página de indisponibilidade, sem revelar se o token existe.
- **Trocar o token invalida o material impresso.** `rotate_table_token()` guarda
  o token anterior por **30 minutos** (`previous_token`) para não derrubar quem
  já está com o cardápio aberto. A interface avisa que o QR e a futura TAG NFC
  precisam ser substituídos.
- **Sessão do cliente:** o middleware grava o token em um cookie
  (`menuvo_table`, 3 h) ao abrir a mesa — o mesmo token que já está na URL, sem
  login e sem credencial de escrita. As próximas etapas (carrinho, pedido,
  chamada de garçom) leem esse cookie; qualquer escrita vai revalidar o token no
  banco.

**QR Code sem dependência.** `src/lib/qr.ts` gera a matriz (byte mode, ECC M,
versões 1–10) e as imagens PNG/SVG em JavaScript puro, sem `node_modules`. O PNG
usa deflate com blocos de Huffman fixos — um PNG "stored" do mesmo código teria
~1,5 MB, e o mesmo QR sai com ~48 kB. Verificado contra um decodificador real
(`jsQR`): 30 de 30 URLs de mesa decodificam, inclusive com acentos.

---

---

## Rotas

| Rota                                  | Descrição                                       |
| ------------------------------------- | ----------------------------------------------- |
| `/`                                   | Landing page                                    |
| `/entrar`                             | Login                                           |
| `/criar-conta`                        | Cadastro                                        |
| `/recuperar-senha`                    | Envio do link de recuperação                    |
| `/redefinir-senha`                    | Nova senha (via link do e-mail)                 |
| `/auth/callback`                      | Troca de código por sessão (confirmação/reset)  |
| `/onboarding`                         | Criação do restaurante                          |
| `/app`                                | Dashboard (Início)                              |
| `/app/cardapio`                       | Cardápio: categorias e produtos (Etapa 2)       |
| `/app/cardapio/produtos`              | Lista completa de produtos com busca e filtros  |
| `/r/[slug]`                           | **Cardápio público (sem login)**                |
| `/r/[slug]/table/[token]`             | **Cardápio aberto pelo QR/NFC da mesa**         |
| `/app/mesas`                          | Mesas: cartões, ativar/desativar, QR (Etapa 4)  |
| `/app/mesas/[id]/qr`                  | Download do QR (`?format=png` ou `?format=svg`) |
| `/sitemap.xml`, `/robots.txt`         | Indexação — só cardápios publicados             |
| `/app/pedidos`                        | Pedidos — Etapa 6/7                             |
| `/app/configuracoes`                  | Hub de configurações                            |
| `/app/configuracoes/conta`            | Conta do usuário                                |
| `/app/configuracoes/restaurante`      | Dados do restaurante                            |

Fluxo principal: **cadastro → login automático → criar restaurante → dashboard**.
O middleware do Supabase renova a sessão e protege `/app`, `/onboarding` e
`/configuracoes`.

---

## Estrutura de pastas

```
src/
├── actions/            Server Actions
│   ├── auth.ts         cadastro, login, logout, senha
│   ├── restaurant.ts   criação e edição do restaurante
│   ├── account.ts      perfil do usuário
│   ├── menu.ts         categorias e produtos (CRUD, toggle, reordenação)
│   └── tables.ts       mesas (CRUD, ativar/desativar, ocupação, novo token)
├── app/
│   ├── layout.tsx      metadata, viewport, manifest
│   ├── page.tsx        landing
│   ├── (auth)…         entrar, criar-conta, recuperar-senha, redefinir-senha
│   ├── auth/callback/  route handler do Supabase Auth
│   ├── onboarding/     criação do restaurante
│   └── app/            área autenticada + bottom nav
├── components/
│   ├── app/            AppHeader, BottomNav, StatCard, StatusToggle
│   ├── auth/           AuthShell
│   ├── menu/           Painel: MenuManager, CategoryCard, ProductCard,
│   │                   sheets, ProductsBrowser, SortableProvider (dnd-kit)
│   ├── public/         Cardápio do cliente: PublicHeader, PublicMenuView,
│   │                   ProductRow, ProductDetail, TableBadge
│   ├── tables/         Painel de mesas: TablesManager, TableCard,
│   │                   TableSheet, QrSheet, QrPrintCard
│   └── ui/             Button, Field, Card, Badge, Sheet, Switch,
│                       ConfirmSheet, ComingSoon…
├── lib/
│   ├── data/           consultas server-side (RLS aplicada)
│   ├── supabase/       client, server, middleware
│   ├── types.ts        tipos de domínio
│   ├── utils.ts        helpers
│   ├── opening-hours.ts horário de funcionamento (fuso, meia-noite)
│   ├── qr.ts           gerador de QR Code (matriz, PNG, SVG) sem dependências
│   ├── table-session.ts cookie de contexto da mesa (QR/NFC)
│   └── validation.ts   schemas Zod
└── middleware.ts
supabase/migrations/    schema aplicado via Supabase
                        0001_init.sql (Etapa 1)
                        0002_menu_categories_products.sql (Etapa 2)
                        0003_public_menu.sql (Etapa 3)
                        0004_tables_qr.sql (Etapa 4)
scripts/                auditoria de layout + teste de RLS
```

---

## Decisões de design

- **Design tokens** em `@theme` (`brand`, `ink`, `accent`, raios, sombras, easing).
  Trocar a cor da marca é mudar uma variável.
- **Alvos de toque ≥ 44px** (`tap-target`), tipografia de input em 16px (evita o
  zoom automático do iOS), `prefers-reduced-motion` respeitado, `env(safe-area-inset-*)`
  nas barras fixas e no topo.
- **Fonte de sistema** por padrão: zero requisição externa, zero CLS, renderização
  nativa em Android e iPhone. Inter pode ser plugada depois via `next/font`.
- **Bottom nav fixa** com 5 destinos, ícone + rótulo e indicador ativo.
- **Estados honestos**: telas não implementadas mostram “Em breve” com a etapa
  correspondente — nunca dados fictícios apresentados como reais.
- **Feedback de RLS**: mutações usam `.select()` e verificam se alguma linha mudou,
  para não reportar “salvo” quando a policy bloqueou a operação.
- **QR Code impresso**: "Imprimir" usa uma raiz `.print-sheet` fora do fluxo da
  tela; no papel só existe o cartão da mesa (com `@page A4`), jamais o painel.
- **Identidade pública opaca**: o que o cliente vê na URL nunca é o número da
  mesa nem o `id` do banco, mas um token que o dono pode rotacionar.

---

## Próximas etapas (já previstas na arquitetura)

| Etapa | Escopo                          | Onde encaixa                                        |
| ----- | ------------------------------- | --------------------------------------------------- |
| ~~2~~ | ~~Categorias e produtos~~       | ~~`/app/cardapio` — **concluída**~~                 |
| ~~3~~ | ~~Cardápio público~~            | ~~`/r/[slug]` — **concluída**~~                     |
| 4     | Mesas + QR Code                 | `tables`; `/app/mesas`; lib de QR                   |
| 5     | NFC                             | URLs curtas por mesa (`/t/:code`)                   |
| 6     | Carrinho e pedidos              | `orders`, `order_items`; RLS + realtime             |
| 7     | Painel de pedidos               | `/app/pedidos`; Supabase Realtime                   |
| 8     | Personalização do cardápio      | `restaurants.settings` (jsonb) + upload de logo     |
| 9     | Planos e assinaturas            | `plans`, `subscriptions`; gate por `restaurant_id`   |
| 10    | Publicação e produção           | domínios, observabilidade, cache                    |

Pontos já preparados: o bucket de storage existe, `settings` é jsonb livre para a
personalização, o status do restaurante já é modelado (`draft → published`), e a
função `has_restaurant_role` aceita o array de papéis permitidos — ou seja, novos
níveis de acesso não exigem reescrever policies.

---

## Acessibilidade

- Estrutura semântica (`nav`, `main`, `header`, `ol`), headings em ordem.
- Rótulos + `aria-describedby` em todos os campos, `aria-invalid` e `role="alert"`
  nos erros; `aria-current="page"` na navegação.
- Foco visível em tudo, contraste AA nos textos, botões com estado `aria-busy`.
- Mockups decorativos marcados com `aria-hidden`.
