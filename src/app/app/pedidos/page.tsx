import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChefHat, ChevronRight } from "lucide-react";
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
        {/*
          Etapa 17 — atalho para a cozinha.
          Fica aqui, e não na barra inferior, porque não é uma tela da equipe de
          salão: é o painel do tablet da cozinha. Quem trabalha no salão abre
          uma vez, manda o link para o tablet e não usa mais este atalho.
        */}
        <Link
          href="/kitchen"
          className="mb-3 flex min-h-14 items-center gap-3 rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 active:scale-[0.99]"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-ink-900 text-white">
            <ChefHat className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink-900">Abrir painel da cozinha</span>
            <span className="block text-xs text-ink-500">Tela cheia para o tablet · tempo real</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-ink-400" aria-hidden="true" />
        </Link>

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
