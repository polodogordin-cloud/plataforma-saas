"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { PageSizeStyle, PrintButton } from "@/components/printing/print-preview";
import { ThermalTicket } from "@/components/printing/thermal-ticket";
import { SegmentedChoice } from "@/components/printing/print-settings-section";
import { buildTestLines, PAPER_SPECS } from "@/lib/printing";
import type { PaperWidth } from "@/lib/types";

/**
 * `Imprimir teste` — Etapa 18.
 *
 * O escopo pede uma página de teste que verifique **tamanho, alinhamento,
 * quebra de linha e largura do papel**. Essas quatro coisas falham juntas e de
 * um jeito específico: o texto passa da área imprimível, quebra no meio de uma
 * palavra, e a coluna de valor desalinha. Por isso o teste não é "Menuvo
 * funciona" — é régua contada, linhas de borda e um parágrafo que precisa
 * caber.
 *
 * A prévia na tela existe para o dono conferir antes de gastar bobina.
 */
export function PrintTestPanel({
  paperWidth,
  restaurantName,
}: {
  paperWidth: PaperWidth;
  restaurantName: string;
}) {
  const [width, setWidth] = useState<PaperWidth>(paperWidth);
  const [showPreview, setShowPreview] = useState(false);

  const lines = buildTestLines(width, restaurantName);
  const spec = PAPER_SPECS[width];

  return (
    <section className="no-print rounded-2xl border border-ink-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-ink-900">Imprimir teste</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-500">
        Use antes de configurar a cozinha. Confira no papel: a régua vai até o fim da linha, as
        linhas de borda não quebram em duas e nenhuma palavra é cortada no meio.
      </p>

      <div className="mt-3">
        <SegmentedChoice
          label="Papel do teste"
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
      </div>

      <div className="mt-3 flex gap-2">
        <PrintButton
          label="Imprimir teste"
          variant="secondary"
          size="md"
          className="min-w-0 flex-1"
        />
        <button
          type="button"
          onClick={() => setShowPreview((current) => !current)}
          aria-expanded={showPreview}
          className="tap-target inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-ink-200 px-3 text-xs font-semibold text-ink-700 hover:bg-ink-50"
        >
          {showPreview ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
          Prévia
        </button>
      </div>

      {showPreview && (
        <div className="mt-3 flex justify-center overflow-x-auto rounded-xl bg-ink-100 p-3">
          <div className="thermal-frame">
            <ThermalTicket lines={lines} width={width} />
          </div>
        </div>
      )}

      {/* Fora da prévia: é o que sai no papel quando o botão é tocado. */}
      <div className="hidden print:block">
        <div className="thermal-sheet">
          <PageSizeStyle width={width} />
          <ThermalTicket lines={lines} width={width} />
        </div>
      </div>
    </section>
  );
}
