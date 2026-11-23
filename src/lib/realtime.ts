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

/**
 * Canal das solicitações da mesa (Etapa 8).
 *
 * Um canal por restaurante, com nome próprio: o painel precisa saber quando
 * um cliente chamou o garçom mesmo estando na tela de pedidos, e um canal
 * separado deixa cada assinatura ser montada/derrubada de forma independente.
 */
export const tableRequestsRealtimeChannel = (restaurantId: string) =>
  `table-requests:${restaurantId}`;

/**
 * Canal do sino (Etapa 26).
 *
 * Um canal por usuário, não por restaurante: a linha de `notifications` já é de
 * um destinatário, e filtrar por `user_id` no cliente reduz o tráfego — o
 * evento de outra pessoa não chega nem a ser entregue.
 *
 * `notifications` está na publicação `supabase_realtime` com `replica identity
 * full`, então o payload traz a linha inteira e o sino pode atualizar o contador
 * sem consultar nada. Mesmo assim a tela relê a lista ao abrir o painel: o
 * payload serve para "chegou algo", não como fonte de verdade.
 */
export const notificationsRealtimeChannel = (userId: string) =>
  `notifications:${userId}`;
