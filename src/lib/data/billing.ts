import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  normalizePlanFeatures,
  normalizePlanLimits,
  type AdminPlanRow,
  type AdminSubscriptionRow,
  type BillingSummary,
  type MySubscription,
  type PlanCatalogEntry,
  type PublicPlansPayload,
  type SubscriptionState,
} from "@/lib/types";

/**
 * Leitura de planos e assinaturas — Etapa 11.
 *
 * Mesma regra da Etapa 10: o painel master **não** lê tabela direto. Tudo passa
 * por RPC `security definer` guardada por `is_platform_admin()`, porque `plans`
 * é pública para leitura e `subscriptions` tem RLS por tenant — deixar o admin
 * consultar `subscriptions` direto exigiria uma policy nova que abriria a
 * tabela para qualquer membro de qualquer casa.
 *
 * O painel do restaurante usa `my_subscription`, que resolve a casa a partir de
 * `auth.uid()`; o `restaurantId` que chega aqui é só um atalho para quem tem
 * mais de uma casa, e o banco confere o vínculo antes de responder.
 */

const toNumber = (value: unknown): number => {
  const parsed = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Normaliza um plano vindo do banco (preço vem como string do PostgREST). */
export function toPlanCatalog(row: Record<string, unknown>): PlanCatalogEntry {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    description: (row.description as string | null) ?? null,
    price: toNumber(row.price ?? row.price_monthly),
    interval: (row.interval ?? row.billing_interval ?? "monthly") as PlanCatalogEntry["interval"],
    features: normalizePlanFeatures(row.features),
    limits: normalizePlanLimits(row.limits),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const toCounter = (value: unknown) => {
  if (!isRecord(value)) return { used: 0, limit: null };
  return {
    used: toNumber(value.used),
    limit: value.limit === null || value.limit === undefined ? null : toNumber(value.limit),
  };
};

/** Assinatura do restaurante logado. `null` quando a RPC recusa. */
export const getMySubscription = cache(
  async (restaurantId?: string): Promise<MySubscription | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("my_subscription", {
      p_restaurant_id: restaurantId ?? null,
    });

    if (error || !isRecord(data)) return null;

    const plan = isRecord(data.plan) ? data.plan : {};
    const usage = isRecord(data.usage) ? data.usage : {};

    return {
      restaurant_id: String(data.restaurant_id ?? ""),
      status: (data.status ?? "expired") as SubscriptionState,
      has_subscription: data.has_subscription === true,
      plan: toPlanCatalog(plan),
      period_start: (data.period_start as string | null) ?? null,
      period_end: (data.period_end as string | null) ?? null,
      trial_start: (data.trial_start as string | null) ?? null,
      trial_end: (data.trial_end as string | null) ?? null,
      cancelled_at: (data.cancelled_at as string | null) ?? null,
      price_snapshot: toNumber(data.price_snapshot),
      trial_days: toNumber(data.trial_days),
      usage: {
        plan_id: String(usage.plan_id ?? plan.id ?? ""),
        plan_name: String(usage.plan_name ?? plan.name ?? ""),
        limits: normalizePlanLimits(usage.limits),
        features: normalizePlanFeatures(usage.features),
        products: toCounter(usage.products),
        tables: toCounter(usage.tables),
        users: toCounter(usage.users),
        categories: toCounter(usage.categories),
        orders_month: toCounter(usage.orders_month),
      },
    };
  },
);

/**
 * Consulta de limite para a UI (botão desabilitado + aviso antes do submit).
 *
 * Não autoriza nada: serve para não deixar o dono preencher um formulário
 * inteiro para receber "limite atingido" no fim. A decisão é do trigger.
 */
export async function getPlanLimitCheck(
  restaurantId: string,
  key: string,
): Promise<{ used: number; limit: number | null; allowed: boolean } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_plan_limit", {
    p_restaurant_id: restaurantId,
    p_key: key,
  });

  if (error || !isRecord(data)) return null;

  return {
    used: toNumber(data.used),
    limit: data.limit === null || data.limit === undefined ? null : toNumber(data.limit),
    allowed: data.allowed === true,
  };
}

/**
 * Recurso liberado no plano?
 *
 * Atalho para o servidor esconder/desabilitar, **nunca** para autorizar: as
 * Server Actions chamam a mesma verificação no banco.
 */
