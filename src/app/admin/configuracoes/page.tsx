import type { Metadata } from "next";
import Link from "next/link";
import {
  ChevronRight,
  CreditCard,
  LogOut,
  ScrollText,
  ShieldCheck,
  Store,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { AdminHeader } from "@/components/admin/admin-header";
import { signOut } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { listPlans } from "@/lib/data/admin";
import { getProfile, getSessionUser } from "@/lib/data/restaurants";
import { formatDate } from "@/lib/utils";
import { formatPrice } from "@/lib/validation";

export const metadata: Metadata = { title: "Configurações" };
export const dynamic = "force-dynamic";

/**
 * Configurações do painel master.
 *
 * Aqui não há "editar dados da plataforma" — não existe tabela para isso ainda,
 * e inventar um formulário que não salva seria mentir para o usuário. O que há
 * é o que existe de verdade: quem sou eu, com qual papel, o catálogo de planos
 * que a próxima etapa vai usar e os atalhos de auditoria.
 */
export default async function AdminSettingsPage() {
  const [user, plans] = await Promise.all([getSessionUser(), listPlans()]);
  const profile = user ? await getProfile(user.id) : null;

  const items: Array<{ href?: string; label: string; description: string; icon: LucideIcon }> = [
    {
      href: "/admin/auditoria",
      label: "Auditoria",
      description: "Quem fez o quê, com data e hora",
      icon: ScrollText,
    },
    {
      href: "/admin/restaurantes",
      label: "Restaurantes",
      description: "Ativar, desativar e suspender casas",
      icon: Store,
    },
    {
      href: "/app",
      label: "Meu painel de restaurante",
      description: "Ir para a visão de restaurante",
      icon: UserRound,
    },
  ];

  return (
    <>
      <AdminHeader title="Configurações" subtitle="Conta da plataforma" />

      <main className="app-shell space-y-4 px-4 py-4">
        <section className="card p-4">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-full bg-ink-900 text-sm font-bold text-white">
              {(profile?.full_name ?? user?.email ?? "?").slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink-900">
                {profile?.full_name ?? "Sem nome"}
              </p>
              <p className="truncate text-xs text-ink-500">{user?.email ?? "—"}</p>
            </div>
            <Badge tone="info" className="ml-auto shrink-0">
              <ShieldCheck className="size-3" aria-hidden="true" />
              Plataforma
            </Badge>
          </div>
          {profile?.created_at && (
            <p className="mt-2 text-[0.7rem] text-ink-400">
              Conta criada em {formatDate(profile.created_at)}
            </p>
          )}
        </section>

        <section className="card divide-y divide-ink-100 p-0">
          {items.map((item) => {
            const Icon = item.icon;
            const content = (
              <>
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ink-100 text-ink-600">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink-900">{item.label}</span>
                  <span className="block truncate text-xs text-ink-500">{item.description}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-ink-300" aria-hidden="true" />
              </>
            );

            return item.href ? (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-ink-50"
              >
                {content}
              </Link>
            ) : (
              <div key={item.label} className="flex items-center gap-3 px-4 py-3">
                {content}
              </div>
            );
          })}
        </section>

        <section className="card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <CreditCard className="size-4 text-ink-500" aria-hidden="true" />
            Planos disponíveis
          </h2>
          <p className="mt-1 text-xs text-ink-500">
            Catálogo que a próxima etapa usa para assinatura e cobrança. Hoje o
            plano é apenas um rótulo no restaurante.
          </p>

          <ul className="mt-3 space-y-2">
            {plans.map((plan) => (
              <li key={plan.id} className="rounded-xl border border-ink-200 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-ink-900">{plan.name}</p>
                  <p className="text-sm font-semibold tabular-nums text-ink-700">
                    {plan.price_monthly === 0 ? "Grátis" : formatPrice(plan.price_monthly)}
                  </p>
                </div>
                {plan.description && (
                  <p className="mt-0.5 text-xs text-ink-500">{plan.description}</p>
                )}
                {plan.features.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1">
                    {plan.features.map((feature) => (
                      <li
                        key={feature}
                        className="rounded-md bg-ink-50 px-1.5 py-0.5 text-[0.68rem] text-ink-600"
                      >
                        {feature}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>

        <form action={signOut}>
          <Button type="submit" variant="secondary" block>
            <LogOut className="size-4" aria-hidden="true" />
            Sair da conta
          </Button>
        </form>

        <p className="pb-2 text-center text-[0.7rem] leading-relaxed text-ink-400">
          Acesso ao painel exige vínculo em <code>platform_admins</code>.
          <br />
          Toda ação administrativa é registrada na auditoria.
        </p>
      </main>
    </>
  );
}
