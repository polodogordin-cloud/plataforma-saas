import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { WhatsappButton } from "@/components/public/whatsapp-button";
import { WhatsappSettingsForm } from "@/components/app/whatsapp-settings-form";

export { React, createRoot, act };

export const components = { WhatsappButton, WhatsappSettingsForm };

export function mount(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return { container, root };
}
