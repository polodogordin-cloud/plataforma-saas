"use client";

import { useState } from "react";
import { TableRequestsSection } from "@/components/orders/table-requests-section";
import { useTableRequests } from "@/components/orders/use-table-requests";
import { setTableRequestStatus } from "@/actions/table-requests";
import type { TableRequest } from "@/lib/types";

/**
 * Conecta a fila de solicitações ao painel.
 *
 * Fica num componente próprio (e não dentro do `OrdersPanel`) para o bloco
 * poder aparecer em mais de uma tela sem arrastar junto todo o estado dos
 * pedidos — e para o canal de tempo real ser montado/derrubado com a seção.
 *
 * A ação otimista é deliberada: o garçom toca em ATENDER, o card muda na hora,
 * e a releitura em seguida confirma (ou desfaz, se o servidor recusar). Em salão
 * cheio, esperar o round-trip para ver o botão responder faz a pessoa tocar de
 * novo.
 */
export function RequestsPanelHost({
  restaurantId,
  className,
}: {
  restaurantId: string;
  className?: string;
}) {
  const { requests, loading, state, refresh, applyLocal } = useTableRequests({ restaurantId });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function change(request: TableRequest, status: "acknowledged" | "resolved") {
    setBusyId(request.id);
    setError(null);
    applyLocal(request.id, status);

    const result = await setTableRequestStatus({ requestId: request.id, status });
    setBusyId(null);

    if (result.ok === false) {
      setError(result.error);
      // Recusado: a tela volta ao que o banco diz.
      await refresh();
      return;
    }

    await refresh();
  }

  return (
    <div className={className}>
      <TableRequestsSection
        requests={requests}
        loading={loading}
        realtimeState={state}
        busyId={busyId}
        onAcknowledge={(request) => void change(request, "acknowledged")}
        onResolve={(request) => void change(request, "resolved")}
      />
      {error && (
        <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
