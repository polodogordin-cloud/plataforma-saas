import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { TablesManager } from "@/components/tables/tables-manager";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { listTables } from "@/lib/data/tables";
import { listNfcHistory, listRestaurantNfcTags } from "@/lib/data/nfc";

export const metadata: Metadata = { title: "Mesas" };

export default async function TablesPage() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const [tables, nfcTags] = await Promise.all([
    listTables(restaurant.id),
    listRestaurantNfcTags(restaurant.id),
  ]);
  const canEdit = restaurant.role === "owner" || restaurant.role === "admin";
  const origin = await resolveOrigin();

  /**
   * Histórico por mesa, carregado só para as mesas que já têm TAG.
   * São poucas consultas (uma por mesa com NFC) e cabem no cache do React.
   */
  const tablesWithTags = [...new Set(nfcTags.map((tag) => tag.table_id))];
  const historyEntries = await Promise.all(
    tablesWithTags.map(async (tableId) => [tableId, await listNfcHistory(tableId, 8)] as const),
  );
  const nfcHistory = Object.fromEntries(historyEntries);

  return (
    <>
      <AppHeader title="Mesas" subtitle={restaurant.name} />

      <main className="app-shell px-4 pb-40 pt-4">
        {!canEdit && (
          <div className="mb-4 flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-inset ring-amber-200">
            <ShieldAlert className="mt-0.5 size-4.5 shrink-0 text-amber-600" aria-hidden="true" />
            <p className="text-sm leading-relaxed text-amber-800">
              Você pode consultar e baixar os QR Codes. Para criar ou editar mesas, peça a
              um proprietário ou administrador.
            </p>
          </div>
        )}

        {restaurant.status !== "published" && (
          <div className="mb-4 rounded-xl bg-ink-100/80 px-4 py-3">
            <p className="text-sm leading-relaxed text-ink-600">
              O cardápio está <strong>desativado</strong>. Os QR Codes das mesas só vão
              abrir o cardápio depois que você publicar o restaurante.
            </p>
          </div>
        )}

        <TablesManager
          restaurantId={restaurant.id}
          restaurantSlug={restaurant.slug}
          origin={origin}
          initialTables={tables}
          nfcTags={nfcTags}
          nfcHistory={nfcHistory}
          canEdit={canEdit}
        />
      </main>
    </>
  );
}

/**
 * Origem pública para montar o link da mesa.
 *
 * O QR Code precisa de URL absoluta (o celular do cliente não tem contexto do
 * painel). Em produção usamos o host que atendeu a requisição, respeitando o
 * proxy da Vercel; em desenvolvimento, o próprio localhost.
 */
async function resolveOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;

  try {
    const headerList = await headers();
    const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
    const proto = headerList.get("x-forwarded-proto") ?? "https";

    if (host && !host.includes("localhost") && !host.startsWith("127.0.0.1")) {
      return `${proto}://${host}`;
    }
    if (host) return `${proto === "http" ? "http" : "https"}://${host}`;
  } catch {
    // Sem headers (contexto estático): cai na configuração.
  }

  return (configured ?? "https://menuvo.app").replace(/\/$/, "");
}
