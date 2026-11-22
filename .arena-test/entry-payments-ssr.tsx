import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PaymentStatusCard, PaymentHistoryList } from "@/components/payments/payment-status-card";
import { PixInstructions } from "@/components/payments/plan-pix-picker";
import { PixStatusBadge } from "@/components/payments/plan-pix-picker";
import { SubscriptionBadge } from "@/components/billing/plan-card";
import type { MyPaymentPanel, PaymentRequestSummary, PixSettings } from "@/lib/types";

export const pixReady: PixSettings = {
  is_active: true,
  is_configured: true,
  recipient_name: "Menuvo Tecnologia ME",
  pix_key: "12.345.678/0001-90",
  pix_key_type: "cnpj",
  instructions: "Envie o comprovante pelo app.",
  qr_code_url: "https://x.supabase.co/storage/v1/object/public/payment-assets/platform/qr.png",
};

const base: MyPaymentPanel = {
  restaurant_id: "rest-1",
  pix: pixReady,
  pending: null,
  history: [],
  subscription: {
    status: "active",
    has_subscription: true,
    plan_id: "profissional",
    period_start: "2026-11-01T00:00:00Z",
    period_end: "2026-12-01T00:00:00Z",
    trial_end: null,
    days_left: 40,
  },
};

const pendingRequest: PaymentRequestSummary = {
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
};

export function renderStatus(over: Partial<MyPaymentPanel> = {}, justConfirmed = false) {
  return renderToStaticMarkup(
    React.createElement(PaymentStatusCard, { panel: { ...base, ...over }, justConfirmed }),
  );
}

export function renderNoPanel() {
  return renderToStaticMarkup(React.createElement(PaymentStatusCard, { panel: null }));
}

export function renderPix(pix: PixSettings = pixReady, amount: number | null = 99.9) {
  return renderToStaticMarkup(
    React.createElement(PixInstructions, { pix, amount, planName: "Profissional" }),
  );
}

export function renderHistory(items: PaymentRequestSummary[]) {
  return renderToStaticMarkup(React.createElement(PaymentHistoryList, { history: items }));
}

export function renderBadge(canView: boolean) {
  return renderToStaticMarkup(
    React.createElement(PixStatusBadge, { pix: canView ? { is_active: true, is_configured: true } : null }),
  );
}

export function renderSubscriptionBadge(status: "active" | "trial" | "expired") {
  return renderToStaticMarkup(React.createElement(SubscriptionBadge, { status }));
}

export const fixtures = { base, pendingRequest, pixReady };
