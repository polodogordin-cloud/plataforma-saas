import React from "react";
import * as ReactDOMClient from "react-dom/client";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { NotificationBellProvider, NotificationBellSlot } from "@/components/notifications/bell-slot";
import { NotificationPreferencesForm } from "@/components/notifications/notification-preferences-form";
import type { Notification, NotificationPreferenceItem } from "@/lib/notifications";
// Mesma instância do módulo que o bundle usa (ver entry-admin.tsx).
import * as notificationActions from "@/actions/notifications";
// Controle do stub de tempo real: o harness entrega eventos por aqui, na mesma
// instância de módulo que o componente usa (importar o arquivo .ts direto do
// Node não funcionaria e daria uma segunda instância, sem listeners).
import { __control as realtimeControl } from "@/lib/supabase/client";

export { notificationActions };
export { realtimeControl };

export function mount(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = ReactDOMClient.createRoot(container);
  root.render(element);
  return { root, container };
}

export const components = {
  NotificationBell,
  NotificationBellProvider,
  NotificationBellSlot,
  NotificationPreferencesForm,
};

export type { Notification, NotificationPreferenceItem };
