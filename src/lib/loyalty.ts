/**
 * Fidelidade e clientes — modelo neutro da Etapa 24.
 *
 * Roda no servidor (Server Actions, páginas) e no navegador (formulário do
 * cliente no cardápio, painel), por isso não importa nada de `next/*` nem abre
 * conexão. Tudo que é **regra de negócio compartilhada** mora aqui: a
 * normalização do telefone, o cálculo de pontos, os rótulos do extrato e a
 * máscara de exibição.
 *
 * ─── A duplicação com o banco é de propósito ─────────────────────────────
 *
 * `normalizePhone()` repete `public.normalize_phone()`. Não é descuido: a UI
 * precisa validar antes de enviar para dar mensagem imediata ("faltam dígitos"),
 * e o banco precisa validar de novo porque o PostgREST aceita chamada direta
 * com a anon key. Duas implementações da **mesma** regra só são perigosas
 * quando divergem — por isso o harness `loyalty-lib.cjs` alimenta as duas com a
 * mesma bateria de números e compara o resultado.
 */

/* ==========================================================================
   Telefone
   ========================================================================== */

/**
 * Normaliza para dígitos com DDI 55 quando o número é brasileiro.
 *
 * Regras (as mesmas de `public.normalize_phone`):
 *   • tira tudo que não é dígito;
 *   • remove o "0" de discagem nacional (0 85 ...) **só** quando o restante tem
 *     tamanho de número brasileiro — sem essa guarda "085 3232-1010" perdia o
 *     zero e ganhava um DDI que não era o dele;
 *   • 12 ou 13 dígitos começando com 55: já tem DDI, devolve como está;
 *   • 10 (fixo) ou 11 (celular) dígitos: prefixa 55;
 *   • qualquer outro tamanho: devolve só os dígitos, sem inventar DDI.
 *
 * `null`/vazio viram `null` — e não `""`, para o formulário distinguir "não
 * informou" de "informou vazio".
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;

  let digits = String(input).replace(/\D/g, "");
  if (!digits) return null;

  /*
   * "0" de discagem nacional (0 85 3232-1010).
   *
   * Só sai quando o que sobra tem tamanho de número brasileiro (11, 12 ou 13
   * dígitos). A primeira versão testava `length > 11` e deixava passar
   * "085 3232-1010" (11 dígitos) com o zero dentro — o número saía como
   * "5508532321010", que não existe e nunca casaria com o mesmo cliente
   * digitado de outro jeito. Foi o harness de paridade com o banco que pegou.
   */
  if (digits.startsWith("0") && [11, 12, 13].includes(digits.length)) {
    digits = digits.slice(1);
  }

  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    return digits;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return digits;
}

/**
 * Um telefone serve para cadastro?
 *
 * 10 a 15 dígitos, igual à constraint do banco. Recusa número curto demais
 * (que nunca casaria) em vez de gravar e descobrir depois.
 */
export function isValidPhone(input: string | null | undefined): boolean {
  const normalized = normalizePhone(input);
  return normalized !== null && /^[0-9]{10,15}$/.test(normalized);
}

/**
 * Formata para leitura: `(85) 98888-7777`.
 *
 * Trabalha em cima do **nacional** (tira o DDI 55 quando presente) porque é
 * assim que o dono e o cliente reconhecem o número. Número que não é
 * brasileiro volta só com dígitos — melhor mostrar feio do que inventar
 * parênteses no lugar errado.
 */
export function formatPhone(input: string | null | undefined): string {
  if (!input) return "";

  const normalized = normalizePhone(input);
  if (!normalized) return "";

  const national =
    normalized.startsWith("55") && (normalized.length === 12 || normalized.length === 13)
      ? normalized.slice(2)
      : normalized;

  if (national.length === 11) {
    return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  }
  if (national.length === 10) {
    return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  }
  return national;
}

/**
 * Máscara progressiva enquanto a pessoa digita.
 *
 * O usuário não deve precisar saber que o campo aceita "85 988887777" ou
 * "(85) 98888-7777". A máscara aplica o formato conhecido e **para de mexer**
 * quando os dígitos passam do tamanho de um celular — tentar formatar daí em
 * diante só embaralha o cursor.
 */
export function maskPhoneInput(input: string): string {
  const digits = String(input ?? "").replace(/\D/g, "").slice(0, 13);

  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  return digits;
}

/* ==========================================================================
   Nome
   ========================================================================== */

export const MAX_CUSTOMER_NAME = 120;
export const MAX_CUSTOMER_EMAIL = 160;
export const MAX_PROGRAM_NOTE = 200;
export const MAX_ADJUST_NOTE = 200;
export const MAX_SEARCH = 80;

