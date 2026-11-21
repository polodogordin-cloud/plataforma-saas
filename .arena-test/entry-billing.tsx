import React from "react";
import * as ReactDOMClient from "react-dom/client";
import { PlanSwitcher, StartTrialButton } from "@/components/billing/plan-switcher";
import { PlanToggle } from "@/components/admin/plan-toggle";
import { TrialSettingsForm } from "@/components/admin/trial-settings";
import { SubscriptionEditor } from "@/components/admin/subscription-editor";
import { UsageMeter, LimitReachedNotice } from "@/components/billing/usage-meter";
import { SubscriptionBadge, PlanCard, FeatureList, PlanPrice } from "@/components/billing/plan-card";
import { ReviewSubscriptionsButton } from "@/components/admin/subscription-review";
import type { PlanCatalogEntry } from "@/lib/types";
// Mesma instância do módulo que o bundle usa (ver entry-admin.tsx).
import * as billingActions from "@/actions/billing";

export { billingActions };

export const plans: PlanCatalogEntry[] = [
  {
    id: "basico",
    name: "Básico",
    description: "Para quem está começando",
    price: 49.9,
    interval: "monthly",
    features: ["qr_code", "waiter_call", "pix"],
    limits: { max_products: 50, max_tables: 10, max_categories: 8, max_users: 3 },
  },
  {
    id: "profissional",
    name: "Profissional",
    description: "A casa em movimento",
    price: 99.9,
    interval: "monthly",
    features: ["qr_code", "nfc", "waiter_call", "bill_request", "custom_theme"],
    limits: { max_products: 500, max_tables: 50, max_categories: 30, max_users: 10 },
  },
  {
    id: "premium",
    name: "Premium",
    description: "Rede ou casa cheia",
    price: 199.9,
    interval: "monthly",
    features: ["qr_code", "nfc", "analytics", "custom_domain"],
    limits: { max_products: null, max_tables: null, max_categories: null, max_users: null },
  },
];

/**
 * Formulário mínimo para exercitar `action` de função.
 *
 * O jsdom não dispara o evento `submit` de um <form action={fn}> do React 19
 * (o handler é registrado para o caminho de hidratação). Este par form/botão
 * reproduz o mesmo contrato com um handler explícito, para o harness poder
 * verificar o FormData que a tela entrega à Server Action.
 */
export function ControlledForm({
  onAction,
  children,
}: {
  onAction: (formData: FormData) => void;
  children: React.ReactNode;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget as HTMLFormElement);
        data.set("key", "trial_days");
        onAction(data);
      }}
    >
      {children}
    </form>
  );
}

export function mount(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = ReactDOMClient.createRoot(container);
  root.render(element);
  return { root, container };
}

export const components = {
  PlanSwitcher,
  StartTrialButton,
  PlanToggle,
  TrialSettingsForm,
  SubscriptionEditor,
  UsageMeter,
  LimitReachedNotice,
  SubscriptionBadge,
  PlanCard,
  FeatureList,
  PlanPrice,
  ReviewSubscriptionsButton,
  ControlledForm,
};

export { React };
