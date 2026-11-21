import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app/app-header";
import { ComingSoon } from "@/components/ui/coming-soon";
import { getActiveRestaurant } from "@/lib/data/restaurants";

export const metadata: Metadata = { title: "Pedidos" };

export default async function OrdersPage() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  return (
    <>
      <AppHeader title="Pedidos" subtitle={restaurant.name} />
      <main className="app-shell space-y-5 px-4 pb-6 pt-5">
        <ComingSoon
          stage="Etapa 6 e 7"
          title="Carrinho e painel de pedidos"
          description="O cliente monta o pedido direto do cardápio e você acompanha tudo em um painel único, com atualização em tempo real."
          bullets={[
            "Carrinho com observações e adicionais",
            "Pedidos em tempo real: novo, preparando, pronto, entregue",
            "Som e notificação de novo pedido",
            "Histórico e total do dia",
          ]}
        />
      </main>
    </>
  );
}
