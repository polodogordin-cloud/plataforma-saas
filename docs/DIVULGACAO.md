# Divulgação do cardápio (Etapa 23)

Tela `Divulgar meu cardápio`, em `/app/divulgar`, e a prévia do link no WhatsApp
e nas redes sociais.

O objetivo é um só: o dono abre o celular, toca em "Compartilhar" e o link chega
bonito na conversa do cliente — com nome, chamada e imagem.

---

## 1. O que a tela faz

| Bloco | O que oferece |
| --- | --- |
| **Seu cardápio público** | Link, Web Share (quando o aparelho tem), WhatsApp, copiar link, visualizar |
| **QR Code do cardápio** | QR geral (`/r/{slug}`) com download em SVG e PNG |
| **Mensagem** | Prévia do texto, edição da chamada, copiar mensagem, enviar no WhatsApp |
| **Outros canais** | Instagram, Facebook, TikTok, Google, Telegram, e-mail e "texto para a bio" |
| **Links** | Geral, de mesa e de pedido, com copiar e abrir |

A tela também aparece no dashboard, logo abaixo do link público.

---

## 2. A mensagem

Formato fixo, com a chamada editável:

```
Famintos

Peça sem fila pelo celular

https://menuvo.app/r/famintos
```

- Nome do restaurante e link entram sozinhos (vêm do banco).
- A chamada é editável, com limite de **160 caracteres** — validado na tela, no
  servidor e por `check` no banco.
- Chamada vazia volta para a padrão (`Confira nosso cardápio digital 🍽️`).
- Espaços e quebras de linha são colapsados: a mensagem vai dentro de uma URL
  (`?text=`), e `%0A` aparece literalmente em alguns Androids.

O texto é montado por **uma** função (`composeShareMessage`), usada pela tela, pelo
Web Share e pelo link do WhatsApp. Duas implementações divergiriam no primeiro
caractere diferente.

---

## 3. Web Share e canais

**Web Share API** é usada quando existe (`navigator.share`). O botão só aparece
depois da hidratação — não renderizamos no servidor para não piscar e sumir.

`AbortError` é tratado como **cancelamento**, não erro: quem fecha a folha de
compartilhamento não deve ver "não foi possível compartilhar".

| Canal | Como funciona |
| --- | --- |
| WhatsApp | `wa.me/?text=` — sem número, para escolher o contato |
| Facebook | `sharer.php?u=` — só a URL; o Facebook ignora texto desde 2017 |
| Telegram | `t.me/share/url` |
| E-mail | `mailto:` com assunto e corpo |
| Google | Busca pelo nome do restaurante (é onde o SEO se confere) |
| Instagram | **Copiar e colar** — não existe URL de envio |
| TikTok | **Copiar e colar** — não existe URL de envio |

### O que não fazemos

Não publicamos em rede social. Instagram e TikTok não têm endpoint de
compartilhamento sem SDK e sem app instalado; o único caminho real a partir do
navegador é o compartilhamento nativo do sistema. Por isso esses dois botões
**copiam** a mensagem e dizem onde colar (story, bio, direct) — em vez de um
botão que promete publicar e não faz nada.

Também não há contador de compartilhamentos. O app não sabe se o dono enviou: quem
abre a conversa é o WhatsApp. Guardar "compartilhado 12 vezes" seria inventar
dado — a mesma regra da Etapa 13.

---

## 4. QR geral

`/app/divulgar/qr?format=svg|png` gera o QR de **`/r/{slug}`** — o cardápio
inteiro, sem mesa. Serve para a porta, o balcão e o adesivo da sacola, onde não
existe mesa. Para mesas, continua valendo `/app/mesas/qrcodes` (Etapa 22).

O slug vem do banco, nunca da query string: trocar o parâmetro não muda o que é
gerado, então não há como produzir QR de outro restaurante.

---

## 5. Links

| Link | Forma | Para quê |
| --- | --- | --- |
| Geral | `/r/{slug}` | Divulgação, bio, QR da porta |
| Mesa | `/r/{slug}/table/{token}` | Cliente na mesa — o token identifica o pedido |
| Pedido | `/r/{slug}/table/{token}#pedido-{n}` | Acompanhamento do pedido |

O link do pedido usa **fragmento** (`#`), não query string: o fragmento não vai
ao servidor, então não vira log de acesso nem invalida o cache ISR do cardápio.
O cardápio já lê o número do último pedido do `localStorage` da própria mesa
(Etapa 7); o fragmento permite abrir a mesma tela em outro aparelho.

---

## 6. SEO e Open Graph

### Página do restaurante — `/r/{slug}`

| Tag | Valor |
| --- | --- |
| `title` | `{nome} · Cardápio` |
| `description` | Chamada de divulgação → descrição do restaurante → texto padrão |
| `canonical` | `/r/{slug}` |
| `og:type` / `og:site_name` / `og:locale` | `website` / `Menuvo` / `pt_BR` |
| `og:title` / `og:description` / `og:url` | idem |
| `og:image` | `/r/{slug}/opengraph-image` — arte 1200×630 |
| `twitter:card` | `summary_large_image` |
| `robots` | indexável (é o que traz cliente pelo Google) |

### Imagem compartilhável

