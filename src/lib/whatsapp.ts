/**
 * WhatsApp — núcleo puro da Etapa 13.
 *
 * Este arquivo **não tem `server-only` e não importa nada**: ele roda no
 * navegador (o botão do cardápio público), no servidor (a configuração) e nos
 * testes. É deliberado — a mesma função que monta o link é a que os testes
 * verificam, então não existe "a versão da tela" e "a versão do servidor".
 *
 * ─── O que este módulo é ───────────────────────────────────────────────────
 *
 * Um gerador de **links `wa.me`**: a pessoa toca no botão, o WhatsApp abre com a
 * mensagem já escrita, ela revisa e envia. Nenhuma mensagem sai do servidor.
 *
 * ─── O que este módulo não é ───────────────────────────────────────────────
 *
 * Não é a API oficial do WhatsApp Business. O escopo proíbe "integração falsa",
 * e a diferença é grande o bastante para valer um comentário:
 *
 *   • `wa.me` **não envia nada sozinho**. Se o dono estiver sem celular, sem
 *     WhatsApp ou com o número errado, a mensagem simplesmente não existe. Não
 *     há entrega, não há status, não há retentativa;
 *   • `wa.me` **não recebe nada**. Não existe webhook, não existe resposta
 *     automática, não existe confirmação;
 *   • portanto nada aqui pode ser usado para "confirmar pedido" ou "avisar o
 *     cliente". Quem quiser isso precisa da API oficial (Cloud API), com número
 *     verificado, token e conta aprovada.
 *
 * A separação que permite essa evolução está em `src/lib/whatsapp/provider.ts`:
 * o botão de hoje é um provedor "link" (sem servidor); a Cloud API entra como
 * outro provedor, sem que a tela mude de contrato. E o registro das mensagens
 * que precisam sair fica em `whatsapp_messages` (migração 0014), com estado
 * `queued`. Hoje nada as envia — de propósito.
 */

/* -------------------------------------------------------------------------- */
/* Normalização do número                                                      */
/* -------------------------------------------------------------------------- */

/**
 * DDI padrão. O produto é brasileiro (o cardápio é em pt-BR, o preço é BRL, o
 * fuso, `America/Sao_Paulo`), então um número digitado no formato nacional
 * assume +55. Quem digita `+351…` continua sendo respeitado — o `+` manda.
 */
export const DEFAULT_COUNTRY_CODE = "55";

/** O que o `wa.me` aceita: só dígitos, começando pelo DDI. */
const WA_ME_RE = /^[1-9]\d{7,14}$/;

/**
 * Dígitos de um telefone, já com DDI.
 *
 * Trata os formatos que as pessoas realmente digitam:
 *
 *   "(11) 99999-0000"      → 5511999990000
 *   "11 99999 0000"        → 5511999990000
 *   "011 99999-0000"       → 5511999990000 (zero de discagem não é DDD)
 *   "5511999990000"        → 5511999990000 (já tem DDI)
 *   "+55 (11) 99999-0000"  → 5511999990000
 *   "+351 912 345 678"     → 351912345678 (o + manda)
 *
 * Devolve `null` quando não é um telefone utilizável. `null` é resposta séria:
 * é melhor o botão não aparecer do que abrir o WhatsApp com um número inválido.
 */
