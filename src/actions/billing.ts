"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import type { ActiveRestaurant } from "@/lib/types";
import { isPlatformAdmin } from "@/lib/data/admin";
import { translateBillingError } from "@/lib/billing";

/**
 * Ações de assinatura do painel do restaurante — Etapa 11.
 *
 * Três regras que este arquivo não negocia:
 *
 *   1. **O restaurante vem do servidor** (`getActiveRestaurant`), nunca do
 *      formulário. Mandar outro `restaurantId` no payload não muda de casa.
 *   2. **Só owner/admin mudam plano.** Um `staff` lendo "Meu plano" não vê os
 *      botões, e se chamar a action direto recebe erro — o banco também
 *      confere (`is_restaurant_owner_admin`).
 *   3. **O banco decide o que é possível.** Limite de downgrade, plano
 *      inexistente e trial repetido voltam de `change_plan`; aqui só
 *      traduzimos para português.
 */

export type BillingResult = { ok: true; message: string } | { ok: false; error: string };

type BillingGuard = { restaurant: ActiveRestaurant } | { error: string };

async function requireBillingManager(): Promise<BillingGuard> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { error: "Restaurante não encontrado." };
  if (restaurant.role !== "owner" && restaurant.role !== "admin") {
    return { error: "Apenas o proprietário pode alterar o plano." };
  }
  return { restaurant };
}

const planIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{2,32}$/, "Plano inválido.");

function revalidateBilling() {
  revalidatePath("/app/plano");
  revalidatePath("/app", "layout");
  revalidatePath("/app/configuracoes");
  revalidatePath("/planos");
}

/** Troca de plano sem cobrança (item 5 e 6 do escopo). */
export async function changeMyPlan(input: {
  planId: string;
  interval?: "monthly" | "yearly";
}): Promise<BillingResult> {
  const parsed = planIdSchema.safeParse(input?.planId);
  if (!parsed.success) return { ok: false, error: "Plano inválido." };

  const guard = await requireBillingManager();
  if ("error" in guard) return { ok: false, error: guard.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("change_plan", {
    p_restaurant_id: guard.restaurant.id,
    p_plan_id: parsed.data,
    p_interval: input.interval ?? "monthly",
  });

  if (error) return { ok: false, error: translateBillingError(error.message ?? "") };

  revalidateBilling();

  const status = (data as { status?: string } | null)?.status;
  return {
    ok: true,
    message:
      status === "trial"
        ? "Plano alterado. Você continua no período de teste."
        : "Plano atualizado. A cobrança automática entra em uma próxima etapa.",
  };
}

/** Inicia o teste gratuito (uma vez por casa, prazo vindo da configuração). */
export async function startMyTrial(): Promise<BillingResult> {
  const guard = await requireBillingManager();
  if ("error" in guard) return { ok: false, error: guard.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_trial", {
    p_restaurant_id: guard.restaurant.id,
  });

  if (error) {
    if (error.message?.includes("trial_already_used")) {
      return { ok: false, error: "Este restaurante já usou o período de teste." };
    }
    return { ok: false, error: translateBillingError(error.message ?? "") };
  }

  revalidateBilling();
  const days = data as { trial_end?: string } | null;
  return {
    ok: true,
    message: days?.trial_end
      ? `Teste iniciado até ${new Date(days.trial_end).toLocaleDateString("pt-BR")}.`
      : "Teste iniciado.",
  };
}

/** Cancelamento: mantém acesso até o fim do período registrado. */
export async function cancelMySubscription(formData: FormData): Promise<BillingResult> {
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length > 280) {
    return { ok: false, error: "O motivo pode ter no máximo 280 caracteres." };
  }

  const guard = await requireBillingManager();
  if ("error" in guard) return { ok: false, error: guard.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_subscription", {
    p_restaurant_id: guard.restaurant.id,
    p_reason: reason || null,
  });

  if (error) return { ok: false, error: translateBillingError(error.message ?? "") };

  revalidateBilling();
  return {
    ok: true,
    message: "Assinatura cancelada. Seu acesso continua até o fim do período.",
  };
}

/* -------------------------------------------------------------------------- */
/* Painel master                                                               */
/* -------------------------------------------------------------------------- */

export type AdminPlanResult = { ok: true; message: string } | { ok: false; error: string };

/** Formulário do editor de plano: limites vazios = sem limite. */
const planFormSchema = z.object({
  id: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,32}$/, "Use letras minúsculas, números e hífen (2 a 32)."),
  name: z.string().trim().min(2, "Informe o nome do plano.").max(60, "Nome muito longo."),
  description: z.string().trim().max(280, "Máximo de 280 caracteres."),
  price: z.coerce.number().min(0, "O preço não pode ser negativo.").max(100000, "Preço muito alto."),
  interval: z.enum(["monthly", "yearly"]),
  isActive: z.boolean(),
  position: z.coerce.number().int().min(0).max(999),
  features: z.array(z.string().trim().min(1).max(32)).max(20),
  limits: z.record(z.string(), z.number().int().min(0).nullable()),
});

