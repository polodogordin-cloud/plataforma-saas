import type { Metadata } from "next";
import Link from "next/link";
import { Store } from "lucide-react";
import { AdminHeader } from "@/components/admin/admin-header";
import { RestaurantList } from "@/components/admin/restaurant-list";
import { getAdminDashboard, listAdminRestaurants } from "@/lib/data/admin";
import type { AdminStatusFilter } from "@/lib/types";

export const metadata: Metadata = { title: "Restaurantes" };
export const dynamic = "force-dynamic";

/**
 * Lista de restaurantes.
 *
 * O filtro vem da URL (`?status=suspended`), porque os cards do dashboard
 * apontam para cá já filtrado — navegar do número para a lista é o gesto
 * natural do suporte. A validação do parâmetro é explícita: valor desconhecido
 * cai em "todos" em vez de quebrar a consulta.
 */
const VALID_STATUS: AdminStatusFilter[] = ["all", "published", "paused", "suspended", "draft"];

export default async function AdminRestaurantsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const initialStatus: AdminStatusFilter =
    status && VALID_STATUS.includes(status as AdminStatusFilter)
      ? (status as AdminStatusFilter)
      : "all";

  const [restaurants, metrics] = await Promise.all([
    listAdminRestaurants(),
    getAdminDashboard(),
  ]);

  return (
    <>
      <AdminHeader
        title="Restaurantes"
        subtitle={`${metrics?.restaurants_total ?? restaurants.length} na plataforma`}
      />

      <main className="app-shell px-4 py-4">
        {restaurants.length === 0 ? (
          <div className="card flex flex-col items-center px-5 py-10 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-ink-100 text-ink-500">
              <Store className="size-6" aria-hidden="true" />
            </span>
            <h2 className="mt-3 text-base font-semibold text-ink-900">
              Nenhum restaurante ainda
            </h2>
            <p className="mt-1 max-w-xs text-sm text-ink-500">
              Quando alguém criar uma conta e cadastrar a casa, ela aparece aqui
              com produtos, mesas e responsável.
            </p>
            <Link
              href="/admin"
              className="tap-target mt-2 inline-flex items-center px-3 text-sm font-semibold text-brand-700 hover:underline"
            >
              Voltar ao início
            </Link>
          </div>
        ) : (
          <RestaurantList restaurants={restaurants} initialStatus={initialStatus} />
        )}
      </main>
    </>
  );
}
