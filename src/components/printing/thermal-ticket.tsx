import type { PaperWidth, PrintOrderDocument } from "@/lib/types";
import { buildTicketLines } from "@/lib/printing";

/**
 * O cupom em si.
 *
 * É um `<pre>` porque o layout é texto já quebrado por `printing.ts`: quem
 * imprimiu 32 colunas foi aquela função, e a tela não deve "reorganizar" o
 * resultado. Isso mantém a regra testável sem DOM e garante que o papel de
 * 58mm e o de 80mm saem do mesmo código que os testes cobrem.
 *
 * Sem tabela, sem flex, sem ícone. Papel térmico é caro e a cabeça imprime
 * texto; qualquer enfeite vira linha gasta e possível desalinhamento.
 */
export function ThermalTicket({
  lines,
  width,
  className,
}: {
  lines: string[];
  width: PaperWidth;
  className?: string;
}) {
  return (
    <pre
      className={`thermal-ticket ${className ?? ""}`.trim()}
      data-paper={width}
      // `aria-label` porque o leitor de tela não deve soletrar 32 colunas de
      // espaços: o conteúdo é um cupom, não um poema concreto.
      aria-label="Cupom de impressão"
    >
      {lines.join("\n")}
    </pre>
  );
}

/** Cupom de um pedido, já no papel escolhido. */
export function OrderTicket({
  document,
  width,
  showPrices,
  copyLabel,
  className,
}: {
  document: PrintOrderDocument;
  width: PaperWidth;
  showPrices?: boolean;
  copyLabel?: string | null;
  className?: string;
}) {
  const lines = buildTicketLines(document, { width, showPrices, copyLabel });
  return <ThermalTicket lines={lines} width={width} className={className} />;
}
