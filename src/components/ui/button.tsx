import { forwardRef } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg" | "sm";

const base =
  "tap-target inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold " +
  "transition-[transform,background-color,box-shadow,opacity] duration-200 ease-[var(--ease-out-soft)] " +
  "active:scale-[0.985] disabled:pointer-events-none disabled:opacity-55 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white shadow-[0_6px_18px_-8px_rgba(15,146,80,0.9)] hover:bg-brand-700",
  secondary:
    "bg-white text-ink-800 border border-ink-200 shadow-[var(--shadow-soft)] hover:bg-ink-50",
  ghost: "bg-transparent text-ink-700 hover:bg-ink-100",
  danger: "bg-red-600 text-white hover:bg-red-700",
};

const sizes: Record<Size, string> = {
  sm: "px-3.5 text-sm min-h-11",  // 44px: alvo de toque mínimo confortável
  md: "px-4 text-[0.95rem] min-h-12",
  lg: "px-5 text-base min-h-[3.25rem]",
};

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, block, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(base, variants[variant], sizes[size], block && "w-full", className)}
      {...props}
    >
      {loading && <Loader2 className="size-4.5 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
});

type ButtonLinkProps = React.ComponentProps<typeof Link> & {
  variant?: Variant;
  size?: Size;
  block?: boolean;
};

export function ButtonLink({
  variant = "primary",
  size = "md",
  block,
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      className={cn(base, variants[variant], sizes[size], block && "w-full", className)}
      {...props}
    >
      {children}
    </Link>
  );
}
