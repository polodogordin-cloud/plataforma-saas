"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { couponApplyInputSchema, couponInputSchema } from "@/lib/validation";
import {
  normalizeCoupon,
  normalizeCouponCode,
  type Coupon,
  type CouponValidation,
} from "@/lib/coupons";
import { toNumber } from "@/lib/loyalty";

/**
 * Actions de cupom — Etapa 25.
 *
 * ─── De onde vem o restaurante ────────────────────────────────────────────
 *
 * Nunca do chamador. Nas actions do painel, de `getActiveRestaurant()` (a
 * sessão); na validação do carrinho, do **token da mesa**, resolvido dentro da
 * RPC. Em nenhum caminho existe um parâmetro `restaurantId` que o navegador
 * possa trocar — e mesmo que existisse, a RPC confere o vínculo de novo.
 *
 * ─── O que o cliente pode dizer ───────────────────────────────────────────
 *
 * Só o código e o subtotal que ele está vendo. O desconto nunca chega do
 * cliente: `validate_coupon` recebe subtotal, mas quem calcula o abatimento no
 * envio é `create_order`, com o subtotal recalculado no banco. Um subtotal
 * mentiroso aqui muda a prévia do próprio cliente e nada mais.
 */

export type CouponActionResult =
  | { ok: true; coupon: Coupon }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type ApplyCouponResult =
  | { ok: true; validation: CouponValidation }
  | { ok: false; error: string };

/* ==========================================================================
   Cliente: aplicar cupom no carrinho
   ========================================================================== */

/**
 * Confere o cupom antes do envio — para o cliente ver o desconto e o motivo da
 * recusa sem perder o carrinho.
 *
 * Nada é gravado aqui. Uma recusa não é erro de sistema: é uma resposta
 * ("cupom expirado"), então devolvemos `validation.ok = false` com a frase
 * pronta em vez de `error`.
 */
export async function applyCoupon(input: unknown): Promise<ApplyCouponResult> {
  const parsed = couponApplyInputSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revise o cupom." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("validate_coupon", {
    p_table_token: parsed.data.tableToken,
    p_code: parsed.data.code,
    p_subtotal: parsed.data.subtotal,
    p_customer_phone: parsed.data.customerPhone || null,
    p_ignore_order: null,
  });

  if (error) {
    return { ok: false, error: "Não foi possível conferir o cupom agora." };
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row) {
    return { ok: false, error: "Não foi possível conferir o cupom agora." };
  }

  return {
    ok: true,
    validation: {
      ok: Boolean(row.ok),
      reason: (row.reason as string | null) ?? null,
      coupon_id: (row.coupon_id as string | null) ?? null,
      code: (row.code as string | null) ?? null,
      type: (row.type as CouponValidation["type"]) ?? null,
      value: row.value === null || row.value === undefined ? null : toNumber(row.value),
      amount: toNumber(row.amount),
      min_order_value:
        row.min_order_value === null || row.min_order_value === undefined
          ? null
          : toNumber(row.min_order_value),
    },
  };
}

/* ==========================================================================
   Painel: criar / editar / ativar
   ========================================================================== */

export async function saveCoupon(input: unknown): Promise<CouponActionResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) {
    return { ok: false, error: "Sessão expirada. Entre de novo." };
  }

  const parsed = couponInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Revise os dados do cupom.",
      fieldErrors,
    };
  }

  const data = parsed.data;

  // Percentual acima de 100 é recusado no schema do banco também; aqui é para a
  // mensagem sair no campo certo antes de bater na constraint.
  if (data.discountType === "percentage" && data.discountValue > 100) {
    return {
      ok: false,
      error: "O percentual não pode passar de 100%.",
      fieldErrors: { discountValue: "O percentual não pode passar de 100%." },
    };
  }

  const supabase = await createClient();
  const { data: row, error } = await supabase.rpc("save_coupon", {
    p_restaurant_id: restaurant.id,
    p_id: data.id ?? null,
    p_name: data.name,
    p_code: normalizeCouponCode(data.code) ?? data.code,
    p_description: data.description || null,
    p_discount_type: data.discountType,
    p_discount_value: data.discountType === "free_shipping" ? 0 : data.discountValue,
    p_min_order_value: data.minOrderValue,
    p_max_discount: data.discountType === "percentage" ? (data.maxDiscount ?? null) : null,
    p_starts_at: data.startsAt ?? null,
    p_ends_at: data.endsAt ?? null,
    p_max_uses: data.maxUses ?? null,
    p_max_uses_per_customer: data.maxUsesPerCustomer,
    p_active: data.active,
  });

  if (error) {
    const message = error.message ?? "";

    if (message.includes("coupon_code_taken")) {
      return {
        ok: false,
        error: "Já existe um cupom com esse código nesta casa.",
        fieldErrors: { code: "Código já usado. Escolha outro." },
      };
    }
    if (message.includes("coupon_invalid_code")) {
      return {
        ok: false,
        error: "Código inválido.",
        fieldErrors: { code: "Use de 3 a 24 letras ou números." },
      };
    }
    if (message.includes("coupon_forbidden")) {
      return { ok: false, error: "Você não tem acesso a esta casa." };
    }
    if (error.code === "23514") {
      return { ok: false, error: "Algum valor não é aceito. Revise os campos." };
    }

    return { ok: false, error: "Não foi possível salvar o cupom." };
  }

  if (!row) {
    return { ok: false, error: "Não foi possível salvar o cupom." };
  }

  revalidatePath("/app/marketing/cupons");
  revalidatePath("/app/marketing/cupons/" + String((row as Record<string, unknown>).id ?? ""));

  return { ok: true, coupon: normalizeCoupon(row as Record<string, unknown>) };
}

/**
 * Liga/desliga o cupom. É o toque mais frequente ("acabou a promoção") e não
 * passa pelo formulário inteiro.
 */
export async function setCouponActive(
  couponId: string,
  active: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Sessão expirada. Entre de novo." };

  if (!/^[0-9a-f-]{36}$/i.test(couponId)) {
    return { ok: false, error: "Cupom inválido." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_coupon_active", {
    p_restaurant_id: restaurant.id,
    p_id: couponId,
    p_active: active,
  });

  if (error) return { ok: false, error: "Não foi possível atualizar o cupom." };
  if (!data) return { ok: false, error: "Cupom não encontrado." };

  revalidatePath("/app/marketing/cupons");
  return { ok: true };
}

/** Código livre sugerido a partir do nome. `null` = não foi possível agora. */
export async function generateCouponCode(name: string): Promise<string | null> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("generate_coupon_code", {
    p_restaurant_id: restaurant.id,
    p_name: name?.trim() || null,
  });

  if (error || typeof data !== "string") return null;
  return data;
}
