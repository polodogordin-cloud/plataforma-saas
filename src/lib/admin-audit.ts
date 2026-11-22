/**
 * Rótulos das ações de auditoria — Etapa 10.
 *
 * Fica separado do `types.ts` porque é vocabulário de apresentação: o banco
 * grava `restaurant.suspended`, a tela mostra "Restaurante suspenso". Se um dia
 * surgir uma ação nova, o fallback é a própria string do banco — nunca um
 * "desconhecido" que esconde o evento.
 */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "restaurant.suspended": "Restaurante suspenso",
  "restaurant.status_changed": "Status do restaurante alterado",
  "restaurant.updated": "Dados do restaurante alterados",
  "product.created": "Produto criado",
  "product.updated": "Produto alterado",
  "product.deleted": "Produto removido",
  "member.role_changed": "Papel de usuário alterado",
  "member.status_changed": "Acesso de usuário alterado",
  "support.access": "Acesso de suporte registrado",
  // Etapa 19 — cobrança manual por PIX.
  "MANUAL_PAYMENT_CONFIRMED": "Pagamento confirmado manualmente",
  "payment.requested": "Pagamento solicitado",
  "payment.receipt_uploaded": "Comprovante enviado",
  "payment.rejected": "Pagamento rejeitado",
  "payment.cancelled": "Pagamento cancelado",
  "payment.settings_updated": "Dados de recebimento PIX alterados",
};

/** Tom do selo por família de ação (mesmo prefixo do banco). */
export function auditTone(action: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (action === "restaurant.suspended") return "danger";
  if (action === "support.access") return "info";
  // Etapa 19: confirmar libera acesso, cancelar/rejeitar encerram o pedido,
  // alterar a chave PIX ou anexar comprovante são passos de atenção.
  if (action === "MANUAL_PAYMENT_CONFIRMED") return "success";
  if (action === "payment.requested") return "info";
  if (action === "payment.cancelled" || action === "payment.rejected") return "danger";
  if (action === "payment.settings_updated" || action === "payment.receipt_uploaded") return "warning";
  if (action.startsWith("member.")) return "warning";
  if (action.endsWith(".created")) return "success";
  return "neutral";
}
