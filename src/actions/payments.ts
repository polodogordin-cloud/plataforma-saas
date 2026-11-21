"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { listOrderPayments } from "@/lib/data/analytics";
import type { OrderPayment, PaymentActionResult, PaymentMethod } from "@/lib/types";

/**
 * Registro de pagamentos — Etapa 16.
 *
 * ─── A regra do módulo, aplicada na entrada ─────────────────────────────────
 *
 * O escopo proíbe considerar um pedido pago sem confirmação real. Esta action é
 * onde "confirmação real" acontece: alguém clicou e informou **quanto** e
 * **como** entrou. Não existe caminho que marque pedido como pago por mudança
 * de status — `delivered` continua sendo só cozinha.
 *
 * ─── Três checagens ─────────────────────────────────────────────────────────
 *
 *  1. sessão + restaurante ativo (aqui);
 *  2. valor, método e teto do pedido (dentro de `record_order_payment`, no
 *     banco — a parte que não dá para contornar chamando a API direto);
 *  3. RLS nas tabelas, como última linha.
 *
 * O `orderId` chega do formulário, mas quem decide se o pedido é do usuário é o
 * banco: `record_order_payment` confere `is_restaurant_member` do pedido e
 * levanta `order_not_found` para o de outra casa. Um uuid forjado não vira
 * pagamento de terceiro.
 */

const methodSchema = z.enum(["cash", "pix", "card", "other"]);

const recordSchema = z.object({
  orderId: z.string().uuid("Pedido inválido."),
  // `coerce` porque o formulário manda string. `positive` + teto generoso; o
  // teto de verdade é o total do pedido, conferido no banco.
  amount: z.coerce
    .number()
    .positive("Informe um valor maior que zero.")
    .max(1_000_000, "Valor acima do permitido.")
    .refine((value) => Number.isFinite(value), "Valor inválido."),
  method: methodSchema,
  note: z.string().trim().max(200).optional(),
});

export type RecordPaymentInput = {
  orderId: string;
  amount: string;
  method: PaymentMethod;
  note?: string;
};

const MESSAGES: Record<string, string> = {
  order_not_found: "Pedido não encontrado.",
  invalid_amount: "Informe um valor maior que zero.",
  amount_exceeds_total: "O valor passa do total do pedido. Confira o que já foi recebido.",
  note_too_long: "A observação ficou longa demais.",
  payment_not_found: "Pagamento não encontrado.",
  already_refunded: "Esse pagamento já foi estornado.",
};

/**
 * Traduz a mensagem do banco.
 *
 * O banco fala em chaves (`amount_exceeds_total`), não em português — a mesma
 * função serve para qualquer app. A tradução mora aqui, junto de quem exibe.
 */
function translate(message: string | undefined, fallback: string): string {
  if (message) {
    for (const [key, text] of Object.entries(MESSAGES)) {
      if (message.includes(key)) return text;
    }
  }
  return fallback;
}

export async function recordPayment(input: unknown): Promise<PaymentActionResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Restaurante não encontrado." };

  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_order_payment", {
    p_order_id: parsed.data.orderId,
    p_amount: parsed.data.amount,
    p_method: parsed.data.method,
    p_note: parsed.data.note ?? null,
  });

  if (error) {
    return {
      ok: false,
      error: translate(error.message, "Não foi possível registrar o pagamento."),
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row) return { ok: false, error: "O pagamento não foi confirmado pelo banco." };

  // O painel de pedidos e o analytics mostram o mesmo dado: os dois precisam
  // saber que ele mudou.
  revalidatePath("/app/pedidos");
  revalidatePath("/app/analytics");

  return {
    ok: true,
    payment: {
      payment_id: String(row.payment_id),
      amount: Number(row.amount ?? 0),
      method: (row.method as PaymentMethod) ?? "other",
      status: (row.status as OrderPayment["status"]) ?? "paid",
      paid_at: String(row.paid_at),
      note: (row.note as string | null) ?? null,
    },
  };
}

export type RefundPaymentResult = { ok: true } | { ok: false; error: string };

export async function refundPayment(paymentId: string): Promise<RefundPaymentResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Restaurante não encontrado." };

  const parsed = z.string().uuid().safeParse(paymentId);
  if (!parsed.success) return { ok: false, error: "Pagamento inválido." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("refund_order_payment", { p_payment_id: parsed.data });

  if (error) {
    return {
      ok: false,
      error: translate(error.message, "Não foi possível estornar o pagamento."),
    };
  }

  revalidatePath("/app/pedidos");
  revalidatePath("/app/analytics");
  return { ok: true };
}

/** Pagamentos de um pedido — chamado sob demanda pelo detalhe no painel. */
export async function fetchOrderPayments(orderId: string): Promise<OrderPayment[]> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return [];

  const parsed = z.string().uuid().safeParse(orderId);
  if (!parsed.success) return [];

  return listOrderPayments(parsed.data);
}
