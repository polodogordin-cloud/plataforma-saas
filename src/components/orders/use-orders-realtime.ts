"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { ordersRealtimeChannel } from "@/lib/realtime";

/**
 * Assinatura de tempo real dos pedidos do restaurante.
 *
 * Por que assim, e não fazendo polling:
 *
 * - Assinamos `postgres_changes` na tabela `orders`. O Postgres avisa o
 *   Supabase quando a linha muda; o navegador recebe por WebSocket. Não existe
 *   "verificar de novo a cada N segundos", então a tela reage na hora e o
 *   celular não consome bateria/dados com consulta constante.
 *
 * - O evento **não carrega os dados do pedido** (itens, nome da mesa). Ele é
 *   só o sinal: "algo mudou". Ao receber, o painel relê a lista pela RPC, que é
 *   a fonte de verdade (com itens, mesa e RLS). Isso evita manter dois modelos
 *   de "pedido" no cliente e evita mostrar um card meio montado.
 *
 * - Isso é *refetch disparado por evento*, não polling: sem evento, zero
 *   consultas. O fallback de reconexão está descrito abaixo.
 *
 * - Se o canal cair (celular perdeu sinal no salão, tela bloqueou), o
 *   `SUBSCRIBED` de volta dispara um refetch — o painel não fica com dado velho
 *   sem avisar. Enquanto estiver caído, a tela mostra o estado "reconectando".
 *
 * - A RLS vale no canal: o Supabase só entrega linha de restaurante de que o
 *   usuário é membro. Ainda assim, a releitura passa pela RPC com guard.
 */

export type RealtimeState = "connecting" | "live" | "offline";

export function useOrdersRealtime({
  restaurantId,
  enabled = true,
  onChange,
}: {
  restaurantId: string;
  /** Desligado quando a aba está escondida por muito tempo, se preciso. */
  enabled?: boolean;
  /** Chamado a cada evento relevante (e na reconexão). */
  onChange: (payload: { table: string; type: string }) => void;
}) {
  const [state, setState] = useState<RealtimeState>("connecting");
  /** Quantos eventos chegaram nesta sessão — o painel usa como "pisca". */
  const [ticks, setTicks] = useState(0);

  // Callback em ref: trocar o handler não pode derrubar a inscrição, senão
  // cada re-render do painel abriria um WebSocket novo.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const notify = useCallback((table: string, type: string) => {
    setTicks((value) => value + 1);
    onChangeRef.current({ table, type });
  }, []);

  useEffect(() => {
    if (!enabled || !restaurantId) return;

    const client = getBrowserClient();
    let active = true;
    let firstSubscribe = true;

    const channel = client
      .channel(ordersRealtimeChannel(restaurantId))
      .on(
        // Sem filtro no servidor: RLS já limita. Filtrar por restaurant_id
        // exigiria a coluna na publicação com replica identity full (que está
        // ligada) — mas o volume por casa é baixo e o filtro no cliente é
        // menos uma coisa para quebrar.
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        (payload) => {
          if (!active) return;
          notify("orders", String(payload.eventType ?? "UPDATE"));
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_status_events" },
        () => {
          if (!active) return;
          notify("order_status_events", "INSERT");
        },
      )
      /*
       * Etapa 17 — `order_items` no MESMO canal.
       *
       * O KDS precisa saber que um item entrou num pedido que já está na tela
       * (mesa que pede mais uma rodada). Assinar isto num canal separado
       * abriria um segundo WebSocket no tablet da cozinha, que fica ligado o
       * turno inteiro — e dois canais para a mesma tabela de pedidos é
       * exatamente a duplicação que o escopo proíbe.
       *
       * O painel do salão recebe o mesmo evento e relê a lista; o custo é uma
       * consulta a mais num caso raro (item adicionado a pedido existente).
       */
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "order_items" },
        () => {
          if (!active) return;
          notify("order_items", "INSERT");
        },
      )
      .subscribe((status) => {
        if (!active) return;

        if (status === "SUBSCRIBED") {
          setState("live");
          // Reconexão: o que aconteceu enquanto estávamos fora não chegou.
          if (!firstSubscribe) notify("orders", "RECONNECTED");
          firstSubscribe = false;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setState("offline");
        } else if (status === "CLOSED") {
          setState("offline");
        }
      });

    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [enabled, restaurantId, notify]);

  return { state, ticks };
}
