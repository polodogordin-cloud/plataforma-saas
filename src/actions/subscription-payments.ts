"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveRestaurant, getSessionUser } from "@/lib/data/restaurants";
import { isPlatformAdmin } from "@/lib/data/admin";
import type { BillingInterval } from "@/lib/types";
import { normalizeReceiptNote, receiptExtension, validateReceipt } from "@/lib/payments";

/**
 * Ações de cobrança manual por PIX — Etapa 19.
 *
 * Quatro regras que este arquivo não negocia:
 *
 *   1. **O restaurante vem do servidor.** Nenhuma action do cliente aceita
 *      `restaurantId`: quem manda é `getActiveRestaurant()`. Um id de outra casa
 *      no payload não muda nada.
 *   2. **O valor nunca vem do navegador.** `requestMyPayment` recebe plano e
 *      intervalo; o preço é lido de `plans` dentro da RPC e congelado no pedido.
 *   3. **Só o admin da plataforma confirma.** As ações de confirmação/rejeição
 *      checam `isPlatformAdmin()` aqui (mensagem boa) *e* a RPC repete a guarda
 *      (garantia). Nenhuma ação do restaurante toca em status.
 *   4. **Nenhuma confirmação é inferida.** Não existe caminho que marque
 *      pagamento como pago por upload de comprovante, por tempo ou por retorno
 *      de tela. Quem confirma é uma pessoa, com nome na auditoria.
 */

export type PaymentResult =
  | { ok: true; message: string; data?: Record<string, unknown> }
  | { ok: false; error: string };

const planIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{2,32}$/, "Plano inválido.");

const intervalSchema = z.enum(["monthly", "yearly"]);

const uuidSchema = z.string().uuid("Registro inválido.");

const OPTION_LABELS: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "e-mail",
  phone: "telefone",
  random: "chave aleatória",
};

/** Traduz erro de RPC para texto de tela. */
function translatePaymentError(message: string | undefined): string {
  const raw = message ?? "";

  if (raw.includes("pix_not_configured")) {
    return "O PIX da plataforma ainda não está configurado ou está desligado. Fale com o suporte.";
  }
  if (raw.includes("plan_is_free")) {
    return "Este plano é gratuito: não há pagamento a fazer.";
  }
  if (raw.includes("invalid_plan")) return "Este plano não está mais disponível.";
  if (raw.includes("payment_not_pending")) {
    return "Esta solicitação já foi analisada. Recarregue a página para ver o estado atual.";
  }
  if (raw.includes("payment_request_not_found")) return "Solicitação de pagamento não encontrada.";
  if (raw.includes("invalid_receipt_path")) {
    return "O comprovante não pôde ser vinculado. Envie o arquivo novamente.";
  }
  if (raw.includes("note_too_long")) return "A observação pode ter no máximo 280 caracteres.";
  if (raw.includes("reason_too_long")) return "O motivo pode ter no máximo 280 caracteres.";
  if (raw.includes("invalid_reason")) return "Explique o motivo da rejeição (pelo menos 3 caracteres).";
  if (raw.includes("reference_too_long")) {
    return "A referência do PIX pode ter no máximo 140 caracteres.";
  }
  if (raw.includes("period_override_forbidden")) {
    return "Somente o administrador master pode alterar a duração do período.";
  }
  if (raw.includes("invalid_period")) return "Período inválido: informe de 1 a 3660 dias.";
  if (raw.includes("master_admin_forbidden")) {
    return "Somente o administrador master altera os dados de recebimento do PIX.";
  }
  if (raw.includes("pix_key_required")) return "Informe a chave PIX antes de ativar o recebimento.";
  if (raw.includes("invalid_pix_key")) return "A chave PIX informada não é válida.";
  if (raw.includes("invalid_pix_key_type")) return "Tipo de chave PIX inválido.";
  if (raw.includes("invalid_recipient_name")) return "Informe o nome do recebedor (2 a 80 caracteres).";
  if (raw.includes("instructions_too_long")) return "As instruções podem ter no máximo 600 caracteres.";
  if (raw.includes("invalid_qr_url")) return "O QR Code precisa ser uma imagem enviada pela plataforma.";
  if (raw.includes("forbidden") || raw.includes("admin_forbidden")) {
    return "Você não tem permissão para esta ação.";
  }
  return "Não foi possível concluir a operação. Tente novamente.";
}

/** Revalida tudo o que mostra estado comercial — em uma casa e na plataforma. */
function revalidatePayments() {
  revalidatePath("/app");
  revalidatePath("/app/plano");
  revalidatePath("/app/pagamento");
  revalidatePath("/app/configuracoes");
  revalidatePath("/dashboard/billing");
  revalidatePath("/admin");
  revalidatePath("/admin/pagamentos");
  revalidatePath("/admin/assinaturas");
  revalidatePath("/admin/configuracoes");
  revalidatePath("/admin/settings/payment");
}

/* -------------------------------------------------------------------------- */
/* Restaurante                                                                */
/* -------------------------------------------------------------------------- */