`src/app/r/[slug]/opengraph-image.tsx` gera a arte com o nome do restaurante em
destaque, a chamada, o endereço numa pílula e a logo quando existe.

- **1200×630** (1.91:1): o formato que WhatsApp, Facebook, LinkedIn e Twitter
  recortam sem cortar texto.
- Gerada em **SVG + `sharp`** (já usado na Etapa 22), não com `next/og`: Satori
  custaria ~500 kB no bundle da função e exigiria fonte embutida.
- **Emoji é removido** do texto da arte: medido, o PNG saía com uma caixa vazia
  no lugar do 🍽️ porque o contêiner da Vercel não tem fonte de emoji. Na mensagem
  do WhatsApp o emoji continua (lá quem desenha é o aparelho do cliente).
- Usa a **chamada editada** (`settings.share_headline`), a mesma da descrição da
  página: arte com texto padrão ao lado de descrição personalizada parece bug.
- Cache de 1 hora; o número é literal no `revalidate` (o Next recusa constante
  importada) e o harness garante que ele não divergiu de `SHARE_CARD_CACHE_SECONDS`.
- `sharp` é **dependência direta** do projeto (ver §9).
- Herdada por `/r/[slug]/table/[token]` — o link da mesa também tem prévia.

### Página da mesa — `/r/{slug}/table/{token}`

Ganha `title`, `description`, `og:*` e `twitter:card` (Etapa 23), mas continua
`noindex`: mesa é contexto de salão e não deve competir com o cardápio do
restaurante na busca. A `og:image` vem por herança do segmento pai.

---

## 7. Banco de dados

Migration `0024_share_menu.sql`:

- **`restaurants.share_headline text`** — chamada editável, `null` = padrão.
  `check` de 160 caracteres.
- **`save_share_headline(uuid, text)`** — exige `is_restaurant_owner`; colapsa
  espaços; recusa > 160 (`share_headline_too_long`, 22023); vazio grava `null`.
- **`share_overview(uuid)`** — `stable`; devolve restaurante (nome, slug, logo,
  status, chamada), mesas (token, estado) e os 20 últimos pedidos (número, mesa,
  token). `null` para tenant alheio.
- `anon` sem `EXECUTE` nas duas funções.

### Espelho em `settings.share_headline`

A coluna é a fonte de verdade. A action também grava `settings.share_headline`
porque a **view pública** `public_restaurants` expõe `settings` e não a coluna —
e é dela que sai a `description`/`og:description` do cardápio. Acrescentar a
coluna na view faria toda leitura do cardápio carregar texto de divulgação e
mudaria o contrato da view. Falha no espelho não invalida o salvamento: a
chamada já está gravada na coluna.

---

## 8. Arquivos

| Caminho | Papel |
| --- | --- |
| `src/lib/share.ts` | Links, mensagem, canais, Web Share, texto de bio |
| `src/lib/share-card.ts` | Arte 1200×630 em SVG (nome, chamada, endereço, logo) |
| `src/lib/data/share.ts` | Leitura de `share_overview` |
| `src/actions/share.ts` | Salvar chamada (+ espelho em `settings`) |
| `src/app/app/divulgar/page.tsx` | Tela `/app/divulgar` |
| `src/app/app/divulgar/qr/route.ts` | QR geral (SVG/PNG) |
| `src/app/r/[slug]/opengraph-image.tsx` | Imagem compartilhável |
| `src/components/share/share-hub.tsx` | Interface da divulgação |
| `supabase/migrations/0024_share_menu.sql` | Coluna e RPCs |

Testes: `.arena-test/share-lib.cjs` (108), `share-security.cjs` (96),
`share-ssr.cjs` (51). O banco foi verificado no projeto real com
`set local role authenticated` — leitura de tenant alheio devolve `null`, escrita
devolve `42501 share_forbidden`, espaços são colapsados na gravação.

---

## 9. `sharp` como dependência direta

Até a Etapa 22 o `sharp` existia apenas como dependência transitiva do `next`.

**O que foi medido:** em produção, `/r/{slug}/opengraph-image` respondia **500**
com exatamente o mesmo código que rodava local. Depois de declarar `sharp` como
dependência direta e reimplantar, a mesma rota passou a responder **200** com
`image/png`, e continuou respondendo 200 na verificação da Etapa 23.

**O que não foi medido:** o *mecanismo*. A explicação mais provável é que o
empacotamento da Vercel não incluiu o binário nativo nas funções que importam
`sharp` dinamicamente, mas não coletamos os logs daquela função para confirmar.
A correlação é sólida (500 → declaração → 200, estável); a causa interna é
hipótese. Se a rota voltar a falhar, comece lendo os logs da função
(`/r/[slug]/opengraph-image`) em vez de assumir esta seção.

O harness `share-security` guarda a declaração em `dependencies` para a
regressão não voltar.

---

## 10. Limitações conhecidas

- **Sem publicação automática** em rede social (ver §3).
- O **Google** abre a busca pelo nome; não existe "pré-visualizar o card no
  Google" — o índice é do buscador.
- A arte compartilhável usa a fonte do sistema e a cor padrão da plataforma; o
  tema do restaurante não é lido ali (seria mais uma consulta por imagem).
- **Sem contador de cliques ou envios** — não temos como saber, e inventar seria
  pior que não medir.
