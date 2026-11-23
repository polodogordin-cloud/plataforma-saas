import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { QrCodesManager } from "@/components/tables/qr-codes-manager";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getQrPlaceSnapshot } from "@/lib/data/qr-place";
import { requireRequestOrigin } from "@/lib/site";

export const metadata: Metadata = { title: "QR Codes das mesas" };

/**
 * `/app/mesas/qrcodes` — gerador de QR Codes e plaquinhas (Etapa 22).
 *
 * Toda a leitura é de uma RPC só (`qr_place_overview`), que confere o vínculo do
 * usuário com a casa. Se ela devolver `null` — restaurante de outra pessoa, ou
 * migration ainda não aplicada — a resposta é 404: a tela não existe para quem
 * não é dono, e não há como distinguir "sem permissão" de "não existe".
 */
export default async function QrCodesPage() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const [snapshot, origin] = await Promise.all([
    getQrPlaceSnapshot(restaurant.id),
    requireRequestOrigin(),
  ]);

  if (!snapshot) notFound();

  const canEdit = restaurant.role === "owner" || restaurant.role === "admin";

  return (
    <>
      <AppHeader
        title="QR Codes"
        subtitle={snapshot.restaurantName}
        backHref="/app/mesas"
      />

      <main className="app-shell px-4 pb-40 pt-4">
        <Link
          href="/app/mesas"
          className="tap-target mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Mesas
        </Link>

        {snapshot.status !== "published" && (
          <div className="mb-4 rounded-xl bg-ink-100/80 px-4 py-3">
            <p className="text-sm leading-relaxed text-ink-600">
              O cardápio está <strong>desativado</strong>. As plaquinhas podem ser baixadas, mas o
              QR Code só abre o cardápio depois que você publicar o restaurante.
            </p>
          </div>
        )}

        {!canEdit && (
          <div className="mb-4 flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-inset ring-amber-200">
            <ShieldAlert className="mt-0.5 size-4.5 shrink-0 text-amber-600" aria-hidden="true" />
            <p className="text-sm leading-relaxed text-amber-800">
              Você pode baixar os QR Codes. Para personalizar a arte ou regenerar códigos, peça a
              um proprietário ou administrador.
            </p>
          </div>
        )}

        <QrCodesManager
          restaurantName={snapshot.restaurantName}
          restaurantSlug={snapshot.slug}
          logoUrl={snapshot.logoUrl}
          origin={origin}
          tables={snapshot.tables}
          style={snapshot.style}
          canEdit={canEdit}
        />
      </main>
    </>
  );
}
