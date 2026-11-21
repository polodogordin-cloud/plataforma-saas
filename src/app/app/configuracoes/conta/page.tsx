import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound, ShieldCheck } from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { Card } from "@/components/ui/card";
import { getProfile, getSessionUser } from "@/lib/data/restaurants";
import { formatDate } from "@/lib/utils";
import { AccountForm } from "./account-form";

export const metadata: Metadata = { title: "Sua conta" };

export default async function AccountSettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/entrar?next=/app/configuracoes/conta");

  const profile = await getProfile(user.id);

  return (
    <>
      <AppHeader title="Sua conta" backHref="/app/configuracoes" />

      <main className="app-shell space-y-5 px-4 pb-6 pt-5">
        <Card>
          <AccountForm
            fullName={profile?.full_name ?? ""}
            phone={profile?.phone ?? ""}
            email={user.email ?? ""}
          />
        </Card>

        <section aria-labelledby="seguranca">
          <h2 id="seguranca" className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-ink-400">
            Segurança
          </h2>
          <Card className="divide-y divide-ink-100 p-0">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                <ShieldCheck className="size-[1.15rem]" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[0.95rem] font-semibold text-ink-900">Senha</p>
                <p className="text-xs text-ink-500">Protegida com criptografia do Supabase Auth</p>
              </div>
              <Link
                href="/recuperar-senha"
                className="tap-target inline-flex items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-brand-700 hover:text-brand-800"
              >
                <KeyRound className="size-4" aria-hidden="true" />
                Alterar
              </Link>
            </div>
            <div className="px-4 py-3.5">
              <p className="text-xs text-ink-500">
                Conta criada em {formatDate(profile?.created_at ?? user.created_at)}
              </p>
            </div>
          </Card>
        </section>

        <p className="text-center text-xs leading-relaxed text-ink-400">
          Convites de equipe com diferentes níveis de acesso chegam em uma próxima etapa.
        </p>
      </main>
    </>
  );
}
