/**
 * Cupons e promoções — Etapa 25.
 *
 * Este módulo é a regra de cupom no lado do app. Ele **não decide** se um cupom
 * vale: quem decide é `validate_coupon` no banco. O que está aqui é o que a
 * tela precisa para não mandar lixo e para explicar o resultado em português:
 *
 *   • normalização do código (a mesma regra do `normalize_coupon_code`, para o
 *     campo mostrar o código como vai ficar antes de enviar);
 *   • descrição do desconto em texto ("10% de desconto", "R$ 5 de desconto");
 *   • formatação de status, limite e validade para a lista do painel;
 *   • validação do formulário de criação (nomes de campo que o usuário entende);
 *   • tradução do `reason` que o banco devolve.
 *
 * ─── Por que a normalização está duplicada ────────────────────────────────
 *
 * Igual ao telefone na Etapa 24: o campo de código precisa mostrar `BEMVINDO10`
 * enquanto a pessoa digita "bem vindo 10" — isso é no navegador, e chamar o
 * banco a cada tecla seria uma ida por letra. O banco normaliza de novo (é a
 * porta aberta do PostgREST), e o harness de paridade roda as duas contra a
 * mesma tabela de casos. Se divergirem, o teste falha.
 */

/* ==========================================================================
   Tipos
   ========================================================================== */

export type CouponDiscountType = "percentage" | "fixed" | "free_shipping";

export type CouponStatus = "active" | "scheduled" | "expired" | "inactive" | "exhausted";

/** Cupom como a lista do painel enxerga. */
export type Coupon = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  discount_type: CouponDiscountType;
  discount_value: number;
  min_order_value: number;
  max_discount: number | null;
  starts_at: string | null;
  ends_at: string | null;
  max_uses: number | null;
  max_uses_per_customer: number;
  active: boolean;
  used_count: number;
  total_discount: number;
  status: CouponStatus;
  created_at: string;
};

/** Um uso de cupom, como a ficha do cupom mostra. */
export type CouponRedemption = {
  id: string;
  order_id: string;
  order_number: number;
  table_name: string;
  customer_name: string | null;
  amount: number;
  created_at: string;
};

/** Cupom com os usos (resposta de `coupon_details`). */
export type CouponDetail = Coupon & {
  redemptions: CouponRedemption[];
};

/** Resposta de `validate_coupon`. */
export type CouponValidation = {
  ok: boolean;
  reason: string | null;
  coupon_id: string | null;
  code: string | null;
  type: CouponDiscountType | null;
  value: number | null;
  amount: number;
  min_order_value: number | null;
};

/** Formulário de criação/edição, com strings para os campos numéricos. */
export type CouponForm = {
  name: string;
  code: string;
  description: string;
  discountType: CouponDiscountType;
  discountValue: string;
  minOrderValue: string;
  maxDiscount: string;
  startsAt: string;
  endsAt: string;
  maxUses: string;
  maxUsesPerCustomer: string;
  active: boolean;
};

/* ==========================================================================
   Limites — espelham as constraints de `coupons`
   ========================================================================== */

export const COUPON_CODE_MIN = 3;
export const COUPON_CODE_MAX = 24;
export const COUPON_NAME_MAX = 80;
export const COUPON_DESCRIPTION_MAX = 200;
/** Teto de valor: R$ 1.000.000, o mesmo do check no banco. */
export const COUPON_VALUE_MAX = 1_000_000;
export const COUPON_MAX_USES_PER_CUSTOMER = 100;

/* ==========================================================================
   Código
   ========================================================================== */

const ACCENTS = "áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ";
const PLAIN = "aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC";

/**
 * Normaliza o código como ele será gravado: maiúsculo, sem acento, sem espaço
 * e sem pontuação. `null` quando não sobra nada.
 *
 * Mesma regra de `public.normalize_coupon_code` no banco — ver o harness
 * `coupon-lib`, que compara as duas implementações lado a lado.
 */
export function normalizeCouponCode(input: string | null | undefined): string | null {
  if (!input) return null;

  let out = "";
  for (const char of input) {
    const index = ACCENTS.indexOf(char);
    out += index >= 0 ? PLAIN[index] : char;
  }

  const cleaned = out
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  return cleaned.length > 0 ? cleaned : null;
}

/** O código cabe no que a coluna aceita? (`^[A-Z0-9]{3,24}$` já normalizado). */
export function isValidCouponCode(code: string | null | undefined): boolean {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return false;
  return normalized.length >= COUPON_CODE_MIN && normalized.length <= COUPON_CODE_MAX;
}

/**
 * Máscara do campo: deixa digitar e já mostra o resultado normalizado.
 *
 * Diferente da máscara de telefone, aqui não há formato a preservar — o código
 * é uma palavra só. Por isso a máscara só descarta o que não é letra/número e
 * passa para maiúsculo, sem inserir separadores.
 */
