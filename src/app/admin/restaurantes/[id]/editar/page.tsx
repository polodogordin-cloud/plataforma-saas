import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminHeader } from "@/components/admin/admin-header";
import { RestaurantEditForm } from "@/components/admin/restaurant-edit-form";
import { getAdminRestaurantDetail, listPlans } from "@/lib/data/admin";

export const metadata: Metadata = { title: "Editar restaurante" };
export const dynamic = "force-dynamic";

/**
 * Edição administrativa.
 *
 * Separada do detalhe de propósito: o detalhe é leitura frequente (suporte
 * olhando o estado), a edição é ação rara e com consequência (mudar link, mudar
 * plano). Misturar as duas numa tela só aumenta o risco de toque acidental.
 */
export default async function AdminRestaurantEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [detail, plans] = await Promise.all([getAdminRestaurantDetail(id), listPlans()]);
  if (!detail) notFound();

  return (
    <>
      <AdminHeader
        title="Editar restaurante"
        subtitle={detail.restaurant.name}
        backHref={`/admin/restaurantes/${id}`}
      />

      <main className="app-shell px-4 py-4">
        <div className="card p-4">
          <RestaurantEditForm restaurant={detail.restaurant} plans={plans} />
        </div>
      </main>
    </>
  );
}
