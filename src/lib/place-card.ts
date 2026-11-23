/**
 * Gerador de plaquinhas de QR Code — Etapa 22.
 *
 * Módulo **neutro** (sem React, sem `server-only`, sem DOM) pelo mesmo motivo de
 * `qr.ts` e `theme-upload.ts`: as regras que decidem se uma placa é legível
 * precisam rodar nos dois lados (preview no navegador, download no servidor) e
 * ser testáveis em Node puro.
 *
 * ─── O que este módulo decide, e por que importa ───────────────────────────
 *
 * O escopo é explícito: "Nunca permitir uma personalização que prejudique a
 * leitura do QR Code". Isso não é uma sugestão de interface — é uma restrição
 * física. Um QR Code é lido por contraste entre módulos escuros e claros, com
 * uma margem silenciosa obrigatória em volta. Se o dono escolher amarelo no
 * branco, o arquivo sai bonito na tela e **não abre no celular do cliente**.
 * Ninguém descobre isso até a placa estar impressa e colada na mesa.
 *
 * Então a regra não vive num `if` de componente: vive aqui, em funções que
 * devolvem números e podem ser testadas. A interface só mostra o resultado e o
 * servidor aplica o mesmo cálculo antes de gerar o arquivo — o cliente não
 * consegue "pedir" uma placa ilegível nem adulterando a requisição.
 *
 * ─── O que muda e o que não muda ──────────────────────────────────────────
 *
 * A URL vai sempre para `public_token` da mesa (`/r/{slug}/table/{token}`). Ela
 * não contém id de produto, preço nem tema: editar o cardápio, trocar a foto do
 * hambúrguer ou mudar as cores não altera um único byte do QR. Só duas ações
 * mudam o código, e as duas são explícitas e avisadas na tela:
 *
 *   • **regenerar o token** da mesa (invalida o código impresso);
 *   • **trocar o slug** do restaurante (invalida todos de uma vez).
 *
 * O token anterior continua válido por uma janela de tolerância no banco, então
 * quem já escaneou não é derrubado no meio do pedido.
 */

/* ========================================================================== */
/* 1. Formatos e modelos                                                     */
/* ========================================================================== */

export type PlaceFormat = "square" | "card" | "tent";

/**
 * Formatos físicos.
 *
 *   • `square` — 80×80 mm, o menor que ainda comporta QR de 50 mm com texto.
 *     Serve para adesivo de mesa e etiqueta.
 *   • `card`   — 90×120 mm, formato de cartão de visita em pé. O mais versátil:
 *     cabe em suporte de acrílico.
 *   • `tent`   — 100×150 mm dobrado ao meio (plaquinha "tenda"). Metade do
 *     tamanho por face, por isso o `widthMm` declarado é a face, não o total.
 *
 * Todas as medidas em milímetros porque é a unidade da gráfica caseira e da
 * impressora doméstica. Trabalhar em px faria a placa sair em tamanho diferente
 * em cada impressora.
 */
export const PLACE_FORMATS: Record<
  PlaceFormat,
  { id: PlaceFormat; label: string; hint: string; widthMm: number; heightMm: number }
> = {
  square: {
    id: "square",
    label: "Quadrado",
    hint: "80 × 80 mm · adesivo ou etiqueta",
    widthMm: 80,
    heightMm: 80,
  },
  card: {
    id: "card",
    label: "Cartão em pé",
    hint: "90 × 120 mm · suporte de mesa",
    widthMm: 90,
    heightMm: 120,
  },
  tent: {
    id: "tent",
    label: "Placa tenda",
    hint: "100 × 150 mm · dobra ao meio",
    widthMm: 100,
    heightMm: 150,
  },
};

export const PLACE_FORMAT_IDS: PlaceFormat[] = ["square", "card", "tent"];

export type PlaceTemplateId =
  | "simples"
  | "aponte"
  | "peca-pelo-celular"
  | "mesa"
  | "mesa-nfc";

export type PlaceTemplate = {
  id: PlaceTemplateId;
  label: string;
  /** Texto de apoio mostrado no seletor (não vai para a placa). */
  hint: string;
  /**
   * Linha de instrução impressa. `null` = placa só com QR e nome.
   *
   * O texto é curto de propósito: em 80 mm de largura, mais de ~40 caracteres
   * quebra em três linhas e empurra o QR para fora da margem.
   */
  instruction: string | null;
  /** Mostra a palavra "NFC" na placa. Nunca promete gravação pelo navegador. */
  showNfc: boolean;
};

