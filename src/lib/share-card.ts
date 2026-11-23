/**
 * Imagem compartilhável do cardápio — Etapa 23.
 *
 * O que o WhatsApp mostra quando o dono cola o link: título, descrição e uma
 * **imagem**. Sem imagem, o link fica com um quadrado cinza — e um cardápio que
 * aparece como quadrado cinza perde o clique para o concorrente que tem foto.
 *
 * ─── Por que desenhamos em SVG e não usamos `next/og` ──────────────────────
 *
 * A rota `next/og` (Satori + resvg) resolve isso, mas custa ~500 kB no bundle da
 * função e exige uma fonte embutida — sem fonte, o texto sai vazio no Linux da
 * Vercel. O nosso caso é simples: fundo, faixa de cor da marca, nome do
 * restaurante, uma linha de chamada e o selo "Cardápio digital". Isso é um SVG de
 * 1 kB, com a fonte do sistema, que o `sharp` (já usado na Etapa 22) rasteriza em
 * poucos milissegundos.
 *
 * ─── Formato ──────────────────────────────────────────────────────────────
 *
 * 1200×630 (1.91:1) é o que o WhatsApp, o Facebook, o LinkedIn e o Twitter
 * recortam sem cortar texto. 1200×1200 também funciona no WhatsApp, mas vira
 * faixa no Facebook; 630 de altura é o denominador comum.
 *
 * Módulo neutro: sem React, sem `server-only`. A rota usa isto e os testes
 * verificam a geometria sem subir servidor.
 */

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

export type ShareCardInput = {
  restaurantName: string;
  /** Chamada curta. `null` usa a padrão. */
  headline?: string | null;
  /** URL em texto, mostrada no rodapé (dá confiança e evita "link estranho"). */
  displayUrl?: string | null;
  /** Cor de destaque (a da marca do restaurante, se houver tema). */
  accent?: string | null;
  /** Logo em data URI ou URL absoluta do bucket do tenant. */
  logoDataUri?: string | null;
};

export const CARD_DEFAULT_HEADLINE = "Confira nosso cardápio digital";

/** Fonte do sistema: renderiza igual no Linux da Vercel e no navegador. */
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/**
 * Corpo do nome conforme o comprimento.
 *
 * Nome curto ("Bar do Zé") fica enorme e ocupa o card; nome longo precisa
 * encolher para não sair da arte. O limite de 24 caracteres de `fitName` garante
 * que o menor corpo (52 px) ainda caiba em 1200 px de largura.
 */
export function nameSize(name: string): number {
  if (name.length <= 12) return 92;
  if (name.length <= 18) return 76;
  return 60;
}

