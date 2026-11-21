import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BookOpenText, LayoutGrid, Package } from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { ComingSoon } from "@/components/ui/coming-soon";
import { Card, SectionTitle } from "@/components/ui/card";
import { getActiveRestaurant, getRestaurantCounters } from "@/lib/data/restaurants";

export const metadata: Metadata = { title: "Cardápio" };

export default async function MenuPage() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const counters = await getRestaurantCounters(restaurant.id);

  return (
    <>
      <AppHeader title="Cardápio" subtitle={restaurant.name} />

      <main className="app-shell space-y-5 px-4 pb-6 pt-5">
        <SectionTitle
          title="Estrutura do cardápio"
          description="Categorias organizam os produtos que o cliente vê."
        />

        <div className="grid grid-cols-2 gap-3">
          <Card className="flex items-center gap-3 p-3.5">
            <span className="grid size-10 place-items-center rounded-xl bg-sky-50 text-sky-700">
              <LayoutGrid className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xl font-semibold leading-none tabular-nums">{counters.categories}</p>
              <p className="mt-1 text-xs text-ink-500">Categorias</p>
            </div>
          </Card>
          <Card className="flex items-center gap-3 p-3.5">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
              <Package className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xl font-semibold leading-none tabular-nums">{counters.products}</p>
              <p className="mt-1 text-xs text-ink-500">Produtos</p>
            </div>
          </Card>
        </div>

        <ComingSoon
          stage="Etapa 2 e 3"
          title="Categorias, produtos e cardápio público"
          description="Aqui você vai criar categorias como Entradas, Pratos e Bebidas, cadastrar produtos com foto e preço, e publicar o cardápio com o seu link."
          bullets={[
            "Categorias com ordem de exibição",
            "Produtos com foto, descrição e preço",
            "Marcadores de destaque, vegano e sem glúten",
            "Cardápio público rápido no celular do cliente",
          ]}
        />

        <div className="flex items-start gap-3 rounded-xl bg-ink-100/70 px-4 py-3">
          <BookOpenText className="mt-0.5 size-4.5 shrink-0 text-ink-400" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-ink-500">
            Nada é perdido: os contadores acima já leem das tabelas reais de categorias
            e produtos, que serão criadas na próxima etapa.
          </p>
        </div>
      </main>
    </>
  );
}
