import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanCard, FeatureList, SubscriptionBadge, PlanPrice } from "@/components/billing/plan-card";
import { UsageMeter, LimitReachedNotice } from "@/components/billing/usage-meter";
import { SubscriptionNotice } from "@/components/app/subscription-notice";
import type { PlanCatalogEntry } from "@/lib/types";

const profissional: PlanCatalogEntry = {
  id: "profissional",
  name: "Profissional",
  description: "A casa em movimento",
  price: 99.9,
  interval: "monthly",
  features: ["qr_code", "nfc", "waiter_call", "bill_request", "custom_theme"],
  limits: { max_products: 500, max_tables: 50 },
};

export function renderPlanCard(overrides: Partial<PlanCatalogEntry> = {}) {
  return renderToStaticMarkup(
    React.createElement(
      "ul",
      null,
      React.createElement(PlanCard, {
        plan: { ...profissional, ...overrides },
        highlighted: true,
        featuredLabel: "Mais escolhido",
        cta: React.createElement("a", { href: "/criar-conta" }, "Começar agora"),
        footer: React.createElement(
          "dl",
          null,
          React.createElement("div", null, React.createElement("dt", null, "Mesas"), React.createElement("dd", null, "50")),
        ),
      }),
    ),
  );
}

export function renderFeatures(features: string[]) {
  return renderToStaticMarkup(React.createElement(FeatureList, { features }));
}

export function renderBadge(status: Parameters<typeof SubscriptionBadge>[0]["status"]) {
  return renderToStaticMarkup(React.createElement(SubscriptionBadge, { status }));
}

export function renderPrice(price: number, interval: "monthly" | "yearly" = "monthly") {
  return renderToStaticMarkup(React.createElement(PlanPrice, { price, interval }));
}

export function renderMeter(used: number, limit: number | null, label = "Mesas") {
  return renderToStaticMarkup(
    React.createElement(UsageMeter, { label, counter: { used, limit }, hint: limit === null ? "Sem limite neste plano" : undefined }),
  );
}

export function renderLimitNotice() {
  return renderToStaticMarkup(
    React.createElement(LimitReachedNotice, { message: "Seu plano atingiu o limite de mesas." }),
  );
}

export function renderSubscriptionNotice(
  status: "expired" | "cancelled",
  trialEnd: string | null = "2026-03-01T12:00:00Z",
) {
  return renderToStaticMarkup(
    React.createElement(SubscriptionNotice, {
      restaurantName: "Famintos",
      status,
      periodEnd: "2026-03-08T12:00:00Z",
      trialEnd,
    }),
  );
}