/**
 * Modelos de placa.
 *
 * O escopo pede "QR + QR + NFC" — interpretei como o modelo que mostra o QR **e**
 * a marca de NFC, para a placa que serve aos dois canais. Não existe modelo com
 * dois QR Codes: dois códigos iguais na mesma placa só confundem quem aponta a
 * câmera, e dois diferentes não caberiam legíveis em 80 mm.
 */
export const PLACE_TEMPLATES: PlaceTemplate[] = [
  {
    id: "simples",
    label: "QR Code simples",
    hint: "Só o código e o nome. Menos é mais.",
    instruction: null,
    showNfc: false,
  },
  {
    id: "aponte",
    label: "Aponte a câmera",
    hint: "A instrução mais direta para quem nunca viu.",
    instruction: "Aponte a câmera do celular",
    showNfc: false,
  },
  {
    id: "peca-pelo-celular",
    label: "Peça pelo celular",
    hint: "Foco na ação, não no mecanismo.",
    instruction: "Peça pelo celular",
    showNfc: false,
  },
  {
    id: "mesa",
    label: "Com o nome da mesa",
    hint: "Mesa em destaque para o garçom conferir.",
    instruction: "Aponte a câmera para ver o cardápio",
    showNfc: false,
  },
  {
    id: "mesa-nfc",
    label: "QR Code + NFC",
    hint: "Uma placa para os dois canais de aproximação.",
    instruction: "Aponte a câmera ou aproxime o celular",
    showNfc: true,
  },
];

export const PLACE_TEMPLATE_IDS = PLACE_TEMPLATES.map((template) => template.id);

export function getPlaceTemplate(id: string | null | undefined): PlaceTemplate {
  return PLACE_TEMPLATES.find((template) => template.id === id) ?? PLACE_TEMPLATES[0]!;
}

/* ========================================================================== */
/* 2. Contraste — a regra que não se negocia                                 */
/* ========================================================================== */

