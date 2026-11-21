import React from "react";
import * as ReactDOMClient from "react-dom/client";
import { RestaurantList } from "@/components/admin/restaurant-list";
import { MembersSection } from "@/components/admin/members-section";
import { RestaurantEditForm } from "@/components/admin/restaurant-edit-form";
import { RestaurantActions } from "@/components/admin/restaurant-actions";
import { AdminNav } from "@/components/admin/admin-nav";
import { MetricCard } from "@/components/admin/metric-card";
import { RestaurantStatusBadge } from "@/components/admin/status-badge";
import { MenuUnavailable } from "@/components/public/menu-unavailable";
import { SuspendedNotice } from "@/components/app/suspended-notice";
import type { AdminRestaurantMember, AdminRestaurantRow, Plan, Restaurant } from "@/lib/types";
// Mesma instância do módulo que o bundle usa: se o harness importasse o stub
// por fora, leria um segundo módulo e `__calls()` viria sempre vazio.
import * as adminActions from "@/actions/admin";

export { adminActions };

const rows: AdminRestaurantRow[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Famintos",
    slug: "famintos",
    status: "published",
    phone: "11999990000",
    created_at: "2026-01-15T12:00:00Z",
    products_count: 12,
    tables_count: 8,
    members_count: 2,
    orders_count: 140,
    owner_name: "Ana Souza",
    owner_email: "ana@famintos.test",
    plan_id: "free",
    subscription_status: "none",
    suspended_reason: null,
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Açaí do Bairro",
    slug: "acai-do-bairro",
    status: "suspended",
    phone: "11888887777",
    created_at: "2026-02-20T12:00:00Z",
    products_count: 3,
    tables_count: 0,
    members_count: 1,
    orders_count: 2,
    owner_name: "Bruno Lima",
    owner_email: "bruno@acai.test",
    plan_id: "pro",
    subscription_status: "past_due",
    suspended_reason: "Pendência de pagamento",
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    name: "Pizzaria Napoli",
    slug: "pizzaria-napoli",
    status: "paused",
    phone: null,
    created_at: "2026-03-01T12:00:00Z",
    products_count: 0,
    tables_count: 2,
    members_count: 1,
    orders_count: 0,
    owner_name: null,
    owner_email: null,
    plan_id: "free",
    subscription_status: "none",
    suspended_reason: null,
  },
];

const members: AdminRestaurantMember[] = [
  {
    user_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: "ana@famintos.test",
    full_name: "Ana Souza",
    role: "owner",
    status: "active",
    created_at: "2026-01-15T12:00:00Z",
  },
  {
    user_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    email: "carla@famintos.test",
    full_name: "Carla Dias",
    role: "manager",
    status: "invited",
    created_at: "2026-02-01T12:00:00Z",
  },
];

const plans: Plan[] = [
  { id: "free", name: "Grátis", description: "Para começar", price_monthly: 0, features: ["Cardápio"], is_active: true, position: 0 },
  { id: "pro", name: "Pro", description: "Movimento alto", price_monthly: 0, features: ["Tudo"], is_active: true, position: 1 },
];

const restaurant: Restaurant = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Famintos",
  slug: "famintos",
  logo_url: null,
  description: "Hambúrguer artesanal",
  phone: "11999990000",
  address_line: null,
  address_number: null,
  district: null,
  city: "Fortaleza",
  state: "CE",
  postal_code: null,
  status: "published",
  timezone: "America/Fortaleza",
  currency: "BRL",
  settings: {},
  plan_id: "free",
  subscription_status: "none",
  created_at: "2026-01-15T12:00:00Z",
  updated_at: "2026-01-15T12:00:00Z",
};

export const components = {
  RestaurantList,
  MembersSection,
  RestaurantEditForm,
  RestaurantActions,
  AdminNav,
  MetricCard,
  RestaurantStatusBadge,
  MenuUnavailable,
  SuspendedNotice,
};

export const fixtures = { rows, members, plans, restaurant };

/**
 * Monta `element` em um container novo e devolve o `root` + o container.
 * Usar `createRoot` uma vez por teste evita o aviso de "container já usado".
 */
export function mount(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = ReactDOMClient.createRoot(container);
  root.render(element);
  return { root, container };
}

export { React };
