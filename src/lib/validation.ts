import { z } from "zod";
import { ORDER_NOTES_MAX } from "@/lib/cart";
import {
  COUPON_CODE_MAX,
  COUPON_CODE_MIN,
  COUPON_DESCRIPTION_MAX,
  COUPON_MAX_USES_PER_CUSTOMER,
  COUPON_NAME_MAX,
  COUPON_VALUE_MAX,
} from "@/lib/coupons";

/** Validações compartilhadas entre formulários e Server Actions. */

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 48);

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Informe seu e-mail.")
  .email("Informe um e-mail válido.")
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(8, "A senha precisa ter pelo menos 8 caracteres.")
  .max(72, "A senha pode ter no máximo 72 caracteres.");

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Informe sua senha."),
});

export const signUpSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "Informe seu nome.")
      .max(80, "Nome muito longo."),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não conferem.",
  });

export const restaurantSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Informe o nome do restaurante.")
    .max(120, "Nome muito longo."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "O link precisa ter pelo menos 3 caracteres.")
    .max(48, "O link pode ter no máximo 48 caracteres.")
    .regex(slugPattern, "Use apenas letras minúsculas, números e hífens."),
  description: z.string().trim().max(500, "Máximo de 500 caracteres.").optional(),
  phone: z.string().trim().max(32, "Telefone inválido.").optional(),
  addressLine: z.string().trim().max(160).optional(),
  addressNumber: z.string().trim().max(20).optional(),
  district: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .max(2, "Use a sigla do estado (ex.: SP).")
    .optional(),
  postalCode: z.string().trim().max(9).optional(),
});

export const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Informe seu nome.").max(80, "Nome muito longo."),
  phone: z.string().trim().max(32, "Telefone inválido.").optional(),
});

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type RestaurantInput = z.infer<typeof restaurantSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;

/** Resultado padrão de Server Actions com validação. */
export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

/* ==========================================================================
   Etapa 2 · Categorias e produtos
   ========================================================================== */

/**
 * Converte o texto digitado em número.
 * Aceita "32,90", "32.90", "R$ 32,90" e "1.234,56" (formato brasileiro).
 */
export function parsePrice(raw: string): number | null {
  const cleaned = raw
    .replace(/[^\d.,-]/g, "")
    .trim();
  if (!cleaned) return null;

  let normalized = cleaned;

  // Formato brasileiro com separador de milhar: 1.234,56
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (cleaned.includes(",")) {
    // 32,90 -> 32.90
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100) / 100;
}

/** Formata para "R$ 32,90". */
export function formatPrice(value: number | string | null | undefined): string {
  const number = typeof value === "string" ? Number(value) : (value ?? 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(number) ? number : 0);
}

export const categorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome da categoria.")
    .max(80, "Máximo de 80 caracteres."),
  description: z.string().trim().max(300, "Máximo de 300 caracteres.").optional(),
  isActive: z.boolean(),
});

export const productSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome do produto.")
    .max(120, "Máximo de 120 caracteres."),
  description: z.string().trim().max(400, "Máximo de 400 caracteres.").optional(),
  price: z
    .string()
    .trim()
    .min(1, "Informe o preço.")
    .superRefine((raw, ctx) => {
      const parsed = parsePrice(raw);
      if (parsed === null) {
        ctx.addIssue({ code: "custom", message: "Preço inválido. Use 0,00." });
      } else if (parsed > 999999.99) {
        ctx.addIssue({ code: "custom", message: "Preço muito alto." });
      }
    }),
  categoryId: z.string().trim().optional(),
  isAvailable: z.boolean(),
  isFeatured: z.boolean(),
  internalCode: z.string().trim().max(40, "Máximo de 40 caracteres.").optional(),
});

export type CategoryInput = z.infer<typeof categorySchema>;
export type ProductInput = z.infer<typeof productSchema>;

/**
 * Normaliza um UUID vindo do cliente. Retorna null se não for válido —
 * o banco também valida, mas evitamos enviar lixo para a API.
 */
export function toUuidOrNull(value: FormDataEntryValue | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : null;
}