/** Converte `#rrggbb` em [r, g, b] 0–255. Devolve `null` para formato inválido. */
export function parseHex(value: string | null | undefined): [number, number, number] | null {
  const raw = String(value ?? "").trim();
  if (!/^#[0-9a-f]{6}$/i.test(raw)) return null;
  return [
    parseInt(raw.slice(1, 3), 16),
    parseInt(raw.slice(3, 5), 16),
    parseInt(raw.slice(5, 7), 16),
  ];
}

/** Luminância relativa (WCAG 2.1). */
export function relativeLuminance(color: [number, number, number]): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = color.map(channel) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razão de contraste entre duas cores (1:1 a 21:1). */
export function contrastRatio(a: string, b: string): number {
  const first = parseHex(a);
  const second = parseHex(b);
  if (!first || !second) return 0;

  const la = relativeLuminance(first);
  const lb = relativeLuminance(second);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Contraste mínimo para o QR Code.
 *
 * A ISO/IEC 18004 não fixa um número de razão de contraste — ela fala em
 * "diferença suficiente entre módulos claros e escuros". Na prática, leitores de
 * celular com câmera de entrada e luz de salão começam a falhar por volta de
 * 3:1, e ficam confortáveis a partir de 4,5:1. Adotamos **7:1** (o nível AAA de
 * texto) porque:
 *
 *   • a placa vai ficar numa mesa de bar, com pouca luz e possivelmente suja;
 *   • o celular do cliente pode estar com a lente riscada;
 *   • a câmera faz a leitura num ângulo qualquer, não de frente.
 *
 * 7:1 dá margem para tudo isso. É mais restritivo que o necessário e é de
 * propósito: reprovar uma cor bonita custa um ajuste na tela; aprovar uma placa
 * ilegível custa uma tiragem inteira impressa.
 */
export const MIN_QR_CONTRAST = 7;

/**
 * Contraste mínimo para **texto sobre a cor de fundo da placa** (4,5:1, WCAG AA).
 *
 * Separado do QR porque são riscos diferentes: o QR precisa ser lido por uma
 * máquina; o texto de instrução, por uma pessoa em pé, a um metro. Quatro e
 * meio é o mínimo que a WCAG considera legível para texto normal.
 */
export const MIN_TEXT_CONTRAST = 4.5;

export type ContrastCheck = {
  ratio: number;
  /** `true` quando atinge o mínimo exigido. */
  ok: boolean;
  /** Mensagem pronta para a tela, já explicando o problema em português. */
  message: string | null;
};

/**
 * Valida o par QR (escuro × claro).
 *
 * Devolve sempre a razão calculada — a tela mostra o número mesmo quando passa,
 * porque "8,4:1" informa mais que um check verde.
 */
export function checkQrContrast(dark: string, light: string): ContrastCheck {
  const ratio = contrastRatio(dark, light);
  if (!parseHex(dark) || !parseHex(light)) {
    return { ratio: 0, ok: false, message: "Cor inválida. Use o formato #rrggbb." };
  }
  if (ratio < MIN_QR_CONTRAST) {
    return {
      ratio,
      ok: false,
      message: `Contraste de ${ratio.toFixed(1)}:1. O mínimo para o QR abrir no celular é ${MIN_QR_CONTRAST}:1 — escureça o código ou clareie o fundo.`,
    };
  }
  return { ratio, ok: true, message: null };
}

/** Valida texto da placa contra o fundo. */
export function checkTextContrast(text: string, background: string): ContrastCheck {
  const ratio = contrastRatio(text, background);
  if (!parseHex(text) || !parseHex(background)) {
    return { ratio: 0, ok: false, message: "Cor inválida. Use o formato #rrggbb." };
  }
  if (ratio < MIN_TEXT_CONTRAST) {
    return {
      ratio,
      ok: false,
      message: `Contraste de ${ratio.toFixed(1)}:1 no texto. O mínimo legível é ${MIN_TEXT_CONTRAST}:1.`,
    };
  }
  return { ratio, ok: true, message: null };
}

/* ========================================================================== */
/* 3. Personalização                                                        */
/* ========================================================================== */

export type PlaceStyle = {
  /** Cor dos módulos escuros do QR. */
  qrDark: string;
  /** Cor do fundo do QR (área dele, não da placa inteira). */
  qrLight: string;
  /** Fundo da placa. */
  background: string;
  /** Cor do texto impresso. */
  text: string;
  /** Tamanho do QR em milímetros. */
  qrSizeMm: number;
  /** Margem interna da placa em milímetros. */
  marginMm: number;
  /** Mostrar logo do restaurante acima do QR. */
  showLogo: boolean;
  /** Mostrar nome do restaurante. */
  showRestaurant: boolean;
  /** Mostrar nome da mesa em destaque. */
  showTable: boolean;
  format: PlaceFormat;
  template: PlaceTemplateId;
};

/**
 * Padrão: preto sobre branco.
 *
 * Não usamos a cor da marca como padrão de propósito. A identidade visual do
 * restaurante pode ser laranja, verde-limão ou rosa — ótimas em botão de site,
 * arriscadas em QR impresso. Quem quiser colorir escolhe, vê o contraste
 * calculado e recebe o aviso se passar do limite.
 */
export const DEFAULT_PLACE_STYLE: PlaceStyle = {
  qrDark: "#111827",
  qrLight: "#ffffff",
  background: "#ffffff",
  text: "#111827",
  // 52 mm: no cartão padrão (90×120 mm) o limite é 55 mm, então 52 deixa o QR
  // grande — o que se quer numa plaquinha de mesa — e ainda cabe com logo,
  // nome da mesa, restaurante, instrução e marca NFC ligados.
  qrSizeMm: 52,
  marginMm: 6,
  showLogo: false,
  showRestaurant: true,
  showTable: true,
  format: "card",
  template: "aponte",
};

/**
 * Faixas que garantem legibilidade por construção.
 *
 * O tamanho do QR tem mínimo de 30 mm: abaixo disso, um QR de versão 4 (33
 * módulos) fica com módulos de ~0,9 mm, e a maioria das câmeras de celular
 * começa a errar. O máximo é limitado pela menor dimensão do formato menos as
 * margens — o QR não pode vazar da placa.
 *
 * A margem tem mínimo de 4 mm: a zona silenciosa do próprio QR (4 módulos) já
 * vem desenhada no SVG; esta margem é o respiro entre o QR e a borda física,
 * que evita que a tesoura ou o corte da gráfica coma a zona silenciosa.
 */
export const MIN_QR_MM = 30;
export const MIN_MARGIN_MM = 4;

/**
 * Reserva vertical para logo + textos, em mm.
 *
 * É a soma das alturas fixas de `placeGeometry` no pior caso (logo 14 + mesa 12
 * + restaurante 7 + instrução 12 + NFC 8). Usar um percentual da altura da placa
 * — a primeira tentativa — dava um limite que dependia do formato e deixava o
 * cartão com QR de 47 mm e a placa tenda com 54 mm, sem que a diferença
 * correspondesse a nada visível. A altura dos textos, ao contrário, **é** a
 * mesma nos três formatos; o que muda é o espaço que sobra.
 */
export const TEXT_RESERVE_MM = 53;

/**
 * Tamanho máximo do QR para um formato, dadas as margens.
 *
 * Duas restrições, e vale a menor:
 *
 *   • **largura** — o QR não pode passar da placa menos as margens laterais;
 *   • **altura** — sobra a área útil menos a pilha de textos.
 *
 * A primeira versão olhava só o menor lado da placa, o que funciona no formato
 * quadrado e erra nos retangulares: no cartão de 90×120 mm a altura não é o
 * gargalo, a largura é.
 */
export function maxQrMm(format: PlaceFormat, marginMm: number): number {
  const { widthMm, heightMm } = PLACE_FORMATS[format];
  const byWidth = widthMm - marginMm * 2;
  const byHeight = heightMm - marginMm * 2 - TEXT_RESERVE_MM;
  return Math.max(MIN_QR_MM, Math.floor(Math.min(byWidth, byHeight)));
}

/** Limita um valor numérico à faixa válida. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Normaliza o estilo vindo do cliente.
 *
 * Esta é a fronteira de confiança. O objeto pode chegar de um formulário, de
 * uma URL ou de uma requisição feita à mão — então tudo é reconferido:
 * cor no formato hex, número dentro da faixa, enum conhecido. O que não passa
 * cai no padrão em vez de estourar: uma placa com valor estranho deve sair
 * legível, não dar 500.
 */
export function normalizePlaceStyle(input: unknown): PlaceStyle {
  const raw = (input ?? {}) as Partial<Record<keyof PlaceStyle, unknown>>;

  const color = (value: unknown, fallback: string): string => {
    const text = String(value ?? "").trim().toLowerCase();
    return parseHex(text) ? text : fallback;
  };

  const format: PlaceFormat = PLACE_FORMAT_IDS.includes(raw.format as PlaceFormat)
    ? (raw.format as PlaceFormat)
    : DEFAULT_PLACE_STYLE.format;

  const template: PlaceTemplateId = PLACE_TEMPLATE_IDS.includes(raw.template as PlaceTemplateId)
    ? (raw.template as PlaceTemplateId)
    : DEFAULT_PLACE_STYLE.template;

  const marginMm = clamp(
    Number(raw.marginMm ?? DEFAULT_PLACE_STYLE.marginMm),
    MIN_MARGIN_MM,
    Math.round(Math.min(PLACE_FORMATS[format].widthMm, PLACE_FORMATS[format].heightMm) * 0.15),
  );

  const qrSizeMm = clamp(
    Number(raw.qrSizeMm ?? DEFAULT_PLACE_STYLE.qrSizeMm),
    MIN_QR_MM,
    maxQrMm(format, marginMm),
  );

  return {
    qrDark: color(raw.qrDark, DEFAULT_PLACE_STYLE.qrDark),
    qrLight: color(raw.qrLight, DEFAULT_PLACE_STYLE.qrLight),
    background: color(raw.background, DEFAULT_PLACE_STYLE.background),
    text: color(raw.text, DEFAULT_PLACE_STYLE.text),
    qrSizeMm,
    marginMm,
    showLogo: raw.showLogo === true,
    showRestaurant: raw.showRestaurant !== false,
    showTable: raw.showTable !== false,
    format,
    template,
  };
}

/**
 * Ajusta ao limite do formato **sem** trocar a escolha do dono.
 *
 * `normalizePlaceStyle` é a fronteira de confiança: valor inválido cai no padrão.
 * Aqui é outra coisa — uma escolha **válida** que deixou de caber porque o dono
 * mudou o formato ou a margem. Nesse caso o certo é encolher até o limite, não
 * voltar ao tamanho padrão (o dono veria o controle pular sozinho para 52 mm e
 * não entenderia por quê).
 *
 * Usado antes de cada gravação e na troca de formato na tela de personalização.
 */
export function clampStyleToFormat(style: PlaceStyle): PlaceStyle {
  const marginMm = clamp(style.marginMm, MIN_MARGIN_MM, 16);
  return {
    ...style,
    marginMm,
    qrSizeMm: clamp(style.qrSizeMm, MIN_QR_MM, maxQrMm(style.format, marginMm)),
  };
}

/**
 * O estilo é seguro para imprimir?
 *
 * Devolve a lista de problemas em vez de um booleano: a tela precisa mostrar
 * **qual** regra falhou, e o download precisa recusar por um motivo que o dono
 * consiga corrigir.
 */
export function validatePlaceStyle(style: PlaceStyle): {
  ok: boolean;
  problems: string[];
} {
  const problems: string[] = [];

  const qr = checkQrContrast(style.qrDark, style.qrLight);
  if (!qr.ok && qr.message) problems.push(qr.message);

  // Texto sobre o fundo da placa.
  const text = checkTextContrast(style.text, style.background);
  if (!text.ok && text.message) problems.push(text.message);

  // A área do QR precisa se destacar do resto da placa, senão a zona
  // silenciosa se confunde com a borda e a câmera perde o enquadramento.
  if (style.qrLight !== style.background) {
    const edge = contrastRatio(style.qrLight, style.background);
    if (edge < 1.2) {
      problems.push(
        "O fundo do QR está quase igual ao fundo da placa. Use a mesma cor ou um contraste visível.",
      );
    }
  }

  if (style.qrSizeMm < MIN_QR_MM) {
    problems.push(`O QR Code precisa ter pelo menos ${MIN_QR_MM} mm para ser lido de perto.`);
  }

  const max = maxQrMm(style.format, style.marginMm);
  if (style.qrSizeMm > max) {
    problems.push(`Neste formato, o QR Code não pode passar de ${max} mm sem encostar na borda.`);
  }

  // A pilha de conteúdo pode não caber mesmo com o QR no mínimo: 80×80 mm com
  // logo, nome da mesa, nome do restaurante e instrução somam mais que a altura
  // útil. Nesse caso a placa **transborda** — e o SVG cortaria o texto ou o QR
  // para fora da margem física. Melhor recusar e dizer o que desligar.
  const overflow = placeOverflowMm(style);
  if (overflow > 0.5) {
    problems.push(
      `O conteúdo não cabe em ${style.format === "square" ? "80×80" : style.format === "card" ? "90×120" : "100×150"} mm: sobram ${overflow.toFixed(0)} mm a menos. Desligue a logo, o nome da mesa ou o restaurante, reduza o QR ou escolha outro formato.`,
    );
  }

  return { ok: problems.length === 0, problems };
}

/* ========================================================================== */
/* 4. Geometria do SVG da placa                                             */
/* ========================================================================== */

export type PlaceGeometry = {
  widthMm: number;
  heightMm: number;
  marginMm: number;
  qrSizeMm: number;
  /** Canto superior esquerdo do QR, em mm. */
  qrX: number;
  qrY: number;
  /** Posições verticais dos blocos de texto, em mm. */
  logoY: number | null;
  tableY: number | null;
  restaurantY: number | null;
  instructionY: number | null;
  nfcY: number | null;
};

/**
 * Layout da placa.
 *
 * ─── Por que calcular em vez de usar flexbox ──────────────────────────────
 *
 * A placa é um SVG (para impressão vetorial) e um preview na tela que precisa
 * ser **idêntico** ao impresso. Se o preview fosse HTML e o arquivo SVG, os dois
 * divergiriam na primeira fonte, no primeiro arredondamento. Calculando a
 * geometria em milímetros, os dois consomem os mesmos números.
 *
 * O QR fica **centralizado na largura** e ancorado abaixo dos textos de cima.
 * A instrução vai para baixo dele — quem lê a placa já olhou para o código.
 */
export function placeGeometry(style: PlaceStyle): PlaceGeometry {
  const { widthMm, heightMm } = PLACE_FORMATS[style.format];
  const template = getPlaceTemplate(style.template);

  // Alturas de cada bloco, em mm. Números fixos porque a fonte é fixa; variar
  // o tamanho da letra por conteúdo faria duas placas parecidas saírem
  // diferentes e o layout "pular" de mesa para mesa.
  const logoHeight = style.showLogo ? 14 : 0;
  const tableHeight = style.showTable ? 12 : 0;
  const restaurantHeight = style.showRestaurant ? 7 : 0;
  const instructionHeight = template.instruction ? 12 : 0;
  const nfcHeight = template.showNfc ? 8 : 0;

  const stack = logoHeight + tableHeight + restaurantHeight + style.qrSizeMm + instructionHeight + nfcHeight;
  const available = heightMm - style.marginMm * 2;
  // Se a pilha não couber, o QR do topo fica levemente acima do centro — é
  // melhor que transbordar a margem ou encolher o código.
  const top = style.marginMm + Math.max(0, (available - stack) / 2);

  const qrX = (widthMm - style.qrSizeMm) / 2;

  let cursor = top;
  const logoY = style.showLogo ? cursor + logoHeight / 2 : null;
  cursor += logoHeight;

  const tableY = style.showTable ? cursor + tableHeight / 2 : null;
  cursor += tableHeight;

  const restaurantY = style.showRestaurant ? cursor + restaurantHeight / 2 : null;
  cursor += restaurantHeight;

  const qrY = cursor;
  cursor += style.qrSizeMm;

  const instructionY = template.instruction ? cursor + instructionHeight / 2 : null;
  cursor += instructionHeight;

  const nfcY = template.showNfc ? cursor + nfcHeight / 2 : null;

  return {
    widthMm,
    heightMm,
    marginMm: style.marginMm,
    qrSizeMm: style.qrSizeMm,
    qrX,
    qrY,
    logoY,
    tableY,
    restaurantY,
    instructionY,
    nfcY,
  };
}

/**
 * Quanto a pilha de conteúdo ultrapassa a área útil, em mm (0 = cabe).
 *
 * `placeGeometry` desloca para cima quando sobra espaço, mas quando **falta** ele
 * não tem para onde encolher: o conteúdo passa da margem e o SVG sai com texto
 * colado na borda (ou fora dela). Esta função é a mesma conta, usada só para
 * avisar antes de imprimir.
 */
export function placeOverflowMm(style: PlaceStyle): number {
  const geometry = placeGeometry(style);
  const bottom = Math.max(
    geometry.qrY + geometry.qrSizeMm,
    geometry.instructionY ?? 0,
    geometry.nfcY ?? 0,
  );
  const limit = geometry.heightMm - style.marginMm;
  return Math.max(0, Math.round((bottom - limit) * 10) / 10);
}

/* ========================================================================== */
/* 5. Texto da placa                                                        */
/* ========================================================================== */

/** Escapa texto para XML/SVG. Nome de restaurante com `&` quebraria o arquivo. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Trunca com reticências preservando o começo, que é o que identifica. */
export function truncate(value: string, max: number): string {
  const text = String(value ?? "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export type PlaceText = {
  restaurant: string;
  table: string;
  instruction: string | null;
  nfc: string | null;
};

/**
 * Texto efetivo da placa, já truncado para o espaço disponível.
 *
 * Os limites vêm do formato: uma placa de 80 mm comporta menos caracteres que
 * uma de 100 mm na mesma fonte. Truncar aqui (e não no CSS) garante que o SVG
 * tenha o texto final — SVG não tem `text-overflow`.
 */
export function placeText(input: {
  restaurantName: string;
  tableName: string;
  style: PlaceStyle;
}): PlaceText {
  const { widthMm } = PLACE_FORMATS[input.style.format];
  const template = getPlaceTemplate(input.style.template);

  // ~1 caractere por 2,2 mm na fonte da placa (medida empírica em 0,4 do
  // tamanho da placa). Serve para não estourar; não é tipografia de precisão.
  const tableLimit = Math.floor(widthMm / 2.4);
  const bodyLimit = Math.floor(widthMm / 1.8);

  return {
    restaurant: input.style.showRestaurant ? truncate(input.restaurantName, bodyLimit) : "",
    table: input.style.showTable ? truncate(input.tableName, tableLimit) : "",
    instruction: template.instruction ? truncate(template.instruction, bodyLimit) : null,
    nfc: template.showNfc ? "NFC" : null,
  };
}

/* ========================================================================== */
/* 6. Nome de arquivo                                                       */
/* ========================================================================== */

/**
 * Nome do arquivo baixado.
 *
 * Sem acento, sem espaço, sem barra: um nome com `/` ou `..` viraria caminho no
 * `Content-Disposition`, e nome com acento em `filename=` sem `filename*`
 * chega corrompido no Android. O sufixo de formato evita que baixar PNG e SVG
 * da mesma mesa sobrescreva um ao outro na pasta de downloads.
 */
export function placeFileName(input: {
  restaurantSlug: string;
  tableName: string;
  format: "png" | "svg";
  style: PlaceStyle;
}): string {
  const slugPart = input.restaurantSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  const tablePart = input.tableName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);

  const pieces = ["placa", slugPart, tablePart, input.style.format, input.style.template].filter(
    Boolean,
  );
  return `${pieces.join("-")}.${input.format}`;
}

/* ========================================================================== */
/* 7. Estabilidade do QR                                                    */
/* ========================================================================== */

/**
 * O que muda o QR Code?
 *
 * Existe como função — e não só como comentário — porque a resposta é a
 * garantia de estabilidade que o escopo pede. Testado: editar produto, preço,
 * categoria, tema ou qualquer conteúdo do cardápio **não** altera o código,
 * porque nada disso entra na URL.
 *
 * O QR é `origem + /r/{slug}/table/{token}`. Logo, só duas coisas o quebram:
 *
 *   • `slug` — trocar o link do restaurante invalida todos os QR da casa;
 *   • `token` — regenerar o token de uma mesa invalida só os dela.
 *
 * Com o token, o banco aceita o anterior por uma janela de tolerância
 * (`previous_token` / `previous_token_expires_at`), então a troca não derruba
 * quem já está com o cardápio aberto.
 */
export function qrPublicPath(input: { restaurantSlug: string; publicToken: string }): string {
  return `/r/${input.restaurantSlug}/table/${input.publicToken}`;
}

/** Motivos pelos quais um QR impresso pode parar de funcionar. */
export const QR_BREAKING_CHANGES = [
  "Regenerar o token da mesa",
  "Trocar o link (slug) do restaurante",
] as const;

/* ========================================================================== */
/* 8. NFC                                                                   */
/* ========================================================================== */

/**
 * URL para gravar na TAG NFC.
 *
 * É **exatamente** a mesma URL do QR — de propósito. Duas URLs diferentes para o
 * mesmo destino significariam duas coisas para manter, e uma delas
 * inevitavelmente ficaria velha.
 *
 * O texto que acompanha é taxativo: o navegador **não** grava TAG NFC. Existe a
 * Web NFC API, mas ela roda só em Chrome para Android, com a aba em primeiro
 * plano e a TAG encostada — não é algo que se prometa num produto que o dono
 * vai abrir no iPhone. Quem grava é um app próprio para isso, e o nosso papel é
 * entregar a URL pronta para copiar.
 */
export function nfcWriteInstructions(): string {
  return (
    "Copie a URL e grave em uma TAG NFC com um aplicativo de gravação (NFC Tools, " +
    "TagWriter). O navegador não grava a TAG sozinho — o aplicativo faz a gravação."
  );
}

/* ========================================================================== */
/* 9. Aviso de leitura                                                      */
/* ========================================================================== */

/**
 * Resultado consolidado da verificação de legibilidade.
 *
 * Usado pelo preview (para mostrar o selo verde/vermelho) e pela rota de
 * download (para recusar o arquivo). A mesma função nos dois lados é o que
 * impede a divergência entre "a tela disse que estava bom" e "o arquivo saiu
 * ilegível".
 */
export function readabilityReport(style: PlaceStyle): {
  ok: boolean;
  problems: string[];
  qrContrast: number;
  textContrast: number;
} {
  const validation = validatePlaceStyle(style);
  return {
    ok: validation.ok,
    problems: validation.problems,
    qrContrast: contrastRatio(style.qrDark, style.qrLight),
    textContrast: contrastRatio(style.text, style.background),
  };
}
