/**
 * Regras de cobrança manual por PIX — Etapa 19.
 *
 * Módulo **neutro**: sem React, sem `server-only`, sem Supabase. É a parte que
 * decide *texto*, *estado* e *validação de arquivo* — tudo o que dá para testar
 * em Node e que, se estivesse espalhado em componentes, divergiria entre as
 * telas do restaurante e as do painel master.
 *
 * A autorização **não** mora aqui. Quem decide se o cliente pode pagar, se o
 * admin pode confirmar e se o valor é o oficial é o banco (`request_plan_payment`,
 * `admin_confirm_payment`). Este arquivo só descreve e valida o que vai na tela.
 */

import type {
  BillingInterval,
  MyPaymentPanel,
  PaymentRequestStatus,
  PixKeyType,
} from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Estados que o dashboard mostra                                             */
/* -------------------------------------------------------------------------- */

/**
 * Os seis estados do escopo, na ordem em que o cliente os vive.
 *
 * Existe porque "status da assinatura" e "status do pagamento" são duas coisas
 * diferentes e o dono não deveria precisar cruzar as duas na cabeça:
 * uma casa em `trial` com pedido pendente está em `pending`, não em `trial`.
 */
export type PaymentStage =
  | "no_plan"
  | "pending"
  | "confirmed"
  | "active"
  | "expiring"
  | "expired";

/** A partir de quantos dias o aviso "seu plano vence em X dias" aparece. */
export const EXPIRING_SOON_DAYS = 7;

/**
 * Traduz (assinatura + pedido pendente) em um estágio só.
 *
 * Precedência, e o porquê de cada uma:
 *   1. **pending** vence tudo: há dinheiro em trânsito e o cliente precisa ver
 *      isso antes de qualquer outra mensagem;
 *   2. **no_plan** quando nunca houve assinatura — o convite é escolher plano;
 *   3. **expired** antes de `active`: uma assinatura vencida não é "ativa" só
 *      porque o enum ainda diz `active` e a data passou;
 *   4. **expiring** quando faltam poucos dias — é o empurrão de renovação;
 *   5. **active** no resto.
 *
 * `confirmed` aparece quando o período já começou (ou seja: `active`) **e** o
 * período é recente o bastante para o cliente querer ver "seu pagamento foi
 * confirmado". Passar `justConfirmed` deixa a tela de retorno mostrar isso sem
 * inventar um estado que o banco não tem.
 */
export function paymentStage(
  panel: Pick<MyPaymentPanel, "pending" | "subscription"> | null,
  justConfirmed = false,
): PaymentStage {
  if (!panel) return "no_plan";
  if (panel.pending) return "pending";

  const sub = panel.subscription;

  if (!sub?.has_subscription) return "no_plan";
  if (sub.status === "expired" || sub.status === "cancelled" || sub.status === "suspended") {
    return "expired";
  }

  const left = sub.days_left;
  if (left !== null && left <= 0) return "expired";
  if (justConfirmed) return "confirmed";
  if (left !== null && left <= EXPIRING_SOON_DAYS) return "expiring";

  return "active";
}

/** Frase de cada estágio, com o número quando existe. Nunca só cor. */
export function paymentStageMessage(stage: PaymentStage, daysLeft: number | null): string {
  switch (stage) {
    case "no_plan":
      return "Escolha um plano para liberar o painel completo.";
    case "pending":
      return "Pagamento aguardando confirmação. Assim que a plataforma confirmar o PIX, seu plano é ativado.";
    case "confirmed":
      return "Pagamento confirmado. Seu plano está ativo.";
    case "active":
      return "Plano ativo.";
    case "expiring": {
      if (daysLeft === null) return "Seu plano está perto do vencimento.";
      if (daysLeft <= 0) return "Seu plano vence hoje.";
      return `Seu plano vence em ${daysLeft} ${daysLeft === 1 ? "dia" : "dias"}.`;
    }
    case "expired":
      return "Seu plano expirou. Faça um novo PIX para reativar o acesso.";
    default:
      return "Plano ativo.";
  }
}

/** Título curto do cartão — o que o dono lê de relance. */
export const PAYMENT_STAGE_TITLE: Record<PaymentStage, string> = {
  no_plan: "Escolha um plano",
  pending: "Pagamento aguardando confirmação",
  confirmed: "Pagamento confirmado",
  active: "Plano ativo",
  expiring: "Plano vencendo",
  expired: "Plano expirado",
};

/** Tom do selo por estágio (o texto continua sendo a informação principal). */
export const PAYMENT_STAGE_TONE: Record<
  PaymentStage,
  "success" | "warning" | "info" | "danger" | "neutral"
