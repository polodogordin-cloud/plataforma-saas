import Link from "next/link";
import { ChevronLeft, Plus } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

/** Cabeçalho compacto das telas internas. */
export function AppHeader({
  title,
  subtitle,
  backHref,
  action,
  showLogo = false,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
  action?: { href: string; label: string; icon?: React.ReactNode };
  showLogo?: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-ink-200/70 bg-white/90 backdrop-blur-lg"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="app-shell flex min-h-14 items-center gap-2 px-4 py-2.5">
        {backHref ? (
          <Link
            href={backHref}
            aria-label="Voltar"
            className="tap-target -ml-2 grid place-items-center rounded-xl text-ink-600 hover:bg-ink-100"
          >
            <ChevronLeft className="size-6" aria-hidden="true" />
          </Link>
        ) : showLogo ? (
          <Logo href="/app" size="sm" withWordmark={false} />
        ) : null}

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[1.05rem] font-semibold leading-tight text-ink-900">
            {title}
          </h1>
          {subtitle && (
            <p className="truncate text-xs text-ink-500">{subtitle}</p>
          )}
        </div>

        {action && (
          <Link
            href={action.href}
            aria-label={action.label}
            className={cn(
              "tap-target inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-600 px-3 text-sm font-semibold text-white",
              "max-[400px]:size-11 max-[400px]:justify-center max-[400px]:px-0",
              "hover:bg-brand-700 active:scale-[0.98] transition-transform",
            )}
          >
            {action.icon ?? <Plus className="size-4.5" aria-hidden="true" />}
            <span className="hidden min-[400px]:inline">{action.label}</span>
          </Link>
        )}
      </div>
    </header>
  );
}
