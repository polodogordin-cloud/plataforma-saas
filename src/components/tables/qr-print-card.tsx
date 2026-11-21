"use client";

import { Armchair } from "lucide-react";
import type { RestaurantTable } from "@/lib/types";

/**
 * Cartão da mesa em tamanho de impressão.
 *
 * Fica escondido na tela (`display: none` via `print-only`) e aparece só no
 * `@media print`. Sem isso, "Imprimir" mandaria o painel inteiro — navegação,
 * botões, busca — para a folha.
 *
 * O cartão é pensado para recortar e colar na mesa: QR grande, nome da mesa em
 * destaque e o mínimo de instrução. Fundo branco e borda sólida para sair bem
 * em impressora comum.
 */
export function QrPrintCard({ table }: { table: RestaurantTable }) {
  return (
    <div className="print-only print-card">
      <p className="print-card__eyebrow">
        <Armchair aria-hidden="true" />
        Mesa
      </p>

      <p className="print-card__name">{table.name}</p>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/app/mesas/${table.id}/qr`}
        alt={`QR Code da ${table.name}`}
        width={720}
        height={720}
        className="print-card__qr"
      />

      <p className="print-card__hint">Aponte a câmera do celular para abrir o cardápio</p>

      {table.code && <p className="print-card__code">{table.code}</p>}
    </div>
  );
}
