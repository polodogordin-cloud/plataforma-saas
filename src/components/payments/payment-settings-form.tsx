"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Lock, Save, Upload } from "lucide-react";
import { Badge, Card, SectionTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { savePaymentSettings } from "@/actions/subscription-payments";
import { getBrowserClient } from "@/lib/supabase/client";
import { validateReceipt } from "@/lib/payments";
import { formatDate } from "@/lib/utils";
import { PIX_KEY_TYPE_LABEL, type AdminPaymentSettings, type PixKeyType } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * `/admin/settings/payment` — configuração global do PIX (Etapa 19).
 *
 * Duas coisas que esta tela faz questão de deixar claras:
 *
 *   1. **Só o MASTER_ADMIN altera.** Se `can_edit` for falso, os campos ficam
 *      desabilitados e a tela explica em texto — não esconde o formulário, para
 *      o admin operacional entender por que não pode. Quem recusa de verdade é
 *      a RPC (`master_admin_forbidden`).
 *   2. **Ativo ≠ configurado.** Ligar sem chave é recusado no servidor e aqui o
 *      botão de salvar já avisa antes, porque um PIX "ativo" para chave vazia
 *      manda o cliente pagar para ninguém.
 *
 * A chave PIX **é** dado público de recebimento: aparece inteira, porque é isso
 * que o cliente copia. Nenhuma credencial, token ou URL de infraestrutura
 * aparece nesta tela nem é lida pelo cliente.
 */
export function PaymentSettingsForm({ settings }: { settings: AdminPaymentSettings | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [recipientName, setRecipientName] = useState(settings?.recipient_name ?? "");
  const [pixKey, setPixKey] = useState(settings?.pix_key ?? "");
  const [pixKeyType, setPixKeyType] = useState<PixKeyType | "">(settings?.pix_key_type ?? "");
  const [instructions, setInstructions] = useState(settings?.instructions ?? "");
  const [qrCodeUrl, setQrCodeUrl] = useState(settings?.qr_code_url ?? "");
  const [isActive, setIsActive] = useState(settings?.is_active ?? false);

  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const canEdit = settings?.can_edit === true;
  const looksConfigured = pixKey.trim().length >= 3;

  const save = () => {
    setFeedback(null);
    startTransition(async () => {
      const result = await savePaymentSettings({
        recipientName,
        pixKey,
        pixKeyType: pixKeyType || null,
        instructions,
        qrCodeUrl,
        isActive,
      });
      setFeedback({ ok: result.ok, text: result.ok ? result.message : result.error });
      if (result.ok) router.refresh();
    });
  };

  /**
   * Upload do QR Code.
   *
   * Reaproveita o validador do comprovante (mesmo limite de tamanho, mesmos
   * formatos) porque as duas imagens vêm do mesmo lugar: o celular do dono.
   * O caminho é fixo (`platform/pix-qr.{ext}`) — é uma imagem só, da plataforma,
   * não de um tenant — e a policy do bucket exige papel de administrador.
   */
  const uploadQr = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);

    const checked = validateReceipt({ name: file.name, size: file.size, type: file.type });
    if (!checked.ok) {
      setUploadError(
        checked.issue === "too_large"
          ? "A imagem passa de 5 MB."
          : "Use PNG, JPG ou WEBP (PDF não serve para QR Code).",
      );
      return;
    }
    if (checked.extension === "pdf") {
      setUploadError("O QR Code precisa ser uma imagem (PNG, JPG ou WEBP).");
      return;
    }

    setUploading(true);
    try {
      const supabase = getBrowserClient();
      const path = `platform/pix-qr-${Date.now().toString(36)}.${checked.extension}`;
      const { error } = await supabase.storage
        .from("payment-assets")
        .upload(path, file, { cacheControl: "86400", contentType: checked.contentType, upsert: false });

      if (error) {
        setUploadError("Não foi possível enviar a imagem.");
        return;
      }

      const { data } = supabase.storage.from("payment-assets").getPublicUrl(path);
      setQrCodeUrl(data.publicUrl);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      {!canEdit && (
        <Card className="flex items-start gap-3 border-amber-200 bg-amber-50">
          <Lock className="mt-0.5 size-5 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-amber-900">Somente leitura</p>
            <p className="mt-0.5 text-sm text-amber-800">
              Os dados de recebimento do PIX só podem ser alterados pelo administrador master da
              plataforma. Você continua podendo confirmar pagamentos.
            </p>
          </div>
        </Card>
      )}

      <Card className="space-y-4">
        <SectionTitle
          title="Recebimento do PIX"
          description="Dados globais: o cliente de qualquer casa paga nesta chave"
          action={
            isActive && looksConfigured ? (
              <Badge tone="success">
                <CheckCircle2 className="size-3" aria-hidden="true" />
                Ativo
              </Badge>
            ) : (
              <Badge tone={looksConfigured ? "warning" : "danger"}>
                {looksConfigured ? "Desligado" : "Não configurado"}
              </Badge>
            )
          }
        />

        <div className="space-y-1.5">
          <label htmlFor="recipient" className="block text-sm font-medium text-ink-700">
            Nome do recebedor
          </label>
          <input
            id="recipient"
            value={recipientName}
            onChange={(event) => setRecipientName(event.target.value.slice(0, 80))}
            disabled={!canEdit}
            placeholder="Ex.: Menuvo Tecnologia ME"
            className="min-h-11 w-full rounded-xl border border-ink-200 px-3 text-sm text-ink-900 disabled:bg-ink-50"
          />
          <p className="text-xs text-ink-500">
            É o nome que o cliente vê na tela de pagamento e no app do banco ao conferir a chave.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="pix-key" className="block text-sm font-medium text-ink-700">
            Chave PIX
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="pix-key"
              value={pixKey}
              onChange={(event) => setPixKey(event.target.value.slice(0, 140))}
              disabled={!canEdit}
              placeholder="E-mail, telefone, CPF/CNPJ ou chave aleatória"
              className="min-h-11 w-full flex-1 rounded-xl border border-ink-200 px-3 font-mono text-sm text-ink-900 disabled:bg-ink-50"
              autoComplete="off"
              spellCheck={false}
            />
            <select
              aria-label="Tipo da chave PIX"
              value={pixKeyType}
              onChange={(event) => setPixKeyType(event.target.value as PixKeyType | "")}
              disabled={!canEdit}
              className="min-h-11 rounded-xl border border-ink-200 px-3 text-sm text-ink-900 disabled:bg-ink-50"
            >
              <option value="">Tipo…</option>
              {(Object.keys(PIX_KEY_TYPE_LABEL) as PixKeyType[]).map((type) => (
                <option key={type} value={type}>
                  {PIX_KEY_TYPE_LABEL[type]}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-ink-500">
            A chave é pública por natureza: é para onde o cliente paga. O banco não valida o
            formato — cada instituição usa um padrão.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="instructions" className="block text-sm font-medium text-ink-700">
            Instruções para o cliente
          </label>
          <textarea
            id="instructions"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value.slice(0, 600))}
            disabled={!canEdit}
            rows={3}
            placeholder="Ex.: envie o comprovante pelo app e aguarde até 1 dia útil para a conferência."
            className="w-full rounded-xl border border-ink-200 px-3 py-2 text-sm text-ink-900 disabled:bg-ink-50"
          />
          <p className="text-xs text-ink-500">{instructions.length}/600</p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-ink-700">QR Code (opcional)</p>
          {qrCodeUrl ? (
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- bucket público, tamanho fixo */}
              <img
                src={qrCodeUrl}
                alt="QR Code do PIX configurado"
                width={96}
                height={96}
                className="rounded-xl border border-ink-200 bg-white p-1"
              />
              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setQrCodeUrl("")}
                  className="text-red-700"
                >
                  Remover
                </Button>
              )}
            </div>
          ) : (
            <p className="text-xs text-ink-500">
              Sem QR Code a tela mostra apenas a chave copiável — que é o que resolve para quem paga
              pelo app do banco.
            </p>
          )}
          {canEdit && (
            <label
              className={cn(
                "tap-target inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-ink-300 px-3 text-sm font-medium text-ink-700",
                uploading && "pointer-events-none opacity-55",
              )}
            >
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                disabled={uploading}
                onChange={(event) => uploadQr(event.target.files?.[0])}
              />
              <Upload className="size-4" aria-hidden="true" />
              {uploading ? "Enviando…" : "Enviar imagem do QR Code"}
            </label>
          )}
          {uploadError && <p className="text-xs text-red-700">{uploadError}</p>}
        </div>

        <label className="flex items-start gap-2.5 rounded-xl bg-ink-50 px-3 py-2.5">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            disabled={!canEdit}
            className="mt-0.5 size-4"
          />
          <span className="text-sm text-ink-800">
            Receber PIX de assinaturas
            <span className="mt-0.5 block text-xs text-ink-500">
              Desligado, as casas veem “PIX indisponível” e não conseguem abrir solicitação. Exige
              chave preenchida.
            </span>
          </span>
        </label>

        {canEdit && (
          <Button block size="lg" loading={pending} onClick={save} disabled={pending}>
            <Save className="size-4" aria-hidden="true" />
            Salvar configuração
          </Button>
        )}

        {feedback && (
          <p
            role="status"
            className={cn(
              "rounded-xl px-3 py-2 text-sm",
              feedback.ok ? "bg-brand-50 text-brand-800" : "bg-red-50 text-red-700",
            )}
          >
            {feedback.text}
          </p>
        )}

        {settings?.updated_at && (
          <p className="text-xs text-ink-400">
            Última alteração em {formatDate(settings.updated_at)}
            {settings.updated_by_email ? ` por ${settings.updated_by_email}` : ""}. Toda mudança é
            registrada na auditoria.
          </p>
        )}
      </Card>
    </div>
  );
}
