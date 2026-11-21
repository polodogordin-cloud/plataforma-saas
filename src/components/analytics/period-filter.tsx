"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { validateCustomRange } from "@/lib/analytics";
import { ANALYTICS_PERIODS, type AnalyticsPeriod } from "@/lib/types";

/**
 * Filtro de período — chips + intervalo personalizado.
 *
 * ─── Por que navegação por URL e não `useState` ────────────────────────────
 *
 * O período vive na querystring (`?periodo=last7&de=…&ate=…`). Três motivos:
 *
 *   1. **recarregar mantém o recorte** — o dono que atualiza a página não volta
 *      para "hoje" e não acha que perdeu os dados;
 *   2. o link é compartilhável com o sócio ("olha as vendas do mês passado");
 *   3. o botão "Atualizar dados" (`router.refresh()`) preserva o filtro sem
 *      precisar guardar estado em dois lugares.
 *
 * `useTransition` deixa o chip responder na hora (fica destacado) enquanto o
 * servidor busca — sem isso, o toque parece não ter funcionado e a pessoa toca
 * de novo, disparando outra requisição.
 */

const CHIPS: Array<{ id: AnalyticsPeriod; label: string }> = ANALYTICS_PERIODS.map((p) => ({
  id: p.id,
  label: p.id === "custom" ? "Personalizado" : p.short,
}));

export function PeriodFilter({
  preset,
  from,
  to,
}: {
  preset: AnalyticsPeriod;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [customOpen, setCustomOpen] = useState(preset === "custom");
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [error, setError] = useState<string | null>(null);

  /** Troca só o que mudou — preserva outros parâmetros da URL. */
  const go = (next: { periodo: string; de?: string; ate?: string }) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("periodo", next.periodo);
    if (next.de && next.ate) {
      params.set("de", next.de);
      params.set("ate", next.ate);
    } else {
      params.delete("de");
      params.delete("ate");
    }

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  const onChip = (id: AnalyticsPeriod) => {
    if (id === "custom") {
      // Abre o formulário já preenchido com o período atual: escolher data do
      // zero em duas telas de calendário é atrito desnecessário.
      setCustomOpen((open) => !open);
      return;
    }
    setCustomOpen(false);
    setError(null);
    go({ periodo: id });
  };

  const applyCustom = () => {
    const problem = validateCustomRange(draftFrom, draftTo);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    go({ periodo: "custom", de: draftFrom, ate: draftTo });
  };

  return (
    <div className="space-y-2.5">
      {/*
       * `overflow-x-auto` com `scrollbar-none`: sete chips não cabem em 320px.
       * Rolagem horizontal é melhor que quebrar em três linhas (empurraria o
       * conteúdo para baixo do fold) e melhor que esconder filtros num menu
       * (o dono não descobre que "mês passado" existe).
       */}
      <div
        className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label="Período do relatório"
      >
        <div className="flex w-max items-center gap-1.5">
          {CHIPS.map((chip) => {
            const active = preset === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => onChip(chip.id)}
                aria-pressed={active}
                className={cn(
                  "tap-target inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[0.82rem] font-semibold transition-colors duration-150",
                  active
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-ink-200 bg-white text-ink-600 hover:border-ink-300 active:bg-ink-50",
                )}
              >
                {chip.id === "custom" && <CalendarRange className="size-3.5" aria-hidden="true" />}
                {chip.label}
              </button>
            );
          })}
          {pending && (
            <Loader2 className="ml-1 size-4 shrink-0 animate-spin text-brand-600" aria-hidden="true" />
          )}
        </div>
      </div>

      {customOpen && (
        <div className="card space-y-2.5 p-3.5">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[0.7rem] font-semibold text-ink-500">De</span>
              <input
                type="date"
                value={draftFrom}
                max={draftTo}
                onChange={(event) => setDraftFrom(event.target.value)}
                className="w-full rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-sm text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[0.7rem] font-semibold text-ink-500">Até</span>
              <input
                type="date"
                value={draftTo}
                min={draftFrom}
                onChange={(event) => setDraftTo(event.target.value)}
                className="w-full rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-sm text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </label>
          </div>

          {error && (
            <p role="alert" className="text-xs font-medium text-red-600">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={applyCustom}
            disabled={pending}
            className="tap-target inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-700 active:scale-[0.99] disabled:opacity-60"
          >
            {pending ? "Carregando…" : "Aplicar período"}
          </button>
        </div>
      )}
    </div>
  );
}
