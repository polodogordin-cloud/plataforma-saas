import "server-only";

import { createClient } from "@/lib/supabase/server";
import { normalizeSettings, toNumber, type LoyaltySettings } from "@/lib/loyalty";
import type { Customer, CustomerDetail, CustomerPointEntry, CustomerPoints } from "@/lib/types";

/**
 * Leitura de clientes e fidelidade — Etapa 24.
 *
 * ─── Autorização ────────────────────────────────────────────────────────────
 *
 * O `restaurantId` vem sempre de `getActiveRestaurant()` na página, nunca da
 * URL. As RPCs conferem `is_restaurant_member` de novo: mesmo que alguém force
 * um id de outra casa, o banco devolve vazio (`list_*`) ou `null`
 * (`customer_overview`). O parâmetro existe para o banco saber **qual** casa,
 * não para autorizar.
 *
 * ─── Por que RPC e não `select` direto ──────────────────────────────────────
 *
 * O saldo de pontos é `sum(delta)`. Fazer isso no cliente exigiria baixar o
 * extrato inteiro de todo mundo e somar em JavaScript — peso no celular do dono
 * e um saldo que diverge assim que uma página pagina. A RPC soma no banco, onde
 * o índice por cliente existe.
 */

/* -------------------------------------------------------------------------- */
/* Regra da casa                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Regra de fidelidade da casa.
 *
 * Devolve a regra **padrão** quando ainda não existe linha: o dono que nunca
 * abriu a tela não deve ver `undefined` em campo nenhum. Quem decide se o
 * programa existe é `enabled`, e ele nasce `false`.
 */
export async function getLoyaltySettings(restaurantId: string): Promise<LoyaltySettings> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("loyalty_settings")
    .select("enabled, points_per_currency, signup_bonus, birthday_bonus, redeem_value, cashback_percent, program_note")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  return normalizeSettings(data as Record<string, unknown> | null);
}

/* -------------------------------------------------------------------------- */
/* Lista                                                                      */
/* -------------------------------------------------------------------------- */

export type CustomerListResult = {
  customers: Customer[];
  total: number;
};

/**
 * Clientes da casa, com busca e paginação.
 *
 * `total` vem da janela `count(*) over ()` da própria RPC: uma consulta a
 * menos para o painel mostrar "12 de 340 clientes" sem pedir um `count`
 * separado (que é justamente o tipo de consulta que fica lenta quando a base
 * cresce).
 */
