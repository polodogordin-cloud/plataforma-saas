import { Badge } from "@/components/ui/card";
import {
  RESTAURANT_STATUS_LABEL,
  RESTAURANT_STATUS_TONE,
  type RestaurantStatus,
} from "@/lib/types";

/**
 * Selo de status — sempre **ícone + texto + cor**, nunca só cor.
 *
 * Quem enxerga "suspenso" em vermelho e "pausado" em cinza lê de relance; quem
 * não distingue as cores lê o texto; quem usa leitor de tela ouve o mesmo
 * texto. A cor é reforço, não a informação.
 */
export function RestaurantStatusBadge({ status }: { status: RestaurantStatus }) {
  const tone = RESTAURANT_STATUS_TONE[status];
  const icons: Record<RestaurantStatus, string> = {
    published: "●",
    draft: "○",
    paused: "❚❚",
    closed: "—",
    suspended: "⊘",
  };

  return (
    <Badge tone={tone}>
      <span aria-hidden="true" className="text-[0.7em]">
        {icons[status]}
      </span>
      {RESTAURANT_STATUS_LABEL[status]}
    </Badge>
  );
}

export function MemberStatusBadge({ status }: { status: "active" | "invited" | "suspended" }) {
  const map = {
    active: { label: "Ativo", tone: "success" as const },
    invited: { label: "Convidado", tone: "warning" as const },
    suspended: { label: "Bloqueado", tone: "danger" as const },
  }[status];

  return <Badge tone={map.tone}>{map.label}</Badge>;
}
