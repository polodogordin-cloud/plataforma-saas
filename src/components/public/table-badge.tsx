import { Armchair } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Rótulo discreto da mesa, ao lado do nome do restaurante.
 *
 * Não é um banner: o cliente está no salão e já sabe onde está sentado. A
 * função aqui é confirmar que o QR Code abriu a mesa certa — "Mesa 01" e não
 * a mesa do vizinho.
 */
export function TableBadge({
  name,
  variant = "light",
  className,
}: {
  name: string;
  variant?: "light" | "dark";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        variant === "dark"
          ? "bg-white/15 text-white ring-1 ring-inset ring-white/25"
          : "bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-200/70",
        className,
      )}
    >
      <Armchair className="size-3.5" aria-hidden="true" />
      {name}
    </span>
  );
}