> = {
  no_plan: "neutral",
  pending: "warning",
  confirmed: "success",
  active: "success",
  expiring: "warning",
  expired: "danger",
};

/** Estágios em que oferecer o botão "Pagar com PIX" faz sentido. */
export function canRequestPayment(stage: PaymentStage): boolean {
  return stage === "no_plan" || stage === "expired" || stage === "expiring";
}

/* -------------------------------------------------------------------------- */
/* PIX                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Prévia da chave para telas onde ela não é o assunto.
 *
 * Mostrar a chave inteira no dashboard é desnecessário; esconder tudo atrapalha
 * quem quer conferir se é a mesma. Deixa 4 caracteres de cada ponta quando há
 * tamanho para isso, e devolve `null` quando não há chave.
 */
export function maskPixKey(key: string | null, type: PixKeyType | null = null): string | null {
  if (!key) return null;
  const clean = key.trim();
  if (!clean) return null;

  // E-mail é identificador público por natureza e é o que o cliente digita
  // para pagar — mascarar aqui só criaria erro de digitação.
  if (type === "email") return clean;

  if (clean.length <= 6) return "•".repeat(clean.length);
  return `${clean.slice(0, 2)}${"•".repeat(4)}${clean.slice(-4)}`;
}

/**
 * O PIX está pronto para receber?
 *
 * Duas condições, e as duas importam: ligado (`is_active`) **e** com chave.
 * Uma tela que só olhasse o interruptor mandaria o cliente pagar para uma
 * chave vazia quando o master esquecesse de preencher.
 */
export function isPixReady(pix: { is_active: boolean; is_configured: boolean } | null): boolean {
  return Boolean(pix?.is_active && pix.is_configured);
}

/** Texto do botão de copiar — o mesmo em todas as telas. */
export const PIX_COPY_LABEL = "Copiar chave PIX";

/**
 * Instrução padrão quando o master não escreveu nenhuma.
 *
 * Não inventa dado de pagamento: só diz o que fazer com o que já está na tela.
 */
export const DEFAULT_PIX_INSTRUCTIONS =
  "Abra o app do seu banco, escolha pagar com PIX, use a chave abaixo e envie o comprovante pelo botão ao lado. A ativação é manual: a plataforma confere o recebimento antes de liberar o plano.";

/* -------------------------------------------------------------------------- */
/* Valores e prazos                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Preço de um ciclo, a partir do preço mensal do catálogo.
 *
 * Espelha `request_plan_payment`: mensal = preço; anual = 12× sem desconto. A
 * conta fica aqui para a tela **mostrar o mesmo número** que o banco vai gravar
 * — se as duas divergirem, o cliente vê um valor e paga outro.
 */
export function cycleAmount(monthlyPrice: number, interval: BillingInterval): number {
  const price = Number.isFinite(monthlyPrice) ? monthlyPrice : 0;
  return interval === "yearly" ? Math.round(price * 12 * 100) / 100 : Math.round(price * 100) / 100;
}

/** Duração do ciclo em dias — mesma regra de `billing_period_days`. */
export function cycleDays(interval: BillingInterval): number {
  return interval === "yearly" ? 365 : 30;
}

/**
 * Mensagem de vencimento do período concedido.
 *
 * Recebe a data final que o banco devolveu na confirmação. Sem data, não
 * afirma nada — melhor "confirmado" sem prazo do que um prazo inventado.
 */
export function confirmedPeriodMessage(periodEnd: string | null, days: number | null): string {
  if (!periodEnd) {
    return days ? `Pagamento confirmado: ${days} dias liberados.` : "Pagamento confirmado.";
  }
  const date = new Date(periodEnd);
  if (Number.isNaN(date.getTime())) {
    return days ? `Pagamento confirmado: ${days} dias liberados.` : "Pagamento confirmado.";
  }
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  return `Pagamento confirmado. Seu plano está ativo até ${formatted}.`;
}

/* -------------------------------------------------------------------------- */
/* Comprovante                                                                */
/* -------------------------------------------------------------------------- */

/** 5 MB — o mesmo `file_size_limit` do bucket `payment-receipts`. */
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

export const RECEIPT_ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf";

export type ReceiptIssue =
  | "empty"
  | "too_large"
  | "bad_type"
  | "bad_extension"
  | "note_too_long";

