# Menuvo · Cardápios digitais para restaurantes

Plataforma SaaS multi-tenant de cardápios digitais para restaurantes, lanchonetes,
pizzarias, bares e cafeterias.

**Etapa 1 — fundação.** Landing page, autenticação completa, onboarding do
restaurante, dashboard mobile e configurações.

**Etapa 2 — categorias e produtos.** O painel `/app/cardapio` cria, edita, exclui,
ativa/desativa e reordena categorias; cadastra e edita produtos com nome, descrição,
preço, categoria, disponibilidade, destaque e código interno; busca por
nome/descrição/código e filtro por categoria. Arrastar-e-soltar otimizado para toque.

**Etapa 3 — cardápio público.** Cada restaurante publicado tem um cardápio
em `/r/{slug}`, sem login: capa com logo e status de funcionamento, abas de
categoria com rolagem lateral sincronizada com a página, busca instantânea, e
detalhe do produto em tela cheia com quantidade. Nada de tela administrativa.

**Etapas 4–7 — mesas, NFC, pedidos e painel em tempo real.** Cada mesa tem QR
Code e TAG NFC; o cliente monta o carrinho e pede; a equipe acompanha tudo em
`/app/pedidos` sem recarregar.

**Etapa 14 — produção (atual).** Ambientes separados por variável, domínio
próprio com HTTPS e `www` canônico, CSP e headers de segurança, limite de
requisições, páginas de 404/500 específicas para cardápio, mesa e casa suspensa,
`/api/health` para diagnóstico e um cliente Supabase sem cookies que permite
cachear o cardápio.

**Etapa 13 — WhatsApp.** O restaurante liga um número em
**Configurações → WhatsApp** e o cardápio público ganha um botão grande
**💬 Falar no WhatsApp** que abre a conversa com a mensagem inicial já escrita.
A plataforma **não envia nada sozinha**: a estrutura da API oficial (fila,
tipos, consentimento, texto do pedido) está pronta e desligada.

**Etapa 12 — PWA instalável.** O cardápio e o painel instalam na tela inicial
com manifest, ícones e service worker; abrem sem rede com `offline.html`; e a
atualização nunca recarrega a página no meio de um pedido.

**Etapa 11 — planos e assinaturas.** O sistema virou SaaS comercial:
cada casa tem plano, limites e período. Básico, Profissional e Premium com preço,
recursos e limites **editáveis pelo admin** — nenhum número mora no código. O
limitador é um trigger no banco: a mesa 51 é recusada mesmo por API, e a tela
responde "Seu plano atingiu o limite de mesas" com o caminho para `/planos`.
Trial configurável, assinatura com seis estados e camada de gateway pronta — sem
nenhuma cobrança real nesta etapa.

**Etapa 10 — painel master.** Existem dois tipos de usuário e o banco
sabe disso: o **dono do restaurante**, que vê só a própria casa, e o
**administrador da plataforma**, que entra em `/admin`, ativa, suspende e audita
todas elas. Nenhum pode fazer o trabalho do outro — nem pela interface, nem por
API.

**Etapa 9 — personalização visual.** Cada restaurante define logo, capa,
cinco cores, estilo de card e de botão, com seis temas prontos e preview de
celular ao vivo. O cardápio público aplica o tema automaticamente — e cai num
tema padrão profissional quando não há personalização.

**Etapa 8 — chamar garçom e pedir a conta.** Barra fixa no cardápio da
mesa com **🛎 Garçom · 🛒 Carrinho · 💳 Conta**, confirmação antes do envio,
anti-duplicata e cooldown no banco, e seção SOLICITAÇÕES no painel com contador
vermelho, "Há 1 minuto" e ATENDER → MARCAR COMO RESOLVIDO, em tempo real.

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
NEXT_PUBLIC_SITE_URL=https://cardapio.seudominio.com.br
NEXT_PUBLIC_APP_ENV=production             # development | staging | production
```

O `.env.example` lista todas, com o que quebra quando cada uma falta. Detalhe,
checklist de domínio e diagnóstico em **[docs/AMBIENTES.md](docs/AMBIENTES.md)**.

A `service_role key` **nunca** é usada na aplicação. Todo acesso a dados passa pelo
cliente anon + cookies de sessão, e portanto por RLS.

Para saber se a implantação está sã:

```bash
curl -s https://<domínio>/api/health | jq
```

O endpoint devolve **estado** (`set` / `missing` / `invalid`), nunca valor de
variável — e com `HEALTH_CHECK_SECRET` configurado exige `Authorization: Bearer`.

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

### NFC das mesas (Etapa 5)

A TAG NFC **não tem URL própria**: ela grava a mesma URL pública do QR Code,
`/r/{slug}/table/{public_token}`. QR e TAG são dois meios de abrir a mesma coisa.

Isso tem consequência prática — mudar preço, foto ou o cardápio inteiro não
exige reimprimir o QR **nem regravar a TAG**. Só a rotação de token muda a URL.

| Objeto | Papel |
| --- | --- |
| `public.table_nfc_tags` | uma linha por TAG física (várias por mesa permitidas) |
| `public.table_nfc_events` | histórico append-only, escrito por trigger |
| `public.table_nfc_overview` | TAG + `nfc_url` calculada + `needs_rerecord` |
| `tables.token_rotated_at` | marca as TAGs que apontam para URL morta |

- **`nfc_url` é calculada, nunca armazenada.** Guardar a URL em coluna criaria
  uma segunda cópia de (slug, token) que envelhece sozinha quando o slug muda
  ou o token rotaciona. A view resolve sempre a partir dos dados atuais.
- **O navegador não grava a TAG** — e a interface diz isso com essas palavras.
  Web NFC só existe em Chrome Android e não é padrão; mesmo lá o usuário precisa
  encostar o celular na TAG. Quem grava é um app dedicado (NFC Tools, TagWriter).
  A Menuvo entrega a URL pronta, registra o estado e o histórico.
- **Quatro estados:** não configurado, configurado, testado, desativado. E um
  aviso derivado que é o mais útil de todos: **"precisa regravar"**, quando a TAG
  foi configurada antes da última rotação de token. Mostrar "Configurado" ali
  seria mentira útil — o cliente encostaria o celular e cairia em erro.
- **UID opcional.** O identificador físico da TAG nunca é obrigatório: cada app
  de gravação mostra (ou não) esse dado num lugar diferente, e exigir isso
  travaria a maioria dos casos.
- **Histórico não some.** `table_nfc_events.tag_id` é `ON DELETE SET NULL`, não
  `CASCADE`: excluir a TAG preserva a auditoria.
- **Substituição com encadeamento:** a TAG nova nasce com `replaced_tag_id`
  apontando para a antiga, que é desativada em vez de apagada. É o mesmo modelo
  que atende várias TAGs por mesa, troca de TAG e QR + NFC na mesma placa.
- **Isolamento:** `anon` não alcança nada de NFC. Um trigger garante que a TAG
  pertence ao mesmo restaurante da mesa, fechando o caso de `restaurant_id`
  próprio + `table_id` de outro tenant.

Preparação (sem implementar): várias TAGs por mesa, substituição, histórico,
identificação, ativação/desativação e QR + NFC na mesma placa já funcionam.
Pedidos e pagamentos seguem fora de escopo.

### Carrinho e criação de pedidos (Etapa 6)

O cliente nunca digita dado sensível. Ele aponta a câmera (QR) ou encosta o
celular (NFC), o cardápio abre com a mesa já resolvida e o fluxo anda em cinco
passos: **escanear → escolher → adicionar → revisar → enviar**.

| Objeto | Papel |
| --- | --- |
| `public.orders` | cabeçalho do pedido: mesa, número curto, status, totais, observação |
| `public.order_items` | itens com `product_name_snapshot` e `unit_price_snapshot` |
| `public.restaurant_order_counters` | contador por restaurante (`next_order_number`) |
| `public.create_order(token, itens, obs)` | RPC `security definer` que valida e grava tudo |
| `public.get_table_order(token, número)` | releitura do **próprio** pedido (tela de sucesso) |
| `public.restaurant_orders` | view de leitura pronta para o painel da Etapa 7 |

- **O preço nunca vem do frontend.** O corpo aceito pelo servidor é só
  `{ product_id, quantity }` (+ observação). O `zod` descarta qualquer chave
  extra e a RPC lê o preço de `public_products` — a mesma view que o cardápio
  renderiza, que já filtra produto disponível, categoria ativa e restaurante
  publicado. Mandar `price: 0.01` no corpo não muda um centavo do total.
- **Snapshot, não ponteiro.** Nome e preço unitário são copiados para o item.
  Mudar o preço do X-Bacon para R$ 99,90 depois não altera o pedido #1001: o
  histórico do salão e o caixa continuam batendo.
- **Mesa vem do token, sempre.** `create_order` resolve o token de novo a cada
  envio — mesa desativada, token de outra mesa ou restaurante pausado são
  recusados na hora. A tela nunca envia `table_id`.
- **Número curto por casa**, começando em 1001, para o atendente chamar
  "pedido 1001" em vez de um UUID.
- **Nada de pedido parcial.** Quantidade fora de 1..99, item esgotado, carrinho
  vazio ou observação acima de 300 caracteres abortam a transação inteira.
- **Carrinho vive no cliente** (`localStorage`, por token de mesa): não existe
  tabela de carrinho no banco. O que não foi enviado simplesmente não existe do
  lado do servidor — e trocar de mesa abre outro carrinho.
- **Anti-flood simples:** quatro pedidos da mesma mesa em 20 segundos bloqueiam
  o quinto. Não substitui rate limit de infraestrutura, mas segura o duplo
  toque e o script trivial.
- **Status:** `pending → confirmed → preparing → ready → delivered`, mais
  `cancelled`. O pedido nasce `pending` e fica assim até a equipe agir — por
  isso a tela de sucesso diz **"Aguardando confirmação."**
- **Tela de sucesso sobrevive ao reload.** O número fica no `localStorage` e o
  conteúdo é relido por `get_table_order`, que só devolve pedido daquela mesa.
- **`anon` não lê a tabela de pedidos.** A única porta é a RPC; a leitura por
  membro da equipe passa pela RLS (painel na Etapa 7).

Preparação (sem implementar): `channel` (`dine_in | takeaway | delivery`),
`fees`, `discount`, `customer_name` e `customer_phone` já existem no schema, com
`dine_in` e taxas zeradas. Adicionais, combos, pagamentos, Pix, WhatsApp,
impressão, chamada de garçom e pedido de conta ficam para as próximas etapas —
a interface reserva o encaixe (`#product-detail-options`) sem inventar regra.

### Painel de pedidos em tempo real (Etapa 7)

Do outro lado do balcão: o restaurante recebe, acompanha e move cada pedido
pelo celular, com o fluxo **novo → confirmado → em preparo → pronto → entregue**
(e cancelamento enquanto não finalizou).

| Objeto | Papel |
| --- | --- |
| `public.order_status_events` | histórico append-only, escrito por trigger em cada transição |
| `public.set_order_status(order, status)` | RPC que valida transição **e** vínculo de equipe |
| `public.list_restaurant_orders(...)` | lista paginada por status, com itens embutidos |
| `public.order_board_counts(...)` | os três números do dashboard numa consulta |
| `public.restaurant_orders` | view com `items` (jsonb) e `item_count` |

- **Histórico é do banco, não da aplicação.** Um trigger em `orders` grava cada
  mudança de status com autor (`auth.uid()`) e horário. Não existe caminho que
  mude status sem deixar registro — inclusive uma alteração feita direto no SQL.
  O pedido do cliente nasce com autor nulo, e isso é correto: quem pediu era
  `anon`, não um usuário do app.
- **Transição válida é regra do servidor.** `set_order_status` recusa pular
  etapa (pendente → entregue) e recusa voltar (entregue → em preparo). Esconder
  botão na tela é conveniência; a regra está onde não dá para contornar.
- **Tempo real de verdade, sem polling.** `orders` e `order_status_events` estão
  na publicação `supabase_realtime` com `replica identity full`. O painel assina
  o canal e, ao receber um evento, **relê** a lista pela RPC — o evento é o
  sinal, a RPC é a fonte de verdade (com itens, nome da mesa e RLS). Sem evento,
  zero consultas: não há `setInterval` em lugar nenhum.
