import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomersList } from "@/components/customers/customers-list";
import { CustomerDetailView } from "@/components/customers/customer-detail";
import { LoyaltySettingsForm } from "@/components/customers/loyalty-settings-form";
import { MyPointsSheet } from "@/components/public/my-points-sheet";
import { DEFAULT_LOYALTY_SETTINGS, CONSENT_TEXT } from "@/lib/loyalty";
import type { Customer, CustomerDetail } from "@/lib/types";

/**
 * Entrada de renderização estática — Etapa 24, parte 3.
 *
 * Renderiza o que o dono e o cliente veem no primeiro paint, sem navegador:
 * lista de clientes, ficha, formulário de pontos e a consulta de saldo no
 * cardápio. É aqui que aparecem os bugs de celular — texto cortado, botão que
 * não existe, número sem formatação, campo sem rótulo.
 */

const customer = (over: Partial<Customer> = {}): Customer => ({
  id: "c1",
  name: "Ana Paula",
  phone: "5585999998888",
  email: null,
  total_orders: 4,
  total_spent: 182.5,
  last_order_at: "2026-11-20T18:30:00Z",
  created_at: "2026-08-01T12:00:00Z",
  points_balance: 120,
  erased_at: null,
  ...over,
});

const initialCustomers: Customer[] = [
  customer(),
  customer({
    id: "c2",
    name: null,
    phone: "558532321010",
    total_orders: 1,
    total_spent: 10,
    last_order_at: "2026-07-01T12:00:00Z",
    points_balance: 0,
  }),
  customer({
    id: "c3",
    name: "João Excluído",
    phone: null,
    email: null,
    erased_at: "2026-11-01T10:00:00Z",
    points_balance: 0,
  }),
];

const listProps = {
  restaurantId: "r1",
  initialCustomers,
  initialTotal: 3,
  programEnabled: true,
  timeZone: "America/Fortaleza",
};

export function renderList(over: Partial<typeof listProps> = {}) {
  return renderToStaticMarkup(React.createElement(CustomersList, { ...listProps, ...over }));
}

export function renderListEmpty() {
  return renderToStaticMarkup(
    React.createElement(CustomersList, {
      ...listProps,
      initialCustomers: [],
      initialTotal: 0,
    }),
  );
}

export function renderListProgramOff() {
  return renderToStaticMarkup(
    React.createElement(CustomersList, { ...listProps, programEnabled: false }),
  );
}

const detail: CustomerDetail = {
  customer: {
    ...customer(),
    birth_date: "1990-03-14",
    consent_at: "2026-08-01T12:00:00Z",
    consent_version: "v1",
    consent_revoked_at: null,
    tags: [],
  },
  balance: 120,
  orders_count: 4,
  first_order_at: "2026-08-01T12:00:00Z",
  last_order_at: "2026-11-20T18:30:00Z",
  orders_per_month: 2,
  entries: [
    {
      id: "l1",
      kind: "earn",
      source: "order",
      delta: 30,
      reference: "1042",
      note: null,
      created_at: "2026-11-20T18:30:00Z",
      order_id: "o1",
    },
    {
      id: "l2",
      kind: "redeem",
      source: "manual",
      delta: -30,
      reference: null,
      note: "Resgate no balcão",
      created_at: "2026-11-10T18:30:00Z",
      order_id: null,
    },
    {
      id: "l3",
      kind: "bonus",
      source: "birthday",
      delta: 50,
      reference: null,
      note: null,
      created_at: "2026-09-02T18:30:00Z",
      order_id: null,
    },
  ],
};

const detailProps = {
  detail,
  loyaltyEnabled: true,
  redeemValue: 0.05,
  birthdayBonus: 100,
  timeZone: "America/Fortaleza",
};

export function renderDetail(over: Partial<typeof detailProps> = {}) {
  return renderToStaticMarkup(React.createElement(CustomerDetailView, { ...detailProps, ...over }));
}

export function renderDetailErased() {
  return renderToStaticMarkup(
    React.createElement(CustomerDetailView, {
      ...detailProps,
      detail: {
        ...detail,
        customer: customer({ name: null, phone: null, erased_at: "2026-11-01T10:00:00Z", points_balance: 0 }),
        entries: [],
        balance: 0,
        orders_count: 1,
      },
    }),
  );
}

export function renderDetailProgramOff() {
  return renderToStaticMarkup(
    React.createElement(CustomerDetailView, { ...detailProps, loyaltyEnabled: false }),
  );
}

export function renderForm(over: Partial<{ enabled: boolean; canEdit: boolean }> = {}) {
  return renderToStaticMarkup(
    React.createElement(LoyaltySettingsForm, {
      initial: {
        ...DEFAULT_LOYALTY_SETTINGS,
        enabled: true,
        signup_bonus: 50,
        birthday_bonus: 100,
        redeem_value: 0.05,
      },
      canEdit: true,
      ...over,
    }),
  );
}

export function renderFormEmpty() {
  return renderToStaticMarkup(
    React.createElement(LoyaltySettingsForm, {
      initial: { ...DEFAULT_LOYALTY_SETTINGS, enabled: false },
      canEdit: true,
    }),
  );
}

const pointsProps = {
  open: true,
  onClose: () => {},
  tableToken: "TOKENA123",
  tableName: "Mesa 01",
  programNote: "1 ponto por R$ 1 · 50 pontos no cadastro",
  redeemValue: 0.05,
};

export function renderPoints(over: Partial<typeof pointsProps> = {}) {
  return renderToStaticMarkup(React.createElement(MyPointsSheet, { ...pointsProps, ...over }));
}

export function renderPointsNoTable() {
  return renderToStaticMarkup(
    React.createElement(MyPointsSheet, { ...pointsProps, tableToken: null }),
  );
}

export const consentText = CONSENT_TEXT;
export const noop = () => {};
