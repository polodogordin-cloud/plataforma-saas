"use client";

import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Botão de envio com estado de carregamento automático. */
export function SubmitButton({
  children,
  className,
  size = "lg",
  pendingLabel,
  ...props
}: {
  children: React.ReactNode;
  className?: string;
  size?: "md" | "lg" | "sm";
  pendingLabel?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children">) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size={size}
      block
      loading={pending}
      className={className}
      {...props}
    >
      {pending ? (pendingLabel ?? "Enviando…") : children}
    </Button>
  );
}

/** Alerta de erro ou sucesso, anunciado por leitores de tela. */
export function FormAlert({
  tone,
  children,
  className,
}: {
  tone: "error" | "success" | "info";
  children: React.ReactNode;
  className?: string;
}) {
  const styles = {
    error: "bg-red-50 text-red-800 ring-red-200",
    success: "bg-brand-50 text-brand-800 ring-brand-200",
    info: "bg-sky-50 text-sky-800 ring-sky-200",
  }[tone];

  const Icon = tone === "error" ? AlertCircle : CheckCircle2;

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live="polite"
      className={cn(
        "flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm leading-relaxed ring-1 ring-inset",
        styles,
        className,
      )}
    >
      <Icon className="mt-0.5 size-4.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