export async function savePlan(formData: FormData): Promise<AdminPlanResult> {
  if (!(await isPlatformAdmin())) {
    return { ok: false, error: "Você não tem acesso ao painel da plataforma." };
  }

  const limits: Record<string, number | null> = {};
  for (const key of [
    "max_products",
    "max_tables",
    "max_users",
    "max_categories",
    "max_orders_month",
  ]) {
    const raw = String(formData.get(`limit_${key}`) ?? "").trim();
    if (raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, error: "Os limites precisam ser números inteiros não negativos." };
    }
    limits[key] = Math.trunc(value);
  }

  const features = Array.from(
    new Set(
      String(formData.get("features") ?? "")
        .split(/[\s,]+/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  const parsed = planFormSchema.safeParse({
    id: String(formData.get("id") ?? ""),
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    price: String(formData.get("price") ?? "0").replace(",", "."),
    interval: String(formData.get("interval") ?? "monthly"),
    isActive: formData.get("isActive") === "on" || formData.get("isActive") === "true",
    position: String(formData.get("position") ?? "0"),
    features,
    limits,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_plan", {
    p_id: parsed.data.id,
    p_name: parsed.data.name,
    p_description: parsed.data.description || null,
    p_price: parsed.data.price,
    p_interval: parsed.data.interval,
    p_is_active: parsed.data.isActive,
    p_features: parsed.data.features,
    p_limits: parsed.data.limits,
    p_position: parsed.data.position,
  });

  if (error) {
    if (error.message?.includes("invalid_plan_id")) {
      return { ok: false, error: "Identificador do plano inválido." };
    }
    if (error.message?.includes("invalid_limits")) {
      return { ok: false, error: "Os limites precisam ser números não negativos." };
    }
    if (error.message?.includes("admin_forbidden")) {
      return { ok: false, error: "Você não tem acesso ao painel da plataforma." };
    }
    return { ok: false, error: "Não foi possível salvar o plano." };
  }

  revalidatePath("/admin/planos");
  revalidatePath("/planos");
  revalidatePath("/admin/assinaturas");
  return { ok: true, message: "Plano salvo." };
}

export async function togglePlan(id: string, active: boolean): Promise<AdminPlanResult> {
  if (!(await isPlatformAdmin())) {
    return { ok: false, error: "Você não tem acesso ao painel da plataforma." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_toggle_plan", { p_id: id, p_active: active });

  if (error) return { ok: false, error: "Não foi possível alterar o plano." };

  revalidatePath("/admin/planos");
  revalidatePath("/planos");
  return { ok: true, message: active ? "Plano ativado." : "Plano desativado na vitrine." };
}

export async function setSubscription(formData: FormData): Promise<AdminPlanResult> {
  if (!(await isPlatformAdmin())) {
    return { ok: false, error: "Você não tem acesso ao painel da plataforma." };
  }

  const restaurantId = String(formData.get("restaurantId") ?? "");
  const planId = String(formData.get("planId") ?? "");
  const status = String(formData.get("status") ?? "");
  const interval = String(formData.get("interval") ?? "monthly");
  const days = Number(String(formData.get("periodDays") ?? "30"));

  if (!/^[0-9a-f-]{36}$/i.test(restaurantId)) {
    return { ok: false, error: "Restaurante não identificado." };
  }
  if (!["trial", "active", "past_due", "cancelled", "expired", "suspended"].includes(status)) {
    return { ok: false, error: "Status inválido." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_subscription", {
    p_restaurant_id: restaurantId,
    p_plan_id: planId,
    p_status: status,
    p_interval: interval === "yearly" ? "yearly" : "monthly",
    p_period_days: Number.isFinite(days) && days > 0 ? Math.trunc(days) : 30,
  });

  if (error) return { ok: false, error: translateBillingError(error.message ?? "") };

  revalidatePath("/admin/assinaturas");
  revalidatePath("/admin/planos");
  revalidatePath("/admin/restaurantes");
  return { ok: true, message: "Assinatura atualizada." };
}

export async function setPlatformSetting(formData: FormData): Promise<AdminPlanResult> {
  if (!(await isPlatformAdmin())) {
    return { ok: false, error: "Você não tem acesso ao painel da plataforma." };
  }

  const key = String(formData.get("key") ?? "");
  const raw = String(formData.get("value") ?? "");

  if (key !== "trial_days" && key !== "grace_days" && key !== "trial_plan_id") {
    return { ok: false, error: "Configuração desconhecida." };
  }

  const supabase = await createClient();

  // `trial_plan_id` é texto (id do plano); os outros dois são dias.
  let payload: unknown;
  if (key === "trial_plan_id") {
    payload = raw.trim();
  } else {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 365) {
      return { ok: false, error: "Informe um número de dias entre 0 e 365." };
    }
    payload = Math.trunc(value);
  }

  const { error } = await supabase.rpc("admin_set_platform_setting", {
    p_key: key,
    p_value: payload,
  });

  if (error) {
    if (error.message.includes("invalid_setting")) {
      return {
        ok: false,
        error:
          key === "trial_plan_id"
            ? "Escolha um plano ativo."
            : "Informe um número de dias entre 0 e 365.",
      };
    }
    return { ok: false, error: "Não foi possível salvar a configuração." };
  }

  revalidatePath("/admin/planos");
  revalidatePath("/admin/assinaturas");
  revalidatePath("/planos");
  return { ok: true, message: "Configuração salva." };
}

/** Aciona a revisão de trials vencidos e períodos atrasados. */
export async function reviewSubscriptions(): Promise<AdminPlanResult> {
  if (!(await isPlatformAdmin())) {
    return { ok: false, error: "Você não tem acesso ao painel da plataforma." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("run_subscription_review");

  if (error) return { ok: false, error: "Não foi possível revisar as assinaturas." };

  const result = (data ?? {}) as { expired?: number; past_due?: number };
  revalidatePath("/admin/assinaturas");
  return {
    ok: true,
    message: `Revisão concluída: ${result.expired ?? 0} teste(s) expirado(s), ${result.past_due ?? 0} atraso(s).`,
  };
}
