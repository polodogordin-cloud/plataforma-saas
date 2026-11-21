import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { getSessionUser } from "@/lib/data/restaurants";
import { isPlatformAdmin } from "@/lib/data/admin";

export const metadata: Metadata = {
  title: { default: "Painel da plataforma · Menuvo", template: "%s · Plataforma Menuvo" },
  // Área administrativa nunca é indexada.
  robots: { index: false, follow: false },
};

/**
 * Layout do painel master — Etapa 10.
 *
 * Três barreiras, nesta ordem:
 *   1. middleware (`updateSession`): sem sessão vai para `/entrar`;
 *   2. **este layout**: sem papel de plataforma vai para `/app` com recado;
 *   3. cada RPC do banco: repete `is_platform_admin()` e recusa.
 *
 * A barreira 2 é a que evita a tela "quase abrir". A 3 é a que realmente
 * protege: se alguém burlar o roteamento, o banco continua fechado.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/entrar?next=/admin");

  const isAdmin = await isPlatformAdmin();
  // Usuário de restaurante que tenta abrir /admin: volta para o próprio painel
  // em vez de ver um 404 — ele não está errado, só não tem esse acesso.
  if (!isAdmin) redirect("/app?aviso=sem-acesso-admin");

  return (
    <div className="min-h-dvh bg-ink-50">
      <div className="pb-[calc(4.25rem+env(safe-area-inset-bottom))]">{children}</div>
      <AdminNav />
    </div>
  );
}
