"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Seção expansível da configuração de impressão.
 *
 * O escopo pede "cards e seções expansíveis; evitar formulários enormes" no
 * celular. A impressão tem quatro blocos (modo, papel, perfis, impressoras) e
 * empilhar tudo aberto faz o dono rolar três telas sem achar o que procura.
 *
 * `<details>` nativo em vez de estado do React: funciona sem JavaScript, o
 * navegador cuida do foco e do teclado, e o conteúdo continua no DOM para o
 * Ctrl+F do navegador achar. O estado controlado é usado só para saber o que
 * está aberto — nunca para esconder conteúdo de quem não tem JS.
 */
export function CollapsibleSection({
  title,
  description,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  description?: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-[var(--shadow-soft)]">
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-[0.95rem] font-semibold text-ink-900">{title}</span>
              {badge}
            </span>
            {description && (
              <span className="mt-0.5 block text-xs leading-snug text-ink-500">{description}</span>
            )}
          </span>
          <ChevronDown
            className={cn(
              "size-5 shrink-0 text-ink-400 transition-transform duration-200",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
        </summary>

        <div className="space-y-4 border-t border-ink-100 px-4 pb-4 pt-4">{children}</div>
      </details>
    </section>
  );
}

/**
 * Segmento de escolha única (papel 58/80, modo manual/automático).
 *
 * Botões grandes em vez de `<select>` ou rádio: são duas ou três opções e o
 * alvo de 48px importa mais que a economia de espaço.
 */
export function SegmentedChoice<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: T;
  options: Array<{ value: T; label: string; description?: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-ink-700">{label}</p>
      {hint && <p className="mt-0.5 text-xs leading-snug text-ink-500">{hint}</p>}

      <div
        role="radiogroup"
        aria-label={label}
        className="mt-2 grid gap-2"
        style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 2)}, minmax(0, 1fr))` }}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                "min-h-12 rounded-xl border px-3 py-2 text-left transition-colors",
                "disabled:opacity-55",
                selected
                  ? "border-brand-600 bg-brand-50 ring-2 ring-brand-200"
                  : "border-ink-200 bg-white hover:bg-ink-50",
              )}
            >
              <span
                className={cn(
                  "block text-sm font-semibold",
                  selected ? "text-brand-800" : "text-ink-800",
                )}
              >
                {option.label}
              </span>
              {option.description && (
                <span className="mt-0.5 block text-[0.7rem] leading-snug text-ink-500">
                  {option.description}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Linha de texto auxiliar com rótulo, no padrão dos formulários do painel. */
export function InfoRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl bg-ink-50 px-3 py-2.5">
      <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-ink-900">{value}</p>
      {hint && <p className="mt-0.5 text-[0.7rem] leading-snug text-ink-500">{hint}</p>}
    </div>
  );
}