export function maskCouponCodeInput(input: string): string {
  return (normalizeCouponCode(input) ?? "").slice(0, COUPON_CODE_MAX);
}

/**
 * Sugestão de código a partir do nome — o mesmo raciocínio de
 * `generate_coupon_code`, mas **sem** consultar o banco (é só o botão "gerar",
 * o banco confere colisão ao salvar e devolve outro se precisar).
 */
export function suggestCouponCode(name: string): string {
  const base = normalizeCouponCode(name) ?? "";
  if (base.length >= COUPON_CODE_MIN) return base.slice(0, COUPON_CODE_MAX);
  return "PROMO";
}

/* ==========================================================================
   Desconto em texto
   ========================================================================== */

export const DISCOUNT_TYPE_LABEL: Record<CouponDiscountType, string> = {
  percentage: "Percentual",
  fixed: "Valor fixo",
  free_shipping: "Frete grátis",
};

export const COUPON_STATUS_LABEL: Record<CouponStatus, string> = {
  active: "Ativo",
  scheduled: "Agendado",
  expired: "Expirado",
  inactive: "Inativo",
  exhausted: "Esgotado",
};

/**
 * "10% de desconto", "R$ 5 de desconto", "Frete grátis".
 *
 * O valor é sempre positivo; quem sabe que é desconto é o rótulo. Mostrar
 * "-10%" no lugar de "10% de desconto" faz o dono conferir duas vezes se
 * digitou o sinal errado.
 */
export function describeDiscount(type: CouponDiscountType, value: number): string {
  if (type === "free_shipping") return "Frete grátis";
  if (type === "percentage") return `${formatPercent(value)} de desconto`;
  return `${formatMoney(value)} de desconto`;
}

