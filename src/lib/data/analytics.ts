import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type {
  AnalyticsCategory,
  AnalyticsDay,
  AnalyticsHour,
  AnalyticsPayload,
  AnalyticsPaymentMethod,
  AnalyticsPeriod,
  AnalyticsPrevious,
  AnalyticsProduct,
  AnalyticsSummary,
  AnalyticsTable,
  OrderPayment,
  PaymentMethod,
} from "@/lib/types";

/**
 * Leitura de analytics — Etapa 16.
 *
 * ─── Por que sete RPCs em vez de uma ────────────────────────────────────────
 *
 * A alternativa óbvia era um `restaurant_analytics(p_restaurant_id, preset)` que
 * devolvesse tudo num jsonb. Ficou de fora por dois motivos:
 *
 *   1. **Tamanho de payload.** Um período de 90 dias com 24 horas, 50 produtos,
 *      20 categorias, 15 mesas e 4 métodos passa fácil de 60 kB de JSON. No
 *      celular do dono, atrás do Wi-Fi do salão, isso é a diferença entre a tela
 *      abrir e a tela girar.
 *   2. **Falha parcial.** Se o ranking de produtos quebrar (um produto apagado,
 *      por exemplo), o dono ainda quer ver o faturamento. Com uma RPC só, tudo
 *      vira erro.
 *
 * As sete vão em `Promise.all` e saem numa resposta HTTP: o custo de rede é o
 * de uma ida só, e cada uma pode ser cacheada/otimizada pelo índice próprio.
 *
 * ─── Autorização ────────────────────────────────────────────────────────────
 *
 * O `restaurantId` vem de `getActiveRestaurant()` na página, nunca da URL. As
 * RPCs conferem `is_restaurant_member` de novo — mesmo que alguém forje o id,
 * o banco devolve vazio. O parâmetro existe para o banco saber qual casa, não
 * para autorizar.
 */

/** Converte numeric do PostgREST em número sem perder centavos. */
function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/** Normaliza o resumo. `orders_by_status` chega como jsonb. */
function normalizeSummary(row: Record<string, unknown>, preset: AnalyticsPeriod): AnalyticsSummary {
  const raw = row.orders_by_status;
  const byStatus =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as AnalyticsSummary["orders_by_status"])
      : {};

  return {
    preset,
    from_date: str(row.from_date).slice(0, 10),
    to_date: str(row.to_date).slice(0, 10),
    orders_count: toNumber(row.orders_count),
    orders_value: toNumber(row.orders_value),
    paid_value: toNumber(row.paid_value),
    unpaid_value: toNumber(row.unpaid_value),
    orders_cancelled: toNumber(row.orders_cancelled),
    cancelled_value: toNumber(row.cancelled_value),
    ticket_average: toNumber(row.ticket_average),
    waiter_calls: toNumber(row.waiter_calls),
    bill_requests: toNumber(row.bill_requests),
    items_sold: toNumber(row.items_sold),
    orders_by_status: byStatus,
  };
}

/** Argumentos de período, no formato que todas as RPCs esperam. */
function periodArgs(preset: AnalyticsPeriod, from?: string | null, to?: string | null) {
  return {
    p_preset: preset,
    p_from: preset === "custom" ? (from ?? null) : null,
    p_to: preset === "custom" ? (to ?? null) : null,
  };
}

/**
 * Carrega a tela inteira.
 *
 * `cache()` deduplica dentro da mesma requisição: a página e o `generateMetadata`
 * (ou um componente de comparação) pedem o mesmo payload e só uma chamada sai.
 *
 * Devolve `null` quando o resumo falha — sem resumo não há tela, e é melhor a
 * página dar o estado de erro do que renderizar sete gráficos vazios como se a
 * casa não tivesse vendido nada.
 */
