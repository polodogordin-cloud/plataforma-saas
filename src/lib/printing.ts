import {
  PAYMENT_METHOD_LABEL,
  PRINT_JOB_STATUS_LABEL,
  PRINT_PROVIDER_SUPPORT,
  type PaperWidth,
  type PrintJobStatus,
  type PrintOrderDocument,
  type PrintProviderKind,
} from "@/lib/types";

/**
 * Regras puras da impressão — Etapa 18.
 *
 * O que este arquivo faz, e o que ele **não** faz:
 *
 *   • Faz: montar o documento do pedido em texto puro, na largura do papel,
 *     para que o mesmo conteúdo possa ser desenhado em HTML (navegador) ou
 *     enviado a um bridge como ESC/POS. Uma fonte de verdade, dois destinos.
 *
 *   • Não faz: conversar com a impressora. Nenhum código de navegador abre a
 *     porta USB de uma térmica. Isso está escrito no `PrintProvider`, não
 *     escondido aqui.
 *
 * A escolha do texto puro como núcleo é o motivo de isto ser testável sem DOM:
 * quebra de linha, alinhamento e largura são as três coisas que dão errado num
 * cupom de 58mm — e todas as três são aritmética, não pixel.
 */

/* -------------------------------------------------------------------------- */
/* Papel                                                                      */
/* -------------------------------------------------------------------------- */

export type PaperSpec = {
  width: PaperWidth;
  /** Largura nominal do rolo, em mm. */
  nominalMm: number;
  /**
   * Área imprimível real. Não é o nominal: a térmica de 58mm imprime ~48mm e
   * a de 80mm ~72mm, porque a cabeça não alcança as bordas.
   */
  printableMm: number;
  /**
   * Colunas de texto em fonte monoespaçada padrão (12 cpm por caractere a
   * 203 dpi). É a medida que importa para ESC/POS e para a quebra de linha.
   */
  columns: number;
  label: string;
};

export const PAPER_SPECS: Record<PaperWidth, PaperSpec> = {
  "58": { width: "58", nominalMm: 58, printableMm: 48, columns: 32, label: "58mm" },
  "80": { width: "80", nominalMm: 80, printableMm: 72, columns: 48, label: "80mm" },
};

export function paperSpec(width: PaperWidth): PaperSpec {
  return PAPER_SPECS[width] ?? PAPER_SPECS["80"];
}

/**
 * Caracteres por linha de um item com quantidade.
 *
 * A coluna de quantidade reserva espaço ("2x "), então o nome do produto tem
 * menos largura que a linha inteira. Manter isso explícito evita o clássico
 * "nome do produto encostando no preço" que só aparece no papel.
 */
export function itemColumns(width: PaperWidth, showPrices: boolean): number {
  const spec = paperSpec(width);
  // "10x " = 4 colunas; preço à direita ocupa até 12 (R$ 1.234,56).
  const priceWidth = showPrices ? 12 : 0;
  return Math.max(8, spec.columns - 4 - priceWidth);
}

/* -------------------------------------------------------------------------- */
/* Texto                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Quebra gulosa por palavra, respeitando a largura.
 *
 * Quebra por caractere puro cortaria "X-Bacon" ao meio; quebra por palavra
 * grande demais (nome enorme, URL) não pode entrar em laço infinito, por isso
 * a palavra sozinha maior que a linha é fatiada.
 */
export function wrapText(text: string, columns: number): string[] {
  const limit = Math.max(1, Math.floor(columns));
  const source = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!source) return [];

  const lines: string[] = [];
  let current = "";

  for (const word of source.split(" ")) {
    if (word.length > limit) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let index = 0; index < word.length; index += limit) {
        lines.push(word.slice(index, index + limit));
      }
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= limit) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

/** Alinha à esquerda e à direita na mesma linha, preenchendo o meio. */
export function justify(left: string, right: string, columns: number): string {
  const l = String(left ?? "");
  const r = String(right ?? "");
  const gap = columns - l.length - r.length;

  if (gap <= 0) {
    // Sem espaço: quebra o texto da esquerda e deixa o valor na última linha.
    const wrapped = wrapText(l, Math.max(1, columns - r.length));
    if (wrapped.length === 0) return r.slice(0, columns);
    const head = wrapped.slice(0, -1);
    const last = wrapped[wrapped.length - 1] ?? "";
    const lastGap = Math.max(1, columns - last.length - r.length);
    return [...head, `${last}${" ".repeat(lastGap)}${r}`].join("\n");
  }

  return `${l}${" ".repeat(gap)}${r}`;
}

/** Centraliza sem cortar: texto maior que a linha é quebrado e cada parte centralizada. */
export function center(text: string, columns: number): string[] {
  return wrapText(text, columns).map((line) => {
    const pad = Math.max(0, Math.floor((columns - line.length) / 2));
    return `${" ".repeat(pad)}${line}`;
  });
}

/** Separador simples. Sem enfeite: papel térmico é caro e cada linha conta. */
export function separator(columns: number, char = "-"): string {
  return char.repeat(Math.max(1, Math.floor(columns)));
}

