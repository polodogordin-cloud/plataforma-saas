/**
 * Regras de plano puras — Etapa 11.
 *
 * Este arquivo não fala com o banco nem com o React. É a única tradução entre
 * "jsonb de limites/recursos" e "o que o usuário lê". A razão de existir é que
 * a mesma conta aparece em três lugares (vitrine `/planos`, tela "Meu plano",
 * editor do admin) e três implementações divergiriam na primeira mudança.
 *
 * A regra de autorização **não** mora aqui: `enforce_plan_limit` e
 * `has_feature` rodam no Postgres. O que está abaixo só descreve.
 */

import {
  PLAN_FEATURE_LABEL,
  PLAN_LIMIT_KEYS,
  PLAN_LIMIT_LABEL,
  SUBSCRIPTION_STATE_LABEL,
  isPlanFeatureKey,
  type PlanCatalogEntry,
  type PlanLimitKey,
  type PlanLimits,
  type RestaurantUsage,
  type SubscriptionState,
  type UsageCounter,
} from "@/lib/types";

/** `null` = sem limite. Ausente também é sem limite (plano novo não bloqueia). */
export const limitOf = (limits: PlanLimits, key: PlanLimitKey): number | null => {
  const value = limits[key];
  return value === null || value === undefined ? null : value;
};

/** Fração consumida, de 0 a 1. Sem limite → 0 (barra vazia, nunca cheia). */
export function usageRatio(counter: UsageCounter): number {
  if (counter.limit === null || counter.limit <= 0) return 0;
  return Math.min(1, Math.max(0, counter.used / counter.limit));
}

export const isLimitReached = (counter: UsageCounter): boolean =>
  counter.limit !== null && counter.used >= counter.limit;

/** Avisa só quando está no último slot ou estourou — cedo demais vira ruído. */
export function isLimitWarning(counter: UsageCounter): boolean {
  if (counter.limit === null) return false;
  if (counter.limit === 0) return true;
  return counter.used / counter.limit >= 0.8;
}

/** "12 de 50" ou "12 (sem limite)". */
export function formatUsage(counter: UsageCounter): string {
  if (counter.limit === null) return `${counter.used} · sem limite`;
  return `${counter.used} de ${counter.limit}`;
}

/** Percentual legível para `aria-valuenow` e para o rótulo da barra. */
export function usagePercent(counter: UsageCounter): number {
  return Math.round(usageRatio(counter) * 100);
}

/** Contadores na ordem de exibição. */
/** Mapa chave-do-plano → contador, porque o jsonb e o TS usam nomes diferentes. */
export const USAGE_BY_LIMIT_KEY: Record<PlanLimitKey, keyof RestaurantUsage> = {
  max_products: "products",
  max_tables: "tables",
  max_users: "users",
  max_categories: "categories",
  max_orders_month: "orders_month",
};

export function usageEntries(usage: RestaurantUsage): Array<{
  key: PlanLimitKey;
  label: string;
  counter: UsageCounter;
}> {
  return PLAN_LIMIT_KEYS.map((key) => ({
    key,
    label: PLAN_LIMIT_LABEL[key],
    counter: usage[USAGE_BY_LIMIT_KEY[key]] as UsageCounter,
  }));
}

/** Recursos do plano com rótulo em português, ignorando chave desconhecida. */
export function featureLabels(features: string[]): string[] {
  return features.filter(isPlanFeatureKey).map((key) => PLAN_FEATURE_LABEL[key]);
}

/**
 * Rótulo de um recurso. Chave desconhecida (plano criado por outra versão)
 * aparece crua em vez de sumir: melhor o dono ver `custom_domain_2` na lista do
 * que o card prometer algo que não está escrito em lugar nenhum.
 */
export function featureLabel(key: string): string {
  return isPlanFeatureKey(key) ? PLAN_FEATURE_LABEL[key] : key;
}

/**
 * Preço por extenso, sem depender de Intl duplicado.
 *
 * `formatPrice` vive em `validation.ts` (com moeda); aqui a vitrine precisa de
 * "R$ 99,90 por mês" e de "Grátis" para zero, então a decisão de rótulo fica
 * junto da decisão de sufixo.
 */
export function priceLabel(plan: Pick<PlanCatalogEntry, "price" | "interval">): string {
  if (plan.price <= 0) return "Grátis";
  return plan.interval === "yearly" ? "por ano" : "por mês";
}

/** Texto do botão de CTA da vitrine. */
export function ctaLabel(plan: Pick<PlanCatalogEntry, "price">): string {
  return plan.price <= 0 ? "Começar grátis" : "Começar agora";
}

/**
 * Frase de cobrança negocial — o que a tela "Meu plano" mostra no topo.
 *
 * Separada de `SUBSCRIPTION_STATE_LABEL` porque aqui o texto depende do estado
 * *e* do contexto (trial tem prazo, expirada pede ação).
 */
export function subscriptionHeadline(
  status: SubscriptionState,
  daysLeft: number | null,
): string {
  switch (status) {
    case "trial":
      if (daysLeft === null) return "Você está no período de teste.";
      if (daysLeft <= 0) return "Seu teste termina hoje.";
      return `Seu teste termina em ${daysLeft} ${daysLeft === 1 ? "dia" : "dias"}.`;
    case "active":
      return "Sua assinatura está ativa.";
    case "past_due":
      return "Não conseguimos confirmar o pagamento desta renovação.";
    case "cancelled":
      return "Sua assinatura foi cancelada.";
    case "expired":
      return "Seu período de acesso terminou.";
    case "suspended":
      return "Sua assinatura está suspensa pela plataforma.";
    default:
      return SUBSCRIPTION_STATE_LABEL[status];
  }
}

/** Dias inteiros entre agora e uma data, nunca negativo. */
export function daysUntil(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return null;
  return Math.max(0, Math.ceil((target - now.getTime()) / 86_400_000));
}

/**
 * Diferença entre dois planos, para a tela "Meu plano" explicar o upgrade.
 *
 * Devolve o que **sobe** e o que **desce**, para o dono não descobrir depois
 * que perdeu 40 mesas ao aceitar uma oferta.
 */
export function comparePlans(
  from: PlanCatalogEntry,
  to: PlanCatalogEntry,
): {
  gained: string[];
  lost: string[];
  raisedLimits: PlanLimitKey[];
  loweredLimits: PlanLimitKey[];
} {
  const fromFeatures = new Set(from.features);
  const toFeatures = new Set(to.features);

  const raisedLimits: PlanLimitKey[] = [];
  const loweredLimits: PlanLimitKey[] = [];

  for (const key of PLAN_LIMIT_KEYS) {
    const a = limitOf(from.limits, key);
    const b = limitOf(to.limits, key);
    if (a === null && b === null) continue;
    if (a === null && b !== null) loweredLimits.push(key);
    else if (a !== null && b === null) raisedLimits.push(key);
    else if (a !== null && b !== null) {
      if (b > a) raisedLimits.push(key);
      if (b < a) loweredLimits.push(key);
    }
  }

  return {
    gained: to.features.filter((f) => !fromFeatures.has(f)),
    lost: from.features.filter((f) => !toFeatures.has(f)),
    raisedLimits,
    loweredLimits,
  };
}
