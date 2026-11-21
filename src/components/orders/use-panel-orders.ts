"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOrderHistory, fetchPanelOrders } from "@/actions/orders-panel";
import type { OrderStatus, OrderStatusEvent, PanelOrder } from "@/lib/types";

/**
 * Estado da lista de pedidos do painel.
 *
 * Duas listas, porque o uso real é diferente:
 *
 * - **Ativos** (pendente, confirmado, em preparo, pronto): é o que a equipe
 *   olha o tempo todo. Recarrega inteira a cada evento de tempo real — são
 *   poucos pedidos, e é importante que a lista bata com o banco.
 * - **Finalizados** (entregue, cancelado): histórico. Carrega a primeira página
 *   e só cresce quando a pessoa pede ("Carregar mais"), com cursor por
 *   `order_number`. Nunca carrega tudo de uma vez.
 */

const ACTIVE_STATUSES: OrderStatus[] = ["pending", "confirmed", "preparing", "ready"];
const DONE_STATUSES: OrderStatus[] = ["delivered", "cancelled"];

const ACTIVE_PAGE = 20;
const DONE_PAGE = 10;

/**
 * Ordena do mais recente para o mais antigo.
 *
 * Cada aba consulta mais de um status (finalizados = entregue + cancelado), e
 * as chamadas voltam em paralelo: sem ordenar aqui, a lista sairia agrupada por
 * status em vez de por hora. `order_number` é monotônico por casa, então
 * ordenar por ele dá a mesma sequência de `created_at` — sem empate.
 */
export function sortOrders(orders: PanelOrder[]): PanelOrder[] {
  return [...orders].sort((a, b) => b.order_number - a.order_number);
}

export function usePanelOrders() {
  const [active, setActive] = useState<PanelOrder[]>([]);
  const [done, setDone] = useState<PanelOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreDone, setHasMoreDone] = useState(false);

  /** Evita aplicar resposta de uma busca antiga por cima de uma nova. */
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    const [activeRows, doneRows] = await Promise.all([
      fetchPanelOrders({ statuses: ACTIVE_STATUSES, limit: ACTIVE_PAGE }),
      fetchPanelOrders({ statuses: DONE_STATUSES, limit: DONE_PAGE }),
    ]);

    // Chegou uma atualização mais nova enquanto esta estava em voo: descarta.
    if (id !== requestId.current) return;

    setActive(sortOrders(activeRows));
    // Não pisa no histórico já carregado: os finalizados só crescem por ação
    // do usuário. Só a primeira página é substituída quando a lista está curta.
    setDone((current) => (current.length <= DONE_PAGE ? sortOrders(doneRows) : current));
    setHasMoreDone((current) => (doneRows.length >= DONE_PAGE ? true : current && current));
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadMoreDone = useCallback(async () => {
    if (loadingMore || done.length === 0) return;

    setLoadingMore(true);
    // Cursor: o menor número já exibido. Números são monotônicos por casa.
    const before = Math.min(...done.map((order) => order.order_number));
    const rows = await fetchPanelOrders({
      statuses: DONE_STATUSES,
      beforeNumber: before,
      limit: DONE_PAGE,
    });

    setDone((current) => {
      const seen = new Set(current.map((order) => order.id));
      return sortOrders([...current, ...rows.filter((order) => !seen.has(order.id))]);
    });
    setHasMoreDone(rows.length >= DONE_PAGE);
    setLoadingMore(false);
  }, [done, loadingMore]);

  const historyFor = useCallback(
    (orderId: string): Promise<OrderStatusEvent[]> => fetchOrderHistory(orderId),
    [],
  );

  return {
    active,
    done,
    loading,
    loadingMore,
    hasMoreDone,
    refresh,
    loadMoreDone,
    historyFor,
    /** Total de pedidos vivos, usado no selo da aba. */
    activeCount: active.length,
  };
}
