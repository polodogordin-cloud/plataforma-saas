import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { KitchenBoard } from "@/components/kitchen/kitchen-board";
import { getActiveRestaurant, getSessionUser } from "@/lib/data/restaurants";
import {
  getKitchenPermissions,
  getKitchenSettings,
  listKitchenOrders,
  listKitchenStations,
} from "@/lib/data/kitchen";

/**
 * `/kitchen` — painel de cozinha (Etapa 17).
 *
 * Server Component: carrega tudo antes de pintar, para o tablet não abrir num
 * "carregando" que assusta. A partir daí o `KitchenBoard` assume e passa a
 * atualizar por tempo real.
 *
 * Guard em três camadas, na ordem em que a requisição passa:
 *
 *   1. middleware exige sessão (`/kitchen` foi adicionado às rotas privadas);
 *   2. esta página exige vínculo ativo com o restaurante e papel com acesso;
 *   3. `list_kitchen_orders` e `set_order_status` conferem de novo no banco.
 *
 * A camada 2 é conveniência e mensagem boa; a 3 é a que não dá para contornar.
 */

export const metadata: Metadata = {
  title: "Cozinha",
  // Painel operacional: nunca indexado, nunca em histórico de busca.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // Na cozinha o tablet fica fixo numa bancada; travar o zoom evita toque
  // acidental que desalinha o painel no meio do serviço.
  maximumScale: 1,
  themeColor: "#191b22",
};

export const dynamic = "force-dynamic";

export default async function KitchenPage() {
  const user = await getSessionUser();
  if (!user) redirect("/entrar?next=/kitchen");

  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  // Casa suspensa ou assinatura sem acesso não pode operar a cozinha. O layout
  // de `/app` já faz esse bloqueio; `/kitchen` fica fora dele de propósito
  // (a cozinha não precisa da navegação do salão), então repete a checagem.
  if (restaurant.status === "suspended") {
    redirect("/app?aviso=casa-suspensa");
  }

  const permissions = await getKitchenPermissions(restaurant.id);

  if (!permissions.canView) {
    // Mensagem no destino do salão, não uma tela de erro na cozinha: quem cai
    // aqui geralmente entrou com a conta errada e precisa saber disso.
    redirect("/app?aviso=sem-acesso-cozinha");
  }

  const [orders, settings, stations] = await Promise.all([
    listKitchenOrders({ restaurantId: restaurant.id }),
    getKitchenSettings(restaurant.id),
    listKitchenStations(restaurant.id),
  ]);

  return (
    <KitchenBoard
      restaurantId={restaurant.id}
      restaurantName={restaurant.name}
      role={{
        canOperate: permissions.canOperate,
        canFinish: permissions.canFinish,
        canCancel: permissions.canCancel,
      }}
      initialOrders={orders}
      settings={settings}
      stations={stations}
    />
  );
}
