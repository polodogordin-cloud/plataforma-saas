"use client";

/**
 * Nomes dos canais de tempo real.
 *
 * Ficam num módulo só para o painel e a home assinarem o *mesmo* tópico — dois
 * canais diferentes para a mesma tabela seriam duas conexões e dois pontos
 * onde esquecer de cancelar a inscrição.
 *
 * O `restaurantId` no nome não é isolamento (a RLS já faz isso): é para a
 * inscrição ser descartada quando o usuário troca de restaurante.
 */
export const ordersRealtimeChannel = (restaurantId: string) =>
  `orders:${restaurantId}`;

/** Tabelas observadas. `orders` cobre status/altas e `order_status_events` o histórico. */
export const REALTIME_FILTER = { table: "orders", schema: "public" } as const;
