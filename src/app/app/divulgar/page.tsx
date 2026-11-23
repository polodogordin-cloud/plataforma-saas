import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { ShareHub } from "@/components/share/share-hub";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getShareSnapshot } from "@/lib/data/share";
import { requireRequestOrigin } from "@/lib/site";

export const metadata: Metadata = { title: "Divulgar meu cardápio" };

/**
 * `/app/divulgar` — divulgação do cardápio (Etapa 23).
 *
 * A tela é a mesma para todos os membros da casa; só a **edição da mensagem** é
 * restrita a dono/admin, e isso o servidor decide (`save_share_headline`).
 * Compartilhar o próprio link não é ato administrativo — é o que o garçom faz
 * quando o cliente pergunta o endereço.
 */
export default async function SharePage() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const [snapshot, origin] = await Promise.all([
    getShareSnapshot(restaurant.id),
    requireRequestOrigin(),
  ]);

  if (!snapshot) notFound();

  const canEdit = restaurant.role === "owner" || restaurant.role === "admin";

  return (
    <>
      <AppHeader title="Divulgar meu cardápio" subtitle={snapshot.name} backHref="/app" />

      <main className="app-shell px-4 pb-40 pt-4">
        <Link
          href="/app"
          className="tap-target mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Início
        </Link>

        {!canEdit && (
          <div className="mb-4 flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-inset ring-amber-200">
            <ShieldAlert className="mt-0.5 size-4.5 shrink-0 text-amber-600" aria-hidden="true" />
            <p className="text-sm leading-relaxed text-amber-800">
              Você pode compartilhar e baixar o QR Code. Para editar a mensagem de divulgação, peça
              a um proprietário ou administrador.
            </p>
          </div>
        )}

        <ShareHub
          restaurantName={snapshot.name}
          restaurantSlug={snapshot.slug}
          logoUrl={snapshot.logoUrl}
          headline={snapshot.headline}
          isPublished={snapshot.status === "published"}
          origin={origin}
          tables={snapshot.tables.map((table) => ({
            id: table.id,
            name: table.name,
            code: table.code,
            publicToken: table.publicToken,
            active: table.isActive && table.status === "active",
          }))}
          orders={snapshot.orders.map((order) => ({
            id: order.id,
            orderNumber: order.orderNumber,
            tableName: order.tableName,
            tableId: order.tableId,
            tablePublicToken: order.publicToken,
          }))}
          canEdit={canEdit}
        />
      </main>
    </>
  );
}
