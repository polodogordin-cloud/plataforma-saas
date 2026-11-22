import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type {
  AdminPaymentRequestDetail,
  AdminPaymentRequestRow,
  AdminPaymentSettings,
  AdminPaymentSummary,
  BillingInterval,
  MyPaymentPanel,
  PaymentRequestMethod,
  PaymentRequestStatus,
  PaymentRequestSummary,
  PixKeyType,
  PixSettings,
  SubscriptionState,
} from "@/lib/types";

/**
 * Leitura de pagamentos — Etapa 19.
 *
 * Mesma regra das etapas 10 e 11: **nada aqui lê tabela direto**. Tudo passa
 * por RPC `security definer`:
 *
 *   • `payment_requests` tem RLS por tenant — ler direto funcionaria para o
 *     restaurante, mas o menu master não é membro de nenhuma casa e não deve
 *     virar um (a policy de `select` é por vínculo, de propósito);
 *   • `payment_settings` não tem policy nenhuma: o restaurante recebe só os
 *     campos de recebimento por `my_payment_panel`, nunca a linha inteira;
 *   • o `restaurantId` que chega aqui é o da casa ativa resolvida no servidor;
 *     o banco confere o vínculo antes de responder.
 *
 * Nenhuma função deste arquivo decide autorização. Ela apenas: chama a RPC,
 * normaliza o JSON (o PostgREST devolve `numeric` como string) e devolve um
 * tipo fechado. Se a RPC recusa, a função devolve `null`/lista vazia e a tela
 * mostra o estado "não foi possível carregar" — sem inventar dado.
 */

const toNumber = (value: unknown): number => {
  const parsed = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toNumberOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : toNumber(value);

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.trim() === "" ? null : text;
};

const PAYMENT_STATUSES: PaymentRequestStatus[] = ["PENDING", "CONFIRMED", "REJECTED", "CANCELLED"];

/** Fecha o vocabulário: status desconhecido do banco não vira `undefined` na tela. */
export function toPaymentStatus(value: unknown): PaymentRequestStatus {
  const raw = String(value ?? "").toUpperCase();
  return (PAYMENT_STATUSES as string[]).includes(raw) ? (raw as PaymentRequestStatus) : "PENDING";
}

const PIX_KEY_TYPES: PixKeyType[] = ["cpf", "cnpj", "email", "phone", "random"];

export function toPixKeyType(value: unknown): PixKeyType | null {
  const raw = String(value ?? "").toLowerCase();
  return (PIX_KEY_TYPES as string[]).includes(raw) ? (raw as PixKeyType) : null;
}

export function toPaymentSummary(row: unknown): PaymentRequestSummary {
  const raw = asRecord(row);
  return {
    id: String(raw.id ?? ""),
    plan_id: String(raw.plan_id ?? ""),
    plan_name: String(raw.plan_name ?? ""),
    amount: toNumber(raw.amount),
    billing_interval: (raw.billing_interval === "yearly" ? "yearly" : "monthly") as BillingInterval,
    payment_method: (raw.payment_method === "MANUAL_PIX"
      ? "MANUAL_PIX"
      : "MANUAL_PIX") as PaymentRequestMethod,
    status: toPaymentStatus(raw.status),
    receipt_path: asText(raw.receipt_path),
    receipt_note: asText(raw.receipt_note),
    rejection_reason: asText(raw.rejection_reason),
    created_at: String(raw.created_at ?? ""),
    confirmed_at: asText(raw.confirmed_at),
  };
}

export function toPixSettings(row: unknown): PixSettings {
  const raw = asRecord(row);
  return {
    is_active: raw.is_active === true,
    is_configured: raw.is_configured === true,
    recipient_name: asText(raw.recipient_name),
    pix_key: asText(raw.pix_key),
    pix_key_type: toPixKeyType(raw.pix_key_type),
    instructions: asText(raw.instructions),
    qr_code_url: asText(raw.qr_code_url),
  };
}

/* -------------------------------------------------------------------------- */
/* Restaurante                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Painel de pagamento da casa ativa.
 *
 * `cache` porque a mesma tela lê isso duas vezes (cartão do dashboard + página
 * de pagamento) e a RPC é estável dentro de uma requisição.
 */
export const getMyPaymentPanel = cache(
  async (restaurantId?: string): Promise<MyPaymentPanel | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("my_payment_panel", {
      p_restaurant_id: restaurantId ?? null,
    });

    if (error || !data) return null;

    const raw = asRecord(data);
    const sub = asRecord(raw.subscription);
    const history = Array.isArray(raw.history) ? raw.history : [];

    return {
      restaurant_id: String(raw.restaurant_id ?? ""),
      pix: toPixSettings(raw.pix),
      pending: raw.pending ? toPaymentSummary(raw.pending) : null,
      history: history.map(toPaymentSummary),
      subscription: {
        status: (sub.status ?? "expired") as SubscriptionState,
        has_subscription: sub.has_subscription === true,
        plan_id: asText(sub.plan_id),
        period_start: asText(sub.period_start),
        period_end: asText(sub.period_end),
        trial_end: asText(sub.trial_end),
        days_left: toNumberOrNull(sub.days_left),
      },
    };
  },
);