type ManagerGuard =
  | { restaurant: { id: string; name: string; role: string } }
  | { error: string };

async function requirePaymentManager(): Promise<ManagerGuard> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { error: "Restaurante não encontrado." };
  if (restaurant.role !== "owner" && restaurant.role !== "admin") {
    return { error: "Apenas o proprietário ou um administrador da casa pode pagar pelo plano." };
  }
  return { restaurant };
}

/**
 * Cria (ou substitui) a solicitação de pagamento de um plano.
 *
 * O payload só tem `planId` e `interval`. Qualquer `amount` enviado junto é
 * ignorado: não existe parâmetro para ele em `request_plan_payment`.
 */
export async function requestMyPayment(input: {
  planId: string;
  interval?: BillingInterval;
}): Promise<PaymentResult> {
  const plan = planIdSchema.safeParse(input?.planId);
  if (!plan.success) return { ok: false, error: "Plano inválido." };

  const interval = intervalSchema.safeParse(input?.interval ?? "monthly");
  if (!interval.success) return { ok: false, error: "Período inválido." };

  const guard = await requirePaymentManager();
  if ("error" in guard) return { ok: false, error: guard.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_plan_payment", {
    p_plan_id: plan.data,
    p_interval: interval.data,
    p_restaurant_id: guard.restaurant.id,
  });

  if (error) return { ok: false, error: translatePaymentError(error.message) };

  revalidatePayments();

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    message: "Solicitação registrada. Faça o PIX e aguarde a confirmação da plataforma.",
    data: {
      id: row.id,
      amount: row.amount,
      plan_name: row.plan_name,
      status: row.status,
    },
  };
}

/**
 * Vincula o comprovante já enviado ao bucket.
 *
 * O upload em si acontece no navegador (arquivo grande não passa por Server
 * Action): a action cria o caminho no **tenant do servidor**, confere tipo e
 * tamanho declarados e chama a RPC, que revalida o prefixo e o status.
 * Comprovante **não** confirma pagamento.
 */
export async function submitPaymentReceipt(input: {
  requestId: string;
  path: string;
  filename: string;
  size: number;
  mimeType: string;
  note?: string | null;
}): Promise<PaymentResult> {
  const requestId = uuidSchema.safeParse(input?.requestId);
  if (!requestId.success) return { ok: false, error: "Solicitação inválida." };

  const guard = await requirePaymentManager();
  if ("error" in guard) return { ok: false, error: guard.error };

  const checked = validateReceipt({
    name: input?.filename ?? "",
    size: Number(input?.size ?? 0),
    type: input?.mimeType ?? "",
  });

  if (!checked.ok) {
    const message =
      checked.issue === "too_large"
        ? "O arquivo passa de 5 MB."
        : checked.issue === "bad_type" || checked.issue === "bad_extension"
          ? "Formato não aceito. Use PNG, JPG, WEBP ou PDF."
          : "Arquivo inválido.";
    return { ok: false, error: message };
  }

  // O caminho tem de ser o que o servidor calculou para esta casa e este
  // pedido: qualquer outro é recusado antes mesmo de chegar ao banco.
  const expectedPrefix = `${guard.restaurant.id}/receipts/${requestId.data}-`;
  if (!input.path?.startsWith(expectedPrefix) || receiptExtension(input.path) !== checked.extension) {
    return { ok: false, error: "Caminho de comprovante inválido. Envie o arquivo novamente." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("attach_payment_receipt", {
    p_request_id: requestId.data,
    p_path: input.path,
    p_note: normalizeReceiptNote(input.note),
  });

  if (error) return { ok: false, error: translatePaymentError(error.message) };

  revalidatePayments();
  return {
    ok: true,
    message: "Comprovante enviado. A plataforma vai conferir o recebimento do PIX.",
  };
}

/* -------------------------------------------------------------------------- */
/* Administrador                                                              */
/* -------------------------------------------------------------------------- */

type AdminGuard = { ok: true } | { ok: false; error: string };

async function requirePlatformAdmin(): Promise<AdminGuard> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Faça login para continuar." };
  if (!(await isPlatformAdmin())) {
    return { ok: false, error: "Você não tem acesso ao painel da plataforma." };
  }
  return { ok: true };
}

/**
 * Confirma o pagamento e ativa a assinatura.
 *
 * Aviso na tela e na mensagem de retorno: só depois de ver o dinheiro na conta.
 * `periodDays` é ajuste manual — a RPC recusa quem não é MASTER_ADMIN.
 */
export async function confirmPayment(input: {
  requestId: string;
  reference?: string | null;
  periodDays?: number | null;
  note?: string | null;
}): Promise<PaymentResult> {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return { ok: false, error: guard.error };

  const requestId = uuidSchema.safeParse(input?.requestId);
  if (!requestId.success) return { ok: false, error: "Solicitação inválida." };

  const reference = (input.reference ?? "").trim();
  if (reference.length > 140) {
    return { ok: false, error: "A referência do PIX pode ter no máximo 140 caracteres." };
  }

  const note = normalizeReceiptNote(input.note);
  const rawDays = input.periodDays;
  const periodDays =
    rawDays === null || rawDays === undefined || Number.isNaN(Number(rawDays))
      ? null
      : Math.trunc(Number(rawDays));

  if (periodDays !== null && (periodDays < 1 || periodDays > 3660)) {
    return { ok: false, error: "Período inválido: informe de 1 a 3660 dias." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_confirm_payment", {
    p_id: requestId.data,
    p_reference: reference || null,
    p_period_days: periodDays,
    p_note: note,
  });

  if (error) return { ok: false, error: translatePaymentError(error.message) };

  revalidatePayments();

  const result = (data ?? {}) as Record<string, unknown>;
  const days = Number(result.period_days ?? 0) || null;
  return {
    ok: true,
    message: days
      ? `Pagamento confirmado e assinatura ativada por ${days} dias.`
      : "Pagamento confirmado e assinatura ativada.",
    data: result,
  };
}

/** Rejeita: não ativa nada, exige motivo e fica na auditoria. */
export async function rejectPayment(input: {
  requestId: string;
  reason: string;
}): Promise<PaymentResult> {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return { ok: false, error: guard.error };

  const requestId = uuidSchema.safeParse(input?.requestId);
  if (!requestId.success) return { ok: false, error: "Solicitação inválida." };

  const reason = (input?.reason ?? "").trim();
  if (reason.length < 3) return { ok: false, error: "Explique o motivo da rejeição." };
  if (reason.length > 280) return { ok: false, error: "O motivo pode ter no máximo 280 caracteres." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reject_payment", {
    p_id: requestId.data,
    p_reason: reason,
  });

  if (error) return { ok: false, error: translatePaymentError(error.message) };

  revalidatePayments();
  return { ok: true, message: "Pagamento rejeitado. O restaurante vê o motivo no histórico." };
}

