import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app/app-header";
import { ComingSoon } from "@/components/ui/coming-soon";
import { getActiveRestaurant } from "@/lib/data/restaurants";

export const metadata: Metadata = { title: "Mesas" };

export default async function TablesPage() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  return (
    <>
      <AppHeader title="Mesas" subtitle={restaurant.name} />
      <main className="app-shell space-y-5 px-4 pb-6 pt-5">
        <ComingSoon
          stage="Etapa 4 e 5"
          title="Mesas, QR Codes e NFC"
          description="Cadastre as mesas do salão, gere QR Codes imprimíveis e ative tags NFC para o cliente abrir o cardápio encostando o celular."
          bullets={[
            "Mesas numeradas com nome e áreas do salão",
            "QR Code único por mesa, pronto para imprimir",
            "Tags NFC para cardápio por aproximação",
            "Link direto de mesa para o garçom identificar o pedido",
          ]}
        />
      </main>
    </>
  );
}