/* ==========================================================================
   Etapa 4 · Mesas
   ========================================================================== */

/** Sugestão de próximo número: "Mesa 03" → "Mesa 04". */
export function nextTableName(existing: string[]): string {
  let max = 0;
  for (const name of existing) {
    const match = /^\s*mesa\s*(\d+)\s*$/i.exec(name);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `Mesa ${String(max + 1).padStart(2, "0")}`;
}

export const tableSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Dê um nome à mesa.")
    .max(60, "O nome pode ter no máximo 60 caracteres."),
  code: z
    .string()
    .trim()
    .max(40, "O código pode ter no máximo 40 caracteres."),
  notes: z
    .string()
    .trim()
    .max(300, "A observação pode ter no máximo 300 caracteres."),
  isActive: z.boolean(),
  /** Ocupação do salão; independente de `isActive` (visibilidade pública). */
  status: z.enum(["free", "occupied", "reserved"]).optional(),
});

export type TableInput = z.infer<typeof tableSchema>;

/* -------------------------------------------------------------------------- */
/* NFC (Etapa 5)                                                              */
/* -------------------------------------------------------------------------- */

/**
 * `nfc_status` aceita os quatro estados do enum do banco.
 *
 * O número físico da TAG é opcional de propósito: exigir o UID travaria a
 * maioria dos casos, porque cada app de gravação mostra esse dado em um lugar
 * diferente (ou não mostra).
 */
export const nfcTagSchema = z.object({
  label: z
    .string()
    .trim()
    .max(60, "O rótulo pode ter no máximo 60 caracteres."),
  tagIdentifier: z
    .string()
    .trim()
    .max(64, "O identificador pode ter no máximo 64 caracteres."),
  status: z.enum(["not_configured", "configured", "tested", "disabled"]),
  isActive: z.boolean(),
  tableId: z.string().uuid("Mesa não identificada."),
  tagId: z.string().uuid().optional(),
});

export type NfcTagInput = z.infer<typeof nfcTagSchema>;

/* ==========================================================================
   Etapa 6 · Pedido
   ========================================================================== */

/**
 * Item enviado ao servidor: **apenas** produto e quantidade.
 *
 * `z.object` sem `.passthrough()` descarta qualquer chave extra — se o
 * navegador mandar `price`/`total`, o valor morre aqui antes de chegar na RPC.
 * E mesmo que chegasse, `create_order` só lê produto e quantidade.
 */
export const orderItemInputSchema = z.object({
  product_id: z.string().uuid("Produto inválido."),
  // 1..99 espelha o CHECK do banco: nada de quantidade zero, negativa ou absurda.
  quantity: z
    .number()
    .int("Quantidade inválida.")
    .min(1, "Quantidade mínima é 1.")
    .max(99, "Quantidade máxima é 99."),
});

export const orderInputSchema = z.object({
  tableToken: z
    .string()
    .trim()
    .regex(/^[2-9A-HJKMNP-Z]{10,64}$/i, "Mesa não identificada."),
  items: z
    .array(orderItemInputSchema)
    .min(1, "Seu carrinho está vazio.")
    .max(50, "Muitos itens diferentes no mesmo pedido."),
  notes: z
    .string()
    .trim()
    .max(ORDER_NOTES_MAX, `A observação pode ter no máximo ${ORDER_NOTES_MAX} caracteres.`)
    .optional()
    .default(""),
  /*
   * Identificação do cliente — Etapa 24, **opcional por definição**.
   *
   * Nenhum dos três campos é obrigatório: quem só quer pedir continua pedindo
   * anônimo, exatamente como na Etapa 6. O que a validação garante é que, se a
   * pessoa **decidiu** se identificar, o dado vem completo e com consentimento
   * — nome ou telefone sem aceite derrubam o pedido no banco
   * (`consent_required`), e o app recusa antes para dar a mensagem certa.
   */
  customerName: z
    .string()
    .trim()
    .max(120, "O nome pode ter no máximo 120 caracteres.")
    .optional()
    .default(""),
  customerPhone: z
    .string()
    .trim()
    .max(40, "Telefone longo demais.")
    .optional()
    .default(""),
  consent: z.boolean().optional().default(false),
  /*
   * Cupom — Etapa 25.
   *
   * Só o CÓDIGO atravessa a fronteira. Valor, teto e total continuam vindo do
   * banco: não existe campo para o cliente mandar desconto, e o schema
   * descartaria se existisse. O código é saneado aqui (maiúsculo, sem espaço)
   * porque comparar "bem vindo10" com "BEMVINDO10" é responsabilidade das duas
   * pontas, não só do banco.
   */
  couponCode: z
    .string()
    .trim()
    .max(COUPON_CODE_MAX, "Código de cupom longo demais.")
    .optional()
    .default(""),
});