export function money(value: number): string {
  const number = Number.isFinite(value) ? value : 0;
  return number.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** "21/11/2026 18:42" no fuso da casa. */
export function dateTimeInZone(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  try {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(date);
  } catch {
    return date.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Documento                                                                  */
/* -------------------------------------------------------------------------- */

export type TicketOptions = {
  width: PaperWidth;
  /** Cópia numerada ("2ª via"). `null` = via principal. */
  copyLabel?: string | null;
  /** Mostrar preços. A cozinha normalmente não quer. */
  showPrices?: boolean;
  /** Papel de teste: troca o conteúdo por linhas de calibração. */
  test?: boolean;
};

/**
 * Linhas do cupom, na ordem em que saem da térmica.
 *
 * A ordem segue o que a cozinha lê de cima para baixo: quem é, qual pedido,
 * onde entregar, quando, o que fazer, quanto custa. Preço no fim de propósito —
 * quem está com a chapa quente não deve tropeçar em valor no meio dos itens.
 */
export function buildTicketLines(
  doc: PrintOrderDocument,
  options: TicketOptions,
): string[] {
  const spec = paperSpec(options.width);
  const cols = spec.columns;
  const showPrices = options.showPrices ?? doc.settings.show_prices;
  const lines: string[] = [];

  if (options.test) {
    return buildTestLines(options.width, doc.restaurant.name);
  }

  /* Cabeçalho: nome da casa em destaque (centralizado, 2 linhas no máximo). */
  lines.push(...center(doc.restaurant.name, cols).slice(0, 2));
  if (doc.settings.footer_note) {
    // O rodapé livre só aparece no fim; no topo ele empurraria o número.
  }
  lines.push("");

  /* Identificação do pedido: o dado mais importante do papel. */
  if (options.copyLabel) {
    lines.push(...center(options.copyLabel, cols));
  }
  lines.push(...center(`PEDIDO #${doc.order.order_number}`, cols));
  lines.push(...center(doc.order.table_name, cols));
  lines.push(separator(cols, "="));

  lines.push(`Data: ${dateTimeInZone(doc.order.created_at, doc.restaurant.timezone)}`);
  lines.push(`Canal: ${channelLabel(doc.order.channel)}`);
  lines.push(separator(cols));

  /* Itens. */
  const nameCols = itemColumns(options.width, showPrices);
  lines.push(showPrices ? justify("ITEM", "VALOR", cols) : "ITEM");
  lines.push(separator(cols, "-"));

  for (const item of doc.order.items) {
    const quantity = `${item.quantity}x `;

    if (showPrices) {
      const nameLines = wrapText(item.name, nameCols);
      const first = nameLines[0] ?? "";
      lines.push(justify(`${quantity}${first}`, money(item.subtotal), cols));
      for (const extra of nameLines.slice(1)) {
        lines.push(`${" ".repeat(quantity.length)}${extra}`);
      }
    } else {
      for (const [index, nameLine] of wrapText(item.name, cols - quantity.length).entries()) {
        lines.push(index === 0 ? `${quantity}${nameLine}` : `${" ".repeat(quantity.length)}${nameLine}`);
      }
    }

    /*
     * Adicionais: indentados e sem preço. Quem monta o prato precisa saber
     * "sem cebola" mais do que quanto custou a exclusão.
     */
    for (const option of item.options) {
      for (const [index, optionLine] of wrapText(`+ ${option.name}`, cols - 2).entries()) {
        lines.push(index === 0 ? `  ${optionLine}` : `    ${optionLine}`);
      }
    }

    /* Observação do item: marcada, nunca escondida. */
    if (item.notes) {
      for (const noteLine of wrapText(`OBS: ${item.notes}`, cols - 2)) {
        lines.push(`  ${noteLine}`);
      }
    }
  }

  lines.push(separator(cols, "-"));

  /* Observação do pedido: o lugar mais visível do cupom. */
  if (doc.order.notes) {
    lines.push(...wrapText("OBSERVACAO DO PEDIDO:", cols));
    for (const noteLine of wrapText(doc.order.notes, cols - 2)) {
      lines.push(`  ${noteLine}`);
    }
    lines.push(separator(cols, "-"));
  }

  /* Total. Subtotal, taxas e desconto só quando existem — cupom curto. */
  if (showPrices) {
    if (doc.order.fees > 0) lines.push(justify("Taxa", money(doc.order.fees), cols));
    // Etapa 25: o cupom aparece na via impressa junto do desconto — é a
    // pergunta do cliente no balcão ("usei o cupom, saiu certo?").
    if (doc.order.discount > 0)
      lines.push(
        justify(
          doc.order.coupon_code ? `Desconto ${doc.order.coupon_code}` : "Desconto",
          `-${money(doc.order.discount)}`,
          cols,
        ),
      );
    lines.push(justify("TOTAL", money(doc.order.total), cols));
  }

  /*
   * Forma de pagamento: só quando existe recebimento registrado no livro da
   * Etapa 16. Sem pagamento, a linha não sai — papel não é lugar de supor.
   */
  const payments = doc.order.payments.filter((payment) => payment.amount > 0);
  if (payments.length > 0) {
    lines.push(separator(cols));
    for (const payment of payments) {
      lines.push(justify(PAYMENT_METHOD_LABEL[payment.method], money(payment.amount), cols));
    }
  }

  if (doc.settings.footer_note) {
    lines.push(separator(cols));
    lines.push(...center(doc.settings.footer_note, cols));
  }

  lines.push("");
  lines.push(...center(`Emitido ${dateTimeInZone(new Date().toISOString(), doc.restaurant.timezone)}`, cols));

  return lines;
}

function channelLabel(channel: PrintOrderDocument["order"]["channel"]): string {
  switch (channel) {
    case "takeaway":
      return "Retirada";
    case "delivery":
      return "Entrega";
    default:
      return "Mesa";
  }
}

/**
 * Página de teste.
 *
 * Existe porque o problema real de impressão térmica é **calibragem**: se o
 * texto encosta na borda, se a linha de 48 colunas quebra em duas, se o papel
 * está torto. O teste mostra as três coisas de uma vez, com marcadores que
 * tornam o erro visível — não um "hello world" que sempre "funciona".
 */
export function buildTestLines(width: PaperWidth, restaurantName: string): string[] {
  const spec = paperSpec(width);
  const cols = spec.columns;
  const lines: string[] = [];

  lines.push(...center("TESTE DE IMPRESSAO", cols));
  lines.push("");
  lines.push(...center(restaurantName, cols));
  lines.push(separator(cols, "="));

  lines.push(`Papel: ${spec.label}`);
  lines.push(`Area util: ${spec.printableMm}mm`);
  lines.push(`Colunas: ${cols}`);
  lines.push(separator(cols));

  /* Régua: mostra a largura real, contada. */
  lines.push("Regua de 10 em 10:");
  let ruler = "";
  for (let index = 1; index <= cols; index += 1) {
    ruler += index % 10 === 0 ? String((index / 10) % 10) : ".";
  }
  lines.push(ruler);
  lines.push(separator(cols));

  /* Bordas: se estas linhas quebrarem, o texto está mais largo que o papel. */
  lines.push(`|${"a".repeat(cols - 2)}|`);
  lines.push(`|${" ".repeat(cols - 2)}|`);
  lines.push(`|${"0".repeat(cols - 2)}|`);
  lines.push(separator(cols));

  lines.push("Alinhamento:");
  lines.push(justify("Esquerda", "Direita", cols));
  lines.push(...center("Centralizado", cols));
  lines.push(separator(cols));

  lines.push("Quebra de linha:");
  lines.push(
    ...wrapText(
      "Se este texto aparece inteiro e sem cortar palavras no meio, a quebra automatica esta correta para a largura escolhida.",
      cols,
    ),
  );
  lines.push("");
  lines.push(...center("FIM DO TESTE", cols));

  return lines;
}

/** Texto completo (o que um bridge mandaria como corpo do cupom). */
export function ticketText(doc: PrintOrderDocument, options: TicketOptions): string {
  return buildTicketLines(doc, options).join("\n");
}

/* -------------------------------------------------------------------------- */
/* Provedores                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * O que o provedor consegue hoje.
 *
 * Este é o ponto que impede a UI de mentir. Só `browser` sai como disponível,
 * e mesmo ele com a ressalva de que a térmica é escolhida na janela do
 * sistema — o navegador não seleciona impressora, não sabe o modelo e não
 * recebe confirmação de papel.
 */
export function providerIsAvailable(provider: PrintProviderKind): boolean {
  return PRINT_PROVIDER_SUPPORT[provider] === "available";
}

/**
 * Status honesto de uma solicitação de impressão.
 *
 * Com provedor `browser` o resultado é sempre `requested`: o app entregou o
 * documento à caixa de diálogo e perdeu o rastro dali em diante (a pessoa pode
 * cancelar, escolher outro papel ou outra impressora). Chamar de "impresso"
 * seria inventar.
 */
export function resolveJobStatus(provider: PrintProviderKind): PrintJobStatus {
  return providerIsAvailable(provider) ? "requested" : "unsupported";
}

export function jobStatusLabel(status: PrintJobStatus): string {
  return PRINT_JOB_STATUS_LABEL[status] ?? status;
}

/* -------------------------------------------------------------------------- */
/* Validação (espelha o zod da action, e é o que os testes cobrem)            */
/* -------------------------------------------------------------------------- */

export const PAPER_WIDTHS: readonly PaperWidth[] = ["58", "80"] as const;

export function normalizePaperWidth(value: unknown): PaperWidth {
  return value === "58" ? "58" : "80";
}

export function normalizeCopies(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(3, Math.max(1, Math.round(parsed)));
}

export const FOOTER_NOTE_MAX = 120;
export const PROFILE_NAME_MAX = 40;
export const PRINTER_NAME_MAX = 60;
export const PRINTER_IDENTIFIER_MAX = 120;