export function normalizeWhatsappNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const input = String(raw).trim();
  if (!input) return null;

  /*
   * Ramal/anotação colada no número.
   *
   * "(11) 99999-0000 ramal 22" sem este corte virava 551199999000022: treze
   * dígitos que passam no formato do E.164 e abrem o WhatsApp para um número
   * que não existe. O ramal não é discável pelo `wa.me` — cortar é melhor que
   * recusar, porque o número principal é inequívoco.
   */
  const cleaned = input.replace(
    /\b(?:ramal|r\.|op[cç][aã]o|opc\.?|ext(?:ens[aã]o)?\.?|apto\.?)\s*:?\s*\d+\s*$/gi,
    "",
  );

  // Só dígitos, mas guardando se havia "+" e se o resto era realmente telefone.
  const hasPlus = cleaned.trim().startsWith("+");
  const digits = cleaned.replace(/\D/g, "");

  // Menos de 8 dígitos não é telefone em nenhum país; mais de 15 estoura o
  // E.164 (máximo de 15 dígitos).
  if (digits.length < 8 || digits.length > 15) return null;

  // Um único "0" na frente é prefixo de discagem nacional, não DDD.
  // ("011 99999-0000" é São Paulo, não um DDI 011.)
  const withoutTrunk = /^0\d/.test(digits) ? digits.replace(/^0+/, "") : digits;

  let full: string;
  if (hasPlus) {
    // Com "+", os dígitos já são o número internacional completo. É a única
    // forma não ambígua de dizer "não é Brasil": "+351 912 345 678" (Portugal)
    // tem 12 dígitos e começaria com 55 se recebesse o DDI brasileiro.
    full = withoutTrunk;
  } else if (withoutTrunk.startsWith("55") && withoutTrunk.length >= 12) {
    // Sem "+", mas com 55 na frente e tamanho de número internacional
    // (12 ou 13 dígitos = DDD + 8 ou 9): é o DDI já digitado. Números maiores
    // não são brasileiros e ganham o 55 como qualquer outro.
    full = withoutTrunk;
  } else {
    full = `${DEFAULT_COUNTRY_CODE}${withoutTrunk}`;
  }

  if (!WA_ME_RE.test(full)) return null;

  // Brasil: DDD válido é 11–99 (não existe 10, 20, 30… 90). Sem esta checagem,
  // "(00) 99999-0000" viraria um número de 13 dígitos que parece válido.
  if (full.startsWith("55") && full.length >= 12) {
    const ddd = Number(full.slice(2, 4));
    if (!Number.isInteger(ddd) || ddd < 11 || ddd > 99 || ddd % 10 === 0) return null;
  }

  return full;
}

/** O número pode ser usado em link? (mesma regra, nome explícito na chamada) */
export function isValidWhatsappNumber(raw: string | null | undefined): boolean {
  return normalizeWhatsappNumber(raw) !== null;
}

/**
 * Exibição amigável do número já normalizado.
 *
 *   "5511999990000" → "(11) 99999-0000"
 *   "351912345678"  → "+351 912345678"
 *
 * É só apresentação: o `wa.me` continua usando os dígitos crus.
 */
export function formatWhatsappNumber(raw: string | null | undefined): string {
  const digits = normalizeWhatsappNumber(raw);
  if (!digits) return "";

  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    const cut = rest.length - 4;
    return `(${ddd}) ${rest.slice(0, cut)}-${rest.slice(cut)}`;
  }

  return `+${digits}`;
}

/* -------------------------------------------------------------------------- */
/* Defaults e limites                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Mensagem inicial padrão.
 *
 * É a mesma sugestão do escopo, e serve como *placeholder* do campo — não é
 * gravada em nome de quem nunca abriu a tela. Ver `WhatsappConfig.isActive`:
 * a ausência de configuração é ausência de botão.
 */
export const DEFAULT_WHATSAPP_MESSAGE = "Olá! Gostaria de fazer um pedido.";

/**
 * Teto da mensagem inicial: 350 caracteres.
 *
 * A URL do `wa.me` carrega a mensagem no `?text=`, e endereços muito longos
 * são truncados por alguns navegadores e apps de mensagem. 350 cabe com folga
 * no que é digitado à mão — e a mensagem de pedido (gerada) tem limite próprio.
 */
export const WHATSAPP_MESSAGE_MAX = 350;

/**
 * Teto da mensagem de pedido: maior de propósito.
 *
 * Um pedido de 12 itens com nome de produto longo passa de 600 caracteres. O
 * limite existe para não gerar URL absurda, não para podar o pedido.
 */
export const WHATSAPP_ORDER_MESSAGE_MAX = 1200;

/* -------------------------------------------------------------------------- */
/* Codificação do texto                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Codifica o texto para o `?text=`.
 *
 * `encodeURIComponent` sozinho está quase certo — o que ele deixa passar são
 * `!'()*`, e um `'` num nome de produto ("Batata d'oro") quebraria o link ao ser
 * inserido em HTML. `!*'()` também são escapados aqui.
 */
