"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Info, Printer as PrinterIcon } from "lucide-react";
import { logPrintJob } from "@/actions/printing";
import { PrintButton, PageSizeStyle } from "@/components/printing/print-preview";
import { OrderTicket } from "@/components/printing/thermal-ticket";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form";
import { SegmentedChoice } from "@/components/printing/print-settings-section";
import { PAPER_SPECS, resolveJobStatus } from "@/lib/printing";
import {
  PRINT_PROVIDER_LABEL,
  type OrderStatus,
  type PaperWidth,
  type PrintOrderDocument,
  type PrintProfile,
  type Printer,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Tela de impressão de um pedido.
 *
 * Ela é uma **rota própria** (`/app/pedidos/[id]/imprimir`), e não um modal:
 *
 *   • imprimir dentro do painel exigiria esconder por CSS navegação, abas,
 *     cards e sheets abertos — e um só elemento esquecido com `position: fixed`
 *     estraga o cupom;
 *   • a tela separada tem URL, então dá para abrir no aparelho ligado à
 *     impressora, salvar nos favoritos e até mandar o link para o tablet da
 *     cozinha;
 *   • no celular, é uma tela cheia com uma decisão só: qual papel e imprimir.
 *
 * Tudo o que aparece aqui veio do servidor (`get_print_order`). O cliente só
 * escolhe papel e via — e registra a solicitação antes de abrir a janela.
 */
export function PrintPreviewScreen({
  document: doc,
  profiles,
  printers,
  autoRequested = false,
}: {
  document: PrintOrderDocument;
  profiles: PrintProfile[];
  printers: Printer[];
  /**
   * Veio de `?auto=1` (impressão automática ao aceitar o pedido).
   *
   * Aqui a decisão importante: **não** chamar `window.print()` sozinho. Numa
   * guia recém-aberta não há gesto do usuário, e o navegador pode bloquear a
   * janela — pior, se abrisse, imprimiria com a impressora errada (a padrão do
   * aparelho), sem ninguém ter escolhido a térmica. O que fazemos é colocar o
   * botão no topo, com o papel já calibrado pelo perfil: um toque.
   */
  autoRequested?: boolean;
}) {
  const [width, setWidth] = useState<PaperWidth>(doc.settings.default_paper_width);
  const [showPrices, setShowPrices] = useState<boolean>(doc.settings.show_prices);
  const [copyLabel, setCopyLabel] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const activeProfiles = useMemo(() => profiles.filter((p) => p.is_active), [profiles]);
  const defaultPrinter = useMemo(() => printers.find((p) => p.is_default && p.is_active), [printers]);

  // A escolha de papel do perfil padrão vence o padrão da casa: quem configurou
  // "Cozinha em 58mm" espera o cupom da cozinha em 58mm.
  useEffect(() => {
    const kitchenProfile = activeProfiles.find((p) => p.kind === "kitchen");
    if (kitchenProfile) setWidth(kitchenProfile.paper_width);
  }, [activeProfiles]);

  const spec = PAPER_SPECS[width];
  const status = resolveJobStatus(defaultPrinter?.provider ?? "browser");

  /** Registra a solicitação. Não bloqueia a impressão: log perdido é menor que cupom perdido. */
  function registerJob() {
    void logPrintJob({
      orderId: doc.order.id,
      profileId: activeProfiles[0]?.id ?? null,
      printerId: defaultPrinter?.id ?? null,
      provider: defaultPrinter?.provider ?? "browser",
      paperWidth: width,
      copies: doc.settings.copies,
      status,
      detail: copyLabel ?? "",
    });
  }

  return (
    <div className="min-h-dvh bg-ink-100">
      <PageSizeStyle width={width} />

      {/* Barra de topo — some no papel. */}
      <header className="no-print sticky top-0 z-10 border-b border-ink-200 bg-white/95 backdrop-blur">
        <div className="app-shell flex min-h-14 items-center gap-2 px-3">
          <Link
            href="/app/pedidos"
            className="tap-target grid size-10 shrink-0 place-items-center rounded-xl text-ink-600 hover:bg-ink-100"
            aria-label="Voltar para os pedidos"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink-900">
              Pedido #{doc.order.order_number}
            </p>
            <p className="truncate text-xs text-ink-500">
              {doc.order.table_name} · {spec.label} · {spec.columns} colunas
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-ink-100 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-ink-600">
            {statusLabel(doc.order.status)}
          </span>
        </div>
      </header>

      <main className="app-shell space-y-4 px-3 pb-28 pt-4">
        {/* Aviso honesto sobre o alcance do botão. */}
        <section className="no-print flex items-start gap-2.5 rounded-xl bg-sky-50 px-3.5 py-3 text-xs leading-relaxed text-sky-900 ring-1 ring-inset ring-sky-200">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            O botão abre a janela de impressão do aparelho.{" "}
            <strong>Escolha a impressora térmica nessa janela</strong> e confirme o tamanho do
            papel como {spec.label}. O Menuvo não conversa com a impressora para confirmar que o
            papel saiu.
          </span>
        </section>

        {autoRequested && (
          <section className="no-print rounded-xl bg-brand-50 px-3.5 py-3 text-xs leading-relaxed text-brand-900 ring-1 ring-inset ring-brand-200">
            <strong>Impressão automática ativada.</strong> Confirme abaixo para mandar este cupom à
            térmica. O navegador precisa de um toque para abrir a janela de impressão.
          </section>
        )}

        {/* Controles */}
        <section className="no-print space-y-4 rounded-2xl border border-ink-200 bg-white p-4">
          <SegmentedChoice
            label="Largura do papel"
            value={width}
            onChange={setWidth}
            options={[
              { value: "58" as PaperWidth, label: "58mm", description: `${spec.printableMm}mm` },
              {
                value: "80" as PaperWidth,
                label: "80mm",
                description: `${PAPER_SPECS["80"].printableMm}mm`,
              },
            ]}
          />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={showPrices}
              onClick={() => setShowPrices(true)}
              className={cn(
                "min-h-11 rounded-full px-3.5 text-xs font-semibold ring-1 ring-inset transition-colors",
                showPrices
                  ? "bg-ink-900 text-white ring-ink-900"
                  : "bg-white text-ink-600 ring-ink-200",
              )}
            >
              Com preços
            </button>
            <button
              type="button"
              aria-pressed={!showPrices}
              onClick={() => setShowPrices(false)}
              className={cn(
                "min-h-11 rounded-full px-3.5 text-xs font-semibold ring-1 ring-inset transition-colors",
                !showPrices
                  ? "bg-ink-900 text-white ring-ink-900"
                  : "bg-white text-ink-600 ring-ink-200",
              )}
            >
              Só produção (cozinha)
            </button>
          </div>

          {activeProfiles.length > 0 && (
            <div>
              <p className="text-sm font-medium text-ink-700">Via</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-pressed={copyLabel === null}
                  onClick={() => setCopyLabel(null)}
                  className={cn(
                    "min-h-11 rounded-full px-3.5 text-xs font-semibold ring-1 ring-inset",
                    copyLabel === null
                      ? "bg-brand-600 text-white ring-brand-600"
                      : "bg-white text-ink-600 ring-ink-200",
                  )}
                >
                  Via principal
                </button>
                {activeProfiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    aria-pressed={copyLabel === profile.name}
                    onClick={() => {
                      setCopyLabel(profile.name);
                      setWidth(profile.paper_width);
                    }}
                    className={cn(
                      "min-h-11 rounded-full px-3.5 text-xs font-semibold ring-1 ring-inset",
                      copyLabel === profile.name
                        ? "bg-brand-600 text-white ring-brand-600"
                        : "bg-white text-ink-600 ring-ink-200",
                    )}
                  >
                    {profile.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {defaultPrinter && (
            <p className="text-[0.7rem] leading-snug text-ink-500">
              Impressora padrão: <strong>{defaultPrinter.name}</strong> ·{" "}
              {PRINT_PROVIDER_LABEL[defaultPrinter.provider]}
            </p>
          )}

          {feedback && <FormAlert tone="info">{feedback}</FormAlert>}
        </section>

        {/* Prévia = o que vai sair. */}
        <section aria-labelledby="print-preview" className="no-print">
          <h2
            id="print-preview"
            className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-ink-400"
          >
            Prévia · {spec.label}
          </h2>
        </section>

        <div className="flex justify-center pb-4">
          {/* A área que a impressão recorta: só ela existe no papel. */}
          <div className="thermal-sheet">
            <div className="thermal-frame">
              <OrderTicket
                document={doc}
                width={width}
                showPrices={showPrices}
                copyLabel={copyLabel}
              />
            </div>
          </div>
        </div>
      </main>

      {/* Barra de ação fixa — no celular o polegar alcança. */}
      <div className="no-print fixed inset-x-0 bottom-0 z-10 border-t border-ink-200 bg-white/95 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="app-shell flex gap-2">
          <Button
            size="lg"
            variant="secondary"
            className="shrink-0 px-3"
            onClick={() => {
              setFeedback(
                "Para testar alinhamento e largura, use “Imprimir teste” na configuração de impressão.",
              );
            }}
          >
            <PrinterIcon className="size-4.5" aria-hidden="true" />
            Ajuda
          </Button>
          <PrintButton
            className="min-w-0 flex-1"
            label={`🖨 Imprimir pedido`}
            onBeforePrint={registerJob}
          />
        </div>
      </div>
    </div>
  );
}

function statusLabel(status: OrderStatus): string {
  switch (status) {
    case "pending":
      return "Novo";
    case "confirmed":
      return "Confirmado";
    case "preparing":
      return "Em preparo";
    case "ready":
      return "Pronto";
    case "delivered":
      return "Entregue";
    default:
      return "Cancelado";
  }
}
