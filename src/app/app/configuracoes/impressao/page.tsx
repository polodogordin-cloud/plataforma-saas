import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app/app-header";
import { PrintConfigForm } from "@/components/printing/print-config-form";
import { PrintTestPanel } from "@/components/printing/print-test-panel";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getPrintConfig } from "@/lib/data/printing";
import { ROLE_CAPABILITIES } from "@/lib/types";

/**
 * `Configurações → Impressão` — Etapa 18.
 *
 * A tela é do restaurante ativo, resolvido no servidor: não existe parâmetro de
 * restaurante na URL, então abrir a página nunca edita a casa de outra pessoa.
 *
 * Leitura para todos os papéis operacionais (`print_can_view`); escrita só para
 * owner/admin/manager (`print_can_configure`). A página mostra a configuração
 * em modo leitura para quem não pode salvar — esconder tudo faria a cozinha
 * achar que a casa não tem impressora.
 */
export const metadata: Metadata = { title: "Impressão" };

export default async function PrintSettingsPage() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  // Papel sem acesso ao painel operacional não tem o que fazer aqui.
  if (!ROLE_CAPABILITIES[restaurant.role].useKitchen) {
    redirect("/app?aviso=sem-acesso-impressao");
  }

  const config = await getPrintConfig(restaurant.id);

  return (
    <>
      <AppHeader title="Impressão" subtitle={restaurant.name} />

      <main className="app-shell space-y-4 px-4 pb-10 pt-4">
        <PrintConfigForm initialConfig={config} />
        <PrintTestPanel paperWidth={config.settings.default_paper_width} restaurantName={restaurant.name} />
      </main>
    </>
  );
}
