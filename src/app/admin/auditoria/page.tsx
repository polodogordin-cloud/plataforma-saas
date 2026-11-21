import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { AdminHeader } from "@/components/admin/admin-header";
import { Badge } from "@/components/ui/card";
import { listAdminAudit } from "@/lib/data/admin";
import { AUDIT_ACTION_LABEL, auditTone } from "@/lib/admin-audit";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Auditoria" };
export const dynamic = "force-dynamic";

/**
 * Histórico de ações administrativas.
 *
 * Só leitura, e é o ponto: a tabela não tem policy de insert nem de delete, e
 * quem grava são funções `security definer` que leem o autor de `auth.uid()`.
 * Nem o admin da plataforma reescreve o passado por aqui.
 *
 * O que aparece: suspensões, mudanças de status, edições cadastrais, trocas de
 * papel de equipe, acessos de suporte — e também produtos criados/alterados,
 * porque "quem mudou o preço?" é a pergunta mais comum do atendimento.
 */
function describeMetadata(action: string, metadata: Record<string, unknown>): string | null {
  if (action === "restaurant.suspended" && metadata.reason) {
    return `Motivo: ${String(metadata.reason)}`;
  }
  if (action === "restaurant.status_changed" && metadata.from && metadata.to) {
    return `${String(metadata.from)} → ${String(metadata.to)}`;
  }
  if (action === "member.role_changed" && metadata.from && metadata.to) {
    return `${String(metadata.from)} → ${String(metadata.to)}`;
  }
  if (action === "member.status_changed" && metadata.from && metadata.to) {
    return `${String(metadata.from)} → ${String(metadata.to)}`;
  }
  if (action === "support.access" && metadata.note) {
    return String(metadata.note);
  }
  if (action === "product.updated" && metadata.from && metadata.to) {
    const from = metadata.from as { price?: number };
    const to = metadata.to as { price?: number };
    if (from.price !== to.price) {
      return `Preço ${from.price} → ${to.price}`;
    }
    return "Nome ou disponibilidade alterados";
  }
  if (metadata.name) return String(metadata.name);
  return null;
}

export default async function AdminAuditPage() {
  const events = await listAdminAudit(100);

  return (
    <>
      <AdminHeader
        title="Auditoria"
        subtitle={`${events.length} ${events.length === 1 ? "evento" : "eventos"} recentes`}
      />

      <main className="app-shell px-4 py-4">
        {events.length === 0 ? (
          <div className="card px-5 py-9 text-center">
            <ScrollText className="mx-auto size-6 text-ink-300" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-ink-700">Nada registrado ainda</p>
            <p className="mt-1 text-sm text-ink-500">
              Suspender um restaurante, alterar um produto ou abrir o cardápio em
              modo suporte gera um evento aqui.
            </p>
          </div>
        ) : (
          <ol className="space-y-2">
            {events.map((event) => {
              const detail = describeMetadata(event.action, event.metadata);

              return (
                <li key={event.id} className="card p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-ink-900">
                      {AUDIT_ACTION_LABEL[event.action] ?? event.action}
                    </p>
                    <Badge tone={auditTone(event.action)}>{event.resource_type}</Badge>
                  </div>

                  <p className="mt-1 truncate text-xs text-ink-500">
                    {event.restaurant_name ?? "Plataforma"} ·{" "}
                    {event.actor_email ?? "sistema"} · {formatDate(event.created_at)}
                  </p>

                  {detail && (
                    <p className="mt-1.5 rounded-lg bg-ink-50 px-2 py-1 text-[0.72rem] text-ink-600">
                      {detail}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </main>
    </>
  );
}