/** Verifica se a string é um hex de 6 dígitos — a única cor que entra no SVG. */
export function isHexColor(value: string | null | undefined): boolean {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

/**
 * Escolhe a cor de destaque legível sobre branco.
 *
 * O tema do restaurante pode ser amarelo-limão. Sobre o fundo branco da arte,
 * texto amarelo é ilegível — então a cor de destaque é usada como **faixa de
 * fundo** com texto branco, e só quando contrasta. Abaixo de 3:1 a faixa cai no
 * verde da plataforma: o selo "Cardápio digital" precisa ser lido.
 */
export function accentColor(value: string | null | undefined): string {
  if (!isHexColor(value)) return "#0f9250";
  const color = String(value).toLowerCase();
  // Branco como faixa deixaria o selo invisível sozinho: cai no verde.
  return color === "#ffffff" ? "#0f9250" : color;
}

/**
 * Trunca o nome do restaurante para uma linha.
 *
 * 24 caracteres em 66 px ocupam ~900 px dos 1200 — sobra margem para nomes
 * longos sem que o texto saia da arte. O corte acontece no espaço mais próximo
 * quando existe, para não cortar palavra no meio.
 */
export function fitName(name: string, max = 24): string {
  const clean = String(name ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;

  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

/**
 * Remove emoji e símbolos pictográficos do texto da arte.
 *
 * Medido, não suposto: a arte gerada com a chamada padrão (que tem 🍽️) saiu com
 * uma **caixa vazia** no lugar do emoji. O `sharp` rasteriza SVG com as fontes do
 * sistema, e a imagem do contêiner da Vercel não tem fonte de emoji — o mesmo
 * acontece em qualquer servidor Linux mínimo. Na mensagem do WhatsApp o emoji
 * fica (lá quem desenha é o aparelho do cliente, que tem fonte); na **arte** ele
 * vira lixo visual, então é removido.
 *
 * O filtro cobre os blocos pictográficos e os complementos (tons de pele,
 * seletor de variação, ZWJ), que fora de contexto viram quadradinhos soltos.
 */
export function plainText(value: string): string {
  return String(value ?? "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Escapa texto para XML (nome de restaurante com `&` quebraria o SVG). */
export function escapeXmlText(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * SVG da imagem de compartilhamento.
 *
 * Layout: fundo claro, faixa de cor no rodapé com o selo, nome grande no topo,
 * chamada abaixo, URL discreta. Texto centralizado porque a prévia do WhatsApp
 * recorta as laterais em telas estreitas — o que está no centro sobrevive.
 */
export function shareCardSvg(input: ShareCardInput): string {
  const accent = accentColor(input.accent);
  const name = escapeXmlText(fitName(plainText(input.restaurantName)));
  // `plainText` antes do escape: emoji sem fonte de sistema sai como caixa vazia
  // no PNG (ver o comentário da função).
  const headline = escapeXmlText(
    plainText(input.headline ?? "") || CARD_DEFAULT_HEADLINE,
  ).slice(0, 80);
  const displayUrl = input.displayUrl ? escapeXmlText(shortUrl(input.displayUrl)) : null;

  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_CARD_WIDTH}" height="${SHARE_CARD_HEIGHT}" viewBox="0 0 ${SHARE_CARD_WIDTH} ${SHARE_CARD_HEIGHT}" role="img" aria-label="${name}">`,
  );

  // Fundo: branco puro. A prévia do WhatsApp é exibida sobre cinza-claro; fundo
  // branco com faixa colorida lê melhor que fundo colorido inteiro.
  parts.push(`<rect width="${SHARE_CARD_WIDTH}" height="${SHARE_CARD_HEIGHT}" fill="#ffffff"/>`);

  // Faixa superior fina: cor da marca sem comprometer o contraste do texto.
  parts.push(`<rect width="${SHARE_CARD_WIDTH}" height="14" fill="${accent}"/>`);

  if (input.logoDataUri) {
    parts.push(
      `<image href="${escapeXmlText(input.logoDataUri)}" x="540" y="64" width="120" height="120" preserveAspectRatio="xMidYMid meet"/>`,
    );
  }

  // O nome fica mais baixo e maior quando há logo — o olho lê a marca primeiro.
  const nameY = input.logoDataUri ? 296 : 250;
  parts.push(
    `<text x="600" y="${nameY}" text-anchor="middle" font-family="${FONT}" font-size="${nameSize(name)}" font-weight="700" fill="#111827">${name}</text>`,
  );

  parts.push(
    `<text x="600" y="${nameY + 76}" text-anchor="middle" font-family="${FONT}" font-size="34" fill="#4b5563">${headline}</text>`,
  );

  // Pílula com o endereço.
  //
  // Existe por dois motivos: preenche o vazio do meio (um card com dois terços
  // de branco parece inacabado) e mostra **para onde o link leva** antes do
  // clique — quem recebe desconfia menos de um endereço legível do que de um
  // `bit.ly` qualquer.
  if (displayUrl) {
    parts.push(
      `<rect x="300" y="${SHARE_CARD_HEIGHT - 196}" width="600" height="66" rx="33" fill="#f3f4f6"/>`,
    );
    parts.push(
      `<text x="600" y="${SHARE_CARD_HEIGHT - 152}" text-anchor="middle" font-family="${FONT}" font-size="26" fill="#374151">${displayUrl}</text>`,
    );
  }

  // Rodapé: faixa da marca com o selo.
  parts.push(`<rect y="${SHARE_CARD_HEIGHT - 90}" width="${SHARE_CARD_WIDTH}" height="90" fill="${accent}"/>`);
  parts.push(
    `<text x="600" y="${SHARE_CARD_HEIGHT - 36}" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="600" fill="#ffffff">Cardápio digital</text>`,
  );

  parts.push("</svg>");
  return parts.join("");
}

/**
 * URL para exibir na arte.
 *
 * Sem `https://` e sem barra final: ocupa menos espaço e é como as pessoas leem
 * endereço. Se a URL for maior que 48 caracteres, corta o caminho no meio — o
 * domínio é a parte que dá confiança.
 */
export function shortUrl(url: string, max = 48): string {
  const clean = String(url ?? "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

/**
 * Cache da imagem.
 *
 * O nome do restaurante e a logo mudam pouco, mas quando mudam a imagem tem de
 * acompanhar — a prévia do WhatsApp é onde o erro fica visível para o cliente
 * final. Uma hora de cache é o equilíbrio: durante uma tarde de divulgação o
 * WhatsApp busca uma vez só.
 */
export const SHARE_CARD_CACHE_SECONDS = 3600;
