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

**Etapa 8 — chamar garçom e pedir a conta (atual).** Barra fixa no cardápio da
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
│   ├── tables.ts       mesas (CRUD, ativar/desativar, ocupação, novo token)
│   ├── nfc.ts          TAGs NFC das mesas
│   ├── orders.ts       criação e releitura de pedidos (Etapa 6)
│   ├── orders-panel.ts status, anotações e histórico (Etapa 7)
│   └── table-requests.ts fila de solicitações da mesa (Etapa 8)
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
│   │                   OrderDetailSheet, OrderBoardCards,
│   │                   TableRequestsSection, hooks de tempo real
│   │                   e de paginação
│   ├── tables/         Painel de mesas: TablesManager, TableCard,
│   │                   TableSheet, QrSheet, QrPrintCard,
│   │                   NfcPanel, NfcSheet, NfcTagSheet, NfcStatusBadge
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
│   ├── nfc.ts          resumo de TAGs por mesa (módulo neutro, uso no cliente)
│   ├── cart.ts         regras do carrinho (módulo neutro, testável)
│   ├── order-status.ts ícone, rótulo e cor de cada status
│   ├── order-time.ts   tempo de espera e alerta de atraso
│   ├── table-request.ts disponibilidade/cooldown das solicitações (neutro)
│   ├── notify.ts       som (WebAudio), vibração e preferência
│   ├── realtime.ts     nomes dos canais de tempo real
│   └── validation.ts   schemas Zod
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
- **Solicitação da mesa é outro domínio.** Chamar garçom e pedir a conta não
  entram em `orders`: são `table_requests`, com ciclo de vida próprio e sem
  valor. A mesa vem do token (nunca do corpo da requisição), a duplicata é
  barrada por índice único parcial e o cooldown vive no banco — a tela só
  reflete a decisão do servidor.
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
| 9     | Personalização do cardápio      | `restaurants.settings` (jsonb) + upload de logo     |
| 10    | Planos e assinaturas            | `plans`, `subscriptions`; gate por `restaurant_id`   |
| 11    | Publicação e produção           | domínios, observabilidade, cache                    |

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
