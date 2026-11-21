"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Interruptor acessível (role=switch).
 * A área de toque tem 44px; a pílula visual tem 28px.
 */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className="min-w-0">
        <p className="text-[0.95rem] font-medium text-ink-900">{label}</p>
        {description && <p className="mt-0.5 text-xs leading-snug text-ink-500">{description}</p>}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "tap-target -mr-1 grid h-11 w-14 shrink-0 place-items-center rounded-full",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
          "disabled:opacity-50",
        )}
      >
        <span
          className={cn(
            "flex h-7 w-12 items-center rounded-full transition-colors duration-200",
            checked ? "bg-brand-600" : "bg-ink-300",
          )}
        >
          <span
            className={cn(
              "ml-1 inline-block size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[var(--ease-out-soft)]",
              checked && "translate-x-5",
            )}
          />
        </span>
      </button>
    </div>
  );
}

/** Versão com input hidden, para uso dentro de <form>. */
export function SwitchField({
  name,
  label,
  description,
  defaultChecked = true,
  className,
}: {
  name: string;
  label: string;
  description?: string;
  defaultChecked?: boolean;
  className?: string;
}) {
  return (
    <SwitchFieldInner
      name={name}
      label={label}
      description={description}
      defaultChecked={defaultChecked}
      className={className}
    />
  );
}

function SwitchFieldInner({
  name,
  label,
  description,
  defaultChecked,
  className,
}: {
  name: string;
  label: string;
  description?: string;
  defaultChecked: boolean;
  className?: string;
}) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <>
      <input type="hidden" name={name} value={checked ? "on" : "off"} />
      <Switch
        checked={checked}
        onChange={setChecked}
        label={label}
        description={description}
        className={className}
      />
    </>
  );
}
