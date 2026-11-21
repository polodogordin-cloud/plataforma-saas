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
};

/** Tom do selo por família de ação (mesmo prefixo do banco). */
export function auditTone(action: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (action === "restaurant.suspended") return "danger";
  if (action === "support.access") return "info";
  if (action.startsWith("member.")) return "warning";
  if (action.endsWith(".created")) return "success";
  return "neutral";
}