export async function hasPlanFeature(restaurantId: string, feature: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("has_feature", {
    p_restaurant_id: restaurantId,
    p_feature: feature,
  });
  if (error) return false;
  return data === true;
}

/** Vitrine de `/planos` — sem sessão, cliente anônimo. */
export const getPublicPlans = cache(async (): Promise<PublicPlansPayload> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_plans");

  if (error || !isRecord(data)) return { trial_days: 7, trial_plan_id: null, plans: [] };

  const plans = Array.isArray(data.plans) ? data.plans : [];
  return {
    trial_days: toNumber(data.trial_days) || 7,
    trial_plan_id: typeof data.trial_plan_id === "string" ? data.trial_plan_id : null,
    plans: plans.filter(isRecord).map((plan) => toPlanCatalog(plan)),
  };
});

/* -------------------------------------------------------------------------- */
/* Painel master                                                               */
/* -------------------------------------------------------------------------- */

export const listAdminPlans = cache(async (): Promise<AdminPlanRow[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_plans");

  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((row) => ({
    ...toPlanCatalog(row),
    is_active: row.is_active === true,
    position: toNumber(row.position),
    created_at: String(row.created_at ?? ""),
    updated_at: (row.updated_at as string | null) ?? null,
  }));
});

export const getBillingSummary = cache(async (): Promise<BillingSummary | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_billing_summary");

  if (error || !isRecord(data)) return null;

  return {
    plans_total: toNumber(data.plans_total),
    plans_active: toNumber(data.plans_active),
    subscriptions_total: toNumber(data.subscriptions_total),
    trials: toNumber(data.trials),
    active: toNumber(data.active),
    past_due: toNumber(data.past_due),
    cancelled: toNumber(data.cancelled),
    expired: toNumber(data.expired),
    mrr: toNumber(data.mrr),
    trial_days: toNumber(data.trial_days),
    grace_days: toNumber(data.grace_days),
  };
});

export async function listAdminSubscriptions(search?: string): Promise<AdminSubscriptionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_subscriptions", {
    p_search: search?.trim() || null,
  });

  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((row) => ({
    restaurant_id: String(row.restaurant_id ?? ""),
    restaurant_name: String(row.restaurant_name ?? ""),
    restaurant_slug: String(row.restaurant_slug ?? ""),
    plan_id: String(row.plan_id ?? ""),
    plan_name: String(row.plan_name ?? ""),
    price: toNumber(row.price),
    status: (row.status ?? "expired") as SubscriptionState,
    billing_interval: (row.billing_interval ?? "monthly") as AdminSubscriptionRow["billing_interval"],
    current_period_start: (row.current_period_start as string | null) ?? null,
    current_period_end: (row.current_period_end as string | null) ?? null,
    trial_start: (row.trial_start as string | null) ?? null,
    trial_end: (row.trial_end as string | null) ?? null,
    days_left: row.days_left === null || row.days_left === undefined ? null : toNumber(row.days_left),
    cancelled_at: (row.cancelled_at as string | null) ?? null,
    provider: (row.provider as string | null) ?? null,
    external_subscription_id: (row.external_subscription_id as string | null) ?? null,
    subscription_id: (row.subscription_id as string | null) ?? null,
  }));
}

export type PlatformSettings = {
  trial_days: number;
  grace_days: number;
  /** Plano concedido no teste gratuito (null = o banco escolhe o mais barato). */
  trial_plan_id: string | null;
};

/** Configuração global (trial, tolerância e plano do teste) para o admin. */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("platform_settings")
    .select("key, value")
    .in("key", ["trial_days", "grace_days", "trial_plan_id"]);

  if (error || !data) return { trial_days: 7, grace_days: 5, trial_plan_id: null };

  const numbers: Record<string, number> = {};
  let trialPlanId: string | null = null;

  for (const row of data as Array<{ key: string; value: unknown }>) {
    if (row.key === "trial_plan_id") {
      // jsonb string pode chegar como string pura ou como JSON serializado.
      const raw = String(row.value ?? "").replace(/^"|"$/g, "");
      trialPlanId = raw.length > 0 ? raw : null;
      continue;
    }
    // jsonb numérico chega como number; string é aceita por robustez.
    const raw = Number(row.value);
    if (Number.isFinite(raw)) numbers[row.key] = raw;
  }

  return {
    trial_days: numbers.trial_days ?? 7,
    grace_days: numbers.grace_days ?? 5,
    trial_plan_id: trialPlanId,
  };
}
