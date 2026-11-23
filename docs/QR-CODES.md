# QR Codes e plaquinhas das mesas (Etapa 22)

Área `Mesas → QR Codes`, em `/app/mesas/qrcodes`. Gera, personaliza e baixa o QR
Code de cada mesa — em PNG e SVG prontos para impressão — e entrega a URL para
gravar em TAG NFC.

---

## 1. O que o QR aponta (e por que isso importa)

O código aponta para o **link público da mesa**:

```
https://<domínio>/r/<slug-do-restaurante>/table/<public_token>
```

Nunca para `/mesa/1`, nunca para um id interno. A consequência prática é a que
interessa ao dono: **a plaquinha impressa continua funcionando** quando ele
renomeia a mesa, muda o número, troca o tema, edita preço, cria categoria ou
reorganiza o cardápio. Nada disso entra na URL.

Só duas ações quebram um código já impresso:

| Ação | Alcance |
| --- | --- |
| **Regenerar o QR** de uma mesa | Só aquela mesa (o token anterior continua aceito por 30 min) |
| **Trocar o link (slug)** do restaurante | Todas as plaquinhas da casa |

As duas pedem confirmação explícita, com o custo descrito em português — a
segunda nas configurações do restaurante, com aviso de reimpressão.

A URL é **sempre montada no servidor** a partir do slug e do token lidos do
banco. O navegador nunca envia a URL: se enviasse, um dono poderia salvar uma
placa apontando para o site de outra pessoa e a tela mostraria o domínio alheio
como se fosse o dele.

---

## 2. O que a tela oferece

Por mesa, um card com:

- miniatura do QR de verdade (a mesma rota que gera o arquivo);
- nome, código e estado (`Pronta para uso` / `Inativa`);
- **Baixar SVG** e **Baixar PNG**;
- **Copiar link** e **Compartilhar** (usa o compartilhamento nativo do celular
  quando existe; cai no copiar quando não);
- menu com **Testar QR Code** (abre o endereço público), **URL para NFC** e
  **Regenerar QR Code**.

Acima da lista, **Criar placa** abre o editor de arte.

---

## 3. Gerador de placa

### Modelos

| Modelo | O que imprime |
| --- | --- |
| QR Code simples | Só o código (e o nome, se ligado) |
| Aponte a câmera | `Aponte a câmera do celular` |
| Peça pelo celular | `Peça pelo celular` |
| Com o nome da mesa | Mesa em destaque + instrução |
| QR Code + NFC | QR + pictograma e a palavra `NFC` |

Não existe modelo com dois QR Codes. Dois códigos iguais na mesma placa só
confundem quem aponta a câmera; dois diferentes não caberiam legíveis em 80 mm.

### Formatos (medidas em milímetros)

| Formato | Tamanho | Uso típico |
| --- | --- | --- |
| Quadrado | 80 × 80 mm | adesivo de mesa, etiqueta |
| Cartão em pé | 90 × 120 mm | suporte de acrílico |
| Placa tenda | 100 × 150 mm | dobra ao meio |

Os arquivos carregam `width="90mm"` no SVG. Gráfica e impressora doméstica
trabalham em milímetros, então o papel sai no tamanho certo sem "imprimir em
100%" e sem conta de DPI.

### Personalização

Logo, nome do restaurante, nome da mesa, texto do modelo, cores (QR, fundo do
QR, fundo da placa, texto), tamanho do QR, margem e formato. Tudo com prévia
ao vivo, desenhada com **as mesmas funções** que geram o arquivo
(`placeGeometry`, `placeText`, `PLACE_FORMATS`) — a prévia não pode divergir do
impresso.

### O que a personalização não pode fazer

A regra do escopo é "nunca permitir personalização que prejudique a leitura".
Então não é um aviso: é bloqueio.

| Regra | Limite |
| --- | --- |
| Contraste QR × fundo do QR | **≥ 7:1** (WCAG pede 3:1 para objeto gráfico; QR é lido por máquina) |
| Contraste texto × fundo da placa | **≥ 4,5:1** (WCAG AA) |
| Tamanho mínimo do QR | **30 mm** (abaixo disso o módulo fica < 0,3 mm) |
| Margem mínima | **4 mm** (a guilhotina come a borda) |
| QR dentro da placa | validado por largura **e** por altura |
| Conteúdo dentro da margem | a pilha de textos não pode transbordar |

Com a arte reprovada, os botões de baixar e de salvar ficam desabilitados e a
tela mostra o número medido (`3,1:1 · mínimo 7:1`). A rota de download repete a
validação e responde **422** — a mesma função nos dois lados é o que impede
"a tela disse que estava bom" e o arquivo sair ilegível.

---

## 4. Downloads

`GET /app/mesas/[id]/qr/place?format=svg|png[&crop=1][&style=<json>]`

