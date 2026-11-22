"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FeatureList } from "@/components/billing/plan-card";
import { requestMyPayment } from "@/actions/subscription-payments";
import { PIX_COPY_LABEL, cycleAmount, isPixReady } from "@/lib/payments";
import { PIX_KEY_TYPE_LABEL, type BillingInterval, type PlanCatalogEntry, type PixSettings } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Escolha de plano com pagamento por PIX — Etapa 19.
 *
 * Substitui o antigo `PlanSwitcher` (que trocava o plano na hora, sem cobrança)
 * por um fluxo honesto: escolher plano **cria uma solicitação de pagamento**.
 * O plano só passa a valer quando um administrador confirma o recebimento do
 * PIX.
 *
 * Por que não um botão por plano que já troca:
 *   • trocar na hora e cobrar depois é o caminho que produz cliente sem plano
 *     pago e plataforma sem receita;
 *   • o escopo desta etapa é manual, e a tela tem de refletir isso — inclusive
 *     quando o PIX está desligado (aí ela não oferece o que não existe).
 *
 * Nada aqui é autorização: o banco relê o plano, recalcula o preço e recusa
 * quem não é dono/admin da casa.
 */
export function PlanPixPicker({
  plans,
  currentPlanId,
  currentInterval,
  pix,
  canManage,
  blockedPlans,
  hasPending,
}: {
  plans: PlanCatalogEntry[];
  currentPlanId: string;
  currentInterval: BillingInterval;
  pix: PixSettings;
  canManage: boolean;
  /** Plano → motivo pelo qual não pode ser contratado agora. */
  blockedPlans: Record<string, string>;
  /** Já existe pedido aguardando confirmação: não deixa criar outro por engano. */
  hasPending: boolean;
}) {
  const router = useRouter();
  const [interval, setInterval] = useState<BillingInterval>(currentInterval);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = isPixReady(pix);
  const chosen = useMemo(
    () => plans.find((plan) => plan.id === selected) ?? null,
    [plans, selected],
  );

  const confirm = () => {
    if (!chosen) return;
    setFeedback(null);

    startTransition(async () => {
      const result = await requestMyPayment({ planId: chosen.id, interval });
      if (!result.ok) {
        setFeedback({ ok: false, text: result.error });
        return;
      }
      setFeedback({ ok: true, text: result.message });
      router.push("/app/pagamento");
      router.refresh();
    });
  };

  if (!canManage) {
    return (
      <Card className="space-y-2">
        <p className="text-sm font-semibold text-ink-900">Troca de plano</p>
        <p className="text-sm text-ink-500">
          Seu perfil pode consultar o plano, mas a contratação é feita pelo proprietário ou por um
          administrador da casa.
        </p>
      </Card>
    );
  }

  if (!ready) {
    return (
      <Card className="space-y-2.5 border-amber-200 bg-amber-50">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          Pagamento por PIX indisponível
        </p>
        <p className="text-sm text-amber-800">
          A plataforma ainda não configurou o recebimento por PIX. Assim que o PIX for ativado, a
          contratação de plano aparece aqui. Se precisar trocar de plano agora, fale com o suporte.
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[1.05rem] font-semibold text-ink-900">Contratar plano</h2>
          <p className="mt-0.5 text-sm text-ink-500">Pagamento por PIX, confirmação manual</p>
        </div>
        <div className="inline-flex rounded-xl bg-ink-100 p-1" role="group" aria-label="Período de cobrança">
          {(["monthly", "yearly"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setInterval(option)}
              aria-pressed={interval === option}
              className={cn(
                "min-h-9 rounded-lg px-3 text-xs font-semibold transition-colors",
                interval === option ? "bg-white text-ink-900 shadow-sm" : "text-ink-500",
              )}
            >
              {option === "monthly" ? "Mensal" : "Anual"}
            </button>
          ))}
        </div>
      </div>

      <ul className="space-y-2.5">
        {plans.map((plan) => {
          const blocked = blockedPlans[plan.id];
          const isCurrent = plan.id === currentPlanId;
          const isSelected = plan.id === selected;
          const free = plan.price <= 0;
          const amount = cycleAmount(plan.price, interval);

          return (
            <li key={plan.id}>
              <button
                type="button"
                disabled={Boolean(blocked) || free}
                onClick={() => setSelected(isSelected ? null : plan.id)}
                aria-pressed={isSelected}
                className={cn(
                  "w-full rounded-[var(--radius-card)] border p-3.5 text-left transition-colors",
                  "min-h-11 disabled:opacity-60",
                  isSelected
                    ? "border-brand-400 bg-brand-50/60 ring-2 ring-brand-200"
                    : "border-ink-200 bg-white",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 font-semibold text-ink-900">
                      {plan.name}
                      {isCurrent && <Badge tone="info">Seu plano atual</Badge>}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-600">
                      {free ? (
                        "Gratuito — não passa por PIX"
                      ) : (
                        <>
                          {cycleAmount(plan.price, interval).toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          })}
                          <span className="text-ink-500">
                            {" "}
                            {interval === "yearly" ? "/ano (12 meses)" : "/mês"}
                          </span>
                        </>
                      )}
                    </p>
                    {blocked && <p className="mt-1 text-xs text-red-700">{blocked}</p>}
                  </div>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border",
                      isSelected ? "border-brand-600 bg-brand-600 text-white" : "border-ink-300",
                    )}
                  >
                    {isSelected && <Check className="size-3.5" />}
                  </span>
                </div>

                {plan.features.length > 0 && (
                  <FeatureList features={plan.features} limit={3} className="mt-2" />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {selected && chosen && (
        <div className="space-y-2 rounded-xl border border-ink-200 bg-ink-50 p-3">
          <p className="text-sm font-medium text-ink-900">
            {hasPending
              ? "Já existe um pagamento aguardando confirmação."
              : `Você vai solicitar: ${chosen.name} — ${cycleAmount(chosen.price, interval).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}${interval === "yearly" ? " por ano" : " por mês"}.`}
          </p>
          <p className="text-xs text-ink-600">
            {hasPending
              ? "Ao confirmar, este pedido substitui o anterior — o valor ainda não confirmado é descartado."
              : "Ao confirmar, você verá a chave PIX para pagar. A ativação só acontece depois que a plataforma conferir o recebimento."}
          </p>
          <Button block size="lg" loading={pending} onClick={confirm} disabled={pending}>
            {hasPending ? "Substituir pedido e ver PIX" : "Solicitar e ver PIX"}
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
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

      <VerificarPagamentoPendente href="/app/pagamento" />
    </Card>
  );
}

/** Atalho para a tela de pagamento quando já há pedido em análise. */
function VerificarPagamentoPendente({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="tap-target inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-700"
    >
      Ver instruções de pagamento
      <ChevronRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Bloco de PIX                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Instruções de PIX + chave copiável + QR Code opcional.
 *
 * A chave é pública por natureza (é para onde o cliente paga); por isso pode
 * aparecer inteira. O que **nunca** aparece aqui é credencial, token ou dado de
 * infraestrutura — o banco não devolve nenhum desses campos nesta RPC.
 */
export function PixInstructions({
  pix,
  amount,
  planName,
}: {
  pix: PixSettings;
  amount?: number | null;
  planName?: string | null;
}) {
  const [copied, setCopied] = useState<"key" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = isPixReady(pix);

  const copy = async () => {
    if (!pix.pix_key) return;
    try {
      await navigator.clipboard.writeText(pix.pix_key);
      setCopied("key");
      window.setTimeout(() => setCopied(null), 2500);
    } catch {
      // Clipboard bloqueado (http, permissão negada, iframe): a chave continua
      // visível e selecionável. Nunca fingir que copiou.
      setError("Não foi possível copiar automaticamente. Selecione a chave acima e copie.");
    }
  };

  if (!ready) {
    return (
      <Card className="space-y-2 border-amber-200 bg-amber-50">
        <p className="text-sm font-semibold text-amber-900">PIX indisponível no momento</p>
        <p className="text-sm text-amber-800">
          A plataforma ainda não configurou o recebimento por PIX. Fale com o suporte para combinar
          o pagamento.
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-[1.05rem] font-semibold text-ink-900">Pague com PIX</h2>
        {planName && (
          <p className="mt-0.5 text-sm text-ink-500">
            {planName}
            {typeof amount === "number" && amount > 0
              ? ` · ${amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
              : ""}
          </p>
        )}
      </div>

      <ol className="space-y-3 text-sm text-ink-700">
        <li className="flex gap-2.5">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink-900 text-xs font-bold text-white">
            1
          </span>
          <span>
            Abra o app do seu banco e escolha <strong>Pagar com PIX</strong>.
          </span>
        </li>
        <li className="flex gap-2.5">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink-900 text-xs font-bold text-white">
            2
          </span>
          <span>
            Use a chave {pix.pix_key_type ? PIX_KEY_TYPE_LABEL[pix.pix_key_type] : "PIX"}
            {pix.recipient_name ? ` de ${pix.recipient_name}` : ""}, copiada abaixo.
          </span>
        </li>
        <li className="flex gap-2.5">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink-900 text-xs font-bold text-white">
            3
          </span>
          <span>
            Envie o comprovante nesta tela (opcional) e aguarde.{" "}
            <strong>A confirmação é manual</strong> — a plataforma confere o recebimento antes de
            ativar o plano.
          </span>
        </li>
      </ol>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Chave PIX</p>
        <div className="flex items-stretch gap-2">
          <p
            className="min-w-0 flex-1 select-all break-all rounded-xl border border-ink-200 bg-ink-50 px-3 py-2.5 font-mono text-sm text-ink-900"
            aria-label="Chave PIX para pagamento"
          >
            {pix.pix_key}
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={copy}
            aria-label={PIX_COPY_LABEL}
            className="shrink-0"
          >
            {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            <span className="sr-only sm:not-sr-only">{copied ? "Copiada" : "Copiar"}</span>
          </Button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <p className="text-xs text-ink-500">
          Confira o nome do recebedor antes de concluir: {pix.recipient_name ?? "informado pela plataforma"}.
        </p>
      </div>

      {pix.qr_code_url && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
            <QrCode className="size-3.5" aria-hidden="true" />
            QR Code
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- imagem de bucket público, tamanho fixo; next/image exigiria configurar o host do Supabase */}
          <img
            src={pix.qr_code_url}
            alt={`QR Code do PIX de ${pix.recipient_name ?? "recebimento"}`}
            width={180}
            height={180}
            className="rounded-xl border border-ink-200 bg-white p-2"
          />
        </div>
      )}

      {pix.instructions && (
        <div className="rounded-xl bg-ink-50 px-3 py-2.5 text-sm text-ink-700">
          <p className="mb-0.5 font-medium text-ink-900">Observações da plataforma</p>
          <p className="whitespace-pre-line">{pix.instructions}</p>
        </div>
      )}

      <p className="flex items-start gap-2 text-xs text-ink-500">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        O Menuvo nunca pede sua senha do banco nem confirma pagamento automaticamente nesta etapa.
      </p>
    </Card>
  );
}

/** Selo de PIX configurado/ligado, usado no painel master e no rodapé do cliente. */
export function PixStatusBadge({ pix }: { pix: Pick<PixSettings, "is_active" | "is_configured"> | null }) {
  if (!pix) return <Badge tone="muted">PIX não verificado</Badge>;
  if (isPixReady(pix)) return <Badge tone="success">PIX ativo</Badge>;
  if (pix.is_configured) return <Badge tone="warning">PIX configurado, desligado</Badge>;
  return <Badge tone="danger">PIX não configurado</Badge>;
}