export const RECEIPT_ISSUE_MESSAGE: Record<ReceiptIssue, string> = {
  empty: "O arquivo está vazio. Escolha outro.",
  too_large: "O arquivo passa de 5 MB. Envie uma foto menor ou o PDF do comprovante.",
  bad_type: "Formato não aceito. Use PNG, JPG, WEBP ou PDF.",
  bad_extension: "A extensão não confere com o tipo do arquivo.",
  note_too_long: "A observação pode ter no máximo 280 caracteres.",
};

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
};

const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

/** Extensão em minúsculas, sem o ponto. `""` quando não há. */
export function receiptExtension(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename ?? "");
  return match?.[1]?.toLowerCase() ?? "";
}

/**
 * Valida o comprovante **antes** de subir.
 *
 * Três checagens independentes, e nenhuma delas é autorização:
 *   • tamanho (rede e bucket);
 *   • MIME declarado pelo navegador;
 *   • extensão × MIME — `comprovante.png` que na verdade é PDF seria aceito
 *     pelo bucket e recusado na leitura de quem abre; recusar aqui evita o
 *     comprovante "invisível".
 *
 * O bucket também filtra MIME e a RPC revalida o caminho do tenant: três
 * camadas, como no upload de logo da Etapa 9.
 */
export function validateReceipt(file: {
  name: string;
  size: number;
  type: string;
}): { ok: true; extension: string; contentType: string } | { ok: false; issue: ReceiptIssue } {
  if (!file || file.size <= 0) return { ok: false, issue: "empty" };
  if (file.size > RECEIPT_MAX_BYTES) return { ok: false, issue: "too_large" };

  const extension = receiptExtension(file.name);
  if (!extension || !MIME_BY_EXTENSION[extension]) return { ok: false, issue: "bad_extension" };

  const declared = (file.type || "").toLowerCase();
  if (declared && !ALLOWED_MIME.includes(declared)) return { ok: false, issue: "bad_type" };
  if (declared && declared !== MIME_BY_EXTENSION[extension]) return { ok: false, issue: "bad_extension" };

  return { ok: true, extension, contentType: MIME_BY_EXTENSION[extension] };
}

/** Observação do comprovante: opcional, curta, sem quebra de linha dupla. */
export function normalizeReceiptNote(note: string | null | undefined): string | null {
  const clean = (note ?? "").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 280) : null;
}

/**
 * Caminho do comprovante no bucket privado.
 *
 * `{restaurant_id}/receipts/{request_id}-{timestamp}.{ext}` — o primeiro
 * segmento é o tenant, que é o que a policy do Storage confere; o id do pedido
 * deixa óbvio, para o admin, a que pagamento o arquivo pertence.
 */
export function receiptPath(
  restaurantId: string,
  requestId: string,
  extension: string,
  stamp: number = Date.now(),
): string {
  return `${restaurantId}/receipts/${requestId}-${stamp.toString(36)}.${extension}`;
}

/* -------------------------------------------------------------------------- */
/* Vocabulário de tela                                                        */
/* -------------------------------------------------------------------------- */

/**
 * O que o administrador está confirmando.
 *
 * Fica em função própria porque o texto do aviso é o item mais importante da
 * tela do admin: confirmar sem ter visto o extrato é o erro que este fluxo
 * existe para evitar.
 */
export function confirmWarning(amount: number, planName: string): string {
  return `Você vai ativar o plano ${planName} por ${formatMoney(amount)}. Confirme somente após verificar o recebimento do PIX na sua conta. Esta ação fica registrada na auditoria.`;
}

/** Formatação em reais sem depender de Intl na chamada (testável). */
export function formatMoney(value: number): string {
  const number = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(number);
}

/** Status de pagamento em texto para `aria-label`/leitor de tela. */
export function paymentStatusAnnouncement(status: PaymentRequestStatus, planName: string): string {
  switch (status) {
    case "PENDING":
      return `Pagamento do plano ${planName} aguardando confirmação.`;
    case "CONFIRMED":
      return `Pagamento do plano ${planName} confirmado.`;
    case "REJECTED":
      return `Pagamento do plano ${planName} rejeitado.`;
    case "CANCELLED":
      return `Pagamento do plano ${planName} cancelado.`;
    default:
      return `Pagamento do plano ${planName}.`;
  }
}

/**
 * Frase do aviso de renovação (usada também no dashboard do restaurante).
 *
 * Separada de `paymentStageMessage` porque ali o texto depende do estágio
 * inteiro; aqui é só o empurrão de antecedência.
 */
export function renewalNotice(daysLeft: number | null): string | null {
  if (daysLeft === null || daysLeft <= 0 || daysLeft > EXPIRING_SOON_DAYS) return null;
  return `Seu plano vence em ${daysLeft} ${daysLeft === 1 ? "dia" : "dias"}.`;
}
