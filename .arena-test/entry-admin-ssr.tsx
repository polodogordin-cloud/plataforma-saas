import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MenuUnavailable } from "@/components/public/menu-unavailable";
import { SuspendedNotice } from "@/components/app/suspended-notice";
import { MetricCard } from "@/components/admin/metric-card";
import { RestaurantStatusBadge } from "@/components/admin/status-badge";
import { Store } from "lucide-react";

export function renderMenuUnavailable(reason: "suspended" | "unpublished" | "table", name?: string) {
  return renderToStaticMarkup(
    React.createElement(MenuUnavailable, { reason, restaurantName: name ?? null }),
  );
}

export function renderSuspendedNotice(reason?: string | null) {
  return renderToStaticMarkup(
    React.createElement(SuspendedNotice, {
      restaurantName: "Famintos",
      reason: reason ?? null,
      suspendedAt: "2026-03-01T12:00:00Z",
    }),
  );
}

export function renderMetrics() {
  return renderToStaticMarkup(
    React.createElement(
      "div",
      null,
      React.createElement(MetricCard, {
        label: "Restaurantes",
        value: 3,
        icon: Store,
        href: "/admin/restaurantes",
      }),
      React.createElement(MetricCard, {
        label: "Suspensos",
        value: 1,
        icon: Store,
        href: "/admin/restaurantes?status=suspended",
        tone: "danger",
        hint: "Bloqueados pela plataforma",
      }),
      React.createElement(MetricCard, { label: "Produtos", value: 15, icon: Store }),
    ),
  );
}

export function renderBadges() {
  return renderToStaticMarkup(
    React.createElement(
      "div",
      null,
      ...(["published", "paused", "suspended", "draft"] as const).map((status) =>
        React.createElement(RestaurantStatusBadge, { key: status, status }),
      ),
    ),
  );
}
