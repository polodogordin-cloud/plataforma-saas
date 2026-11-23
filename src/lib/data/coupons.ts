"use server-only";

import { createClient } from "@/lib/supabase/server";
import { normalizeCoupon, type Coupon, type CouponDetail } from "@/lib/coupons";
import { toNumber } from "@/lib/loyalty";

/**
 * Leitura de cupons no painel — Etapa 25.
 *
 * Tudo passa pelas RPCs (`list_restaurant_coupons`, `coupon_details`), não por
 * `select` direto: elas conferem `is_restaurant_member` no banco e devolvem
 * `used_count` calculado das redenções. Um select em `coupons` traria a linha
 * sem o uso, e o painel mostraria "0 de 100 usados" para um cupom esgotado.
 */

export type CouponListResult = {
  coupons: Coupon[];
  total: number;
};

export async function listCoupons({
  restaurantId,
  search,
  limit = 50,
  offset = 0,
}: {
  restaurantId: string;
  search?: string | null;
  limit?: number;
  offset?: number;
}): Promise<CouponListResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("list_restaurant_coupons", {
    p_restaurant_id: restaurantId,
    p_search: search?.trim() || null,
    p_limit: limit,
    p_offset: offset,
  });

  if (error || !Array.isArray(data)) return { coupons: [], total: 0 };

  const rows = data as Array<Record<string, unknown>>;

  return {
    total: rows.length > 0 ? toNumber(rows[0]?.total_count) : 0,
    coupons: rows.map(normalizeCoupon),
  };
}

/** Ficha do cupom com os últimos usos. `null` = não existe ou é de outra casa. */
export async function getCouponDetails(
  restaurantId: string,
  couponId: string,
): Promise<CouponDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("coupon_details", {
    p_restaurant_id: restaurantId,
    p_id: couponId,
  });

  if (error || !data || typeof data !== "object") return null;

  const payload = data as Record<string, unknown>;
  const redemptions = Array.isArray(payload.redemptions)
    ? (payload.redemptions as Array<Record<string, unknown>>)
    : [];

  return {
    ...normalizeCoupon(payload),
    redemptions: redemptions.map((row) => ({
      id: String(row.id ?? ""),
      order_id: String(row.order_id ?? ""),
      order_number: toNumber(row.order_number),
      table_name: String(row.table_name ?? ""),
      customer_name: (row.customer_name as string | null) ?? null,
      amount: toNumber(row.amount),
      created_at: String(row.created_at ?? ""),
    })),
  };
}

/**
 * Sugere um código livre para a casa.
 *
 * Chamado pelo botão "gerar" do formulário. Não é obrigatório — o cliente pode
 * digitar o próprio código — e não reserva nada: se outra pessoa criar o mesmo
 * código entre a sugestão e o salvamento, `save_coupon` recusa com
 * `coupon_code_taken` e o formulário mostra "código já existe".
 */
export async function suggestCouponCodeFor(restaurantId: string, name: string): Promise<string | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("generate_coupon_code", {
    p_restaurant_id: restaurantId,
    p_name: name?.trim() || null,
  });

  if (error || typeof data !== "string") return null;
  return data;
}

/**
 * Histórico de cupons usados em um pedido — usado na ficha do pedido do painel.
 *
 * Separado de `getCouponDetails` porque aqui o eixo é o pedido, não o cupom: o
 * dono abre um pedido e quer saber "qual cupom foi usado e quanto abateu".
 */
export async function readOrderCoupon(
  restaurantId: string,
  orderId: string,
): Promise<{ code: string; amount: number } | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("coupon_redemptions")
    .select("code_snapshot, amount")
    .eq("restaurant_id", restaurantId)
    .eq("order_id", orderId)
    .maybeSingle();

  if (error || !data) return null;

  return { code: String(data.code_snapshot), amount: toNumber(data.amount) };
}
