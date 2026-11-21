"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, UserCog } from "lucide-react";
import { setMemberRole, setMemberStatus } from "@/actions/admin";
import { MemberStatusBadge } from "@/components/admin/status-badge";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RESTAURANT_ROLE_LABEL, type AdminRestaurantMember, type RestaurantRole } from "@/lib/types";
import { formatDate, initials } from "@/lib/utils";
import { MemberRoleSheet } from "@/components/admin/restaurant-actions";

/**
 * Equipe da casa, vista pelo suporte.
 *
 * Os quatro papéis do escopo já existem no banco (`owner`, `admin`, `manager`,
 * `staff`), então a tela nasce pronta para a etapa de convites: hoje ela troca
 * papel e bloqueia acesso; amanhã ela só acrescenta o "convidar".
 *
 * Gerente e equipe aparecem com o efeito explicado em uma linha, porque a
 * diferença entre `admin` e `manager` é justamente "pode mexer na equipe?".
 */
export function MembersSection({
  restaurantId,
  members,
}: {
  restaurantId: string;
  members: AdminRestaurantMember[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminRestaurantMember | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rolePending, startRoleTransition] = useTransition();
  const [statusPending, startStatusTransition] = useTransition();

  const changeRole = (role: RestaurantRole) => {
    if (!editing) return;

    startRoleTransition(async () => {
      const result = await setMemberRole({
        restaurantId,
        userId: editing.user_id,
        role,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setEditing(null);
      setError(null);
      router.refresh();
    });
  };

  const toggleAccess = (member: AdminRestaurantMember) => {
    startStatusTransition(async () => {
      const result = await setMemberStatus({
        restaurantId,
        userId: member.user_id,
        status: member.status === "active" ? "suspended" : "active",
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setError(null);
      router.refresh();
    });
  };

  return (
    <section className="card p-0">
      <header className="flex items-center gap-2.5 px-4 py-3">
        <span className="grid size-8 place-items-center rounded-lg bg-ink-100 text-ink-600">
          <UserCog className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink-900">
            Usuários <span className="text-xs font-normal text-ink-400">{members.length}</span>
          </h2>
          <p className="text-xs text-ink-500">Quem acessa esta casa e com qual papel</p>
        </div>
      </header>

      {members.length === 0 ? (
        <p className="border-t border-ink-100 px-4 py-4 text-sm text-ink-500">
          Nenhum usuário vinculado. Casa sem usuário não consegue gerenciar o
          próprio painel — vale avisar o responsável.
        </p>
      ) : (
        <ul className="divide-y divide-ink-100 border-t border-ink-100">
          {members.map((member) => (
            <li key={member.user_id} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink-100 text-xs font-bold text-ink-600">
                  {initials(member.full_name ?? member.email)}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-900">
                    {member.full_name ?? "Sem nome"}
                  </p>
                  <p className="truncate text-xs text-ink-500">{member.email ?? "—"}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge tone={member.role === "owner" ? "info" : "neutral"}>
                      {member.role === "owner" && (
                        <ShieldCheck className="size-3" aria-hidden="true" />
                      )}
                      {RESTAURANT_ROLE_LABEL[member.role]}
                    </Badge>
                    <MemberStatusBadge status={member.status} />
                    <span className="text-[0.68rem] text-ink-400">
                      desde {formatDate(member.created_at)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-2 flex gap-1.5 pl-12">
                <Button size="sm" variant="ghost" onClick={() => setEditing(member)}>
                  Trocar papel
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => toggleAccess(member)}
                  loading={statusPending}
                  className={member.status === "active" ? "text-red-700 hover:bg-red-50" : undefined}
                >
                  {member.status === "active" ? "Bloquear acesso" : "Liberar acesso"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && !editing && (
        <p role="alert" className="mx-4 mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <MemberRoleSheet
        open={Boolean(editing)}
        onClose={() => {
          setEditing(null);
          setError(null);
        }}
        onConfirm={changeRole}
        memberName={editing?.full_name ?? editing?.email ?? "este usuário"}
        pending={rolePending}
        error={error}
      />
    </section>
  );
}