/** Colapsa espaço e corta o excesso. `null` quando sobra nada. */
export function cleanName(input: string | null | undefined): string | null {
  if (!input) return null;
  const clean = String(input).replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.slice(0, MAX_CUSTOMER_NAME);
}

export function isValidEmail(input: string | null | undefined): boolean {
  if (!input) return false;
  const value = String(input).trim();
  return value.length <= MAX_CUSTOMER_EMAIL && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

/* ==========================================================================
   Pontos
   ========================================================================== */

/** Teto de segurança: regra acima disso é erro de digitação, não promoção. */
export const MAX_POINTS_PER_CURRENCY = 100;
export const MAX_BONUS_POINTS = 100_000;

/**
 * Pontos que um pedido rende: `floor(total × pontos por real)`.
 *
 * Piso, e não arredondamento: ponto é passivo da casa. Arredondar para cima
 * num pedido de R$ 4,90 com regra 1,5 daria 8 pontos onde o dono calculou 7 —
 * em mil pedidos é uma diferença que ninguém consegue explicar depois.
 *
 * Repete `loyalty_award_order` no banco de propósito: a tela mostra "você vai
 * ganhar X pontos" **antes** de enviar, e o número tem de ser o mesmo que o
 * banco vai gravar.
 */
export function pointsForAmount(total: number, pointsPerCurrency: number): number {
  const amount = Number.isFinite(total) ? Math.max(total, 0) : 0;
  const rate = Number.isFinite(pointsPerCurrency) ? Math.max(pointsPerCurrency, 0) : 0;
  return Math.floor(amount * rate);
}

/** Quanto vale o saldo em dinheiro, pela regra de resgate da casa. */
export function pointsValue(balance: number, redeemValue: number): number {
  const points = Number.isFinite(balance) ? Math.max(balance, 0) : 0;
  const value = Number.isFinite(redeemValue) ? Math.max(redeemValue, 0) : 0;
  return Math.round(points * value * 100) / 100;
}

/* ==========================================================================
   Consentimento (LGPD)
   ========================================================================== */

/**
 * Versão do texto de consentimento mostrada ao cliente.
 *
 * Vai gravada em `customers.consent_version`. Quando o texto mudar de forma
 * relevante (o que é coletado, para quê, por quanto tempo), sobe a versão: o
 * banco passa a distinguir quem aceitou o texto novo de quem aceitou o antigo.
 * Sem isso, "todos consentiram" vira uma afirmação que não se consegue provar.
 */
export const CONSENT_VERSION = "v1";

/**
 * Texto do aceite. Curto porque ninguém lê um termo no celular com a comida
 * esperando — e porque prometer no texto algo que o produto não faz seria pior
 * que não ter texto.
 */
export const CONSENT_TEXT =
  "Autorizo este restaurante a guardar meu nome e WhatsApp para registrar meus pedidos e meus pontos de fidelidade. Posso pedir a exclusão dos meus dados a qualquer momento.";

/** Motivo do aceite, guardado junto da identificação. */
export const CONSENT_PURPOSE = "programa de fidelidade e histórico de pedidos";

/* ==========================================================================
   Extrato de pontos
   ========================================================================== */

export type LoyaltyEntryKind =
  | "earn"
  | "redeem"
  | "bonus"
  | "adjust"
  | "expire"
  | "campaign"
  | "cashback";

export type LoyaltyEntrySource =
  | "order"
  | "signup"
  | "birthday"
  | "manual"
  | "campaign"
  | "cashback";

/**
 * Rótulo do lançamento para a tela.
 *
 * Combinação de `kind` + `source`, e não só `kind`: "Bônus de aniversário" e
 * "Bônus de cadastro" são os dois `kind = 'bonus'`, e o cliente precisa saber
 * qual dos dois foi. Fonte desconhecida cai num rótulo genérico — nunca no
 * enum cru, que apareceria como `earn` na cara do usuário.
 */
export function entryLabel(kind: LoyaltyEntryKind, source: LoyaltyEntrySource): string {
  if (kind === "earn") return "Pontos do pedido";
  if (kind === "redeem") return "Pontos utilizados";
  if (kind === "expire") return "Pontos expirados";
  if (kind === "adjust") return "Ajuste do restaurante";
  if (kind === "campaign") return "Campanha";
  if (kind === "cashback") return "Cashback";

  switch (source) {
    case "signup":
      return "Bônus de cadastro";
    case "birthday":
      return "Bônus de aniversário";
    case "campaign":
      return "Bônus de campanha";
    case "cashback":
      return "Cashback";
    default:
      return "Bônus";
  }
}

/** Sinal formatado: `+50` / `−20` (menos tipográfico, não hífen). */
export function formatDelta(delta: number): string {
  const value = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return "0";
}

/**
 * Rótulo da frequência.
 *
 * `null` quando há menos de dois pedidos: com um só evento não existe
 * intervalo, e mostrar "0,0 pedidos/mês" faria o cliente parecer inativo
 * quando ele só pediu uma vez. Quem chama mostra "primeiro pedido".
 */
export function formatFrequency(ordersPerMonth: number | null | undefined): string | null {
  if (ordersPerMonth === null || ordersPerMonth === undefined) return null;
  if (!Number.isFinite(ordersPerMonth) || ordersPerMonth <= 0) return null;

  if (ordersPerMonth >= 1) {
    const rounded = Math.round(ordersPerMonth * 10) / 10;
    return `${rounded.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} pedidos/mês`;
  }

  // Menos de um pedido por mês é mais fácil de entender como intervalo.
  const months = Math.round(1 / ordersPerMonth);
  if (months <= 1) return "Cerca de 1 pedido/mês";
  return `Cerca de 1 pedido a cada ${months} meses`;
}

/**
 * Classificação de recência para a lista de clientes.
 *
 * Serve para o dono achar quem está sumindo — o começo de qualquer campanha de
 * retorno. A régua é grosseira de propósito: 30/60/90 dias é o que ele já pensa
 * em termos de mês, e uma pontuação de "engajamento" inventada não ajudaria.
 */
export type CustomerActivity = "active" | "cooling" | "at_risk" | "dormant" | "new";

export const ACTIVITY_LABEL: Record<CustomerActivity, string> = {
  new: "Novo",
  active: "Ativo",
  cooling: "Esfriando",
  at_risk: "Sumindo",
  dormant: "Inativo",
};

export function customerActivity(
  lastOrderAt: string | null | undefined,
  now: Date = new Date(),
): CustomerActivity {
  if (!lastOrderAt) return "new";

  const last = new Date(lastOrderAt);
  if (Number.isNaN(last.getTime())) return "new";

  const days = Math.floor((now.getTime() - last.getTime()) / 86_400_000);
  if (days <= 30) return "active";
  if (days <= 60) return "cooling";
  if (days <= 90) return "at_risk";
  return "dormant";
}

/* ==========================================================================
   Regra de fidelidade
   ========================================================================== */

export type LoyaltySettings = {
  enabled: boolean;
  points_per_currency: number;
  signup_bonus: number;
  birthday_bonus: number;
  redeem_value: number;
  cashback_percent: number;
  program_note: string | null;
};

/** Regra padrão: "R$ 1 = 1 ponto", sem bônus, desligada. */
export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettings = {
  enabled: false,
  points_per_currency: 1,
  signup_bonus: 0,
  birthday_bonus: 0,
  redeem_value: 0,
  cashback_percent: 0,
  program_note: null,
};

/**
 * Descrição curta da regra, para o cardápio e para a tela de configuração.
 *
 * Ex.: "1 ponto por R$ 1 · 50 pontos no cadastro". Nula quando o programa está
 * desligado — o cardápio não deve prometer pontos que não existem.
 */
export function describeProgram(settings: LoyaltySettings): string | null {
  if (!settings.enabled) return null;

  const parts: string[] = [];
  const rate = settings.points_per_currency;

  if (rate > 0) {
    const formatted = rate.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
    const unit = rate === 1 ? "ponto" : "pontos";
    parts.push(`${formatted} ${unit} por R$ 1`);
  }
  if (settings.signup_bonus > 0) {
    parts.push(`${settings.signup_bonus} pontos no cadastro`);
  }
  if (settings.birthday_bonus > 0) {
    parts.push(`${settings.birthday_bonus} pontos no aniversário`);
  }

  if (parts.length === 0) return null;
  return parts.join(" · ");
}

/** Texto do programa: a nota do dono ou a descrição gerada. */
export function programHeadline(settings: LoyaltySettings): string | null {
  const note = settings.program_note?.trim();
  if (note) return note;
  return describeProgram(settings);
}

/* ==========================================================================
   Formulário de configuração
   ========================================================================== */

export type LoyaltyFormValues = {
  enabled: boolean;
  pointsPerCurrency: string;
  signupBonus: string;
  birthdayBonus: string;
  redeemValue: string;
  programNote: string;
};

/** Converte a regra gravada para os campos de texto do formulário. */
export function toLoyaltyForm(settings: LoyaltySettings): LoyaltyFormValues {
  const asText = (value: number) =>
    Number.isFinite(value)
      ? value.toLocaleString("pt-BR", { maximumFractionDigits: 4, useGrouping: false })
      : "0";

  return {
    enabled: settings.enabled,
    pointsPerCurrency: asText(settings.points_per_currency),
    signupBonus: String(settings.signup_bonus),
    birthdayBonus: String(settings.birthday_bonus),
    redeemValue: asText(settings.redeem_value),
    programNote: settings.program_note ?? "",
  };
}

/**
 * Lê os campos de texto do formulário.
 *
 * Aceita vírgula decimal (o teclado brasileiro digita vírgula) e devolve erro
 * por campo em vez de um booleano — a tela precisa dizer **qual** campo está
 * errado. Campo vazio vira 0, não `NaN`: "não quero bônus" é uma escolha.
 */
export type LoyaltyParseResult =
  | { ok: true; settings: Omit<LoyaltySettings, "cashback_percent"> }
  | { ok: false; errors: Record<string, string> };

function parseDecimal(input: string): number | null {
  const clean = String(input ?? "")
    .replace(/\s/g, "")
    .replace(",", ".");
  if (clean === "") return 0;
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  return Number(clean);
}

function parseInteger(input: string): number | null {
  const clean = String(input ?? "").replace(/[^\d]/g, "");
  if (clean === "") return 0;
  return Number(clean);
}

export function parseLoyaltyForm(values: LoyaltyFormValues): LoyaltyParseResult {
  const errors: Record<string, string> = {};

  const pointsPerCurrency = parseDecimal(values.pointsPerCurrency);
  if (pointsPerCurrency === null || pointsPerCurrency < 0) {
    errors.pointsPerCurrency = "Informe um número de pontos válido.";
  } else if (pointsPerCurrency > MAX_POINTS_PER_CURRENCY) {
    errors.pointsPerCurrency = `O máximo é ${MAX_POINTS_PER_CURRENCY} pontos por real.`;
  }

  const signupBonus = parseInteger(values.signupBonus);
  if (signupBonus === null || signupBonus > MAX_BONUS_POINTS) {
    errors.signupBonus = "Bônus de cadastro inválido.";
  }

  const birthdayBonus = parseInteger(values.birthdayBonus);
  if (birthdayBonus === null || birthdayBonus > MAX_BONUS_POINTS) {
    errors.birthdayBonus = "Bônus de aniversário inválido.";
  }

  const redeemValue = parseDecimal(values.redeemValue);
  if (redeemValue === null || redeemValue < 0) {
    errors.redeemValue = "Informe um valor de resgate válido.";
  } else if (redeemValue > 1000) {
    errors.redeemValue = "O valor por ponto é alto demais (máx. R$ 1.000).";
  }

  const note = values.programNote.trim();
  if (note.length > MAX_PROGRAM_NOTE) {
    errors.programNote = `A mensagem pode ter no máximo ${MAX_PROGRAM_NOTE} caracteres.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    settings: {
      enabled: values.enabled,
      points_per_currency: pointsPerCurrency ?? 0,
      signup_bonus: signupBonus ?? 0,
      birthday_bonus: birthdayBonus ?? 0,
      redeem_value: redeemValue ?? 0,
      program_note: note || null,
    },
  };
}

/**
 * A regra como será enviada ao banco.
 *
 * Separado do formulário porque "desligado" não zera os números: o dono que
 * pausa o programa no fim do ano e reabre em janeiro não deve recadastrar a
 * regra inteira.
 */
export function settingsPayload(
  parsed: Omit<LoyaltySettings, "cashback_percent">,
): Record<string, unknown> {
  return {
    p_enabled: parsed.enabled,
    p_points_per_currency: parsed.points_per_currency,
    p_signup_bonus: parsed.signup_bonus,
    p_birthday_bonus: parsed.birthday_bonus,
    p_redeem_value: parsed.redeem_value,
    p_program_note: parsed.program_note,
  };
}

/* ==========================================================================
   Normalização da linha do banco
   ========================================================================== */

/**
 * `numeric` do PostgREST chega como string em muitas versões. Converter na
 * borda evita `"0.05" * 10` virar `NaN` no meio da tela.
 */
export function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function normalizeSettings(row: Record<string, unknown> | null | undefined): LoyaltySettings {
  if (!row) return { ...DEFAULT_LOYALTY_SETTINGS };

  return {
    enabled: Boolean(row.enabled),
    points_per_currency: toNumber(row.points_per_currency),
    signup_bonus: Math.trunc(toNumber(row.signup_bonus)),
    birthday_bonus: Math.trunc(toNumber(row.birthday_bonus)),
    redeem_value: toNumber(row.redeem_value),
    cashback_percent: toNumber(row.cashback_percent),
    program_note: typeof row.program_note === "string" ? row.program_note : null,
  };
}
