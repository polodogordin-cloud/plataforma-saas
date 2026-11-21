import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/ui/logo";

/**
 * Layout comum das telas de autenticação.
 * Mobile-first: conteúdo em coluna única, largura confortável, respiro no topo.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  backHref,
  backLabel = "Voltar",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <main className="flex min-h-dvh flex-col bg-white">
      <div className="pt-safe">
        <div className="app-shell px-5 pt-5">
          <div className="flex items-center justify-between">
            <Logo href="/" size="sm" />
            {backHref && (
              <Link
                href={backHref}
                className="tap-target inline-flex items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-ink-500 hover:text-ink-800"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                {backLabel}
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="app-shell flex flex-1 flex-col px-5 pb-10 pt-8">
        <header className="animate-fade-in">
          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight text-ink-900">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-500">{subtitle}</p>
          )}
        </header>

        <div className="mt-7 flex-1">{children}</div>

        {footer && <div className="mt-8 text-center text-sm text-ink-500">{footer}</div>}
      </div>
    </main>
  );
}
