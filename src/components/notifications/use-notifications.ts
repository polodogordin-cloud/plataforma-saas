"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { notificationsRealtimeChannel } from "@/lib/realtime";
import { normalizeNotification, type Notification } from "@/lib/notifications";
import { markAllNotificationsRead, markNotificationRead } from "@/actions/notifications";

/**
 * Estado da central de notificações no navegador — Etapa 26.
 *
 * ─── Sem polling ───────────────────────────────────────────────────────────
 *
 * O contador e a lista vivem de dois eventos de `notifications`:
 * `INSERT` (chegou algo) e `UPDATE` (alguém marcou como lido em outro aparelho).
 * Sem evento, zero consultas — o mesmo desenho do painel de pedidos (Etapa 7).
 *
 * A inscrição é filtrada por `user_id` do destinatário. Não é a segurança (a RLS
 * é), é tráfego: o WebSocket não entrega o evento de outra pessoa.
 *
 * ─── Reconexão conta como evento ───────────────────────────────────────────
 *
 * Celular no bolso, tela bloqueada, Wi-Fi do salão oscilando: o canal cai e o
 * que aconteceu nesse intervalo não chegou. Ao voltar para `SUBSCRIBED`, a tela
 * relê — sem isso o sino ficaria com um número de dez minutos atrás.
 */

export type BellRealtimeState = "connecting" | "live" | "offline";

const PAGE_SIZE = 30;

/**
 * Lista e contador no **mesmo** estado.
 *
 * Eles já foram dois `useState` e o resultado era um contador que mentia: o
 * Supabase reentrega evento depois de reconectar, e a lista descartava a linha
 * repetida enquanto o contador somava de novo. Com um objeto só, a transição é
 * calculada contra o que está na tela — "esta linha já estava aqui?" e "esta
 * linha estava lida?" viram a mesma pergunta, e não há janela entre as duas
 * atualizações.
 */
type BellData = { items: Notification[]; unread: number };

const clampCount = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);

const sameUnread = (a: Notification, b: Notification) => (a.read_at === null) === (b.read_at === null);

export function useNotifications({
  userId,
  restaurantName,
  initialUnread = 0,
}: {
  userId: string;
  /** Nome usado no cabeçalho do painel; vem do servidor, não do cliente. */
  restaurantName?: string | null;
  /**
   * Contagem lida no servidor. É só o ponto de partida: a primeira leitura da
   * lista (ao abrir o painel) e os eventos de tempo real corrigem o número.
   * Sem ela, o sino nasceria apagado em toda navegação interna.
   */
  initialUnread?: number;
}) {
  const [data, setData] = useState<BellData>(() => ({
    items: [],
    unread: clampCount(initialUnread),
  }));
  const { items, unread } = data;
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [state, setState] = useState<BellRealtimeState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  /** Guarda contra resposta fora de ordem (duas releituras em voo). */
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);

    const response = await fetch("/api/notifications", { cache: "no-store" });
    if (mine !== seq.current) return;

    if (!response.ok) {
      setLoading(false);
      setLoadedOnce(true);
      return;
    }

    const payload = (await response.json()) as {
      notifications?: Array<Record<string, unknown>>;
      unread?: number;
    };

    if (mine !== seq.current) return;

    setData({
      items: (payload.notifications ?? []).map(normalizeNotification),
      unread: clampCount(Number(payload.unread ?? 0)),
    });
    setLoading(false);
    setLoadedOnce(true);
  }, []);

  /* --------------------------------------------------------- tempo real */
  const handleEvent = useCallback(
    (payload: { eventType?: string; new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
      const event = String(payload.eventType ?? "").toUpperCase();

      if (event === "INSERT" && payload.new) {
        const incoming = normalizeNotification(payload.new);

        setData((current) => {
          // Reentrega do mesmo evento (o Supabase repete depois de reconectar)
          // não pode duplicar a linha **nem** inflar o contador.
          if (current.items.some((item) => item.id === incoming.id)) return current;
          return {
            items: [incoming, ...current.items].slice(0, PAGE_SIZE),
            unread: clampCount(current.unread + (incoming.read_at ? 0 : 1)),
          };
        });
        setLoadedOnce(true);
        return;
      }

      if (event === "UPDATE" && payload.new) {
        const incoming = normalizeNotification(payload.new);

        setData((current) => {
          const previous = current.items.find((item) => item.id === incoming.id);
          // Linha que não está na tela não mexe no contador: quem conta é o
          // servidor, e o número daqui é o que a pessoa está vendo.
          if (!previous) return current;

          const items = current.items.map((item) => (item.id === incoming.id ? incoming : item));

          // A transição vem do estado local, não de `payload.old`: um UPDATE
          // repetido traz o mesmo `old` e descontaria de novo.
          if (sameUnread(previous, incoming)) return { items, unread: current.unread };
          return {
            items,
            unread: clampCount(current.unread + (incoming.read_at === null ? 1 : -1)),
          };
        });
      }
    },
    [],
  );

  useEffect(() => {
    if (!userId) return;

    const client = getBrowserClient();
    let active = true;
    let firstSubscribe = true;

    const channel = client
      .channel(notificationsRealtimeChannel(userId))
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (!active) return;
          handleEvent(payload as unknown as Parameters<typeof handleEvent>[0]);
        },
      )
      .subscribe((status) => {
        if (!active) return;

        if (status === "SUBSCRIBED") {
          setState("live");
          // Reconexão: o que passou enquanto estávamos fora não chegou.
          if (!firstSubscribe) void refresh();
          firstSubscribe = false;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setState("offline");
        }
      });

    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [userId, handleEvent, refresh]);

  /* ------------------------------------------------------------- ações */
  const markRead = useCallback(
    async (id: string) => {
      const target = items.find((item) => item.id === id);
      if (!target || target.read_at) return;

      setBusyId(id);
      setError(null);
      // Otimista: o item muda na hora. O servidor confirma (ou a releitura
      // desfaz, se recusar) — em salão cheio, esperar o round-trip faz a pessoa
      // tocar de novo.
      setData((current) => ({
        items: current.items.map((item) =>
          item.id === id ? { ...item, read_at: new Date().toISOString() } : item,
        ),
        unread: clampCount(current.unread - 1),
      }));

      const result = await markNotificationRead(id);
      setBusyId(null);

      if (result.ok === false) {
        setError(result.error);
        await refresh();
      }
    },
    [items, refresh],
  );

  const markAll = useCallback(async () => {
    if (unread === 0 || markingAll) return;

    setMarkingAll(true);
    setError(null);
    const now = new Date().toISOString();
    // Global não é marcada em massa: a linha é uma só para todos os admins, e
    // marcar aqui marcaria para os outros também.
    setData((current) => ({
      items: current.items.map((item) =>
        item.is_global || item.read_at ? item : { ...item, read_at: now },
      ),
      unread: 0,
    }));

    const result = await markAllNotificationsRead();
    setMarkingAll(false);

    if (result.ok === false) {
      setError(result.error);
      await refresh();
    }
  }, [unread, markingAll, refresh]);

  const clearError = useCallback(() => setError(null), []);

  return {
    items,
    unread,
    loading,
    loadedOnce,
    state,
    error,
    busyId,
    markingAll,
    restaurantName,
    refresh,
    markRead,
    markAll,
    clearError,
  };
}