export const getAnalytics = cache(
  async ({
    restaurantId,
    preset,
    from,
    to,
  }: {
    restaurantId: string;
    preset: AnalyticsPeriod;
    from?: string | null;
    to?: string | null;
  }): Promise<AnalyticsPayload | null> => {
    if (!restaurantId) return null;

    const supabase = await createClient();
    const args = periodArgs(preset, from, to);

    const [summary, previous, daily, hours, products, categories, tables, methods, timezone] =
      await Promise.all([
        supabase.rpc("restaurant_analytics_summary", { p_restaurant_id: restaurantId, ...args }),
        supabase.rpc("restaurant_analytics_previous", { p_restaurant_id: restaurantId, ...args }),
        supabase.rpc("restaurant_analytics_daily", { p_restaurant_id: restaurantId, ...args }),
        supabase.rpc("restaurant_analytics_hours", { p_restaurant_id: restaurantId, ...args }),
        supabase.rpc("restaurant_analytics_top_products", {
          p_restaurant_id: restaurantId,
          ...args,
          p_limit: 10,
        }),
        supabase.rpc("restaurant_analytics_categories", { p_restaurant_id: restaurantId, ...args }),
        supabase.rpc("restaurant_analytics_tables", { p_restaurant_id: restaurantId, ...args }),
        supabase.rpc("restaurant_analytics_payment_methods", {
          p_restaurant_id: restaurantId,
          ...args,
        }),
        // Fuso da casa: `restaurants` tem RLS por tenant, então o membro lê a
        // própria linha direto — sem RPC nova só para 3 colunas.
        supabase.from("restaurants").select("timezone").eq("id", restaurantId).maybeSingle(),
      ]);

    if (summary.error || !summary.data) return null;

    const summaryRow = (Array.isArray(summary.data) ? summary.data[0] : summary.data) as
      | Record<string, unknown>
      | undefined;
    // Membro de outra casa recebe zero linhas, não erro: o resumo vazio é o
    // sinal de "sem acesso". `null` aqui vira a tela de erro, que não revela
    // se a casa existe.
    if (!summaryRow) return null;

    const prevRow = (Array.isArray(previous.data) ? previous.data[0] : previous.data) as
      | Record<string, unknown>
      | undefined;

    const previousValue: AnalyticsPrevious = prevRow
      ? {
          from_date: str(prevRow.from_date).slice(0, 10),
          to_date: str(prevRow.to_date).slice(0, 10),
          orders_count: toNumber(prevRow.orders_count),
          orders_value: toNumber(prevRow.orders_value),
          paid_value: toNumber(prevRow.paid_value),
          ticket_average: toNumber(prevRow.ticket_average),
          has_data: prevRow.has_data === true,
        }
      : {
          from_date: "",
          to_date: "",
          orders_count: 0,
          orders_value: 0,
          paid_value: 0,
          ticket_average: 0,
          has_data: false,
        };

    const tz = str((timezone.data as { timezone?: string } | null)?.timezone);

    return {
      summary: normalizeSummary(summaryRow, preset),
      previous: previousValue,
      daily: ((daily.data ?? []) as Array<Record<string, unknown>>).map(
        (row): AnalyticsDay => ({
          day: str(row.day).slice(0, 10),
          orders_count: toNumber(row.orders_count),
          orders_value: toNumber(row.orders_value),
          paid_value: toNumber(row.paid_value),
          cancelled_count: toNumber(row.cancelled_count),
        }),
      ),
      hours: ((hours.data ?? []) as Array<Record<string, unknown>>).map(
        (row): AnalyticsHour => ({
          hour: toNumber(row.hour),
          orders_count: toNumber(row.orders_count),
          orders_value: toNumber(row.orders_value),
        }),
      ),
      products: ((products.data ?? []) as Array<Record<string, unknown>>).map(
        (row): AnalyticsProduct => ({
          product_name: str(row.product_name),
          quantity: toNumber(row.quantity),
          revenue: toNumber(row.revenue),
        }),
      ),
      categories: ((categories.data ?? []) as Array<Record<string, unknown>>).map(
        (row): AnalyticsCategory => ({
          category_id: (row.category_id as string | null) ?? null,
          category_name: str(row.category_name) || "Sem categoria",
          quantity: toNumber(row.quantity),
          revenue: toNumber(row.revenue),
        }),
      ),
      tables: ((tables.data ?? []) as Array<Record<string, unknown>>).map(
        (row): AnalyticsTable => ({
          table_id: str(row.table_id),
          table_name: str(row.table_name),
          orders_count: toNumber(row.orders_count),
          orders_value: toNumber(row.orders_value),
        }),
      ),
      methods: ((methods.data ?? []) as Array<Record<string, unknown>>).map(
        (row): AnalyticsPaymentMethod => ({
          method: (row.method as PaymentMethod) ?? "other",
          payments_count: toNumber(row.payments_count),
          amount: toNumber(row.amount),
        }),
      ),
      timeZone: tz || "America/Sao_Paulo",
    };
  },
);

/** Pagamentos de um pedido, para o detalhe no painel. */
export async function listOrderPayments(orderId: string): Promise<OrderPayment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_order_payments", { p_order_id: orderId });
  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map((row) => ({
    payment_id: str(row.payment_id),
    amount: toNumber(row.amount),
    method: (row.method as PaymentMethod) ?? "other",
    status: (row.status as OrderPayment["status"]) ?? "paid",
    paid_at: str(row.paid_at),
    note: (row.note as string | null) ?? null,
  }));
}

/** Métricas globais do painel master. */
export const getAdminAnalytics = cache(async (days = 30) => {
  const supabase = await createClient();
  const [summary, daily] = await Promise.all([
    supabase.rpc("admin_analytics", { p_days: days }),
    supabase.rpc("admin_analytics_daily", { p_days: days }),
  ]);

  if (summary.error || !summary.data) return null;

  const row = (Array.isArray(summary.data) ? summary.data[0] : summary.data) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;

  return {
    summary: {
      days: toNumber(row.days),
      restaurants_total: toNumber(row.restaurants_total),
      restaurants_active: toNumber(row.restaurants_active),
      restaurants_suspended: toNumber(row.restaurants_suspended),
      restaurants_new: toNumber(row.restaurants_new),
      restaurants_previous: toNumber(row.restaurants_previous),
      orders_total: toNumber(row.orders_total),
      orders_value: toNumber(row.orders_value),
      paid_value: toNumber(row.paid_value),
      orders_cancelled: toNumber(row.orders_cancelled),
      orders_new: toNumber(row.orders_new),
      orders_previous: toNumber(row.orders_previous),
      active_subscriptions: toNumber(row.active_subscriptions),
      trials_now: toNumber(row.trials_now),
      mrr: toNumber(row.mrr),
    },
    daily: ((daily.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      day: str(r.day).slice(0, 10),
      restaurants_new: toNumber(r.restaurants_new),
      orders_count: toNumber(r.orders_count),
      orders_value: toNumber(r.orders_value),
    })),
  };
});
