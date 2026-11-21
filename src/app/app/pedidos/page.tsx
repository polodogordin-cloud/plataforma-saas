import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app/app-header";
import { OrdersPanel } from "@/components/orders/orders-panel";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getOrderBoardCounts } from "@/lib/data/orders-panel";
import { getRestaurantTimezone } from "@/lib/data/timezone";

export const metadata: Metadata = { title: "Pedidos" };

/**
 * Painel de pedidos — Etapa 7.
 *
 * A contagem inicial vem do servidor (uma RPC), então a primeira pintura já
 * mostra "Novos 3" em vez de zero. Depois disso quem manda é o cliente: a lista
 * se mantém pelo canal de tempo real.
 */
const TAB_IDS = ["new", "preparing", "ready", "done"] as const;
type TabId = (typeof TAB_IDS)[number];

/** `?tab=ready` vindo do dashboard: abre o painel já no recorte certo. */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const { tab } = await searchParams;
  const initialTab = TAB_IDS.includes(tab as TabId) ? (tab as TabId) : null;

  const [counts, timeZone] = await Promise.all([
    getOrderBoardCounts(restaurant.id),
    getRestaurantTimezone(restaurant.id),
  ]);

  return (
    <>
      <AppHeader title="Pedidos" subtitle={restaurant.name} />
      <main className="app-shell px-4 pb-6 pt-4">
        <OrdersPanel
          restaurantId={restaurant.id}
          timeZone={timeZone}
          initialPending={counts.pending}
          initialTab={initialTab}
        />
      </main>
    </>
  );
}