/* -------------------------------------------------------------------------- */
/* Painel master                                                              */
/* -------------------------------------------------------------------------- */

export async function getAdminPaymentRequestList(
  status?: PaymentRequestStatus | "ALL",
  search?: string,
): Promise<AdminPaymentRequestRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_payment_requests", {
    p_status: status && status !== "ALL" ? status : null,
    p_search: search?.trim() || null,
  });

  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((row) => ({
    id: String(row.id ?? ""),
    restaurant_id: String(row.restaurant_id ?? ""),
    restaurant_name: String(row.restaurant_name ?? ""),
    restaurant_slug: String(row.restaurant_slug ?? ""),
    requester_name: asText(row.requester_name),
    requester_email: asText(row.requester_email),
    plan_id: String(row.plan_id ?? ""),
    plan_name: String(row.plan_name ?? ""),
    billing_interval: (row.billing_interval === "yearly" ? "yearly" : "monthly") as BillingInterval,
    amount: toNumber(row.amount),
    payment_method: "MANUAL_PIX" as PaymentRequestMethod,
    status: toPaymentStatus(row.status),
    receipt_path: asText(row.receipt_path),
    receipt_uploaded_at: asText(row.receipt_uploaded_at),
    transaction_reference: asText(row.transaction_reference),
    rejection_reason: asText(row.rejection_reason),
    created_at: String(row.created_at ?? ""),
    confirmed_at: asText(row.confirmed_at),
    period_days: toNumberOrNull(row.period_days),
    subscription_id: asText(row.subscription_id),
    confirmed_by_email: asText(row.confirmed_by_email),
  }));
}

export async function getAdminPaymentRequest(id: string): Promise<AdminPaymentRequestDetail | null> {
  if (!id) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_payment_request", { p_id: id });

  if (error || !data) return null;

  const raw = asRecord(data);
  const sub = asRecord(raw.subscription);

  return {
    id: String(raw.id ?? ""),
    restaurant_id: String(raw.restaurant_id ?? ""),
    restaurant_name: String(raw.restaurant_name ?? ""),
    restaurant_slug: String(raw.restaurant_slug ?? ""),
    requester_name: asText(raw.requester_name),
    requester_email: asText(raw.requester_email),
    plan_id: String(raw.plan_id ?? ""),
    plan_name: String(raw.plan_name ?? ""),
    billing_interval: (raw.billing_interval === "yearly" ? "yearly" : "monthly") as BillingInterval,
    amount: toNumber(raw.amount),
    payment_method: "MANUAL_PIX",
    status: toPaymentStatus(raw.status),
    receipt_path: asText(raw.receipt_path),
    receipt_uploaded_at: asText(raw.receipt_uploaded_at),
    transaction_reference: asText(raw.transaction_reference),
    rejection_reason: asText(raw.rejection_reason),
    created_at: String(raw.created_at ?? ""),
    confirmed_at: asText(raw.confirmed_at),
    period_days: toNumberOrNull(raw.period_days),
    subscription_id: asText(raw.subscription_id),
    confirmed_by_email: asText(raw.confirmed_by_email),
    receipt_note: asText(raw.receipt_note),
    notes: asText(raw.notes),
    paid_at: asText(raw.paid_at),
    subscription: {
      status: (sub.status ?? "expired") as SubscriptionState,
      plan_id: asText(sub.plan_id),
      period_start: asText(sub.period_start),
      period_end: asText(sub.period_end),
      trial_end: asText(sub.trial_end),
    },
  };
}

export async function getAdminPaymentSettings(): Promise<AdminPaymentSettings | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_payment_settings");

  if (error || !data) return null;

  const raw = asRecord(data);
  return {
    is_active: raw.is_active === true,
    recipient_name: asText(raw.recipient_name),
    pix_key: asText(raw.pix_key),
    pix_key_type: toPixKeyType(raw.pix_key_type),
    instructions: asText(raw.instructions),
    qr_code_url: asText(raw.qr_code_url),
    updated_at: asText(raw.updated_at),
    updated_by_email: asText(raw.updated_by_email),
    can_edit: raw.can_edit === true,
  };
}

export const getAdminPaymentSummary = cache(async (): Promise<AdminPaymentSummary | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_payment_summary");

  if (error || !data) return null;

  const raw = asRecord(data);
  return {
    pending: toNumber(raw.pending),
    confirmed: toNumber(raw.confirmed),
    rejected: toNumber(raw.rejected),
    confirmed_amount_month: toNumber(raw.confirmed_amount_month),
  };
});

/**
 * URL assinada do comprovante.
 *
 * O bucket é **privado**: nem o restaurante dono do arquivo, nem o admin,
 * conseguem abrir o caminho direto. A URL assinada vale 5 minutos — tempo de
 * olhar, não de guardar link. Quem pode assinar é decidido pela policy do
 * Storage, então esta função não é autorização.
 */
export async function getReceiptUrl(path: string | null): Promise<string | null> {
  if (!path) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("payment-receipts")
    .createSignedUrl(path, 300);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
