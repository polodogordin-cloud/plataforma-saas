import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WizardHeader, StepSummary } from "@/components/onboarding/wizard-header";
import { SetupProgressCard } from "@/components/onboarding/setup-progress-card";
import {
  StepCategories,
  StepInfo,
  StepProducts,
  StepQr,
  StepSegment,
  StepTables,
  StepTheme,
  StepWhatsapp,
} from "@/components/onboarding/step-content";
import { setupOverview, type ProgressSteps } from "@/lib/onboarding";

/**
 * Entrada de renderização estática do onboarding (Etapa 21).
 *
 * Só os componentes que **não** dependem de ação do servidor ou de `useState`
 * entram aqui: os passos de conteúdo e os blocos de leitura. O wizard completo
 * é client component com `useTransition`/`useRouter` e é coberto por
 * `onboarding-lib.cjs` por análise de fonte — renderizá-lo aqui exigiria
 * simular o roteador inteiro sem ganhar verificação nova.
 */

export const noop = () => {};

export function renderHeader(steps: ProgressSteps) {
  return renderToStaticMarkup(
    React.createElement(WizardHeader, {
      current: "categorias",
      steps,
      onBack: noop,
      canGoBack: true,
    }),
  );
}

export function renderSummary(steps: ProgressSteps) {
  return renderToStaticMarkup(React.createElement(StepSummary, { steps }));
}

export function renderProgressCard(facts: Parameters<typeof setupOverview>[0], onWizard = true) {
  return renderToStaticMarkup(
    React.createElement(SetupProgressCard, {
      overview: setupOverview(facts),
      onWizard,
    }),
  );
}

export function renderInfo() {
  return renderToStaticMarkup(
    React.createElement(StepInfo, {
      name: "Famintos",
      description: "Hambúrguer artesanal",
      logoUrl: null,
      onChange: noop,
      error: null,
    }),
  );
}

export function renderTheme(selected: string | null, segment: "hamburgueria" | null) {
  return renderToStaticMarkup(
    React.createElement(StepTheme, { selected, segment, onSelect: noop }),
  );
}

export function renderSegment() {
  return renderToStaticMarkup(
    React.createElement(StepSegment, { selected: "hamburgueria", onSelect: noop }),
  );
}

export function renderCategories(existing: string[], segment: "hamburgueria" | null) {
  return renderToStaticMarkup(
    React.createElement(StepCategories, {
      segment,
      existing,
      suggested: segment === "hamburgueria" ? ["Hambúrgueres", "Combos", "Bebidas"] : [],
      onApply: noop,
      applyLabel: "Usar configuração sugerida",
    }),
  );
}

export function renderProducts(hasCategories: boolean, productCount: number) {
  return renderToStaticMarkup(
    React.createElement(StepProducts, { hasCategories, productCount }),
  );
}

export function renderTables(tableCount: number) {
  return renderToStaticMarkup(React.createElement(StepTables, { tableCount }));
}

export function renderQr(tableId: string | null) {
  return renderToStaticMarkup(
    React.createElement(StepQr, { tableId, tableName: tableId ? "Mesa 01" : null }),
  );
}

export function renderWhatsapp(configured: boolean) {
  return renderToStaticMarkup(React.createElement(StepWhatsapp, { configured }));
}
