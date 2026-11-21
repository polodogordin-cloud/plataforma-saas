"use client";

import { useEffect, useId, useState } from "react";
import { Check } from "lucide-react";
import { contrastRatio, normalizeHex } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * Seletor de cor para o celular.
 *
 * Três formas de escolher, na mesma linha, porque cada uma serve a um momento:
 *
 *  1. **swatch** (`<input type="color">`) — o seletor nativo do sistema, que no
 *     iPhone e no Android já é grande, acessível e familiar;
 *  2. **hex** — para quem tem a cor da marca anotada e quer digitar;
 *  3. **sugestões** — cinco variações do tema atual, para quem não quer pensar
 *     em código de cor nenhum.
 *
 * O campo de texto tem **estado local**: enquanto o que está digitado não
 * fecha em `#rrggbb`, o texto fica na tela mas **não** sobe para o tema. Sem
 * isso, apagar um dígito mandaria "#ff" para o preview (preto) e para o botão
 * de salvar — o rascunho precisa ser sempre um tema válido, senão o banco
 * recusa e o dono não entende o motivo.
 */
export function ColorField({
  label,
  hint,
  value,
  onChange,
  suggestions = [],
  /** Cor de fundo para o aviso de contraste (só o campo de texto usa). */
  contrastAgainst,
  contrastLabel,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  suggestions?: string[];
  contrastAgainst?: string;
  contrastLabel?: string;
}) {
  const id = useId();
  const [text, setText] = useState(() => (normalizeHex(value) ?? "").replace("#", "").toUpperCase());
  const [invalid, setInvalid] = useState(false);

  // Sugestões repetidas (o preset e o valor atual, por exemplo) viram uma só:
  // duas bolinhas idênticas confundem e quebram a identidade da lista.
  const swatches = suggestions.filter(
    (color, index) =>
      suggestions.findIndex(
        (other) => (normalizeHex(other) ?? "").toLowerCase() === (normalizeHex(color) ?? "").toLowerCase(),
      ) === index,
  );

  // Mudança vinda de fora (preset aplicado, reset): o campo acompanha.
  useEffect(() => {
    const normalized = normalizeHex(value);
    if (normalized) {
      setText(normalized.replace("#", "").toUpperCase());
      setInvalid(false);
    }
  }, [value]);

  const contrast =
    contrastAgainst && contrastLabel
      ? contrastRatio(normalizeHex(value) ?? "#000000", contrastAgainst)
      : null;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={`${id}-hex`} className="text-sm font-medium text-ink-700">
          {label}
        </label>
        {contrast !== null && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[0.7rem] font-bold",
              contrast >= 4.5
                ? "bg-brand-50 text-brand-700"
                : contrast >= 3
                  ? "bg-amber-50 text-amber-800"
                  : "bg-red-50 text-red-700",
            )}
          >
            {contrastLabel} {contrast.toFixed(1)}:1
          </span>
        )}
      </div>

      <div className="flex items-stretch gap-2">
        {/* Seletor nativo. O input é invisível mas ocupa o quadrado todo: o
            alvo de toque é o quadrado, não o pontinho do color picker. */}
        <div className="relative size-12 shrink-0 overflow-hidden rounded-xl border border-ink-200 shadow-sm">
          <span
            className="absolute inset-0"
            style={{ backgroundColor: normalizeHex(value) ?? "#000000" }}
            aria-hidden="true"
          />
          <input
            type="color"
            aria-label={`Escolher ${label.toLowerCase()}`}
            value={normalizeHex(value) ?? "#000000"}
            onChange={(event) => onChange(event.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
          <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-black/10" />
        </div>

        <div className="flex min-h-12 min-w-0 flex-1 items-center rounded-xl border border-ink-200 bg-white px-3 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
          <span className="select-none pr-1 text-sm text-ink-400" aria-hidden="true">
            #
          </span>
          <input
            id={`${id}-hex`}
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={7}
            value={text}
            aria-invalid={invalid || undefined}
            aria-describedby={
              invalid ? `${id}-invalid` : hint ? `${id}-hint` : undefined
            }
            onChange={(event) => {
              const raw = event.target.value.replace(/[^0-9a-fA-F]/g, "").toUpperCase().slice(0, 6);
              setText(raw);

              const candidate = normalizeHex(raw);
              if (candidate) {
                setInvalid(false);
                onChange(candidate);
              } else {
                setInvalid(true);
              }
            }}
            onBlur={() => {
              // Ao sair do campo com valor incompleto, volta para a cor válida
              // atual em vez de deixar um texto vermelho órfão.
              if (invalid) {
                setText((normalizeHex(value) ?? "").replace("#", "").toUpperCase());
                setInvalid(false);
              }
            }}
            className="min-w-0 flex-1 bg-transparent py-3 font-mono text-sm uppercase tracking-wider text-ink-900 placeholder:text-ink-400 focus:outline-none"
          />
        </div>
      </div>

      {invalid ? (
        <p id={`${id}-invalid`} role="alert" className="text-xs font-medium text-amber-700">
          Cor incompleta. Use 6 dígitos, por exemplo FF8A00.
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-ink-500">
            {hint}
          </p>
        )
      )}

      {swatches.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Sugestões para ${label}`}>
          {swatches.map((color) => {
            const isActive =
              (normalizeHex(value) ?? "").toLowerCase() === (normalizeHex(color) ?? "").toLowerCase();
            return (
              <button
                key={color}
                type="button"
                onClick={() => onChange(color)}
                aria-label={`Usar ${color}`}
                aria-pressed={isActive}
                className={cn(
                  "grid size-9 place-items-center rounded-lg ring-1 ring-inset transition",
                  isActive ? "ring-2 ring-ink-900" : "ring-black/10",
                )}
                style={{ backgroundColor: color }}
              >
                {isActive && (
                  <Check
                    className="size-4"
                    style={{ color: contrastRatio(color, "#ffffff") > 3 ? "#fff" : "#14161c" }}
                    aria-hidden="true"
                    strokeWidth={3}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
