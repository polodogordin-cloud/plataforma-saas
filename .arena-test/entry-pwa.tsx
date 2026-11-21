import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { UpdateToast } from "@/components/pwa/update-toast";
import { BottomNav, NAV_ITEMS } from "@/components/app/bottom-nav";

export { React, createRoot, act };

export const components = { InstallPrompt, UpdateToast, BottomNav };
export { NAV_ITEMS };

export function mount(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return { container, root };
}

export const flush = async (times = 3) => {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
};
