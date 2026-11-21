"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { tableRequestsRealtimeChannel } from "@/lib/realtime";
import { fetchTableRequests } from "@/actions/table-requests";
import type { TableRequest } from "@/lib/types";

export type RequestsRealtimeState = "connecting" | "live" | "offline";

/**
 * Fila de solicitações da mesa, mantida por tempo real.
 *
 * Mesmo desenho do painel de pedidos (Etapa 7): o evento do Postgres é só o
 * sinal — "algo mudou na tabela" — e a releitura pela RPC é a fonte de verdade.
 * Sem evento, zero consultas: nada de polling.
 *
 * Além do refetch por evento, há um `tick` local de 30s que só serve para
 * **recalcular o tempo relativo** ("Há 1 minuto") dos cards na tela. Ele não
 * consulta o banco — só força um render para o "Há X minutos" não congelar.
 */
export function useTableRequests({
  restaurantId,
  enabled = true,
}: {
  restaurantId: string;
  enabled?: boolean;
}) {
  const [requests, setRequests] = useState<TableRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<RequestsRealtimeState>("connecting");
  const [ticks, setTicks] = useState(0);
  const [, setClock] = useState(0);

  /** Guarda contra resposta fora de ordem (duas releituras em voo). */
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    const rows = await fetchTableRequests(true);
    if (mine !== seq.current) return; // resposta antiga: descarta
    setRequests(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled || !restaurantId) return;

    const client = getBrowserClient();
    let active = true;
    let first = true;

    const channel = client
      .channel(tableRequestsRealtimeChannel(restaurantId))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "table_requests" },
        () => {
          if (!active) return;
          setTicks((value) => value + 1);
          void refresh();
        },
      )
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          setState("live");
          // Reconexão: o que aconteceu enquanto estávamos fora não chegou.
          if (!first) void refresh();
          first = false;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setState("offline");
        }
      });

    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [enabled, restaurantId, refresh]);

  /** Relógio de 30s: só repinta os rótulos de tempo. */
  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  /** Aplica a mudança local na hora, antes da releitura (resposta instantânea). */
  const applyLocal = useCallback((id: string, status: TableRequest["status"]) => {
    setRequests((current) =>
      status === "resolved" || status === "cancelled"
        ? current.filter((item) => item.id !== id)
        : current.map((item) => (item.id === id ? { ...item, status } : item)),
    );
  }, []);

  return { requests, loading, state, ticks, refresh, applyLocal };
}
