import "server-only";

/**
 * Camada de abstração de pagamento — Etapa 11.
 *
 * **Não existe integração real aqui, e de propósito.** O escopo desta etapa
 * proíbe gateway, e um mock que "funciona" é pior do que nenhum: alguém liga a
 * tela, marca uma casa como paga e descobre meses depois que nada foi cobrado.
 * O que este arquivo entrega é o **contrato** — as seis funções que o escopo
 * pede — mais um provedor `manual` que é honesto sobre o que faz:
 *
 *   • ele não chama a rede;
 *   • não inventa id de gateway (devolve `null` em `external_*`, não "sub_123");
 *   • registra na auditoria que a operação foi manual;
 *   • devolve `requiresProvider: true` para que a tela avise que a cobrança
 *     ainda não existe.
 *
 * Quando Stripe/Mercado Pago/Asaas entrar, o trabalho é:
 *   1. implementar `PaymentProvider` em `lib/billing/<provedor>.ts`;
 *   2. trocar `getPaymentProvider()` por um switch em env;
 *   3. implementar a rota de webhook (`/api/webhooks/<provedor>`) chamando
 *      `handleWebhook`, que **já** sabe traduzir evento → RPC do banco.
 *
 * Regra que vale para qualquer provedor futuro: quem decide o estado da
 * assinatura é o banco (`change_plan`, `start_trial`, `cancel_subscription`,
 * `admin_set_subscription`). O provedor só *pede* a mudança. Assim o gateway
 * nunca vira a fonte de verdade de autorização.
 */

import { createClient } from "@/lib/supabase/server";
import type { BillingInterval, SubscriptionRecord, SubscriptionState } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Contrato                                                                    */
/* -------------------------------------------------------------------------- */

export type BillingCustomer = {
  /** Id no gateway. `null` no provedor manual: não existe conta lá. */
  externalId: string | null;
  email: string | null;
  name: string | null;
};

export type CheckoutSession = {
  /** URL para onde mandar o cliente. `null` = não há cobrança a fazer. */
  url: string | null;
  externalSubscriptionId: string | null;
  /** `true` quando o provedor real ainda não está ligado. */
  requiresProvider: boolean;
  message: string;
};

export type BillingWebhookEvent = {
  type:
    | "subscription.created"
    | "subscription.renewed"
    | "subscription.payment_failed"
    | "subscription.cancelled"
    | "subscription.expired"
    | "unknown";
  externalSubscriptionId: string | null;
  externalCustomerId: string | null;
  /** ISO 8601 quando o provedor informar. */
  currentPeriodEnd: string | null;
  raw?: unknown;
};

export type WebhookResult = {
  handled: boolean;
  status: SubscriptionState | null;
  message: string;
};

/**
 * O que um provedor precisa implementar.
 *
 * Todos os métodos são assíncronos mesmo quando a implementação manual é
 * síncrona: um provedor HTTP não pode ter assinatura diferente.
 */
export type PaymentProvider = {
  readonly id: string;
  readonly label: string;
  /** `false` = não cobra de verdade. A UI usa isso para não prometer nada. */
  readonly live: boolean;
  /**
   * Como o cliente paga, quando existe um caminho sem gateway (Etapa 19).
   *
   * `manual_pix` = a plataforma tem uma chave PIX e confere o recebimento à mão.
   * `none` = não há como pagar por aqui. É um campo descritivo: a tela usa para
   * escolher entre "ver o PIX" e "fale com o suporte" — e **nunca** para
   * concluir que um pagamento aconteceu.
   */
  readonly settlement: "manual_pix" | "none";

  createCustomer(input: {
    restaurantId: string;
    email: string | null;
    name: string;
  }): Promise<BillingCustomer>;

  createSubscription(input: {
    restaurantId: string;
    planId: string;
    interval: BillingInterval;
    customer: BillingCustomer;
    trialDays?: number;
  }): Promise<CheckoutSession>;

  cancelSubscription(input: {
    restaurantId: string;
    subscription: SubscriptionRecord | null;
    immediately?: boolean;
  }): Promise<{ ok: boolean; message: string }>;

  changePlan(input: {
    restaurantId: string;
    subscription: SubscriptionRecord | null;
    planId: string;
    interval: BillingInterval;
  }): Promise<{ ok: boolean; message: string; requiresProvider: boolean }>;

  getSubscriptionStatus(input: {
    subscription: SubscriptionRecord | null;
  }): Promise<{ status: SubscriptionState | null; syncedAt: string }>;

  handleWebhook(event: BillingWebhookEvent): Promise<WebhookResult>;
};