export function encodeWhatsappText(text: string): string {
  return encodeURIComponent(text).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/* -------------------------------------------------------------------------- */
/* Link                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Link `wa.me` com a mensagem.
 *
 * Por que `wa.me` e não `api.whatsapp.com/send`: `wa.me` é o domínio curto
 * oficial, o único que abre o app instalado tanto no Android quanto no iOS sem
 * pedir confirmação extra. `whatsapp://send` (deep link nativo) é tentador, mas
 * falha feio em navegador de computador e em quem não tem o app — no salão,
 * a pessoa pode estar no tablet do restaurante.
 *
 * Devolve `null` quando não há número válido: o chamador decide não renderizar
 * o botão. Retornar `"https://wa.me/?text=..."` sem número abriria a tela de
 * "escolher contato" — parece bug, e o cliente não sabe para quem falar.
 */
export function buildWhatsappLink({
  phone,
  message,
}: {
  phone: string | null | undefined;
  message?: string | null;
}): string | null {
  const digits = normalizeWhatsappNumber(phone);
  if (!digits) return null;

  const text = (message ?? "").trim();
  const base = `https://wa.me/${digits}`;

  return text ? `${base}?text=${encodeWhatsappText(text)}` : base;
}

/* -------------------------------------------------------------------------- */
/* Estado da configuração                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Configuração usada pelas telas.
 *
 * `phone` é o número **normalizado** (dígitos com DDI), não o que foi digitado:
 * gravar o texto cru faria cada leitura precisar normalizar de novo, e um valor
 * antigo inválido só apareceria no dia em que o botão fosse tocado.
 */
export type WhatsappConfig = {
  /** Dígitos com DDI, ou `null` quando não configurado/inválido. */
  phone: string | null;
  message: string;
  isActive: boolean;
};

export const EMPTY_WHATSAPP_CONFIG: WhatsappConfig = {
  phone: null,
  message: DEFAULT_WHATSAPP_MESSAGE,
  isActive: false,
};

/**
 * O botão deve aparecer?
 *
 * Três condições, e todas precisam valer:
 *
 *   1. o dono ligou o WhatsApp (`isActive`);
 *   2. existe um número que o `wa.me` aceita;
 *   3. a casa não está suspensa/pausada — quem foi bloqueado pela plataforma
 *      não segue recebendo pedido por um canal lateral.
 *
 * A checagem do plano (`whatsapp` em `plans.features`) **não** está aqui: é
 * feita no servidor, junto com a leitura, porque é dado comercial e não deve
 * viajar para o HTML do cliente. Ver `getPublicWhatsappConfig`.
 */
export function shouldShowWhatsappButton(config: WhatsappConfig | null | undefined): boolean {
  if (!config) return false;
  if (!config.isActive) return false;
  return normalizeWhatsappNumber(config.phone) !== null;
}

/**
 * Normaliza uma configuração vinda do banco (ou de qualquer lugar).
 *
 * Linha ausente, coluna nula e valor estranho caem em `EMPTY_WHATSAPP_CONFIG`
 * — mesma regra do tema: o cardápio nunca quebra por falta de configuração,
 * só deixa de mostrar o botão.
 */
export function normalizeWhatsappConfig(row: {
  phone?: string | null;
  message?: string | null;
  is_active?: boolean | null;
} | null | undefined): WhatsappConfig {
  if (!row) return EMPTY_WHATSAPP_CONFIG;

  const phone = normalizeWhatsappNumber(row.phone);
  const message = (row.message ?? "").trim().slice(0, WHATSAPP_MESSAGE_MAX);

  return {
    phone,
    message: message || DEFAULT_WHATSAPP_MESSAGE,
    // Sem número válido não existe "ativo": evita um botão que abre o WhatsApp
    // sem destinatário.
    isActive: Boolean(row.is_active) && phone !== null,
  };
}

/* -------------------------------------------------------------------------- */
/* Mensagem de pedido — preparo, não envio                                      */
/* -------------------------------------------------------------------------- */

/** Item do pedido, no mínimo necessário para montar a mensagem. */
export type WhatsappOrderItem = {
  name: string;
  quantity: number;
  /** Subtotal da linha. Opcional: nem toda leitura traz o valor. */
  subtotal?: number | null;
};

/** Pedido que pode virar mensagem. */
export type WhatsappOrderSummary = {
  restaurantName: string;
  orderNumber: number;
  tableName?: string | null;
  items: WhatsappOrderItem[];
  total: number;
  currency?: string | null;
};

/**
 * Formata dinheiro para a mensagem, sem depender de locale do ambiente.
 *
 * `Intl` no servidor da Vercel e no Safari do iPhone às vezes discordam do
 * separador (espaço não separável × espaço comum), e isso aparece na mensagem
 * que o cliente lê. Aqui é explícito: `R$ 79,70`.
 */
export function formatWhatsappMoney(
  value: number,
  currency: string | null | undefined = "BRL",
): string {
  const symbol = !currency || currency === "BRL" ? "R$" : currency;
  const safe = Number.isFinite(value) ? value : 0;
  const fixed = Math.abs(safe).toFixed(2);
  const point = fixed.indexOf(".");
  const integer = fixed.slice(0, point);
  const decimals = fixed.slice(point + 1);
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${safe < 0 ? "-" : ""}${symbol} ${grouped},${decimals}`;
}

/** "Mesa 04" → "04"; "Mesa 12" → "12"; "Balcão" → "Balcão". */
function shortTableName(tableName: string | null | undefined): string | null {
  const value = (tableName ?? "").trim();
  if (!value) return null;
  const match = /^mesa\s*([\w-]+)$/i.exec(value);
  return match?.[1] ?? value;
}

/**
 * Monta o texto da mensagem de pedido.
 *
 * O formato segue o exemplo do escopo:
 *
 *   Olá, gostaria de informações sobre o pedido #1042.
 *
 *   Mesa: 04
 *
 *   2x X-Bacon
 *   1x Batata
 *
 *   Total: R$ 79,70
 *
 * Duas decisões que valem registro:
 *
 *   • **O total vem do argumento**, calculado pelo servidor. A função se recusa
 *     a somar os itens (isso seria uma segunda fonte de verdade para dinheiro);
 *   • **O texto é o pedido gravado**, não o carrinho em memória. Quando a
 *     mensagem passar a ser gerada de verdade, ela vai ler o pedido do banco —
 *     o carrinho do cliente pode ter mudado, o pedido não.
 *
 * Retorna `null` para pedido sem itens: uma mensagem "0 itens, total R$ 0,00"
 * confunde mais do que ajuda.
 */
export function buildOrderMessage({
  restaurantName,
  orderNumber,
  tableName,
  items,
  total,
  currency = "BRL",
}: WhatsappOrderSummary): string | null {
  if (!Array.isArray(items) || items.length === 0) return null;

  const lines: string[] = [];
  lines.push(`Olá, gostaria de informações sobre o pedido #${orderNumber}.`);

  const table = shortTableName(tableName);
  if (table) {
    lines.push("");
    lines.push(`Mesa: ${table}`);
  }

  lines.push("");
  for (const item of items) {
    // Quantidade 0 ou negativa não é item; nome vazio também não. Descartar
    // é melhor que escrever "0x" numa mensagem para o restaurante.
    const quantity = Math.trunc(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const name = (item.name ?? "").trim();
    if (!name) continue;
    lines.push(`${quantity}x ${name}`);
  }

  if (lines.at(-1) === "") return null; // todos os itens eram inválidos

  lines.push("");
  lines.push(`Total: ${formatWhatsappMoney(total, currency)}`);

  // O nome do restaurante fecha a mensagem. Útil porque o dono pode ter mais
  // de uma casa no mesmo WhatsApp — e é o primeiro item do escopo (item 4).
  const restaurant = (restaurantName ?? "").trim();
  if (restaurant) {
    lines.push("");
    lines.push(`— ${restaurant}`);
  }

  const text = lines.join("\n");
  return text.length > WHATSAPP_ORDER_MESSAGE_MAX
    ? `${text.slice(0, WHATSAPP_ORDER_MESSAGE_MAX - 1).trimEnd()}…`
    : text;
}

/**
 * Link pronto para o pedido — o mesmo `wa.me`, com a mensagem gerada.
 *
 * Hoje **não é chamado em lugar nenhum da interface**: o escopo diz "não enviar
 * automaticamente nesta etapa". Ele existe para que o dia em que a tela de
 * pedido ganhar o botão seja uma linha, e para que o formato da mensagem já
 * tenha teste. Quando a Cloud API entrar, esta função continua válida como
 * prévia — o provedor novo usa o mesmo `buildOrderMessage`.
 */
export function buildOrderWhatsappLink({
  phone,
  order,
}: {
  phone: string | null | undefined;
  order: WhatsappOrderSummary;
}): string | null {
  const message = buildOrderMessage(order);
  if (!message) return null;
  return buildWhatsappLink({ phone, message });
}
