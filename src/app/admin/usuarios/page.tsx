import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, Store, UserRound } from "lucide-react";
import { AdminHeader } from "@/components/admin/admin-header";
import { Badge } from "@/components/ui/card";
import { listAdminUsers } from "@/lib/data/admin";
import { RESTAURANT_ROLE_LABEL } from "@/lib/types";
import { formatDate, initials } from "@/lib/utils";
import type { RestaurantRole } from "@/lib/types";

export const metadata: Metadata = { title: "Usuários" };
export const dynamic = "force-dynamic";

/**
 * Usuários da plataforma.
 *
 * Uma linha por **pessoa**, não por vínculo: quem tem duas casas aparece uma
 * vez, com os dois restaurantes e papéis embaixo. É a visão que o suporte
 * precisa ("quem é esta pessoa, o que ela alcança?"), não o contrário.
 *
 * O papel de plataforma é um selo separado do papel de restaurante — são coisas
 * diferentes, e misturá-las na mesma coluna ensinaria o modelo errado.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const users = await listAdminUsers(q ?? null);
  const admins = users.filter((user) => user.is_platform_admin).length;

  return (
    <>
      <AdminHeader
        title="Usuários"
        subtitle={`${users.length} ${users.length === 1 ? "pessoa" : "pessoas"} · ${admins} com acesso à plataforma`}
      />

      <main className="app-shell space-y-3 px-4 py-4">
        <form action="/admin/usuarios" className="relative">
          <UserRound
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
            aria-hidden="true"
          />
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Nome, e-mail ou restaurante"
            aria-label="Buscar usuários"
            className="h-12 w-full rounded-xl border border-ink-200 bg-white pl-9 pr-3 text-[0.95rem] text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
        </form>

        {users.length === 0 ? (
          <div className="card px-5 py-9 text-center">
            <UserRound className="mx-auto size-6 text-ink-300" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-ink-700">Nenhum usuário encontrado</p>
            <p className="mt-1 text-sm text-ink-500">
              {q ? `Nada corresponde a “${q}”.` : "Ninguém cadastrado ainda."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {users.map((user) => (
              <li key={user.user_id} className="card p-3.5">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink-100 text-xs font-bold text-ink-600">
                    {initials(user.full_name ?? user.email)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-ink-900">
                        {user.full_name ?? "Sem nome"}
                      </p>
                      {user.is_platform_admin && (
                        <Badge tone="info">
                          <ShieldCheck className="size-3" aria-hidden="true" />
                          Plataforma
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-ink-500">{user.email ?? "—"}</p>

                    {user.restaurants.length === 0 ? (
                      <p className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-ink-50 px-2 py-1 text-[0.7rem] text-ink-500">
                        Sem restaurante vinculado
                      </p>
                    ) : (
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {user.restaurants.map((link) => (
                          <li key={link.restaurant_id}>
                            <Link
                              href={`/admin/restaurantes/${link.restaurant_id}`}
                              className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-ink-50 px-2.5 text-[0.72rem] font-medium text-ink-700 hover:bg-ink-100"
                            >
                              <Store className="size-3" aria-hidden="true" />
                              {link.name}
                              <span className="text-ink-400">
                                · {RESTAURANT_ROLE_LABEL[link.role as RestaurantRole]}
                              </span>
                              {link.status !== "active" && (
                                <span className="text-amber-600">· bloqueado</span>
                              )}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}

                    <p className="mt-1.5 text-[0.68rem] text-ink-400">
                      Desde {formatDate(user.created_at)}
                      {user.phone ? ` · ${user.phone}` : ""}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