/**
 * Cancela uma solicitação pendente (a pedido do cliente, pelo suporte).
 *
 * Não existe ação equivalente para o restaurante: cancelar é mudar status, e
 * nesta etapa o cliente só cria, anexa comprovante e lê.
 */
export async function cancelPendingPayment(input: {
  requestId: string;
  reason?: string | null;
}): Promise<PaymentResult> {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return { ok: false, error: guard.error };

  const requestId = uuidSchema.safeParse(input?.requestId);
  if (!requestId.success) return { ok: false, error: "Solicitação inválida." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_cancel_payment", {
    p_id: requestId.data,
    p_reason: normalizeReceiptNote(input?.reason),
  });

  if (error) return { ok: false, error: translatePaymentError(error.message) };

  revalidatePayments();
  return { ok: true, message: "Solicitação cancelada." };
}

/**
 * Salva a configuração global do PIX — **só MASTER_ADMIN**.
 *
 * A guarda dupla (aqui e na RPC) existe porque esta é a única escrita que muda
 * *para onde o dinheiro vai*. Um admin operacional confirmando pagamentos não
 * deve poder redirecionar a chave.
 */
export async function savePaymentSettings(input: {
  recipientName: string;
  pixKey: string;
  pixKeyType?: string | null;
  instructions?: string | null;
  qrCodeUrl?: string | null;
  isActive: boolean;
}): Promise<PaymentResult> {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return { ok: false, error: guard.error };

  const recipientName = (input?.recipientName ?? "").trim();
  const pixKey = (input?.pixKey ?? "").trim();
  const pixKeyType = (input?.pixKeyType ?? "").trim();
  const instructions = normalizeReceiptNote(input?.instructions);
  const qrCodeUrl = (input?.qrCodeUrl ?? "").trim();

  if (recipientName && (recipientName.length < 2 || recipientName.length > 80)) {
    return { ok: false, error: "Informe o nome do recebedor (2 a 80 caracteres)." };
  }
  if (input.isActive && !pixKey) {
    return { ok: false, error: "Informe a chave PIX antes de ativar o recebimento." };
  }
  if (pixKey && (pixKey.length < 3 || pixKey.length > 140)) {
    return { ok: false, error: "A chave PIX deve ter entre 3 e 140 caracteres." };
  }
  if (pixKeyType && !OPTION_LABELS[pixKeyType]) {
    return { ok: false, error: "Tipo de chave PIX inválido." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_payment_settings", {
    p_recipient_name: recipientName || null,
    p_pix_key: pixKey || null,
    p_pix_key_type: pixKeyType || null,
    p_instructions: instructions,
    p_qr_code_url: qrCodeUrl || null,
    p_is_active: Boolean(input.isActive),
  });

  if (error) return { ok: false, error: translatePaymentError(error.message) };

  revalidatePayments();
  return {
    ok: true,
    message: input.isActive
      ? "Dados de recebimento salvos. O PIX está ativo para as casas."
      : "Dados de recebimento salvos. O PIX está desligado.",
  };
}
