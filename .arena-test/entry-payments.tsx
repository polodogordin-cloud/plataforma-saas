import React from "react";
import * as ReactDOMClient from "react-dom/client";
import { PlanPixPicker, PixInstructions } from "@/components/payments/plan-pix-picker";
import {
  PaymentStatusCard,
  PaymentHistoryList,
  ReceiptUpload,
} from "@/components/payments/payment-status-card";
import { PaymentDetailPanel } from "@/components/payments/payment-detail-panel";
import { PaymentSettingsForm } from "@/components/payments/payment-settings-form";
import type {
  AdminPaymentRequestDetail,
  MyPaymentPanel,
  PlanCatalogEntry,
  PixSettings,
} from "@/lib/types";
// Mesma instância do módulo que o bundle usa (senão o `calls` do teste é outro).
import * as paymentActions from "@/actions/subscription-payments";

export { paymentActions };

export const plans: PlanCatalogEntry[] = [
  {
    id: "basico",
    name: "Básico",
    description: "Para quem está começando",
    price: 49.9,
    interval: "monthly",
    features: ["qr_code", "waiter_call", "pix"],
    limits: { max_products: 50, max_tables: 10 },
  },
  {
    id: "profissional",
    name: "Profissional",
    description: "A casa em movimento",
    price: 99.9,
    interval: "monthly",
    features: ["qr_code", "nfc", "analytics"],
    limits: { max_products: 500, max_tables: 50 },
  },
];

export const pixReady: PixSettings = {
  is_active: true,
  is_configured: true,
  recipient_name: "Menuvo Tecnologia ME",
  pix_key: "pix@menuvo.com.br",
  pix_key_type: "email",
  instructions: "Envie o comprovante e aguarde a conferência.",
  qr_code_url: null,
};

export const pixOff: PixSettings = {
  is_active: false,
  is_configured: false,
  recipient_name: null,
  pix_key: null,
  pix_key_type: null,
  instructions: null,
  qr_code_url: null,
};

export const pendingPanel: MyPaymentPanel = {
  restaurant_id: "rest-1",
  pix: pixReady,
  pending: {
    id: "req-1",
    plan_id: "profissional",
    plan_name: "Profissional",
    amount: 99.9,
    billing_interval: "monthly",
    payment_method: "MANUAL_PIX",
    status: "PENDING",
    receipt_path: null,
    receipt_note: null,
    rejection_reason: null,
    created_at: "2026-11-20T12:00:00Z",
    confirmed_at: null,
  },
  history: [
    {
      id: "req-0",
      plan_id: "basico",
      plan_name: "Básico",
      amount: 49.9,
      billing_interval: "monthly",
      payment_method: "MANUAL_PIX",
      status: "REJECTED",
      receipt_path: null,
      receipt_note: null,
      rejection_reason: "Comprovante ilegível",
      created_at: "2026-10-01T12:00:00Z",
      confirmed_at: null,
    },
  ],
  subscription: {
    status: "trial",
    has_subscription: true,
    plan_id: "profissional",
    period_start: "2026-11-01T00:00:00Z",
    period_end: "2026-11-21T00:00:00Z",
    trial_end: "2026-11-21T00:00:00Z",
    days_left: 1,
  },
};

export const detail: AdminPaymentRequestDetail = {
  id: "req-1",
  restaurant_id: "rest-1",
  restaurant_name: "Famintos",
  restaurant_slug: "famintos",
  requester_name: "Dono A",
  requester_email: "dono@famintos.com",
  plan_id: "profissional",
  plan_name: "Profissional",
  billing_interval: "monthly",
  amount: 99.9,
  payment_method: "MANUAL_PIX",
  status: "PENDING",
  receipt_path: "rest-1/receipts/req-1-abc.pdf",
  receipt_uploaded_at: "2026-11-20T13:00:00Z",
  transaction_reference: null,
  rejection_reason: null,
  created_at: "2026-11-20T12:00:00Z",
  confirmed_at: null,
  period_days: null,
  subscription_id: null,
  confirmed_by_email: null,
  receipt_note: "paguei às 14h",
  notes: null,
  paid_at: null,
  subscription: {
    status: "trial",
    plan_id: "profissional",
    period_start: "2026-11-01T00:00:00Z",
    period_end: "2026-11-21T00:00:00Z",
    trial_end: "2026-11-21T00:00:00Z",
  },
};

export function mount(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = ReactDOMClient.createRoot(container);
  root.render(element);
  return { root, container };
}

export const components = {
  PlanPixPicker,
  PixInstructions,
  PaymentStatusCard,
  PaymentHistoryList,
  ReceiptUpload,
  PaymentDetailPanel,
  PaymentSettingsForm,
};

export { React };
