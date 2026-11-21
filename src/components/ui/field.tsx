"use client";

import { forwardRef, useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Moldura compartilhada de input.
 * O <input> fica transparente e sem borda para nunca duplicar a borda do wrapper.
 */
function FieldFrame({
  id,
  label,
  hint,
  error,
  prefix,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  prefix?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink-700">
        {label}
        {required && (
          <span className="ml-0.5 text-brand-600" aria-hidden="true">
            *
          </span>
        )}
      </label>

      <div
        className={cn(
          "flex min-h-12 items-center rounded-xl border bg-white transition",
          "focus-within:ring-4",
          error
            ? "border-red-400 focus-within:border-red-500 focus-within:ring-red-100"
            : "border-ink-200 focus-within:border-brand-500 focus-within:ring-brand-100",
        )}
      >
        {prefix && (
          <span
            className="shrink-0 select-none pl-3.5 text-sm text-ink-400"
            aria-hidden="true"
          >
            {prefix}
          </span>
        )}
        {children}
      </div>

      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-ink-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const inputStyles =
  "min-w-0 flex-1 rounded-xl bg-transparent px-3.5 py-3 text-ink-900 placeholder:text-ink-400 " +
  "focus:outline-none focus-visible:outline-none disabled:text-ink-500 disabled:cursor-not-allowed";

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
  /** Prefixo visual, ex.: "menuvo.app/" */
  prefix?: string;
};

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, prefix, className, id, type = "text", ...props },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;

  return (
    <FieldFrame
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      prefix={prefix}
      required={props.required}
    >
      <input
        ref={ref}
        id={fieldId}
        type={type}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(inputStyles, className)}
        {...props}
      />
    </FieldFrame>
  );
});

type PasswordFieldProps = Omit<FieldProps, "type">;

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField({ label, hint, error, className, id, ...props }, ref) {
    const autoId = useId();
    const fieldId = id ?? autoId;
    const [visible, setVisible] = useState(false);
    const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;

    return (
      <FieldFrame
        id={fieldId}
        label={label}
        hint={hint}
        error={error}
        required={props.required}
      >
        <input
          ref={ref}
          id={fieldId}
          type={visible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(inputStyles, "pr-1", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
          aria-pressed={visible}
          className="tap-target mr-1 grid w-11 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:text-ink-700"
        >
          {visible ? (
            <EyeOff className="size-[1.15rem]" aria-hidden="true" />
          ) : (
            <Eye className="size-[1.15rem]" aria-hidden="true" />
          )}
        </button>
      </FieldFrame>
    );
  },
);

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  error?: string;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ label, hint, error, className, id, ...props }, ref) {
    const autoId = useId();
    const fieldId = id ?? autoId;
    const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;

    return (
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={fieldId} className="block text-sm font-medium text-ink-700">
            {label}
          </label>
          {props.maxLength && (
            <span className="text-xs tabular-nums text-ink-400">
              máx. {props.maxLength} caracteres
            </span>
          )}
        </div>
        <textarea
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "w-full rounded-xl border bg-white px-3.5 py-3 text-ink-900 placeholder:text-ink-400 transition focus:outline-none focus:ring-4",
            error
              ? "border-red-400 focus:border-red-500 focus:ring-red-100"
              : "border-ink-200 focus:border-brand-500 focus:ring-brand-100",
            "resize-y",
            className,
          )}
          {...props}
        />
        {error ? (
          <p id={`${fieldId}-error`} role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : hint ? (
          <p id={`${fieldId}-hint`} className="text-sm text-ink-500">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
