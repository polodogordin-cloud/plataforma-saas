"use client";

import { Check, ChevronLeft } from "lucide-react";
import { ONBOARDING_STEPS, stepIndex, type OnboardingStepId, type StepState } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

/**
 * Cabeçalho do wizard — Etapa 21.
 *
 * ─── Por que não é uma barra de passos tradicional ─────────────────────────
 *
 * Os assistentes de desktop costumam mostrar oito bolinhas numeradas com nome
 * embaixo. Em 360 px de largura isso vira sopa de letrinhas ilegível, e o dono
 * perde a única informação que importa: **onde estou e quanto falta**.
 *
 * A solução aqui é em duas camadas, cada uma otimizada para um olhar:
 *
 *   1. uma linha de texto grande — `3/8 · Categorias` — que responde a pergunta
 *      em uma leitura, sem decodificar ícone;
 *   2. uma trilha fina de 8 segmentos logo abaixo, colorida por estado, que
 *      responde "quanto falta" por percepção, não por contagem.
 *
 * O texto é a fonte de verdade (está em `<h1>`, com `aria-label` completo); a
 * trilha é `aria-hidden` porque repetir "segmento 3 de 8, concluído" oito vezes
 * no leitor de tela é ruído, não acessibilidade.
 *
 * ─── Botão voltar ─────────────────────────────────────────────────────────
 *
 * O botão voltar é explícito, não só o gesto do navegador: no celular, o "voltar"
 * do sistema sai da página inteira, e o dono perde o wizard. Aqui ele volta uma
 * etapa, com alvo de 44 px.
 */
export function WizardHeader({
  current,
  steps,
  onBack,
  canGoBack,
}: {
  current: OnboardingStepId;
  steps: Partial<Record<OnboardingStepId, StepState>>;
  onBack: () => void;
  canGoBack: boolean;
}) {
  const index = stepIndex(current);
  const step = ONBOARDING_STEPS[index];
  const position = index + 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={!canGoBack}
          aria-label="Voltar para a etapa anterior"
          className={cn(
            "tap-target grid size-11 shrink-0 place-items-center rounded-xl text-ink-600 transition",
            "hover:bg-ink-100 active:scale-95",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-brand-700">
            {position} de {ONBOARDING_STEPS.length}
          </p>
          <h1 className="truncate text-base font-semibold text-ink-900">{step?.label}</h1>
        </div>

        <span className="shrink-0 rounded-full bg-ink-100 px-2.5 py-1 text-[0.7rem] font-semibold text-ink-600">
          {Math.round(
            (ONBOARDING_STEPS.filter((s) => steps[s.id] === "done" || steps[s.id] === "skipped")
              .length /
              ONBOARDING_STEPS.length) *
              100,
          )}
          %
        </span>
      </div>

      {/* Trilha: um segmento por etapa. Concluída/pulada = cheia. */}
      <ol
        aria-hidden="true"
        className="flex gap-1"
      >
        {ONBOARDING_STEPS.map((item, itemIndex) => {
          const state = steps[item.id];
          const resolved = state === "done" || state === "skipped";
          const isCurrent = item.id === current;
          return (
            <li
              key={item.id}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                resolved
                  ? state === "skipped"
                    ? "bg-brand-300"
                    : "bg-brand-600"
                  : isCurrent
                    ? "bg-brand-400"
                    : "bg-ink-200",
              )}
            >
              <span className="sr-only">
                {item.label}: {resolved ? (state === "skipped" ? "pulada" : "concluída") : "pendente"}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="sr-only" aria-live="polite">
        Etapa {position} de {ONBOARDING_STEPS.length}: {step?.label}.{" "}
        {step?.description}
      </p>
    </div>
  );
}

/**
 * Lista de etapas concluídas (para a tela final e para "rever").
 *
 * Separada do cabeçalho porque lá o espaço é escasso — aqui é o resumo em que
 * o dono confere o que fez e o que pulou.
 */
export function StepSummary({
  steps,
  onGoTo,
}: {
  steps: Partial<Record<OnboardingStepId, StepState>>;
  onGoTo?: (id: OnboardingStepId) => void;
}) {
  return (
    <ol className="space-y-1.5">
      {ONBOARDING_STEPS.map((step) => {
        const state = steps[step.id];
        const resolved = state === "done" || state === "skipped";
        return (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => onGoTo?.(step.id)}
              disabled={!onGoTo}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition",
                onGoTo && "hover:bg-ink-50 active:scale-[0.995]",
                !onGoTo && "cursor-default",
              )}
            >
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full text-[0.65rem] font-bold",
                  state === "done"
                    ? "bg-brand-600 text-white"
                    : state === "skipped"
                      ? "bg-brand-100 text-brand-700"
                      : "bg-ink-100 text-ink-400",
                )}
              >
                {state === "done" ? (
                  <Check className="size-3.5" aria-hidden="true" />
                ) : state === "skipped" ? (
                  "–"
                ) : (
                  "•"
                )}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  resolved ? "text-ink-700" : "text-ink-400",
                )}
              >
                {step.label}
              </span>
              <span className="shrink-0 text-[0.68rem] font-medium text-ink-400">
                {state === "done" ? "concluída" : state === "skipped" ? "pulada" : "pendente"}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