/** Formata percentual sem arrastar zeros: 10 → "10%", 7.5 → "7,5%". */
export function formatPercent(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/**
 * Formata reais sem depender de `Intl` do Node em contexto de teste.
 *
 * O app já usa `formatPrice` de `lib/validation` nas telas; esta cópia existe
 * para o módulo continuar sem importar `validation` (que carrega zod) no
 * cardápio público.
 */
export function formatMoney(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `R$ ${safe.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "Válido até 31/12", "Começa em 01/12", "Válido até 31/12/2026". */
export function describeValidity(
  startsAt: string | null,
  endsAt: string | null,
  timeZone = "America/Sao_Paulo",
): string {
  const fmt = (iso: string, withYear: boolean) =>
    new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone,
    }).format(new Date(iso));

  const now = Date.now();
  const start = startsAt ? new Date(startsAt) : null;
  const end = endsAt ? new Date(endsAt) : null;

  const sameYear = end ? end.getUTCFullYear() === new Date().getUTCFullYear() : true;

  if (start && start.getTime() > now) {
    return `Começa em ${fmt(startsAt!, true)}`;
  }
  if (end) {
    return `Até ${fmt(endsAt!, !sameYear)}`;
  }
  return "Sem prazo";
}

/** "3 de 100 usados", "3 usados", "Não usado ainda". */
export function describeUsage(used: number, max: number | null): string {
  const safeUsed = Math.max(0, Math.trunc(used));
  if (max === null) {
    return safeUsed === 0 ? "Não usado ainda" : `${safeUsed} ${safeUsed === 1 ? "uso" : "usos"}`;
  }
  return `${safeUsed} de ${max} ${max === 1 ? "uso" : "usos"}`;
}

/**
 * Linha de regra do cupom para o cardápio e para o painel:
 * "10% de desconto · Pedido mínimo R$ 30 · 1 uso por cliente".
 */
export function describeCoupon(coupon: {
  discount_type: CouponDiscountType;
  discount_value: number;
  min_order_value: number;
  max_uses_per_customer: number;
  max_discount?: number | null;
}): string {
  const parts = [describeDiscount(coupon.discount_type, coupon.discount_value)];

  if (coupon.discount_type === "percentage" && coupon.max_discount) {
    parts.push(`máximo ${formatMoney(coupon.max_discount)}`);
  }
  if (coupon.min_order_value > 0) {
    parts.push(`pedido mínimo ${formatMoney(coupon.min_order_value)}`);
  }
  if (coupon.max_uses_per_customer === 1) {
    parts.push("1 uso por cliente");
  } else if (coupon.max_uses_per_customer > 1) {
    parts.push(`${coupon.max_uses_per_customer} usos por cliente`);
  }

  return parts.join(" · ");
}

/* ==========================================================================
   Tradução do motivo de recusa
   ========================================================================== */

/**
 * `reason` do banco → frase para o cliente final.
 *
 * As frases dizem o que fazer, não o que o banco recusou: "Este cupom já
 * expirou" resolve; "coupon_expired" não.
 */
export const COUPON_REASON_MESSAGE: Record<string, string> = {
  coupon_not_found: "Cupom não encontrado. Confira o código.",
  coupon_invalid_code: "Digite o código do cupom.",
  coupon_inactive: "Este cupom não está mais ativo.",
  coupon_not_started: "Este cupom ainda não começou a valer.",
  coupon_expired: "Este cupom já expirou.",
  coupon_exhausted: "Este cupom atingiu o limite de usos.",
  customer_limit_reached: "Você já usou este cupom.",
  below_minimum: "O pedido não atingiu o valor mínimo para este cupom.",
  coupon_no_effect: "Este cupom não gera desconto neste pedido.",
  table_unavailable: "Esta mesa não está mais disponível.",
  coupon_not_applicable: "Este cupom não pode ser aplicado a este pedido.",
};

export function couponReasonMessage(reason: string | null | undefined): string {
  if (!reason) return "Não foi possível aplicar o cupom.";
  return COUPON_REASON_MESSAGE[reason] ?? "Não foi possível aplicar o cupom.";
}

/* ==========================================================================
   Formulário
   ========================================================================== */

export const EMPTY_COUPON_FORM: CouponForm = {
  name: "",
  code: "",
  description: "",
  discountType: "percentage",
  discountValue: "10",
  minOrderValue: "0",
  maxDiscount: "",
  startsAt: "",
  endsAt: "",
  maxUses: "",
  maxUsesPerCustomer: "1",
  active: true,
};

/** Cupom do banco → formulário (edição). */
export function toCouponForm(coupon: Coupon | CouponDetail): CouponForm {
  const dateInput = (iso: string | null) => (iso ? toLocalDateTimeInput(iso) : "");

  return {
    name: coupon.name,
    code: coupon.code,
    description: coupon.description ?? "",
    discountType: coupon.discount_type,
    discountValue: decimalToInput(coupon.discount_value),
    minOrderValue: decimalToInput(coupon.min_order_value),
    maxDiscount: coupon.max_discount === null ? "" : decimalToInput(coupon.max_discount),
    startsAt: dateInput(coupon.starts_at),
    endsAt: dateInput(coupon.ends_at),
    maxUses: coupon.max_uses === null ? "" : String(coupon.max_uses),
    maxUsesPerCustomer: String(coupon.max_uses_per_customer),
    active: coupon.active,
  };
}

/** `10.5` → `"10,5"`; `10` → `"10"`. Evita `"10,00"` em campo de edição. */
export function decimalToInput(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  return String(rounded).replace(".", ",");
}

/**
 * Converte o campo em número, aceitando vírgula.
 *
 * `""` vira `null` — e `null` tem significados diferentes por campo: "sem teto"
 * em `maxDiscount`, "ilimitado" em `maxUses`, "0" em `minOrderValue` (ver
 * `parseCouponForm`). Devolver `0` para tudo apagaria essa diferença.
 */
export function parseDecimalInput(input: string): number | null {
  const trimmed = input.trim().replace(",", ".");
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}

export function parseIntegerInput(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) return null;
  return parsed;
}

/** `2026-12-31T10:00` (input datetime-local) → ISO UTC. */
export function inputToIso(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** ISO UTC → valor de `datetime-local` no fuso local do navegador. */
export function toLocalDateTimeInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export type CouponPayload = {
  id: string | null;
  name: string;
  code: string;
  description: string | null;
  discount_type: CouponDiscountType;
  discount_value: number;
  min_order_value: number;
  max_discount: number | null;
  starts_at: string | null;
  ends_at: string | null;
  max_uses: number | null;
  max_uses_per_customer: number;
  active: boolean;
};

export type CouponFormResult =
  | { ok: true; payload: CouponPayload }
  | { ok: false; errors: Record<string, string> };

/**
 * Valida o formulário e devolve o payload da RPC.
 *
 * A validação daqui é de **forma** (campo vazio, texto, coerência entre os
 * campos). A de **negócio** (código já existe, data no passado) é do banco:
 * repetir aqui faria as duas discordarem no primeiro caso de borda.
 */
export function parseCouponForm(form: CouponForm, id: string | null = null): CouponFormResult {
  const errors: Record<string, string> = {};

  const name = form.name.trim();
  if (!name) {
    errors.name = "Dê um nome ao cupom (só você vê este nome).";
  } else if (name.length > COUPON_NAME_MAX) {
    errors.name = `O nome pode ter no máximo ${COUPON_NAME_MAX} caracteres.`;
  }

  const code = normalizeCouponCode(form.code);
  if (!code) {
    errors.code = "Informe o código que o cliente vai digitar.";
  } else if (!isValidCouponCode(code)) {
    errors.code = `Use de ${COUPON_CODE_MIN} a ${COUPON_CODE_MAX} letras ou números.`;
  }

  if (form.description.length > COUPON_DESCRIPTION_MAX) {
    errors.description = `A descrição pode ter no máximo ${COUPON_DESCRIPTION_MAX} caracteres.`;
  }

  // Valor do desconto: percentual entre 0 e 100; fixo maior que zero.
  const discountValue = parseDecimalInput(form.discountValue);
  if (form.discountType !== "free_shipping") {
    if (discountValue === null || discountValue <= 0) {
      errors.discountValue = "Informe um valor maior que zero.";
    } else if (form.discountType === "percentage" && discountValue > 100) {
      errors.discountValue = "O percentual não pode passar de 100%.";
    } else if (discountValue > COUPON_VALUE_MAX) {
      errors.discountValue = "Valor alto demais.";
    }
  }

  const minOrderValue = parseDecimalInput(form.minOrderValue) ?? 0;
  if (minOrderValue < 0) {
    errors.minOrderValue = "O valor mínimo não pode ser negativo.";
  }

  const maxDiscount = parseDecimalInput(form.maxDiscount);
  if (maxDiscount !== null && maxDiscount <= 0) {
    errors.maxDiscount = "Deixe vazio ou informe um valor maior que zero.";
  }

  const maxUses = parseIntegerInput(form.maxUses);
  if (form.maxUses.trim() && (maxUses === null || maxUses <= 0)) {
    errors.maxUses = "Deixe vazio (ilimitado) ou informe um número maior que zero.";
  }

  const maxUsesPerCustomer = parseIntegerInput(form.maxUsesPerCustomer);
  if (
    maxUsesPerCustomer === null ||
    maxUsesPerCustomer < 1 ||
    maxUsesPerCustomer > COUPON_MAX_USES_PER_CUSTOMER
  ) {
    errors.maxUsesPerCustomer = `De 1 a ${COUPON_MAX_USES_PER_CUSTOMER}.`;
  }

  const startsAt = inputToIso(form.startsAt);
  if (form.startsAt.trim() && !startsAt) {
    errors.startsAt = "Data de início inválida.";
  }

  const endsAt = inputToIso(form.endsAt);
  if (form.endsAt.trim() && !endsAt) {
    errors.endsAt = "Data de fim inválida.";
  }

  if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    errors.endsAt = "O fim precisa ser depois do início.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    payload: {
      id,
      name,
      code: code!,
      description: form.description.trim() || null,
      discount_type: form.discountType,
      discount_value: form.discountType === "free_shipping" ? 0 : (discountValue as number),
      min_order_value: minOrderValue,
      max_discount: form.discountType === "percentage" ? maxDiscount : null,
      starts_at: startsAt,
      ends_at: endsAt,
      max_uses: maxUses,
      max_uses_per_customer: maxUsesPerCustomer as number,
      active: form.active,
    },
  };
}

/* ==========================================================================
   Normalização das linhas do banco
   ========================================================================== */

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Linha de `list_restaurant_coupons` → `Coupon`. */
export function normalizeCoupon(row: Record<string, unknown>): Coupon {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    code: String(row.code ?? ""),
    description: (row.description as string | null) ?? null,
    discount_type: (row.discount_type as CouponDiscountType) ?? "fixed",
    discount_value: toNumber(row.discount_value),
    min_order_value: toNumber(row.min_order_value),
    max_discount: row.max_discount === null || row.max_discount === undefined ? null : toNumber(row.max_discount),
    starts_at: (row.starts_at as string | null) ?? null,
    ends_at: (row.ends_at as string | null) ?? null,
    max_uses: row.max_uses === null || row.max_uses === undefined ? null : toNumber(row.max_uses),
    max_uses_per_customer: toNumber(row.max_uses_per_customer) || 1,
    active: Boolean(row.active),
    used_count: toNumber(row.used_count),
    total_discount: toNumber(row.total_discount),
    status: (row.status as CouponStatus) ?? "inactive",
    created_at: String(row.created_at ?? ""),
  };
}

/**
 * Foto do cupom que o cliente vê no carrinho **antes** de enviar.
 *
 * Não é o valor final: o total oficial sai do banco no envio. Serve para o
 * cliente saber o que esperar, e é por isso que a tela escreve "estimado".
 */
export function couponPreviewAmount(
  type: CouponDiscountType,
  value: number,
  subtotal: number,
  maxDiscount: number | null,
): number {
  if (subtotal <= 0) return 0;
  if (type === "free_shipping") return 0;

  let amount = type === "percentage" ? Math.round(subtotal * value) / 100 : value;
  if (type === "percentage" && maxDiscount !== null) amount = Math.min(amount, maxDiscount);

  return Math.max(0, Math.min(Math.round(amount * 100) / 100, subtotal));
}
