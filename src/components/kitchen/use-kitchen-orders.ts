"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { refreshKitchenOrders } from "@/actions/kitchen";
import { useOrdersRealtime, type RealtimeState } from "@/components/orders/use-orders-realtime";
import {
  highestOrderNumber,
  newArrivals,
  playNewOrderSound,
  readSoundPreference,
  writeSoundPreference,
} from "@/lib/kitchen";
import type { KitchenOrder } from "@/lib/types";

/**
 * Estado ao vivo do painel de cozinha.
 *
 * Estrutura: **um** estado de pedidos + relógio separado + som separado.
 *
 *   • Os pedidos vêm do servidor por RPC, nunca montados a partir do evento.
 *     O evento do Supabase é só o sinal "mudou" — ele não traz a estação
 *     resolvida nem o histórico de preparo.
 *   • O relógio (`nowMs`) atualiza a cada segundo e **não** refaz a consulta. É
 *     o que faz o contador `00:12` andar sem 60 requisições por minuto.
 *   • O som é decidido comparando o maior `order_number` conhecido com os
 *     novos; preferência no `localStorage` do aparelho.
 *
 * Isso é refetch disparado por evento, não polling: sem evento, zero consultas.
 */

const TICK_MS = 1000;
/** Depois de uma ação local, espera o eco do servidor antes de reler de novo. */
const ACTION_GRACE_MS = 1200;

export function useKitchenOrders({
  restaurantId,
  station,
  initialOrders,
  initialLateAfter,
  initialWarnAfter,
}: {
  restaurantId: string;
  station: string | null;
  initialOrders: KitchenOrder[];
  initialLateAfter: number;
  initialWarnAfter: number;
}) {
  const [orders, setOrders] = useState<KitchenOrder[]>(initialOrders);
  const [lateAfter, setLateAfter] = useState(initialLateAfter);
  const [warnAfter, setWarnAfter] = useState(initialWarnAfter);

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [arrived, setArrived] = useState<KitchenOrder[]>([]);
  /** Números vistos nesta sessão — base do "o que é novo". */
  const [lastSeen, setLastSeen] = useState<number | null>(() => highestOrderNumber(initialOrders));

  const requestId = useRef(0);
  const lastActionAt = useRef(0);
  const stationRef = useRef(station);
  stationRef.current = station;

  /* ------------------------------------------------------------------ */
  /* Preferência de som (por aparelho)                                   */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    setSoundEnabled(readSoundPreference(restaurantId));
  }, [restaurantId]);

  const toggleSound = useCallback(() => {
    setSoundEnabled((current) => {
      const next = !current;
      writeSoundPreference(restaurantId, next);

      if (next) {
        // Tocar agora, no gesto do usuário: é o único momento em que o
        // navegador garante permissão de áudio. Serve também de teste audível.
        const played = playNewOrderSound();
        setSoundBlocked(!played);
      } else {
        setSoundBlocked(false);
      }

      return next;
    });
  }, [restaurantId]);

  /* ------------------------------------------------------------------ */
  /* Relógio: um tick por segundo, sem consulta                          */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  /* ------------------------------------------------------------------ */
  /* Recarga                                                            */
  /* ------------------------------------------------------------------ */

  const refresh = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      const id = ++requestId.current;
      if (!silent) setLoading(true);

      const result = await refreshKitchenOrders({ station: stationRef.current });

      // Resposta de uma busca antiga chegando depois de uma mais nova.
      if (id !== requestId.current) return;

      setOrders(result.orders);
      setLateAfter(result.lateAfter);
      setWarnAfter(result.warnAfter);
      setLoading(false);

      setLastSeen((seen) => {
        const arrivals = newArrivals(result.orders, seen);
        if (arrivals.length > 0) {
          setArrived(arrivals);
          if (readSoundPreference(restaurantId)) {
            setSoundBlocked(!playNewOrderSound());
          }
        }
        return highestOrderNumber(result.orders) ?? seen;
      });
    },
    [restaurantId],
  );

  // Troca de estação: recarrega com o novo filtro.
  const previousStation = useRef(station);
  useEffect(() => {
    if (previousStation.current === station) return;
    previousStation.current = station;
    void refresh();
  }, [station, refresh]);

  /* ------------------------------------------------------------------ */
  /* Tempo real — mesmo canal do painel da Etapa 7                       */
  /* ------------------------------------------------------------------ */

  const onRealtime = useCallback(() => {
    // A ação local já revalidou e o servidor vai mandar o evento dela mesma.
    // Reler no eco imediato duplica a consulta sem mudar nada na tela.
    if (Date.now() - lastActionAt.current < ACTION_GRACE_MS) return;
    void refresh({ silent: true });
  }, [refresh]);

  const realtime: { state: RealtimeState } = useOrdersRealtime({
    restaurantId,
    onChange: onRealtime,
  });

  /* ------------------------------------------------------------------ */
  /* Ações                                                              */
  /* ------------------------------------------------------------------ */

  const markActed = useCallback((orderId: string, status: KitchenOrder["status"]) => {
    lastActionAt.current = Date.now();

    // Otimista: o card muda de coluna na hora. O servidor confirma em seguida;
    // se recusar, a próxima recarga devolve o estado verdadeiro. Em cozinha com
    // fila, esperar 300ms de rede por toque é o que faz a equipe tocar duas
    // vezes no mesmo botão.
    setOrders((current) =>
      current.map((order) => (order.id === orderId ? { ...order, status } : order)),
    );

    // Sai da lista de destaques: o pedido já foi visto.
    setArrived((current) => current.filter((order) => order.id !== orderId));
  }, []);

  const dismissArrival = useCallback((orderId: string) => {
    setArrived((current) => current.filter((order) => order.id !== orderId));
  }, []);

  return {
    orders,
    nowMs,
    lateAfter,
    warnAfter,
    loading,
    refresh,
    realtimeState: realtime.state,
    soundEnabled,
    soundBlocked,
    toggleSound,
    arrived,
    dismissArrival,
    markActed,
  };
}
