import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminHeader } from "@/components/admin/admin-header";
import { PaymentDetailPanel } from "@/components/payments/payment-detail-panel";
import {
  getAdminPaymentRequest,
  getReceiptUrl,
} from "@/lib/data/payments";
import { isPlatformOwner } from "@/lib/data/admin";

export const metadata: Metadata = { title: "Detalhe do pagamento" };
export const dynamic = "force-dynamic";

/**
 * `/admin/pagamentos/[id]` — Etapa 19, item 10.
 *
 * Só administrador da plataforma chega aqui (layout do `/admin` + `admin_payment_request`
 * recusando qualquer outro papel). O comprovante vem por **URL assinada de 5
 * minutos**: o bucket é privado, então nem quem tem o caminho consegue abrir.
 *
 * `isMasterAdmin` habilita o campo de período — a decisão continua no banco
 * (`period_override_forbidden`), porque `can_edit` de tela nunca foi autorização.
 */
export default async function AdminPaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const detail = await getAdminPaymentRequest(id);
  if (!detail) notFound();

  const [receiptUrl, isMasterAdmin] = await Promise.all([
    getReceiptUrl(detail.receipt_path),
    isPlatformOwner(),
  ]);

  return (
    <>
      <AdminHeader
        title="Pagamento"
        subtitle={detail.restaurant_name}
        backHref="/admin/pagamentos"
      />

      <main className="app-shell px-4 pb-8 pt-4">
        <PaymentDetailPanel detail={detail} receiptUrl={receiptUrl} isMasterAdmin={isMasterAdmin} />
      </main>
    </>
  );
}