export type OrderInput = z.infer<typeof orderInputSchema>;

/* ==========================================================================
   Etapa 25 · Cupons (painel)
   ========================================================================== */

/**
 * Entrada de `validate_coupon` a partir do carrinho.
 *
 * `subtotal` é enviado para o cupom de valor mínimo poder responder antes do
 * envio. Ele **não** é usado para calcular o desconto final: no envio, o
 * servidor recalcula o subtotal com os preços do banco e chama a mesma função
 * de novo. Um subtotal mentiroso aqui só engana a prévia do próprio cliente.
 */
export const couponApplyInputSchema = z.object({
  tableToken: z
    .string()
    .trim()
    .regex(/^[2-9A-HJKMNP-Z]{10,64}$/i, "Mesa não identificada."),
  code: z
    .string()
    .trim()
    .min(1, "Digite o código do cupom.")
    .max(COUPON_CODE_MAX, "Código de cupom longo demais."),
  subtotal: z
    .number()
    .finite()
    .min(0, "Subtotal inválido.")
    .max(1_000_000, "Subtotal inválido."),
  customerPhone: z.string().trim().max(40).optional().default(""),
});

/**
 * Formulário de cupom do painel.
 *
 * Tipos numéricos chegam como número (a action converte de string com
 * `parseCouponForm`); aqui a validação é a última barreira antes da RPC.
 */
/**
 * Preferências de notificação — Etapa 26.
 *
 * O array só é conferido no formato; **quais** tipos existem é o banco que
 * decide (contra o enum `notification_type`). Duplicar a lista aqui criaria
 * duas verdades: a tela aceitaria um tipo que o banco recusa, ou o contrário.
 */
export const saveNotificationPreferencesSchema = z.object({
  restaurantId: z.string().uuid("Restaurante inválido."),
  disabled: z
    .array(z.string().trim().min(1).max(60))
    // Teto = número de tipos do enum. Truncar em silêncio esconderia um bug de
    // formulário; recusar é melhor.
    .max(50, "Lista de preferências inválida.")
    .default([]),
});

export const couponInputSchema = z.object({
  id: z.string().uuid().nullable().optional().default(null),
  name: z
    .string()
    .trim()
    .min(1, "Dê um nome ao cupom.")
    .max(COUPON_NAME_MAX, `O nome pode ter no máximo ${COUPON_NAME_MAX} caracteres.`),
  code: z
    .string()
    .trim()
    .min(COUPON_CODE_MIN, "Código curto demais.")
    .max(COUPON_CODE_MAX, "Código longo demais.")
    .regex(/^[A-Z0-9]+$/, "Use apenas letras e números."),
  description: z.string().trim().max(COUPON_DESCRIPTION_MAX).optional().default(""),
  discountType: z.enum(["percentage", "fixed", "free_shipping"]),
  discountValue: z.number().finite().min(0).max(COUPON_VALUE_MAX),
  minOrderValue: z.number().finite().min(0).max(COUPON_VALUE_MAX),
  maxDiscount: z.number().finite().min(0).max(COUPON_VALUE_MAX).nullable().optional().default(null),
  startsAt: z.string().datetime().nullable().optional().default(null),
  endsAt: z.string().datetime().nullable().optional().default(null),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().optional().default(null),
  maxUsesPerCustomer: z.number().int().min(1).max(COUPON_MAX_USES_PER_CUSTOMER),
  active: z.boolean(),
});