- **Reconexão não deixa dado velho.** Se o canal cai (celular perdeu sinal, tela
  bloqueou), a tela mostra "sem conexão em tempo real" e, ao reconectar, refaz a
  leitura — senão os pedidos que chegaram no intervalo ficariam invisíveis.
- **Som é sintetizado, não baixado.** Dois tons com WebAudio: nada para carregar
  antes do primeiro "bi". O navegador só libera áudio depois de um gesto, então
  há um botão explícito "Ativar som" — e o painel funciona inteiro com o som
  mudo. Vibração (`navigator.vibrate`) entra quando o aparelho suporta.
- **Alerta não depende de cor.** Todo status tem ícone + texto + cor. O selo diz
  "Novo pedido", o sino acompanha, e o tempo de espera muda de rótulo quando
  passa de 15 min. Quem não distingue as cores lê a mesma informação.
- **Histórico não carrega tudo.** A lista ativa é curta por natureza; os
  finalizados chegam em páginas de 10 com cursor por `order_number` — que, ao
  contrário de `created_at`, não empata quando dois pedidos caem na mesma
  transação (caso de maior movimento, e o que a primeira versão errava).
- **Por mesa, sem tela nova.** As mesas com pedido vivo viram chips no topo da
  lista; tocar filtra. Um painel a mais só para ver "Mesa 04 tem 2 pedidos"
  seria navegação sem necessidade.
- **Só a equipe.** Leitura e escrita passam por RPC que confere
  `is_restaurant_member`, com RLS como segunda camada. Pedido de outro
  restaurante é indistinguível de pedido inexistente.

Preparação (sem implementar): push, som em dispositivo externo (impressora,
campainha de cozinha) e integração com WhatsApp ficam para as próximas etapas —
o alerta já nasce isolado em `src/lib/notify.ts`, com um ponto único de disparo.

---

### Chamar garçom e pedir a conta (Etapa 8)

O cliente sentado com o celular na mão não quer um produto — quer **atenção**.
Agora o cardápio da mesa tem uma barra fixa com três destinos:
**🛎 Garçom · 🛒 Carrinho · 💳 Conta**, sempre à mão durante a navegação.

| Objeto | Papel |
| --- | --- |
| `public.table_requests` | uma linha por pedido de atenção (`waiter` / `bill`) |
| `public.create_table_request(token, tipo, nota)` | cliente registra pelo **token da mesa** |
| `public.get_table_request_state(token)` | o que a tela do cliente deve mostrar agora |
| `public.set_table_request_status(id, status)` | equipe atende / resolve / cancela |
| `public.list_table_requests(...)` | fila do painel, mais antigas primeiro |
| `public.table_request_counts(...)` | contadores do painel e do dashboard |

- **Solicitação não é pedido.** Chamar garçom não tem valor, não vai para a
  cozinha e não vira linha em `orders`: é outra tabela, com ciclo de vida
  próprio (`pending → acknowledged → resolved`, ou `cancelled`). Misturar os
  dois faria o faturamento e a cozinha carregarem um conceito que não é deles.
- **A mesa vem do token, nunca do cliente.** `create_table_request` resolve
  `(restaurante, mesa)` por `resolve_table_token`. Não existe parâmetro de
  `table_id` — então não existe caminho para chamar garçom na mesa dos outros.
- **Anti-duplicata é índice, não `if`.** Um índice único parcial garante no
  máximo uma solicitação **viva** por (mesa, tipo). Dois toques simultâneos
  passam pelas duas leituras, mas só um `insert` vence. Tocando de novo, a RPC
  devolve a solicitação que já está na fila — a tela mostra "Solicitação já
  enviada" com o horário original, em vez de erro.
- **Cooldown cobre a metralhadora.** Depois de resolvida, a mesma mesa só pode
  chamar de novo após 120s (`table_request_cooldown_seconds()`). Curto o
  bastante para não atrapalhar, longo o bastante para conter toque repetido.
  O botão desabilitado com "Aguarde 45s" é conveniência: a regra mora no banco.
- **Confirmação antes de incomodar o salão.** Tocar em 🛎 abre um sheet com
  "Você deseja chamar um garçom para esta mesa?" e CANCELAR / CHAMAR GARÇOM.
  Ao confirmar, o retorno é "Garçom a caminho!"; na conta, "Conta solicitada!".
- **Tempo real também para as solicitações.** `table_requests` está na
  publicação `supabase_realtime` com `replica identity full`; o painel assina
  `table-requests:{restaurantId}`, relê pela RPC ao receber evento e não faz
  polling (há só um relógio de 30s que repinta o "Há X minutos").
- **O painel mostra a fila, não um histórico.** Seção SOLICITAÇÕES com contador
  "🔴 2 solicitações pendentes", card por mesa (ícone + tipo + "Há 1 minuto" +
  nota), ação **[ATENDER]** que vira **[MARCAR COMO RESOLVIDO]**. Resolvida sai
  da lista; a linha fica no banco para auditoria. A seção some quando a fila
  zera, para não ocupar a primeira dobra do salão com um bloco vazio.
- **Atender direto é permitido.** Numa casa pequena o garçom chega na mesa e já
  resolve; obrigar o passo intermediário seria burocracia que ninguém cumpre.
  O que o banco recusa é reabrir ou mudar uma solicitação encerrada.
- **Alvos de toque e área segura.** Os três botões da barra têm 56px de altura,
  `min-w-0` e `flex` (cabem em 320px sem largura fixa), e a barra respeita
  `env(safe-area-inset-bottom)`.

Verificação da etapa: **27 checagens SQL** no banco vivo (fluxo completo do
roteiro, cooldown, anti-duplicata, token inválido, mesa desativada, isolamento
entre duas casas, publicação de tempo real) e **64 checagens de UI** em jsdom
(41 de comportamento + 23 de tempo real e layout em 320px).

---

### Personalização visual do cardápio (Etapa 9)

Cada restaurante escolhe a própria cara — logo, capa, cinco cores, estilo de
card e de botão — na tela **Personalizar cardápio** (`/app/configuracoes/personalizacao`),
com preview de celular atualizando ao vivo.

| Objeto | Papel |
| --- | --- |
| `public.restaurant_themes` | uma linha por restaurante (PK = `restaurant_id`) |
| `public.public_restaurant_themes` | view do cardápio público, só com as colunas do tema |
| `public.save_restaurant_theme(...)` | upsert validado (hex, estilos, URL do próprio tenant) |
| `public.reset_restaurant_theme(uuid)` | apaga a personalização e volta ao padrão |
| `src/lib/theme.ts` | presets, contraste, tokens e CSS vars (módulo neutro) |

- **O tema não é `settings`.** Jsonb livre não valida cor: aqui as cinco cores
  são colunas com `check` de `#rrggbb`, `card_style`/`button_style` têm lista
  fechada e `PK = restaurant_id` impede tema duplicado ou órfão. Valor inválido
  é recusado pelo banco, não "tratado" na tela.
- **Uma fonte de verdade para a aparência: variáveis CSS.** O cardápio público
  não usa `bg-brand-600`; usa `--mv-primary`, `--mv-bg`, `--mv-button`… O
  `ThemeScope` no topo da página define as 17 variáveis, e o mesmo
  `themeTokens()` alimenta o preview do painel. Preview e produção não podem
  divergir porque são o mesmo cálculo.
- **Contraste é regra, não sugestão.** Texto sobre o fundo e texto do botão são
  **derivados** por contraste (WCAG 4.5:1): se o dono escolher cinza-claro sobre
  branco, o cardápio continua legível. A tela de cores mostra a razão medida.
- **Seis temas prontos.** Moderno, Elegante, Dark, Minimalista, Restaurante e
  Fast food — cada um preenche tudo (nada de tema "meio configurado") e serve
  como ponto de partida para ajuste fino.
- **Estilos de card e de botão.** `rounded | soft | flat` mudam raio e sombra
  dos cards; `solid | outline | pill` mudam o preenchimento e o raio dos
  botões. Botão "outline" é fundo da superfície + borda na cor do botão.
- **Upload otimizado no navegador.** PNG/JPG/WEBP, até 8 MB no original: a
  imagem é validada por **assinatura de arquivo** (renomear `.exe` para `.png`
  não passa), redimensionada com `canvas` para 320×320 (logo) ou 1600×900
  (capa) e só então enviada em WebP. O arquivo não passa por Server Action.
- **Segurança em três camadas.** O caminho é sempre
  `{restaurant_id}/theme/...`; a policy do Storage exige `is_restaurant_admin`
  naquele primeiro segmento; e a RPC recusa URL que não aponte para a pasta do
  próprio restaurante. `anon` não lê a tabela — só a view pública.
- **Fallback é leitura, não escrita.** Quem nunca personalizou não ganha linha:
  `normalizeTheme(null)` devolve o tema padrão (Moderno) e o cardápio abre
  igual. "Nunca personalizou" continua distinguível de "personalizou igual ao
  padrão", e o botão *Restaurar tema padrão* só apaga a linha.
- **Mobile primeiro.** Preview fixo no topo no formato de um celular
  (320×620), três abas (Temas · Cores · Estilo), accordions para o que é
  secundário, inputs de 48 px e a barra de **Salvar** fixa no rodapé. Nada é
  gravado até salvar — dá para testar dez paletas e desistir.
- **Sem quebra de performance.** O tema é um `style` inline (nenhum CSS novo por
  restaurante, nenhum rebuild), as imagens já saem no tamanho usado e a página
  pública continua com `revalidate = 60` — as ações chamam `revalidatePath` para
  o tema novo aparecer na hora.

Verificação da etapa: **25 checagens SQL** no banco vivo (upsert, view pública,
isolamento entre duas casas, staff sem escrita, hex/estilo/preset inválidos, URL
externa e de outro tenant recusadas, bucket sem SVG, realtime) e **135
checagens automatizadas** — 59 de lógica/segurança do tema, 15 de upload, 51 de
UI em jsdom e 18 de renderização SSR do cardápio.

---

### Painel master do administrador da plataforma (Etapa 10)

Existem dois tipos de usuário, e o banco sabe disso: **quem pertence a um
restaurante** (`restaurant_users`) e **quem administra a plataforma**
(`platform_admins`). O segundo entra em `/admin` e enxerga todas as casas.

| Objeto | Papel |
| --- | --- |
| `public.platform_admins` | quem tem acesso global — tabela própria, não um papel de restaurante |
| `public.is_platform_admin()` | guarda de toda leitura e escrita do painel |
| `public.admin_dashboard()` | nove contadores globais em uma linha |
| `public.admin_list_restaurants(search, status)` | lista com busca por nome, slug, telefone e responsável |
| `public.admin_restaurant_detail(id)` | as sete seções da casa em um `jsonb` |
| `public.admin_set_restaurant_status(...)` | ativa, desativa e suspende (com motivo obrigatório) |
| `public.admin_audit_log` | histórico append-only de ações administrativas |

- **Ser admin da plataforma não é um papel de restaurante.** Se `admin` fosse
  mais um valor em `restaurant_member_role`, um dono que criasse o próprio
  vínculo com esse papel ganharia poder global. Por isso a autorização mora em
  tabela separada, e `is_platform_admin()` nunca olha para `restaurant_users`.
- **Nenhuma policy nova abre as tabelas para o admin global.** A leitura do
  painel passa por funções `security definer` que devolvem listas já recortadas
  e repetem `is_platform_admin()` a cada chamada. RLS continua fechada por
  tenant: o admin não "vira" membro de ninguém, ele consulta por um caminho
  explícito e auditável. Um `select` copiado para outra tela não vira porta
  aberta.
- **Suspender é um cadeado, não um rótulo.** O dono pode `update` a própria
  linha em `restaurants` (a policy permite), então um status `suspended` no enum
  sozinho seria decorativo: bastaria ele mesmo gravar `published` de volta. O
  trigger `guard_restaurant_admin_fields` fecha os dois sentidos — nem suspender
  a si mesmo, nem sair da suspensão. Só a plataforma passa.