/* -------------------------------------------------------------------------- */
/* Provedor manual (o que existe hoje)                                         */
/* -------------------------------------------------------------------------- */

const NOT_CONFIGURED =
  "A cobrança é manual por PIX nesta versão. Depois do pagamento, o plano é liberado pelo painel da plataforma.";

/**
 * Provedor `manual`: registra a intenção e delega ao banco via RPC.
 *
 * Ele nunca marca uma assinatura como paga sozinho. Quem ativa plano pago é
 * `admin_confirm_payment`, depois do PIX conferido (Etapa 19); `change_plan`
 * só movimenta plano gratuito ou o intervalo do plano em que a casa já está.
 */
export const manualProvider: PaymentProvider = {
  id: "manual",
  label: "Ajuste manual",
  live: false,
  settlement: "none",

  async createCustomer({ restaurantId, email, name }) {
    return { externalId: null, email, name: name || restaurantId };
  },

  async createSubscription({ planId, interval }) {
    return {
      url: null,
      externalSubscriptionId: null,
      requiresProvider: true,
      message: `Plano ${planId} (${interval === "yearly" ? "anual" : "mensal"}) registrado sem cobrança. ${NOT_CONFIGURED}`,
    };
  },

  async cancelSubscription({ subscription }) {
    if (!subscription) {
      return { ok: false, message: "Esta casa não tem assinatura corrente para cancelar." };
    }
    return {
      ok: true,
      message: `Cancelamento registrado. O acesso segue até ${subscription.current_period_end ?? "o fim do período"}. ${NOT_CONFIGURED}`,
    };
  },

  async changePlan({ planId }) {
    return {
      ok: true,
      requiresProvider: true,
      message: `Plano alterado para ${planId}. ${NOT_CONFIGURED}`,
    };
  },

  async getSubscriptionStatus({ subscription }) {
    return {
      status: subscription?.status ?? null,
      syncedAt: new Date().toISOString(),
    };
  },

  async handleWebhook() {
    return {
      handled: false,
      status: null,
      message: "Nenhum provedor de pagamento está configurado: webhooks são ignorados.",
    };
  },
};

/* -------------------------------------------------------------------------- */
/* Provedor PIX manual (Etapa 19)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Provedor `manual_pix`: o cliente paga no PIX da plataforma e uma pessoa
 * confirma.
 *
 * O que ele é: um **caminho de pagamento real** sem gateway. A cobrança
 * acontece (dinheiro entra na conta do dono), e a confirmação é humana —
 * registrada em `payment_requests` + `admin_audit_log`.
 *
 * O que ele **não** é, e por isso `live: false` continua:
 *   • não cria customer/subscription no gateway (não existe gateway);
 *   • não gera checkout URL (a "URL" é a própria tela de pagamento interna);
 *   • não trata webhook — `handleWebhook` devolve `handled: false` com uma
 *     mensagem honesta. Não existe rota falsa de webhook em lugar nenhum.
 *
 * Quando Stripe/MP/Asaas entrar, este provedor continua útil: a maioria das
 * casas brasileiras ainda vai preferir pagar por PIX e ter o comprovante
 * conferido por gente. O escopo da Etapa 19 escolheu exatamente esse caminho.
 */
export const manualPixProvider: PaymentProvider = {
  id: "manual_pix",
  label: "PIX manual",
  live: false,
  settlement: "manual_pix",

  async createCustomer({ restaurantId, email, name }) {
    return { externalId: null, email, name: name || restaurantId };
  },

  async createSubscription({ planId, interval }) {
    return {
      url: null,
      externalSubscriptionId: null,
      // `false` porque não há provedor externo: o "checkout" é a tela interna
      // que mostra a chave PIX. A assinatura só nasce quando alguém confirma.
      requiresProvider: false,
      message: `Solicitação de ${planId} (${interval === "yearly" ? "anual" : "mensal"}) por PIX. Faça o pagamento e aguarde a confirmação da plataforma.`,
    };
  },

  async cancelSubscription({ subscription }) {
    if (!subscription) {
      return { ok: false, message: "Esta casa não tem assinatura corrente para cancelar." };
    }
    return {
      ok: true,
      message: `Cancelamento registrado. O acesso segue até ${subscription.current_period_end ?? "o fim do período"}.`,
    };
  },

  async changePlan({ planId }) {
    return {
      ok: true,
      requiresProvider: true,
      message: `A troca para ${planId} passa por um novo pagamento por PIX e pela confirmação da plataforma.`,
    };
  },

  async getSubscriptionStatus({ subscription }) {
    return {
      status: subscription?.status ?? null,
      syncedAt: new Date().toISOString(),
    };
  },

  async handleWebhook() {
    return {
      handled: false,
      status: null,
      message:
        "PIX manual não envia webhook: a confirmação é feita por um administrador no painel, com auditoria.",
    };
  },
};

