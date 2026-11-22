import type { Metadata } from "next";
import { AdminHeader } from "@/components/admin/admin-header";
import { Card } from "@/components/ui/card";
import { PaymentSettingsForm } from "@/components/payments/payment-settings-form";
import { PixStatusBadge } from "@/components/payments/plan-pix-picker";
import { getAdminPaymentSettings } from "@/lib/data/payments";
import { isPlatformOwner } from "@/lib/data/admin";

export const metadata: Metadata = { title: "Recebimento PIX" };
export const dynamic = "force-dynamic";

/**
 * `/admin/settings/payment` — Etapa 19, item 7 do escopo.
 *
 * Configuração **global** de como a plataforma recebe a assinatura: nome do
 * recebedor, chave PIX, instruções, QR Code opcional e o interruptor que liga ou
 * desliga o recebimento. Só `MASTER_ADMIN` altera — um admin operacional vê a
 * tela em modo leitura e continua podendo confirmar pagamentos.
 *
 * O que **não** tem aqui, e é intencional: token de gateway, URL de webhook,
 * chave de API, credencial de banco. Nada disso existe nesta etapa, e um campo
 * vazio com esse nome sugeriria uma integração que não foi feita.
 */
export default async function AdminPaymentSettingsPage() {
  const [settings, isMaster] = await Promise.all([
    getAdminPaymentSettings(),
    isPlatformOwner(),
  ]);

  return (
    <>
      <AdminHeader
        title="Recebimento PIX"
        subtitle="Dados globais da cobrança manual"
        backHref="/admin/configuracoes"
      />

      <main className="app-shell space-y-4 px-4 pb-8 pt-4">
        <Card className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-900">Estado atual</p>
            <p className="mt-0.5 text-sm text-ink-500">
              {settings?.is_active
                ? "As casas conseguem gerar solicitação de pagamento por PIX."
                : "As casas veem “PIX indisponível” e não conseguem pedir pagamento."}
            </p>
          </div>
          <PixStatusBadge
            pix={
              settings
                ? {
                    is_active: settings.is_active,
                    is_configured: Boolean(settings.pix_key && settings.pix_key.trim()),
                  }
                : null
            }
          />
        </Card>

        <PaymentSettingsForm
          settings={
            settings
              ? {
                  ...settings,
                  // `can_edit` do banco manda; o `isMaster` do servidor só cobre
                  // o caso de a RPC ter falhado em devolver o campo.
                  can_edit: settings.can_edit || isMaster,
                }
              : null
          }
        />

        <Card className="space-y-1.5 text-xs text-ink-500">
          <p className="text-sm font-semibold text-ink-800">Como a confirmação funciona</p>
          <p>
            O cliente pede o plano e paga no PIX desta chave. A plataforma confere o recebimento e
            confirma em <strong>Pagamentos</strong>. Só então o plano é ativado — não existe
            confirmação automática nesta etapa.
          </p>
        </Card>
      </main>
    </>
  );
}