- **Suspensão tem três superfícies, com textos diferentes.** O cardápio público
  do cliente (`/r/...` e `/r/.../table/...`) diz que está fora do ar e manda
  chamar um atendente; o painel do restaurante mostra uma tela com **o motivo
  escrito pelo admin** e a informação de que nada foi apagado; a lista do
  `/admin` mostra o motivo em vermelho. Nenhuma delas é um 404 seco, e a função
  pública que revela o motivo (`public_restaurant_state`) devolve **só o
  status** — nunca telefone, equipe ou configurações.
- **Quatro papéis, com uma linha de diferença que importa.** `owner`, `admin`,
  `manager` e `staff` já existem no banco. Gerente é admin **operacional**
  (cardápio, mesas, pedidos, tema) e não mexe na equipe: isso é
  `is_restaurant_owner_admin`, e as policies de `restaurant_users` passaram a
  usá-la — senão um gerente poderia se promover a dono.
- **Auditoria é append-only de verdade.** A tabela tem RLS com apenas `select`
  para admin global: nenhuma policy de insert, update ou delete. Quem grava são
  funções `security definer`, e o autor vem de `auth.uid()` dentro do banco — um
  `actor_id` vindo do payload permitiria forjar autoria. Nem o próprio admin
  reescreve o passado pelo cliente.
- **Acesso de suporte deixa rastro antes de abrir.** O botão "Abrir cardápio
  público" chama `logSupportAccess` e só abre a aba **depois** que o registro
  volta com sucesso: se a auditoria falha, o acesso não acontece. É o que faz a
  trilha valer alguma coisa.
- **Último owner é protegido.** Rebaixar ou bloquear o único proprietário ativo
  é recusado pelo banco (`last_owner`): uma casa sem dono fica órfã, e o suporte
  não deveria conseguir fazer isso por acidente.
- **Plano é modelo, não cobrança.** `plan_id`, `subscription_status`,
  `subscription_start` e `subscription_end` já existem, com catálogo em
  `plans`. Nada cobra nesta etapa; as colunas existem para a Etapa 11 não
  precisar migrar dados com pressa. E o trigger impede o dono de trocar o
  próprio plano.