/* -------------------------------------------------------------------------- */
/* Seleção do provedor                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Provedor ativo.
 *
 * Lê `PAYMENT_PROVIDER` do ambiente para que a troca seja configuração, não
 * deploy de código. Qualquer valor desconhecido cai no manual — falhar aberto
 * seria pior, mas falhar fechado derrubaria o painel inteiro por um typo de
 * env, e o resultado do manual é "não cobra", que é o estado atual.
 */
export function getPaymentProvider(): PaymentProvider {
  const configured = (process.env.PAYMENT_PROVIDER ?? "manual_pix").trim().toLowerCase();
  switch (configured) {
    // Etapa 19: PIX manual é o caminho ligado por padrão — é o único em que
    // dinheiro entra de verdade hoje. `manual` continua existindo como o modo
    // "sem cobrança" (ajuste direto pelo painel), útil para cortesia/teste.
    case "manual_pix":
    case "pix":
      return manualPixProvider;
    case "manual":
      return manualProvider;
    // case "stripe": return stripeProvider;
    // case "mercadopago": return mercadoPagoProvider;
    // case "asaas": return asaasProvider;
    default:
      return manualPixProvider;
  }
}

/** Conveniência para a UI: existe cobrança real ligada? */
export const isBillingLive = (): boolean => getPaymentProvider().live;

/* -------------------------------------------------------------------------- */
/* Orquestração: provedor → banco                                              */
/* -------------------------------------------------------------------------- */

/**
 * Contrata/realinha um plano.
 *
 * O banco é quem aplica (e valida downgrade, limite, autorização). O provedor
 * só prepara a cobrança. Se o provedor real devolver uma URL de checkout, ela é
 * repassada para a tela redirecionar — nada disso existe no manual.
 */
export async function subscribeToPlan(input: {
  restaurantId: string;
  planId: string;
  interval?: BillingInterval;
}): Promise<{ ok: boolean; message: string; checkoutUrl: string | null }> {
  const provider = getPaymentProvider();

  const session = await provider.createSubscription({
    restaurantId: input.restaurantId,
    planId: input.planId,
    interval: input.interval ?? "monthly",
    customer: { externalId: null, email: null, name: input.restaurantId },
  });

  const supabase = await createClient();
  const { error } = await supabase.rpc("change_plan", {
    p_restaurant_id: input.restaurantId,
    p_plan_id: input.planId,
    p_interval: input.interval ?? "monthly",
  });

  if (error) {
    return {
      ok: false,
      message: translateBillingError(error.message),
      checkoutUrl: null,
    };
  }

  return { ok: true, message: session.message, checkoutUrl: session.url };
}

/** Traduz erro de RPC de plano para texto de tela. */
export function translateBillingError(message: string | undefined): string {
  const raw = message ?? "";
  if (raw.includes("plan_limit_reached")) return "Seu plano atingiu o limite desta ação.";
  if (raw.includes("plan_downgrade_too_small")) {
    const [, key, used, limit] = raw.split(":");
    const nome =
      key === "max_tables"
        ? "mesas"
        : key === "max_products"
          ? "produtos"
          : key === "max_users"
            ? "usuários"
            : key === "max_categories"
              ? "categorias"
              : "itens";
    return `Este plano permite ${limit} ${nome}, mas você tem ${used}. Remova o excedente antes de mudar.`;
  }
  if (raw.includes("invalid_plan")) return "Este plano não está mais disponível.";
  // Etapa 19b: plano pago novo não se ativa por aqui — o caminho é pedir o PIX
  // e esperar a confirmação do master. A mensagem diz para onde ir.
  if (raw.includes("payment_required")) {
    return "Plano pago é liberado depois do pagamento por PIX. Peça o pagamento em \"Meu plano\" e aguarde a confirmação.";
  }
  if (raw.includes("trial_already_used")) return "O período de teste já foi usado por este restaurante.";
  if (raw.includes("subscription_not_found")) return "Não há assinatura ativa para cancelar.";
  if (raw.includes("forbidden") || raw.includes("admin_forbidden")) {
    return "Você não tem permissão para alterar esta assinatura.";
  }
  if (raw.includes("reason_too_long")) return "O motivo pode ter no máximo 280 caracteres.";
  return "Não foi possível alterar a assinatura agora.";
}