| Formato | Como é gerado |
| --- | --- |
| **SVG** | Vetor com o QR desenhado como caminho único, `mm` no `viewBox`, logo embutida em data URI |
| **PNG** | O mesmo SVG rasterizado a **300 DPI** pelo `sharp` (o QR continua vetorial até o último passo) |

`crop=1` acrescenta marcas de corte (4 mm de sangria) para quem imprime em A4 e
recorta à mão. O conteúdo é transladado num `<g transform>` — a placa é gerada
uma vez só, então as marcas não podem divergir dela.

**PDF não é gerado.** Embutir PDF exigiria uma biblioteca de PDF ou um
navegador no servidor; o SVG abre em qualquer visualizador e imprime em tamanho
real. A tela diz isso em vez de oferecer um botão que não baixa nada — baixar
SVG é o caminho recomendado para gráfica.

`style` na query string permite baixar "do jeito que está na tela" antes de
salvar. Passa pela mesma normalização e pela mesma validação; arte ilegível é
recusada, não gravada.

---

## 5. NFC

A tela mostra a **URL para NFC** — exatamente a mesma do QR, de propósito: duas
URLs para o mesmo destino significam duas coisas para manter, e uma delas
inevitavelmente envelhece.

O texto que acompanha é taxativo e aparece na interface:

> Copie a URL e grave em uma TAG NFC com um aplicativo de gravação (NFC Tools,
> TagWriter). O navegador não grava a TAG sozinho — o aplicativo faz a gravação.

Existe a Web NFC API, mas roda só em Chrome para Android, com a aba em primeiro
plano e a TAG encostada. Não é algo para prometer a um dono de restaurante que
vai abrir o painel no iPhone.

---

## 6. Banco de dados

Migration `0023_qr_place_settings.sql`:

- **`restaurants.qr_place_style jsonb`** — arte padrão da casa (nulo = padrão da
  aplicação). `check` garante que é objeto com a chave `format`; a validação de
  legibilidade é do app, onde ela pode ser explicada.
- **`save_qr_place_style(p_restaurant_id uuid, p_style jsonb)`** — exige
  `is_restaurant_owner`; recusa payload não-objeto (`invalid_qr_style`) e acima
  de 4 KB (`qr_style_too_large`).
- **`qr_place_overview(p_restaurant_id uuid)`** — `stable`; devolve restaurante
  (nome, slug, logo, status, arte) e mesas (nome, código, `public_token`,
  ativa, estado, se há token antigo válido). Devolve `null` para tenant alheio.

`anon` não executa nenhuma das duas. As demais regras de acesso continuam nas
policies existentes: a RPC é mais uma camada, não a única.

### Por que a URL não é guardada

A tentação é salvar a URL no banco no momento em que a placa é gerada. Isso cria
uma segunda fonte de verdade: no dia em que o domínio mudar, metade das placas
aponta para o endereço velho. Guardamos só a **arte**; a URL é derivada do slug
e do token na hora de desenhar. Trocar de domínio passa a atualizar tudo.

---

## 7. Arquivos

| Caminho | Papel |
| --- | --- |
| `src/lib/place-card.ts` | Modelo neutro: formatos, modelos, contraste, geometria em mm, texto, nome de arquivo, NFC |
| `src/lib/place-svg.ts` | SVG da placa (QR vetorial) e variante com marcas de corte |
| `src/lib/data/qr-place.ts` | Leitura da RPC e resolução do contexto da rota de arquivo |
| `src/actions/qr-places.ts` | Salvar arte, restaurar padrão, regenerar token |
| `src/app/app/mesas/qrcodes/page.tsx` | Página `/app/mesas/qrcodes` |
| `src/app/app/mesas/[id]/qr/place/route.ts` | Download SVG/PNG |
| `src/components/tables/qr-codes-manager.tsx` | Lista de QR por mesa |
| `src/components/tables/place-editor.tsx` | Editor com prévia em SVG |
| `supabase/migrations/0023_qr_place_settings.sql` | Coluna e RPCs |

Testes: `.arena-test/qr-place-lib.cjs` (modelo e SVG), `qr-place-security.cjs`
(tenant, autorização, honestidade), `qr-place-ssr.cjs` (render da prévia). As
regras de banco foram conferidas no projeto real com `set local role
authenticated` — outro tenant recebe `42501` ao gravar e `null` ao ler.

---

## 8. Limitações conhecidas

- **PDF** não é gerado (ver §4).
- O **QR da prévia é ilustrativo**: mostra tamanho e distribuição, não o código.
  Um QR falso que funcionasse na tela acabaria impresso por alguém.
- O editor salva a arte para **todas as mesas** da casa. Arte por mesa é uma
  evolução possível; o escopo pediu modelo único com personalização.
- O PNG depende do `sharp` que já vem com o Next. Se a rasterização falhar, a
  rota responde 503 sugerindo o SVG — o vetor é a saída correta de qualquer
  forma.