- **Mobile primeiro, cinco abas.** Início · Casas · Usuários · Pedidos · Ajustes,
  com fundo escuro (sinal permanente de "você está na plataforma, não no seu
  restaurante"), cards de toque largo, busca com acento normalizado e filtros
  que mostram contagem. Os cards de "suspensos" e "inativos" do dashboard são
  atalhos para a lista já filtrada — número sem ação não resolve nada.

Verificação da etapa: **58 checagens SQL** no banco vivo (contadores, busca por
nome/slug/telefone/e-mail, isolamento entre duas casas, RLS com role trocada,
dono sem acesso ao painel, cadeado da suspensão nos dois sentidos, auditoria por
trigger, último owner, slug duplicado e auditabilidade) e **145 checagens
automatizadas** — 58 de lógica/segurança, 62 de UI em jsdom, 25 de SSR.

---

### Planos e assinaturas (Etapa 11)

A pergunta que esta etapa responde não é "quanto custa", é **"quem decide que
esta casa pode criar a mesa 51?"**. A resposta é o banco, e o desenho todo segue
daí.

| Objeto | Papel |
| --- | --- |
| `plans` | Catálogo: nome, descrição, preço, intervalo, `features` (jsonb), `limits` (jsonb), ativo, posição |
| `subscriptions` | Histórico comercial: plano, status, período, trial, cancelamento, ids do gateway, **preço congelado** |
| `platform_settings` | `trial_days` e `grace_days`, editáveis no painel |
| `billing_events` | Caixa de entrada de webhooks (vazia até existir gateway) |
| `enforce_plan_limit()` | Trigger que recusa o insert acima do limite |
| `enforce_subscription_active()` | Trigger que recusa escrita com assinatura sem acesso |
| `sync_restaurant_subscription()` | Espelha a assinatura corrente em `restaurants` |
| `restaurant_usage` / `check_plan_limit` / `has_feature` | Aritmética única de uso, limite e recurso |
| `my_subscription`, `public_plans` | Leitura do dono e vitrine pública |
| `admin_save_plan`, `admin_toggle_plan`, `admin_set_subscription`, `admin_set_platform_setting`, `run_subscription_review` | Administração comercial |

- **O limite mora no plano, nunca no código.** `plans.limits` tem chaves estáveis
  (`max_products`, `max_tables`, `max_users`, `max_categories`,
  `max_orders_month`). Mudar 50 para 80 no `/admin/planos` muda o que o banco
  permite no próximo insert — sem deploy. Plano **sem** a chave é plano sem
  limite; nunca é zero.
- **Limite é trigger, não `check`.** Um `check` no insert não sabe quantas mesas
  a casa já tem, e um `check` em `tables` não pode ler `plans` sem criar
  dependência circular. O trigger consulta o plano e a contagem **na mesma
  transação** e vale para qualquer caminho: Server Action, PostgREST direto ou
  SQL na mão.
- **A plataforma também não fura o limite.** O trigger não abre exceção para
  admin global: se a plataforma precisa destravar um cliente, ela troca o plano
  dele — decisão registrada na auditoria, não furo silencioso.
- **Downgrade respeita o uso.** `change_plan` recusa cair para um plano cujo
  limite já está estourado (`plan_downgrade_too_small`). Sem isso a casa ficaria
  acima do próprio plano e o próximo insert falharia com erro de banco sem
  explicação.
- **Assinatura tem tabela própria e o restaurante guarda um espelho.**
  `subscriptions` é o histórico (troca de plano, cancelamento, trial);
  `restaurants.plan_id`/`subscription_state` é o atalho que a RLS, o layout e o
  cardápio leem sem join. O trigger `sync_restaurant_subscription` é o **único**
  lugar que escreve o espelho — e ele marca a transação para o guard não
  confundir sincronização interna com o dono tentando trocar o próprio plano.
- **Trial é derivado, não digitado.** Quem inicia o teste não escolhe a data
  final: ela vem de `platform_settings.trial_days`. Casa nova ganha trial
  automaticamente pelo trigger `restaurants_grant_trial`.
- **Assinatura sem acesso tranca o painel, não o salão.** `expired`,
  `cancelled` e `suspended` levam à tela de aviso com o caminho para `/planos`;
  `past_due` continua entrando — casa em atraso está operando, e travar o salão
  por uma fatura em processamento custa mais caro que a mensalidade. **Pedidos
  nunca são bloqueados**: o cliente na mesa não tem culpa da cobrança.
- **Gateway é contrato, não simulação.** `src/lib/billing` define
  `PaymentProvider` com as seis funções do escopo (`createCustomer`,
  `createSubscription`, `cancelSubscription`, `changePlan`,
  `getSubscriptionStatus`, `handleWebhook`). O único provedor implementado é
  `manual`, que é honesto: não chama rede, não inventa `sub_123`, devolve
  `requiresProvider: true` e diz na tela que a cobrança não existe nesta versão.
  Trocar de provedor é `PAYMENT_PROVIDER` no ambiente.
- **A vitrine é pública e curva de comparação não existe.** `/planos` sai sem
  sessão com cards **verticais**, um por linha no celular: nome, preço, recursos
  com ✓ e "Começar agora". Tabela de seis colunas em 320px é ilegível — o escopo
  proíbe, e a razão é boa.

Verificação da etapa: **26 checagens SQL** no banco vivo, com um restaurante
sintético criado e apagado na mesma transação (plano com 2 mesas → terceira
recusada; produto acima do limite recusado; upgrade liberando insert; assinatura
expirada, cancelada e suspensa bloqueando escrita; **pedido do cliente seguindo
permitido**; RPC de admin recusando quem não é admin; preço e limite negativos
recusados; revisão expirando trial e marcando atraso; auditoria registrando tudo)
e **169 checagens automatizadas** — 72 de lógica, 56 de UI em jsdom e 41 de SSR.
A suíte SQL também encontrou dois bugs reais, corrigidos na hora: `suspended`
não estava na lista de bloqueio de escrita e apagar um restaurante com
assinatura esbarrava no guard do plano.

---

## PWA (Etapa 12)

O app é instalável no Android e no iPhone. Nada disso é "telefone falso": o
manifesto é servido por rota com `content-type: application/manifest+json`, os
ícones são PNG reais em 192 e 512 (mais variante **maskable**, para o Android não
recortar o logo), e o service worker é versionado pelo **hash do próprio
conteúdo** — uma correção de cache chega ao aparelho no deploy seguinte.

### O que o app guarda no aparelho

A regra que governa todo o cache é uma só: **guardar o que é igual para todo
mundo, nunca o que depende de quem está pedindo**. Uma resposta em cache não
passa por RLS, cookie de sessão nem middleware — no aparelho compartilhado de um
salão, o próximo a abrir veria o que ficou guardado.

| O quê                                         | Estratégia      | Por quê |
| --------------------------------------------- | --------------- | ------- |
| `/_next/static/*`, `/icons/*`, `/fonts/*`     | cache primeiro  | nome tem hash; o conteúdo nunca muda |
| Fotos públicas de produto (Storage do Supabase) | cache primeiro | maior ganho de carga do cardápio |
| `/r/[slug]` (cardápio público)                 | rede primeiro   | preço e prato mudam; cache é só a rede de segurança |
| `/app`, `/admin`, `/onboarding`, `configuracoes` | **rede pura** | resposta depende da sessão |
| `*.supabase.co` (API e auth)                   | **rede pura**   | resposta depende do usuário ou do token |
| `/api`, `/auth`, pedido, carrinho              | **rede pura**   | dado de pedido em cache = pedido errado |
| Qualquer `POST`/`PUT`/`PATCH`/`DELETE`         | rede pura       | escrita em cache é bug de dados |

Os caches têm teto (80 estáticos, 24 páginas, 120 fotos) e poda pelas entradas
mais antigas: celular tem pouco espaço e o sistema despeja cache grande.

Sem rede, navegar para uma tela do painel mostra o `offline.html` (guardado no
`install`, sem dado de ninguém) em vez do erro nativo do navegador — que no
iPhone parece que o app quebrou. O cardápio público já visitado continua
abrindo, e o que o cliente montou no carrinho vive em estado do React: nada
disso passa pelo service worker.

### Atualização

O SW novo fica em `waiting` — **não** assume sozinho, porque recarregar no meio
de um pedido é pior que ficar uma versão atrás. A página mostra "Nova versão
disponível · Atualizar" com o botão que envia `SKIP_WAITING`; se a pessoa
ignorar, o app segue funcionando e a atualização entra na próxima abertura. No
`activate` os caches de versões anteriores são apagados.

### Convite para instalar

Aparece a partir da **segunda visita**, nunca em modo standalone e nunca depois
de dispensado (30 dias, em `localStorage`). No Android, o botão usa o
`beforeinstallprompt` quando o navegador permite; no iPhone o texto explica o
caminho real do Safari (*Compartilhar → Adicionar à Tela de Início*), porque o
iOS não expõe API de instalação. O texto é um só em `src/lib/pwa.ts` — a tela e
o teste leem a mesma fonte.

### Arquivos

| Arquivo | Papel |
| ------- | ----- |
| `src/lib/pwa.ts` | **Fonte única**: nome, cores, `start_url`, ícones, regras de cache, textos do convite |
| `src/app/manifest.webmanifest/route.ts` | Manifest gerado a partir dessa fonte |
| `src/app/sw.js/route.ts` | Serve o SW com versão carimbada e `Cache-Control: must-revalidate` |
| `src/sw-source.js` | O service worker (JS puro — não é transpilado) |
| `public/offline.html` | Tela de "sem conexão", autocontida e sem CSS externo |
| `src/components/pwa/` | Registro do SW, convite de instalação, aviso de atualização |
| `scripts/generate-icons.mjs` | Gera os 6 PNGs a partir do logo (`node scripts/generate-icons.mjs`) |

### Verificação

```bash
npm run build && npm start          # em outro terminal
node scripts/audit-layout.mjs       # rotas, alvos de toque e pacote PWA
node .arena-test/pwa-lib.cjs        # regras de cache e textos
node .arena-test/pwa-ui.cjs         # convite e aviso de atualização (jsdom)
node .arena-test/pwa-nav.cjs        # navegação inferior em 320–430px
node .arena-test/pwa-sw.cjs         # service worker rodando em ambiente simulado
node .arena-test/pwa-ssr.cjs        # manifest, ícones e <head> servidos de verdade
node .arena-test/pwa-security.cjs   # nada de credencial, nada sensível em cache
```

Os harnesses de UI precisam de `npm install --no-save jsdom esbuild`.

**Checklist que exige aparelho** (o resto é automatizado): instalar pelo Chrome
Android e pelo Safari iPhone, abrir pelo ícone sem a barra do navegador, fazer
login dentro do app instalado, abrir o cardápio público e o QR de uma mesa,
receber um pedido com o app aberto, perder o sinal de propósito e conferir a
tela de aviso, e atualizar o app depois de um deploy.

---

## WhatsApp (Etapa 13)

O restaurante liga um WhatsApp e o cardápio público ganha o botão **Falar no
WhatsApp**. Ao tocar, o WhatsApp abre com a mensagem inicial já escrita; quem
envia é o cliente.

### O que a integração é — e o que ela não é

O mecanismo é o link `wa.me`, que é oficial e não precisa de API, token nem
conta aprovada. A consequência precisa ser dita em voz alta, porque é onde a
maioria das implementações mente para o dono do restaurante:

| | `wa.me` (o que existe hoje) | WhatsApp Business API (o que não existe) |
|---|---|---|
| Quem envia | a pessoa, tocando no botão | o servidor |
| O sistema sabe se saiu | **não** | sim (status de entrega/leitura) |
| Recebe resposta | **não** | sim (webhook) |
| Confirma pedido / avisa status | **não** | sim |
| Precisa de | nada | número verificado, conta aprovada, template |

Não há integração falsa: nenhuma função do sistema devolve "mensagem enviada"
quando nada foi enviado. O provedor da API oficial existe como
`unconfiguredCloudWhatsappProvider` e responde `provider_not_configured` — é o
lembrete de que ligar a integração real é escrever `cloud.ts`, não trocar uma
variável de ambiente.

### Configuração

Em `Configurações → WhatsApp`:

- **número** — qualquer formato (`(11) 99999-0000`, `011 99999-0000`,
  `+55 11 99999-0000`, `11 99999-0000 ramal 22`), normalizado para
  `5511999990000`. O banco guarda o normalizado, nunca o texto digitado;
- **mensagem inicial** — até 350 caracteres; a prévia mostra o link exato que o
  cliente vai receber, com botão para copiar;
- **interruptor** — desligar tira o botão do cardápio na hora, sem apagar
  número nem mensagem.

O número é validado duas vezes: em `src/lib/whatsapp.ts` (navegador, retorno
imediato) e em `save_whatsapp_settings` (banco, incluindo DDD válido — 11 a 99,
não múltiplo de 10). As duas implementações são testadas, e a do banco é a que
decide.

### O botão no cardápio

Fica no rodapé do cardápio público (`/r/{slug}` e `/r/{slug}/table/{token}`),
abaixo do cardápio e dos horários. Alvo de 56px, verde `#25d366` com texto
escuro (contraste 8:1; texto branco nesse verde daria 1.9:1 e reprovaria AA).

É um `<a href>`, não um `onClick`: funciona sem JavaScript, o toque longo
oferece "copiar link" e leitor de tela anuncia o destino. O `aria-label` diz com
quem é a conversa, e o texto **não** promete envio.

### Quem pode ver

O botão só aparece quando todas valem: interruptor ligado, número válido, casa
publicada **e** plano com o recurso `whatsapp` (Profissional e Premium). A
checagem do plano roda no banco (`public_whatsapp_config`), então ela não vira
dado no HTML nem decisão da tela. Desligar o plano esconde o botão sem apagar a
configuração — voltar o plano faz ele reaparecer.

### Preparação para a API oficial

A estrutura já existe e **nada a consome** (é o que o escopo pede):

| Peça | Onde | Estado |
| --- | --- | --- |
| Fila de mensagens | `whatsapp_messages` | criada, `status = 'queued'`, sem processo que envie |
| Tipos do escopo | enum `whatsapp_message_kind` | `order_created`, `order_status`, `order_confirmed`, `marketing`, `winback`, `contact` |
| Idempotência | `dedupe_key` unique por casa | evita "pedido confirmado" em duplicidade |
| Consentimento | `whatsapp_settings.terms_accepted_at` | gravado quando o canal é ligado; preservado ao desligar |
| Texto do pedido | `buildOrderMessage()` | testado contra o exemplo do escopo; **não chamado na UI** |
| Contrato do provedor | `src/lib/whatsapp/provider.ts` | `link` (hoje) e `cloud` (não configurado) |

A mensagem de pedido — restaurante, número, mesa, itens, quantidades e total —
está pronta e testada:

```
Olá, gostaria de informações sobre o pedido #1042.

Mesa: 04

2x X-Bacon
1x Batata

Total: R$ 79,70

— Cantina da Praça
```

Ela **não é enviada em lugar nenhum nesta etapa**. Quando a Cloud API entrar, o
provedor novo usa o mesmo `buildOrderMessage` e grava em `whatsapp_messages`;
a tela não muda de contrato.

### Dado de demonstração

O restaurante `famintos` tem uma configuração real em `whatsapp_settings`
(número `5511987654321`, mensagem padrão, canal ligado). **Não é lixo de teste —
é ela que mantém o botão visível no cardápio de produção**, e foi uma decisão
consciente mantê-la. Remover essa linha tira o botão do ar; se for removê-la,
remova sabendo disso.

### Segurança

- `whatsapp_settings` tem RLS: `anon` não lê a tabela; `authenticated` só vê a
  própria casa. O cardápio usa a RPC `public_whatsapp_config`, que devolve
  **linha nenhuma** quando o botão não deve existir — não há "campo vazio" para
  a tela interpretar errado.
- A fila `whatsapp_messages` não tem policy de escrita: nenhum navegador forja
  uma mensagem.
- A Server Action ignora qualquer `restaurantId` do corpo e usa o vínculo ativo
  do servidor; `save_whatsapp_settings` recusa quem não é admin da casa.
- Nenhum token, chave ou credencial nesta etapa — não há integração que precise
  de credencial. Quando houver, ela mora em variável de ambiente do servidor,
  nunca no banco nem no frontend.

### Verificação

```bash
node .arena-test/whatsapp-lib.cjs   # 103 · número, link, mensagem, recusas
node .arena-test/whatsapp-ui.cjs    # 56 · botão e formulário em jsdom
node .arena-test/whatsapp-ssr.cjs   # 51 sem servidor · 57 com servidor
```

O `whatsapp-ssr` só roda a parte HTTP quando encontra um servidor em
`http://localhost:3000` (ou na URL passada como argumento); sem um, são 51
checagens. `esbuild` e `jsdom` entram com `npm install --no-save`.

**Conferido em aparelho** (Android e iPhone, cardápio de produção): tocar no
botão abre o WhatsApp no número configurado com a mensagem já escrita; o
formulário do painel fica utilizável com o teclado aberto; e desligar o canal
remove o botão do cardápio em menos de um minuto — sem apagar número nem
mensagem, então religar traz o botão de volta. O que segue exigindo aparelho é só
*enviar* a mensagem: isso é do app do WhatsApp, não da plataforma.

---

## Produção (Etapa 14)

Preparação para ambiente real: ambientes separados, domínio próprio, headers de
segurança, limite de requisições, páginas de erro e diagnóstico. O passo a passo
operacional está em **[docs/AMBIENTES.md](docs/AMBIENTES.md)**; aqui ficam as
decisões.

### Ambientes

`NEXT_PUBLIC_APP_ENV` distingue os três, e existe porque **a Vercel roda staging
com `NODE_ENV=production`**. Sem a variável, um preview se comportaria como
produção: mandaria HSTS de um ano e redirecionaria `www` — num domínio de teste
que ainda não tem todos os subdomínios em HTTPS, isso tranca o time fora.

Staging compartilha o banco de produção (dívida consciente: plano gratuito, sem
branch de banco). A consequência está escrita no doc: nada de migration
destrutiva a partir de preview.

### HTTPS, `www` e domínio canônico

O middleware redireciona `http → https` (308) e `www.<domínio> → <domínio>`.
As duas regras são desligadas em `development` e não se aplicam a
`*.vercel.app` — sem essa guarda, um preview redirecionaria para fora de si
mesmo.

**HSTS exige produção *e* HTTPS real.** As duas condições, não uma: mandar HSTS
numa resposta `http://` faz o navegador passar a exigir HTTPS naquele host, e
`localhost` para de responder até alguém limpar o cache do navegador. Esse bug
existiu no primeiro commit desta etapa e o harness pegou —
`staticSecurityHeaders({ production: true, https: false })` não emite o header.

### Ordem de decisão da origem pública

Uma função (`resolveSiteOrigin`) responde por QR Code, `canonical`, sitemap e
link de e-mail. Antes eram quatro implementações, e elas divergiam:

1. `NEXT_PUBLIC_SITE_URL`, se válida (https fora de dev);
2. o host da requisição, **se confiável** — domínio configurado, `*.vercel.app`,
   localhost ou `TRUSTED_EXTRA_HOSTS`;
3. nada, e o chamador decide.

O passo 2 evita que esquecer a variável gere QR Code apontando para
`menuvo.app`. O passo 3 existe porque devolver um domínio que não é o nosso é
pior que devolver nada — QR Code errado só se descobre impresso. Testes cobrem
host forjado, `http://` em produção e caminho na URL.

### Headers de segurança e CSP

`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
`Permissions-Policy` fechando câmera/microfone/geolocalização, HSTS em
produção, `Cross-Origin-Opener-Policy` e CSP.

A CSP tem **duas políticas**, e a diferença é deliberada:

| Rota | `script-src` | Por quê |
| --- | --- | --- |
| app, admin, login | `'self' 'nonce-…' 'strict-dynamic'` | páginas já são dinâmicas; nonce sai de graça |
| `/r/...` (cardápio) | `'self' 'unsafe-inline'` | ISR: nonce por resposta forçaria renderizar a cada visita |

No cardápio, a proteção que não depende de nonce continua toda ativa:
`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
`frame-ancestors 'none'` e `connect-src` limitado ao próprio site + Supabase.
Trocar cache por nonce ali é o trade-off errado para um cardápio que precisa ser
rápido no 3G do salão.

Os headers estáveis também vivem no `next.config.ts`, porque o matcher do
middleware exclui `sw.js`, `manifest.webmanifest` e `offline.html` de propósito
(Etapa 12) — sem duplicar no config, essas rotas sairiam sem `nosniff`, e
`offline.html` é justamente a página que aparece quando a rede caiu.

### Limite de requisições

`src/lib/rate-limit.ts`, contador em memória do processo:

| Balde | Limite | Por quê |
| --- | --- | --- |
| login | 10 / 5 min | errar a senha 2–3 vezes é normal; força bruta deixa de valer a pena |
| cadastro | 5 / hora | cadastro em massa polui o banco |
| recuperar senha | 5 / hora | cada chamada custa e-mail e incomoda a caixa do usuário |
| criar pedido | 30 / min | o banco já tem anti-duplicata; isto barra varredura de tokens |

**É limite de rajada, não de cota.** Cada instância serverless tem o seu mapa, e
reciclagem de instância esquece o histórico. Para garantia distribuída, um Redis
atrás da mesma interface. Está escrito no topo do módulo porque o contrário seria
prometer o que o código não faz.

O cardápio público **não** é limitado: é cacheado, e todo mundo atrás do Wi-Fi
do restaurante sai com o mesmo IP público — limitar ali puniria o cliente certo.

### Páginas de erro

| Situação | Arquivo | O que o visitante vê |
| --- | --- | --- |
| 404 genérico | `src/app/not-found.tsx` | "Página não encontrada" |
| restaurante não encontrado | `src/app/r/[slug]/not-found.tsx` | "Cardápio não encontrado" |
| mesa não encontrada | `src/app/r/[slug]/table/[token]/not-found.tsx` | "Não encontramos esta mesa" |
| restaurante suspenso | `MenuUnavailable reason="suspended"` | "Cardápio temporariamente indisponível" |
| 500 no cardápio | `src/app/r/[slug]/error.tsx` | "Não conseguimos abrir o cardápio" |
| 500 no painel | `src/app/app/error.tsx`, `admin/error.tsx` | mantém sessão, oferece voltar |
| 500 no layout raiz | `src/app/global-error.tsx` | página autossuficiente, CSS inline |

Nenhuma mostra mensagem de exceção, stack ou nome de tabela. Só o `digest`, que
casa com o log do servidor sem entregar o mapa do sistema a quem está olhando a
tela.

A tela de mesa é **a mesma** para token inválido, mesa desativada e casa
fechada. Diferenciar transformaria o endereço num oráculo: bastaria varrer
tokens para descobrir quais existem, e um token válido dá acesso ao pedido
daquela mesa.

### Performance do cardápio

- **Cliente Supabase sem cookies** (`lib/supabase/public.ts`) para as leituras
  públicas. `createClient()` lia `cookies()`, e no App Router ler cookie torna a
  rota dinâmica — o cardápio nunca pôde ser cacheado. Continua sendo a anon key
  com RLS: a diferença é não haver JWT de usuário, ou seja, o papel mais
  restrito do banco.
- **Code splitting** dos três painéis (detalhe, carrinho, garçom): só aparecem
  depois de um toque.
- `/_next/static` imutável por um ano (hash no nome), AVIF/WebP nas fotos,
  cache de 31 dias para imagem de produto.
- `console.log` removido do bundle de produção (`error`/`warn` ficam).

**O cardápio passou de `ƒ` para `●`.** Foram **duas** causas, e eu só tinha
achado a primeira:

1. `createClient()` lia `cookies()` em toda leitura pública → cliente sem
   cookies (`lib/supabase/public.ts`);
2. `revalidate` sozinho não faz nada numa rota com parâmetro dinâmico que não
   declara nenhum caminho — sem `generateStaticParams`, o Next não tem o que
   pré-renderizar e trata a rota como dinâmica. Foi confirmado com uma rota de
   teste: mesma página, `○`/`ƒ` sem a função e `●` com ela.

O `build` mostra `● /r/[slug]  1m  1y`: ISR revalidando a cada minuto. A rota de
mesa (`/r/[slug]/table/[token]`) continua `ƒ` de propósito — o token não é
enumerável, e listá-lo num build seria expor as mesas de todo mundo.

O `generateStaticParams` lista as casas publicadas no momento do build; casa que
publicar depois entra na primeira visita e passa a ser cacheada igual. Falha de
banco no build devolve lista vazia e a rota volta a ser dinâmica: degradar é
melhor que não subir.

### SEO

`title` dinâmico (nome do restaurante), `description` composta de campos
públicos com corte em 160 caracteres, Open Graph com `metadataBase`, favicon e
ícones, `canonical` por cardápio, `robots.txt` bloqueando área autenticada e
`sitemap.xml` listando só casas publicadas.

`metadataBase` vem de `NEXT_PUBLIC_SITE_URL`, não de `headers()` — a primeira
tentativa usou `headers()` e o custo apareceu no build: a rota virou dinâmica e
o ISR morreu. Nunca expõe `settings`, e-mail da conta, id interno ou plano.

---

## Analytics e relatórios (Etapa 16)

Módulo de métricas por restaurante em `/app/analytics` e visão global da
plataforma em `/admin/analytics`. O passo a passo de dados e permissões está em
**[docs/AMBIENTES.md](docs/AMBIENTES.md)**; aqui ficam as decisões.

### Pedido não é pagamento

O escopo pede para diferenciar "valor dos pedidos" de "valor efetivamente pago"
e proíbe marcar pedido como pago sem confirmação real. O produto não tinha
**nenhum** registro de pagamento até esta etapa — nem tabela, nem coluna — então
"quanto entrou hoje?" era uma pergunta sem resposta no banco.

A tentação seria `orders.paid boolean` marcado `true` quando o status vira
`delivered`. Isso mente em três situações reais: cliente que saiu sem pagar,
conta dividida entre duas pessoas e pagamento em dois métodos. Por isso o
caminho escolhido foi um livro (`order_payments`): cada linha é um valor que
entrou, com método, horário e quem lançou. `paid` é **derivado** da soma, nunca
digitado, e `delivered` continua sendo só o estado da cozinha.

| Conceito | De onde sai | O que responde |
| --- | --- | --- |
| `orders_value` | soma de `orders.total`, sem cancelados | "quanto pediram" |
| `paid_value` | soma de `order_payments` com `status = 'paid'` | "quanto entrou" |
| `unpaid_value` | `orders_value − pago por pedido` | "quanto há a receber" |

Os dois números divergem de propósito, e em duas dimensões: cancelamento (pedido
existe, dinheiro não) e tempo (`orders_value` conta por `created_at`,
`paid_value` por `paid_at` — pedido de março pago em abril aparece em março como
venda e em abril como caixa).

### O que a tela responde

Faturamento (pedido x recebido x a receber), pedidos, ticket médio, cancelados,
itens vendidos, vendas e pedidos por dia, horários de pico, produtos e
categorias mais vendidos, mesas com maior volume, formas de pagamento, chamadas
de garçom e pedidos de conta, pedidos por status e comparação com o período
anterior.

Filtros: hoje, ontem, últimos 7, últimos 30, este mês, mês anterior e
personalizado (até 1 ano).

### Gráficos sem biblioteca

Não havia biblioteca de gráficos instalada, e o escopo diz para usar uma "caso já
exista". Adicionar Recharts custaria ~100 kB gzip para desenhar quatro séries de
barras — contra o item 6 do escopo (menos JS). O módulo inteiro são 12 kB sobre
o bundle compartilhado, em SVG e CSS puro:

| Gráfico | Componente | Por que assim |
| --- | --- | --- |
| Vendas por dia | `TrendArea` (linha + área) | tendência se lê em linha |
| Pedidos por dia | `DailyBars` (barras) | quantidade dia a dia é comparação |
| Horários de pico | `HoursBars` (24 barras finas) | a forma do dia importa; 24 é o eixo fixo |
| Produtos/categorias/mesas/métodos | `RankedBars` (barras horizontais) | pizza de 6 fatias não se lê em 320px |

Cada gráfico leva junto uma `<table>` em `sr-only` com os mesmos números: gráfico
é imagem, e leitor de tela precisa do dado.

### Estados, não gráfico quebrado

| Situação | O que aparece |
| --- | --- |
| Carregando | transição do filtro + botão "Atualizar" girando |
| Sem dados no período | cartão explicando o que falta e dois atalhos (QR Codes, cardápio) |
| **Dados insuficientes** | o número em lista + aviso de que a evolução começa no 2º dia |
| Erro | "não foi possível carregar" com botão de atualizar — distinto de "sem venda" |

"Dados insuficientes" é o estado que evita a mentira mais comum de dashboard:
uma linha com **um ponto** parece dado perdido. A regra é `hasEnoughForTrend`
(≥ 2 dias com movimento), e vale para período de 30 dias em que a casa vendeu em
um só.

### Crescimento sem inventar porcentagem

`computeGrowth` trata os casos que enganam:

| Caso | Resultado | Por quê |
| --- | --- | --- |
| anterior = 0 | `null` → "sem base" | crescer de 0 para 3 não é "+∞%" nem "+300%" |
| período anterior sem movimento | `null` → "sem base" | comparar com quando a casa não existia vira conquista falsa |
| variação < 0,5% | `0%` → "estável" | "0%" com flecha para cima é contraditório |
| queda total | `−100%` | o divisor é o anterior, que é > 0 |

### Multi-tenant e RBAC

Toda função `restaurant_analytics_*` recebe `p_restaurant_id` e chama
`is_restaurant_member(p_restaurant_id)` **antes** de devolver qualquer linha. O
`restaurant_id` vem de `getActiveRestaurant()` (sessão), nunca da URL — e o banco
confere de novo, então um id forjado devolve vazio, indistinguível de "casa sem
movimento". As nove funções são `revoke` de `public, anon`; `anon` não lê
faturamento de ninguém.

Verificado no banco real com `set local role authenticated` +
`request.jwt.claims`: usuário fora da casa recebe **0 linhas** nas sete RPCs e
**0 linhas** na tabela `order_payments`. `admin_analytics` com não-admin levanta
`42501 admin_forbidden`.

### Desempenho

`force-dynamic` é deliberado: o período vem da querystring e o número muda com o
salão. O custo é uma consulta por abertura, e é por isso que a agregação é função
de banco indexada — não `select *` trazido para o Node somar. Três índices novos
(`orders(restaurant_id, created_at)`, `order_items(...)`, `table_requests(...,
type)`) e o livro de pagamentos com `(restaurant_id, paid_at)`.

As sete RPCs vão em `Promise.all` — uma ida de rede, falha parcial isolada (se o
ranking de produtos quebrar, o faturamento continua na tela).

### O bug que o primeiro teste pegou

`analytics_period` é `returns table` em plpgsql. Atribuir às colunas de saída
**não emite linha**: sem `return next`, a função devolve zero registros em
silêncio, e todas as sete agregações devolvem zero junto. O sintoma não foi erro
— foi um painel vazio que parecia "casa sem movimento". Está documentado no
código e coberto pelo harness.

### Verificação

```bash
node .arena-test/analytics-lib.cjs        # 64 · dinheiro, crescimento, escala, datas
node .arena-test/analytics-security.cjs   # 95 · guards de tenant, RBAC, grants no SQL
node .arena-test/analytics-ui.cjs         # 48 · gráficos, estados e pagamento em jsdom
node .arena-test/nav-fit.cjs              # 13 · a barra de 6 abas cabe em 320px
```

O `analytics-security` é análise estática da migração: garante que o arquivo no
repositório mantém `is_restaurant_member`, `revoke ... from public, anon`,
`is_platform_admin` e o teto de pagamento. Ele **não** substitui o teste contra o
banco aplicado — os dois rodaram, e é o par que importa.

O `analytics-ui` roda os componentes reais em jsdom e verifica, entre outras
coisas, que dia sem venda tem barra no piso (não some do eixo), que um único dia
não desenha linha de tendência, que nenhum elemento sai com `height: NaN%` e que
o formulário de pagamento abre com **o saldo**, não com o total — que é o erro
que faria o segundo lançamento de uma conta dividida ser recusado.

O `nav-fit` merece uma nota porque ele existe por causa de um erro de
estimativa: a 6ª aba foi dimensionada "no olho" (~0.55 em por caractere) e o
rótulo "Configurações" passava do slot em 320px, criando rolagem horizontal sem
nenhum erro de runtime. Agora o teste lê as tabelas `cmap`/`hmtx` da fonte e
soma as larguras de avanço reais — em Noto Sans (fonte de UI real) e em DejaVu
Sans Bold (12% mais largo, pior caso). Reverter o `min-w-0`/`truncate` derruba
o teste para 9/13.

---

## Painel de cozinha (Etapa 17)

KDS em `/kitchen`, para tablet Android. Lê e escreve **no sistema de pedidos que
já existia** — não há tabela de pedido paralela, nem produto, nem mesa
duplicada.

### Os dois papéis novos, e por que só dois

O escopo lista ADMIN, MANAGER, KITCHEN, STAFF e WAITER. Os três primeiros já
existiam (`owner`/`admin`, `manager`, `staff`). Criar os cinco de novo seria
duplicar a Etapa 10 e quebrar as policies que dependem de `is_restaurant_admin`.
Entraram `kitchen` e `waiter`.

A regra que os define: **papel novo é permissão menor, não maior.**

| | Ver KDS | Aceitar/iniciar/pronto | Finalizar | Cancelar | Cardápio |
| --- | --- | --- | --- | --- | --- |
| owner / admin | sim | sim | sim | sim | sim |
| manager | sim | sim | sim | sim | sim |
| staff | sim | sim | sim | sim | **não** |
| **kitchen** | sim | sim | sim | **não** | **não** |
| **waiter** | sim | **não** | sim | **não** | **não** |

Duas decisões explicam o resto:

- **`kitchen` fica fora de `is_restaurant_admin`.** Se entrasse, a cozinha
  poderia mudar preço e esconder produto — e aí não é mais cozinha.
- **`waiter` não inicia preparo.** Quem leva o pedido à mesa não decide quando
  a cozinha começou; se decidisse, o KDS perderia a única coisa que promete.
  Mas ele **finaliza**, porque registrar a entrega é trabalho do salão.

`cancelar` mantém exatamente a lista que já valia na Etapa 7
(owner/admin/manager/staff). Nenhum papel perdeu poder; os dois novos é que não
herdaram esse.

A autorização foi para dentro de `set_order_status`, que agora decide pelo
**status de destino**: a mesma regra vale para o KDS e para o painel do salão,
sem segundo caminho de escrita.

### Tempo: derivado, nunca digitado

| Pergunta | Fonte | Por que não o atalho |
| --- | --- | --- |
| Há quanto tempo chegou? | `orders.created_at` | — |
| Há quanto tempo está em preparo? | 1º evento `→ preparing` em `order_status_events` | `updated_at` muda a cada toque e **reiniciaria** o contador |
| Está atrasado? | minutos desde `created_at` vs `late_after_minutes` da casa | medir desde o preparo esconde a espera do cliente |

Pedido entregue ou cancelado nunca é "atrasado": vermelho em pedido que já saiu
ensina a equipe a ignorar o vermelho.

### Som e autoplay

Dois bipes (880 Hz e 1174 Hz) via Web Audio — sem arquivo no bundle, sem
depender de rede, sem passar por `media-src` da CSP.

Navegador bloqueia áudio sem gesto do usuário. A função **devolve `false`** em
vez de fingir que tocou, e a tela mostra "o navegador bloqueou o som, toque em
Ativar som". Tocar em qualquer lugar libera o contexto. A preferência fica no
`localStorage` **por restaurante** (o mesmo tablet pode servir duas casas) e o
default é **ligado**: painel mudo na primeira abertura é pior que um som que
alguém desliga.

### Dois layouts, um componente

| Largura | Layout | Motivo |
| --- | --- | --- |
| ≥ 1024px (tablet paisagem) | quatro colunas, scroll próprio | cards grandes, o pedido explícito do escopo |
| < 1024px (celular **e tablet retrato**) | abas com contador | em 768px quatro colunas dariam ~180px cada e o nome do item quebraria em 3 linhas |

O corte em `lg` e não `md` é deliberado: tablet em retrato também usa abas.

### Estação: arquitetura sem a divisão completa

`kitchen_stations` + `kitchen_station_categories` existem e funcionam. A ligação
é por **categoria**, não por produto: "todas as bebidas vão para o bar" é uma
linha, e produto novo em Bebidas cai no bar sozinho. Ligar produto a produto
exigiria reconfigurar a cada item novo — e alguém esqueceria.

Sem estação configurada, o KDS mostra tudo, que é o certo para a casa pequena. A
view resolve `station_slug` no item; o filtro por estação é uma linha de SQL.

**O que não entrou:** tela de cadastro de estação. As tabelas e o filtro estão
prontos; a UI fica para quando alguém pedir a divisão.

### Duas lacunas de dado que você deve conhecer

1. **Adicionais não são gravados hoje.** Os grupos de opções existem desde a
   Etapa 2, mas o cardápio público nunca ofereceu a escolha
   (`#product-detail-options` está reservado e vazio). A tabela
   `order_item_options` e o card do KDS já sabem desenhá-los; falta a Etapa 18
   ligar a escolha no cardápio e passar os itens no `create_order`.
2. **Observação por item existe no banco, mas o cliente não envia.**
   `order_items.notes` está na view e o card mostra; hoje vem sempre vazio. A
   observação do **pedido**, essa sim, é preenchida pelo cliente no carrinho e
   aparece no card.

Nada disso foi simulado com dado falso: o KDS mostra o que existe. Inventar
"adicionais" para a cozinha acertar seria pior que não mostrar.

### Tempo real

Mesmo canal `orders:<restaurantId>` da Etapa 7, com `order_items` acrescentado
**no mesmo canal**. O evento é o sinal, não o dado: ao receber, o painel relê
pela RPC `list_kitchen_orders`, que traz estação e tempo de preparo. Montar o
card a partir do payload perderia os dois.

O relógio do contador roda em `setInterval` de 1 s e **não** consulta o banco —
60 consultas por minuto por tablet derrubaria a cozinha.

### Verificação

```bash
node .arena-test/kitchen-lib.cjs        # 89 · contador, urgência, colunas, filtros, som
node .arena-test/kitchen-security.cjs   # 70 · RBAC, tenant, não-duplicação, acessibilidade
node .arena-test/kitchen-ui.cjs         # 59 · card e painel reais em jsdom
node .arena-test/kitchen-ssr.cjs        # 33 · primeiro paint do tablet
```

Fluxo validado **contra o banco real** (transação descartável, `anon` + claims
de cada papel):

| Passo | Resultado |
| --- | --- |
| cliente (`anon`) cria pedido pelo QR | pedido 1004 nasce `pending`, com observação |
| `kitchen` vê o pedido | aparece em `list_kitchen_orders` com item, mesa e tempo |
| `kitchen` aceita → prepara → pronto → entrega | 4 transições aceitas |
| histórico | 5 eventos (`null→pending` … `ready→delivered`) |
| `kitchen` tenta cancelar | **`role_forbidden`** |
| `waiter` tenta aceitar | **`role_forbidden`** |
| `waiter` entrega | aceito |
| `kitchen` cria estação | **bloqueado pelo RLS** |
| outro tenant | 0 linhas |

## Impressão de pedidos (Etapa 18)

Cupom de impressora térmica — 58mm e 80mm — configurado em
`Configurações → Impressão`, impresso pelo botão **🖨 Imprimir pedido** no
detalhe do pedido e no card do KDS.

### O que o navegador NÃO faz

Esta é a decisão que organiza a etapa inteira, e ela contraria a expectativa
mais comum de quem pede "impressão na térmica":

> **Nenhuma página web abre a porta USB/COM de uma térmica, fala ESC/POS ou
> seleciona a impressora instalada.** O que existe é `window.print()`, que
> entrega o documento à caixa de diálogo do sistema e perde o rastro dali em
> diante — a pessoa pode escolher outra impressora, outro papel ou cancelar.

Por isso o produto faz três coisas e **não finge** uma quarta:

1. **Monta o cupom exato para o papel** (`src/lib/printing.ts`): 32 colunas em
   58mm, 48 em 80mm, quebra por palavra, alinhamento de valor à direita.
2. **Imprime pela rota dedicada** `/app/pedidos/[id]/imprimir`, com `@page`
   ajustado à largura e o resto da tela escondido por CSS.
3. **Registra a solicitação**, não a confirmação: `print_jobs.status` nasce
   `requested` e a tela diz "solicitada".
4. **Não existe** — e a tela avisa — impressão automática sem toque. Isso exige
   um bridge local ou um serviço de impressão, que a Etapa 18 **prepara** mas
   não implementa.

### `PrintProvider`: contrato pronto, integração não inventada

`src/lib/print-provider.ts` define a interface que um bridge futuro implementa:

```ts
interface PrintProvider {
  readonly kind: PrintProviderKind;
  readonly available: boolean;
  connect(): Promise<ProviderConnection>;
  disconnect(): Promise<void>;
  testPrint(request: PrintJobRequest): Promise<PrintResult>;
  printOrder(request: PrintJobRequest): Promise<PrintResult>;
}
```

| Provedor      | Hoje        | Como alcança a térmica                                  |
| ------------- | ----------- | ------------------------------------------------------- |
| `browser`     | **disponível** | janela do sistema + driver instalado no aparelho     |
| `os`          | planejado   | serviço local que fala com a fila de impressão           |
| `web_print`   | planejado   | servidor Web Print / CUPS na mesma rede                   |
| `bridge`      | planejado   | app instalado no computador da loja (USB/rede, ESC/POS)   |
| `service`     | planejado   | serviço de impressão em nuvem contratado à parte          |

Dois detalhes que impedem a mentira:

- `BrowserPrintProvider.connect()` responde **`supported: false`**. Devolver
  `connected: true` faria a tela dizer "impressora pronta" para quem nunca
  instalou driver.
- `printOrder()` devolve `status: "requested"` e `confirmed: false`. Os
  provedores planejados devolvem `unsupported` com o motivo — eles existem no
  registro para a tela poder listá-los honestamente.

### Banco

Quatro tabelas, todas com `restaurant_id` e RLS:

| Tabela           | O que guarda                                              |
| ---------------- | --------------------------------------------------------- |
| `print_settings` | uma linha por casa: modo, papel padrão, os 4 interruptores, cópias, rodapé |
| `print_profiles` | destinos (COZINHA, BALCÃO, BAR, CAIXA) com papel e cópias próprios |
| `printers`       | impressora física: nome, provedor, identificador, padrão    |
| `print_jobs`     | **solicitações** de impressão (escrita só por RPC)          |

`print_profiles` não guarda pedidos e `printers` não duplica equipamento por
pedido: o documento sai de `orders`, `order_items`, `order_item_options`
(Etapa 17) e `order_payments` (Etapa 16), pela RPC `get_print_order`.

| Ação                                    | owner/admin | manager | kitchen | staff | waiter |
| --------------------------------------- | ----------- | ------- | ------- | ----- | ------ |
| Ver a configuração (`print_can_view`)   | sim         | sim     | sim     | sim   | sim    |
| Configurar (`print_can_configure`)      | sim         | sim     | **não** | não   | não    |
| Imprimir pedido / registrar job         | sim         | sim     | sim     | sim   | sim    |

`kitchen` pode imprimir e não pode configurar: quem está na bancada precisa do
papel, não precisa mudar o endereço da impressora.

### Layout do cupom

Cabeçalho com o restaurante, `PEDIDO #1042`, mesa, data/hora no fuso da casa,
itens com quantidade, adicionais indentados, `OBS:` do item, observação do
pedido em destaque, totais (quando o perfil quer preço) e forma de pagamento
**somente quando existe recebimento registrado** — sem pagamento, nenhuma linha
aparece. Escrever "NÃO PAGO" no papel da cozinha seria afirmar o que o app não
sabe.

### Página de teste

`Imprimir teste` desenha régua contada (10, 20, 30…), linhas de borda `|...|` e
um parágrafo que precisa caber. As quatro falhas de calibragem — tamanho,
alinhamento, quebra de linha e largura — aparecem juntas no mesmo papel, em vez
de um "hello world" que sempre parece funcionar.

### Verificação

```bash
node .arena-test/print-lib.cjs        # 108 · colunas, quebra, alinhamento, pagamento, migration
node .arena-test/print-provider.cjs   # 69 · contrato, honestidade do status, sem rede
node .arena-test/print-security.cjs   # 67 · RBAC, tenant, não-duplicação, mobile
node .arena-test/print-ui.cjs         # 72 · configuração e prévia reais em jsdom
node .arena-test/print-ssr.cjs        # 46 · cupom e configuração no primeiro paint
```

Validado **contra o banco real** (transação descartável com claims de cada
papel):

| Passo | Resultado |
| --- | --- |
| `owner` cria os 4 perfis | `seed_default_print_profiles` → 4 linhas (`cozinha`, `balcao`, `bar`, `caixa`) |
| rodar o seed de novo | 0 criados — idempotente por `(restaurant_id, slug)` |
| salvar modo/papel/interruptores | `save_print_settings` devolve o config completo |
| criar duas impressoras padrão | **só uma fica padrão** (índice parcial troca, não recusa) |
| `get_print_order` | devolve pedido 1005 com item, `payments: []` (nada registrado) |
| `kitchen` lê pedido para imprimir | aceito |
| `kitchen` salva configuração | **`print_forbidden`** |
| `kitchen` cria perfil/impressora | **`print_forbidden`** |
| `kitchen` registra `log_print_job` | aceito |
| config de restaurante inexistente | **`print_forbidden`** |

### Lacunas conhecidas (e o que falta para fechar)

- **Adicionais seguem sem escolha no cardápio.** `order_item_options` existe
  desde a 17 e o cupom sabe imprimi-los, mas `create_order` ainda não recebe
  opções — a linha simplesmente não aparece. Nada é simulado.
- **Observação por item** idem: coluna existe, cliente não envia.
- **Impressão automática sem toque** exige provedor `bridge`/`service`. O modo
  `auto` hoje abre a tela de impressão no aceite do pedido; o toque final é da
  pessoa, e a tela explica por quê.
- **Sem divisão de itens por perfil.** O perfil organiza destino e papel;
  "bebida vai para o bar" é a próxima evolução, e a chave `kind` já existe.

---

## Cobrança manual por PIX (Etapa 19)

A plataforma cobra a assinatura **sem gateway**: o cliente escolhe o plano, paga
no PIX do dono da plataforma e um administrador confere o recebimento antes de
liberar o acesso. Não existe webhook, não existe confirmação automática e nada
nesta etapa finge que existe.

### O fluxo, do começo ao fim

1. **Escolher o plano** (`/app/plano` → `PlanPixPicker`). A tela mostra o preço
   do ciclo — mensal = preço do catálogo, anual = 12× sem desconto — e envia
   apenas `planId` e `interval`.
2. **Solicitação criada** (`request_plan_payment`). O banco lê o preço de
   `plans`, congela em `payment_requests.amount` e grava `PENDING`. Uma
   pendente por casa: pedir de novo cancela a anterior em vez de acumular.
3. **Pagar o PIX** (`/app/pagamento`, também em `/dashboard/billing`). Mostra
   recebedor, chave copiável, QR Code opcional e a instrução de que a
   confirmação é **manual**.
4. **Comprovante (opcional)**. Upload direto para o bucket privado
   `payment-receipts`, no caminho `{restaurant_id}/receipts/...`. Anexar
   comprovante **não** confirma nada.
5. **Conferir e confirmar** (`/admin/pagamentos/[id]`). O aviso é literal:
   *"Confirme somente após verificar o recebimento do PIX."* Confirmar chama
   `admin_confirm_payment`, que fecha a assinatura corrente, abre a nova em
   `subscriptions` (`active`, 30 dias mensal / 365 anual, preço congelado,
   `payment_method = MANUAL_PIX`, `payment_request_id`, `activated_by`) e grava
   `MANUAL_PAYMENT_CONFIRMED` em `admin_audit_log`.
6. **Rejeitar** (`admin_reject_payment`) exige motivo, não toca na assinatura e
   aparece no histórico do cliente.

### Quem pode o quê

| Ação | Restaurante (owner/admin) | Admin da plataforma | MASTER_ADMIN |
| --- | --- | --- | --- |
| Criar solicitação | sim | sim | sim |
| Anexar comprovante | sim (só da própria casa) | sim | sim |
| Ver histórico | só da própria casa | todas | todas |
| Confirmar / rejeitar / cancelar | **não** | sim | sim |
| Ajustar duração do período | não | **não** | sim (auditado) |
| Alterar chave/recebedor do PIX | não | **não** (leitura) | sim |

`MASTER_ADMIN` é `role = 'owner'` em `platform_admins` (`is_platform_owner()`).
Confirmar pagamentos e trocar a chave que recebe o dinheiro são degraus
diferentes de propósito.

### O que a arquitetura mantém

- **`PaymentProvider` continua o contrato** (`src/lib/billing/index.ts`). O
  provedor novo é `manualPixProvider` (`settlement: "manual_pix"`,
  `live: false`), ligado por `PAYMENT_PROVIDER` — troca é configuração, não
  deploy. `getPaymentProvider()` cai em `manual_pix` por padrão.
- **Quem decide o estado da assinatura é o banco.** O provedor só descreve o
  caminho de pagamento; nenhuma função do provedor escreve em `subscriptions`.
- **Nenhuma tabela de assinatura nova.** `payment_requests` é a *solicitação*;
  `subscriptions` (Etapa 11) continua sendo o contrato, agora com
  `payment_request_id`, `payment_method`, `activated_by` e `activated_at`.
- **Comprovante é dado financeiro.** Bucket privado, `file_size_limit` de 5 MB,
  leitura por URL assinada de 5 minutos, escrita só no diretório do próprio
  tenant (e do admin global).
- **Configuração do PIX é global e fechada.** Uma linha em `payment_settings`,
  sem policy de leitura: o cliente recebe só os campos de recebimento por
  `my_payment_panel`; o admin pelo `admin_payment_settings`.

### Estados no painel do restaurante

`paymentStage()` (módulo neutro `src/lib/payments.ts`) resume assinatura +
pedido pendente em seis estágios, e o mesmo texto aparece no dashboard, em
"Meu plano" e na tela de pagamento:

| Estágio | Texto |
| --- | --- |
| `no_plan` | "Escolha um plano para liberar o painel completo." |
| `pending` | "Pagamento aguardando confirmação…" |
| `confirmed` | "Pagamento confirmado. Seu plano está ativo." |
| `active` | "Plano ativo." |
| `expiring` | "Seu plano vence em X dias." (janela de 7 dias) |
| `expired` | "Seu plano expirou. Faça um novo PIX para reativar o acesso." |

Precedência: pendente vence tudo; vencido vence ativo; `justConfirmed` só
aparece depois do retorno da confirmação.

### Rotas

| Rota | Quem | O que é |
| --- | --- | --- |
| `/app/pagamento` | restaurante | instruções de PIX, comprovante, histórico |
| `/dashboard/billing` | restaurante | alias da mesma tela (nome do escopo) |
| `/admin/pagamentos` | plataforma | fila de solicitações, pendentes primeiro |
| `/admin/pagamentos/[id]` | plataforma | detalhe, comprovante, confirmar/rejeitar |
| `/admin/settings/payment` | plataforma (edita: master) | chave, recebedor, QR, ligar/desligar |

### Verificação

- `0019_payments.sql` aplicada no Supabase; 20 asserções SQL em transação com
  `rollback` (8 do escopo + master/tenant/preço/idempotência) — resultados em
  `docs/AMBIENTES.md`.
- `payments-lib` (61), `payments-security` (59), `payments-ui` (66),
  `payments-ssr` (29). Suíte total: **1.659 asserções em 30 harnesses**.
- `tsc --noEmit` e `next build` verdes; `/admin/pagamentos`,
  `/admin/pagamentos/[id]`, `/admin/settings/payment`, `/app/pagamento` e
  `/dashboard/billing` no manifesto de rotas.

### Lacunas conhecidas

- **Renovação é manual de ponta a ponta.** O aviso "vence em X dias" existe,
  mas nada cobra sozinho: o cliente pede de novo e o admin confirma de novo.
- **Sem gateway, sem webhook, sem recibo fiscal.** É o recorte pedido; o
  contrato `PaymentProvider` já prevê a entrada de um provedor real sem
  reescrever tela.
- **Comprovante é conferência humana.** Não há OCR nem verificação de
  comprovante — e o desenho é esse: quem confirma é gente.

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
| `/r/[slug]/table/[token]`             | **Cardápio + carrinho + pedido (QR/NFC)**       |
| `/app/mesas`                          | Mesas: cartões, ativar/desativar, QR (Etapa 4)  |
| `/app/mesas/[id]/qr`                  | Download do QR (`?format=png` ou `?format=svg`) |
| `/app/mesas` (sheet NFC)              | TAGs da mesa: URL, status, histórico (Etapa 5)  |
| `/sitemap.xml`, `/robots.txt`         | Indexação — só cardápios publicados             |
| `/app/pedidos`                        | **Painel de pedidos em tempo real** (Etapa 7)   |
| `/app/configuracoes`                  | Hub de configurações                            |
| `/app/configuracoes/conta`            | Conta do usuário                                |
| `/app/configuracoes/restaurante`      | Dados do restaurante                            |
| `/app/configuracoes/personalizacao`   | **Personalizar cardápio** — cores e imagens (E9) |
| `/admin`                              | **Painel master** — visão geral (Etapa 10)      |
| `/admin/restaurantes`                 | Todas as casas: busca, filtro, status           |
| `/admin/restaurantes/[id]`            | Detalhe de suporte (sete seções)                |
| `/admin/restaurantes/[id]/editar`     | Edição de dados, link e plano                   |
| `/admin/usuarios`                     | Usuários, papéis e vínculos                     |
| `/admin/pedidos`                      | Pedidos recentes de toda a plataforma           |
| `/admin/auditoria`                    | Histórico de ações administrativas              |
| `/admin/configuracoes`                | Conta da plataforma e catálogo de planos        |
| `/planos`                             | **Vitrine pública de planos** (Etapa 11)        |
| `/app/plano`                          | **Meu plano** — status, uso, limites e troca    |
| `/admin/planos`                       | Catálogo: criar, editar, ativar, preço, limites |
| `/admin/assinaturas`                  | Plano, status, período e trial de cada casa     |
| `/manifest.webmanifest`               | **Manifesto do PWA** (Etapa 12)                 |
| `/api/health`                         | **Diagnóstico da implantação** (Etapa 14)       |
| `/sw.js`                              | **Service worker** — versão carimbada por hash  |
| `/offline.html`                       | Tela de "sem conexão"                           |
| `/app/configuracoes/whatsapp`         | **WhatsApp** — número, mensagem e botão (E13)   |
| `/app/analytics`                      | **Relatórios do restaurante** (Etapa 16)        |
| `/admin/analytics`                    | **Métricas globais da plataforma** (Etapa 16)   |
| `/kitchen`                            | **Painel de cozinha (KDS)** — tablet, tempo real |
| `/app/configuracoes/impressao`        | **Impressão** — papel, perfis, impressoras (E18) |
| `/app/pedidos/[id]/imprimir`          | **Cupom térmico** do pedido — 58/80mm (Etapa 18) |

Fluxo principal: **cadastro → login automático → criar restaurante → dashboard**.
O middleware do Supabase renova a sessão e exige login em `/app`,
`/onboarding`, `/configuracoes` e `/admin`. O **papel** de plataforma não é
checado no middleware (ele roda em toda rota e não deve consultar o banco): quem
decide é o layout do `/admin` e, de novo, cada RPC `security definer`.

---

## Estrutura de pastas

```
src/
├── actions/            Server Actions
│   ├── auth.ts         cadastro, login, logout, senha
│   ├── restaurant.ts   criação e edição do restaurante
│   ├── account.ts      perfil do usuário
│   ├── menu.ts         categorias e produtos (CRUD, toggle, reordenação)
│   ├── tables.ts       mesas (CRUD, ativar/desativar, ocupação, novo token)
│   ├── nfc.ts          TAGs NFC das mesas
│   ├── orders.ts       criação e releitura de pedidos (Etapa 6)
│   ├── orders-panel.ts status, anotações e histórico (Etapa 7)
│   ├── table-requests.ts fila de solicitações da mesa (Etapa 8)
│   ├── theme.ts        tema do cardápio: salvar, resetar, upload (Etapa 9)
│   ├── admin.ts        painel master: status, cadastro, papéis (Etapa 10)
│   ├── billing.ts      planos, trial, troca de plano e assinatura (Etapa 11)
│   └── payments.ts     livro de pagamentos: lançar, estornar, ler (E16)
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
│   │                   ProductRow, ProductDetail, TableBadge,
│   │                   CartProvider, CartSheet, OrderSuccess,
│   │                   TableActionsBar (Garçom/Carrinho/Conta),
│   │                   TableRequestSheet (confirmação)
│   ├── orders/         Painel da equipe: OrdersPanel, OrderCard,
│   │                   OrderDetailSheet, OrderBoardCards, PaymentSection,
│   │                   TableRequestsSection, hooks de tempo real
│   │                   e de paginação
│   ├── analytics/      Relatórios: charts (SVG/CSS puro), MetricCard,
│   │                   PeriodFilter (Etapa 16)
│   ├── tables/         Painel de mesas: TablesManager, TableCard,
│   │                   TableSheet, QrSheet, QrPrintCard,
│   │                   NfcPanel, NfcSheet, NfcTagSheet, NfcStatusBadge
│   ├── admin/          Painel master: AdminNav, RestaurantList,
│   │                   MembersSection, RestaurantEditForm, MetricCard,
│   │                   PlanForm, PlanToggle, SubscriptionEditor (E11)
│   ├── billing/        PlanCard, UsageMeter, PlanSwitcher (Etapa 11)
│   ├── theme/          Editor de personalização: ThemeEditor, MenuPreview,
│   │                   ColorField, ImagePicker
│   ├── pwa/            Registro do service worker, convite de instalação
│   │                   e aviso de atualização (Etapa 12)
│   └── ui/             Button, Field, Card, Badge, Sheet, Switch,
│                       ConfirmSheet, ComingSoon…
├── lib/
│   ├── data/           consultas server-side (RLS aplicada)
│   ├── supabase/       client, server, middleware
│   │                   public.ts: cliente sem cookies para leitura pública
│   ├── types.ts        tipos de domínio
│   ├── utils.ts        helpers
│   ├── opening-hours.ts horário de funcionamento (fuso, meia-noite)
│   ├── qr.ts           gerador de QR Code (matriz, PNG, SVG) sem dependências
│   ├── table-session.ts cookie de contexto da mesa (QR/NFC)
│   ├── nfc.ts          resumo de TAGs por mesa (módulo neutro, uso no cliente)
│   ├── cart.ts         regras do carrinho (módulo neutro, testável)
│   ├── order-status.ts ícone, rótulo e cor de cada status
│   ├── order-time.ts   tempo de espera e alerta de atraso
│   ├── theme.ts        presets, contraste e CSS vars do cardápio (neutro)
│   ├── theme-upload.ts validação e otimização de imagem (neutro)
│   ├── table-request.ts disponibilidade/cooldown das solicitações (neutro)
│   ├── notify.ts       som (WebAudio), vibração e preferência
│   ├── realtime.ts     nomes dos canais de tempo real
│   ├── plan-rules.ts   limites, uso e comparação de planos (neutro)
│   ├── billing/        contrato de gateway de pagamento (Etapa 11)
│   ├── pwa.ts          config do PWA: nome, cores, ícones, cache (Etapa 12)
│   ├── whatsapp.ts     número, link wa.me e mensagem de pedido (neutro, E13)
│   ├── whatsapp/       contrato do provedor (link hoje, Cloud API depois)
│   ├── env.ts          ambientes, origem canônica, redirect seguro (E14)
│   ├── site.ts         origem da requisição + metadataBase (server, E14)
│   ├── rate-limit.ts   contadores por balde em memória (E14)
│   ├── security-headers.ts CSP e headers por tipo de rota (E14)
│   └── validation.ts   schemas Zod
├── sw-source.js        service worker (JS puro, versionado por hash)
└── middleware.ts
supabase/migrations/    schema aplicado via Supabase
                        0001_init.sql (Etapa 1)
                        0002_menu_categories_products.sql (Etapa 2)
                        0003_public_menu.sql (Etapa 3)
                        0004_tables_qr.sql (Etapa 4)
                        0005_table_nfc.sql (Etapa 5)
                        0006_nfc_stale_and_replaced.sql (correções da Etapa 5)
                        0007_orders.sql (Etapa 6)
                        0008_order_panel.sql (Etapa 7)
                        0009_table_requests.sql (Etapa 8)
                        0010_restaurant_theme.sql (Etapa 9)
                        0011_platform_admin.sql (Etapa 10)
                        0012_plans_subscriptions.sql (Etapa 11)
                        0013_plan_catalog_and_trial_fix.sql (Etapa 11)
                        0014_whatsapp.sql (Etapa 13)
docs/                    documentação interna
└── AMBIENTES.md         ambientes, domínio, banco, storage, deploy, PWA
public/
├── icons/              ícones do PWA (192, 512, maskable, apple-touch)
└── offline.html        tela de "sem conexão"
scripts/                auditoria de layout + teste de RLS
                        generate-icons.mjs (logo → PNGs do PWA)
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
- **Solicitação da mesa é outro domínio.** Chamar garçom e pedir a conta não
  entram em `orders`: são `table_requests`, com ciclo de vida próprio e sem
  valor. A mesa vem do token (nunca do corpo da requisição), a duplicata é
  barrada por índice único parcial e o cooldown vive no banco — a tela só
  reflete a decisão do servidor.
- **Dois tipos de usuário, dois lugares no banco.** Poder de restaurante vive
  em `restaurant_users`; poder de plataforma, em `platform_admins`. Misturar os
  dois faria de "admin" um papel que qualquer dono poderia se dar. Todas as
  consultas do `/admin` passam por RPC `security definer` guardada por
  `is_platform_admin()` — a autorização não depende de a interface esconder o
  botão, e o middleware checa sessão (não papel) para não consultar o banco em
  toda requisição.
- **Aparência é dado do restaurante, não código.** O cardápio lê variáveis
  `--mv-*` definidas por um `style` no topo da página; nenhum CSS é gerado por
  restaurante e nenhum rebuild acontece ao trocar de tema. O mesmo módulo que
  calcula os tokens pinta o preview do editor — o que se vê ali é o que o
  cliente vê, com contraste corrigido no caminho.
- **Tempo real sem polling.** O painel não consulta em intervalo: assina o
  canal, e o evento só dispara uma releitura. Menos requisição, menos bateria no
  celular do salão e a lista certa no instante em que o pedido chega.
- **Total do pedido é do servidor.** A UI mostra uma estimativa enquanto o
  cliente monta o carrinho (soma em centavos inteiros, para não aparecer
  `113.60000000000001`), mas a tela de sucesso exibe o número que o banco
  gravou. Quando os dois divergem, o banco está certo.
- **Feedback de RLS**: mutações usam `.select()` e verificam se alguma linha mudou,
  para não reportar “salvo” quando a policy bloqueou a operação.
- **QR Code impresso**: "Imprimir" usa uma raiz `.print-sheet` fora do fluxo da
  tela; no papel só existe o cartão da mesa (com `@page A4`), jamais o painel.
- **Identidade pública opaca**: o que o cliente vê na URL nunca é o número da
  mesa nem o `id` do banco, mas um token que o dono pode rotacionar.
- **Uma URL por mesa, dois meios**: QR Code e TAG NFC apontam para o mesmo
  endereço. Nada de "link de NFC" separado para manter em sincronia.
- **Nada que o navegador não faz**: a interface nunca promete gravar TAG NFC.
  Ela entrega a URL, registra o que foi gravado e avisa quando a gravação
  ficou velha.

---

### WhatsApp

- **`wa.me`, não API oficial.** O escopo proíbe integração falsa, e a diferença
  importa: `wa.me` não envia, não recebe e não confirma nada. O botão diz "Falar
  no WhatsApp", não "Enviar".
- **O número é gravado normalizado.** Aceitar o texto cru faria cada leitura
  reinterpretar o que o dono digitou — e um valor antigo inválido só apareceria
  no dia em que o cliente tocasse no botão.
- **O plano decide no banco.** `public_whatsapp_config` devolve linha nenhuma
  quando o recurso não está no plano. A tela nunca decide autorização e o
  catálogo comercial não vai para o HTML.
- **Mensagem de pedido pronta, envio não.** `buildOrderMessage` existe com teste
  e formato do escopo, mas não é chamada na interface: o pedido é do sistema, a
  conversa é do cliente.
- **Fila sem consumidor.** `whatsapp_messages` nasce com `status = 'queued'` e
  nenhum processo que a leia. É estrutura, não funcionalidade — e o comentário
  na migração diz isso.

---

## Próximas etapas (já previstas na arquitetura)

| Etapa | Escopo                          | Onde encaixa                                        |
| ----- | ------------------------------- | --------------------------------------------------- |
| ~~2~~ | ~~Categorias e produtos~~       | ~~`/app/cardapio` — **concluída**~~                 |
| ~~3~~ | ~~Cardápio público~~            | ~~`/r/[slug]` — **concluída**~~                     |
| ~~4~~ | ~~Mesas + QR Code~~             | ~~`/app/mesas` + `/app/mesas/[id]/qr` — **concluída**~~ |
| ~~5~~ | ~~NFC das mesas~~               | ~~TAGs da mesa (mesma URL do QR) — **concluída**~~  |
| ~~6~~ | ~~Carrinho e pedidos~~          | ~~`orders`, `order_items`, `create_order` — **concluída**~~ |
| ~~7~~ | ~~Painel de pedidos~~           | ~~`/app/pedidos` + tempo real — **concluída**~~     |
| ~~8~~ | ~~Chamar garçom / pedir a conta~~ | ~~`table_requests` + barra do cardápio — **concluída**~~ |
| ~~9~~ | ~~Personalização do cardápio~~  | ~~`restaurant_themes` + `/app/configuracoes/personalizacao` — **concluída**~~ |
| ~~10~~ | ~~Painel master do administrador~~ | ~~`platform_admins` + `/admin` — **concluída**~~ |
| ~~11~~ | ~~Planos e assinaturas~~        | ~~`plans`, `subscriptions`, limites por trigger — **concluída**~~ |
| ~~12~~ | ~~PWA instalável e mobile first~~ | ~~manifest, service worker, ícones, offline — **concluída**~~ |
| ~~13~~ | ~~WhatsApp: configuração e botão~~ | ~~`whatsapp_settings` + `wa.me` no cardápio — **concluída**~~ |
| ~~14~~ | ~~Preparação para produção~~     | ~~ambientes, domínio, CSP, rate limit, erros, health — **concluída**~~ |
| ~~16~~ | ~~Analytics e relatórios~~      | ~~`/app/analytics` + `/admin/analytics`, RPCs de agregação — **concluída**~~ |
| ~~17~~ | ~~Painel de cozinha (KDS)~~     | ~~`/kitchen`, papéis `kitchen`/`waiter` — **concluída**~~ |
| ~~18~~ | ~~Impressão de pedidos (térmica)~~ | ~~`print_settings`/`print_profiles`/`printers`, `PrintProvider` — **concluída**~~ |
| 15    | Cobrança real (gateway)         | `lib/billing` — Stripe/Mercado Pago/Asaas via `PAYMENT_PROVIDER` |
| —     | Observabilidade                 | Sentry/Datadog nos dois pontos de `console.error` já marcados |
| —     | WhatsApp Business API           | `lib/whatsapp/provider.ts` + `whatsapp_messages` (estrutura pronta) |

Pontos já preparados: o bucket de storage existe, o tema já é uma tabela por
tenant, a função `has_restaurant_role` aceita o array de papéis permitidos (novos
níveis de acesso não exigem reescrever policies) e a cobrança tem contrato
pronto em `lib/billing` com `billing_events` no banco — ligar um gateway é
implementar `PaymentProvider` e um endpoint de webhook, não reescrever regra.

---

### PWA e cache

- **O cache só guarda o que é igual para todo mundo.** Regra única que explica
  todas as escolhas: resposta por usuário (painel, Supabase, pedido) vai direto
  para a rede. A ordem das regras importa e é testada — uma regra de URL
  absoluta do Supabase chegou a capturar as fotos públicas de produto e anular o
  maior ganho de carga do cardápio. O teste `fotos de produto são cache-first`
  existe para isso não voltar.
- **Versão do service worker = hash do conteúdo.** Não é data nem tamanho: só
  muda quando a política de cache muda, e muda sempre que ela muda.
- **"Configurações", não "Ajustes".** A aba voltou ao nome da rota. Cabe em 320px
  com tamanho de fonte fluido (`clamp`), em vez de encurtar o nome do usuário.
- **O SW nunca recarrega sozinho.** Atualização aparece como convite; um reload
  no meio de um pedido é pior que ficar uma versão atrás.
- **Sem rede, tela de aviso.** Toda navegação sem conexão cai no `offline.html`,
  inclusive as do painel — que continua sem cachear nada de conteúdo.

---

## Acessibilidade

- Estrutura semântica (`nav`, `main`, `header`, `ol`), headings em ordem.
- Rótulos + `aria-describedby` em todos os campos, `aria-invalid` e `role="alert"`
  nos erros; `aria-current="page"` na navegação.
- Foco visível em tudo, contraste AA nos textos, botões com estado `aria-busy`.
- Mockups decorativos marcados com `aria-hidden`.