export async function listCustomers({
  restaurantId,
  search,
  limit = 50,
  offset = 0,
}: {
  restaurantId: string;
  search?: string | null;
  limit?: number;
  offset?: number;
}): Promise<CustomerListResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("list_restaurant_customers", {
    p_restaurant_id: restaurantId,
    p_search: search?.trim() || null,
    p_limit: limit,
    p_offset: offset,
  });

  if (error || !Array.isArray(data)) return { customers: [], total: 0 };

  const rows = data as Array<Record<string, unknown>>;

  return {
    total: rows.length > 0 ? toNumber(rows[0]?.total_count) : 0,
    customers: rows.map((row) => ({
      id: String(row.id),
      name: (row.name as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      total_orders: toNumber(row.total_orders),
      total_spent: toNumber(row.total_spent),
      last_order_at: (row.last_order_at as string | null) ?? null,
      created_at: String(row.created_at ?? ""),
      points_balance: toNumber(row.points_balance),
      erased_at: (row.erased_at as string | null) ?? null,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Ficha                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Ficha completa do cliente.
 *
 * `null` tanto para cliente inexistente quanto para cliente de outra casa — a
 * RPC não distingue, e a tela mostra "cliente não encontrado" nos dois casos.
 * Distinguir confirmaria a existência de dado alheio.
 */
export async function getCustomerOverview(
  restaurantId: string,
  customerId: string,
): Promise<CustomerDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("customer_overview", {
    p_restaurant_id: restaurantId,
    p_customer_id: customerId,
  });

  if (error || !data || typeof data !== "object") return null;

  const payload = data as Record<string, unknown>;
  const customer = (payload.customer ?? {}) as Record<string, unknown>;
  const entries = Array.isArray(payload.entries) ? (payload.entries as Array<Record<string, unknown>>) : [];

  const rawFrequency = payload.orders_per_month;

  return {
    customer: {
      id: String(customer.id),
      name: (customer.name as string | null) ?? null,
      phone: (customer.phone as string | null) ?? null,
      email: (customer.email as string | null) ?? null,
      total_orders: toNumber(customer.total_orders),
      total_spent: toNumber(customer.total_spent),
      last_order_at: (customer.last_order_at as string | null) ?? null,
      created_at: String(customer.created_at ?? ""),
      points_balance: toNumber(payload.balance),
      erased_at: (customer.erased_at as string | null) ?? null,
      birth_date: (customer.birth_date as string | null) ?? null,
      consent_at: (customer.consent_at as string | null) ?? null,
      consent_version: (customer.consent_version as string | null) ?? null,
      consent_revoked_at: (customer.consent_revoked_at as string | null) ?? null,
      tags: Array.isArray(customer.tags) ? (customer.tags as string[]) : [],
    },
    balance: toNumber(payload.balance),
    orders_count: toNumber(payload.orders_count),
    first_order_at: (payload.first_order_at as string | null) ?? null,
    last_order_at: (payload.last_order_at as string | null) ?? null,
    /*
     * Frequência nula é informação, não ausência de dado: com um pedido só não
     * existe intervalo, e o painel mostra "primeiro pedido". Converter para 0
     * faria o cliente parecer inativo.
     */
    orders_per_month:
      rawFrequency === null || rawFrequency === undefined ? null : toNumber(rawFrequency),
    entries: entries.map((entry) => ({
      id: String(entry.id),
      kind: entry.kind as CustomerPointEntry["kind"],
      source: entry.source as CustomerPointEntry["source"],
      delta: toNumber(entry.delta),
      reference: (entry.reference as string | null) ?? null,
      note: (entry.note as string | null) ?? null,
      created_at: String(entry.created_at ?? ""),
      order_id: (entry.order_id as string | null) ?? null,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Saldo público do cliente                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Saldo de pontos do próprio cliente, pelo token da mesa + telefone.
 *
 * Roda no servidor porque o cliente do cardápio não tem sessão: quem chama é a
 * Server Action `readMyPoints`, que valida o telefone antes.
 */
export async function readCustomerPoints(
  tableToken: string,
  phone: string,
): Promise<CustomerPoints | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("customer_points", {
    p_token: tableToken,
    p_phone: phone,
  });

  if (error || !data || typeof data !== "object") return null;

  const payload = data as Record<string, unknown>;

  return {
    name: (payload.name as string | null) ?? null,
    balance: toNumber(payload.balance),
    enabled: Boolean(payload.enabled),
    program_note: (payload.program_note as string | null) ?? null,
    points_per_currency: toNumber(payload.points_per_currency),
    redeem_value: toNumber(payload.redeem_value),
  };
}

/* -------------------------------------------------------------------------- */
/* Programa público                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Regra de fidelidade para o **cardápio público** (e só para ele).
 *
 * ─── Por que uma função separada ───────────────────────────────────────────
 *
 * `getLoyaltySettings` roda com a sessão do dono e devolve a regra inteira.
 * Aqui não há sessão: quem chama é a página pública, que roda como `anon`. A
 * tabela `loyalty_settings` não tem policy para `anon` (é configuração da casa,
 * não cardápio), então a leitura vai por uma RPC `security definer` que
 * devolve **apenas** o que o cliente precisa para entender o programa:
 * `enabled`, `points_per_currency`, os bônus e o texto.
 *
 * O que fica de fora de propósito: `cashback_percent` (recurso futuro, não deve
 * aparecer como promessa) e qualquer coluna que diga respeito à operação.
 *
 * Devolve `null` quando o programa está desligado — a página não passa adiante
 * um objeto que faria o carrinho mostrar um bloco vazio.
 */
export async function getPublicLoyaltySettings(
  restaurantId: string,
): Promise<LoyaltySettings | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("public_loyalty_settings", {
    p_restaurant_id: restaurantId,
  });

  if (error || !data || typeof data !== "object") return null;

  const settings = normalizeSettings(data as Record<string, unknown>);
  return settings.enabled ? settings : null;
}
