import Link from "next/link";
import { ChevronLeft, ShieldCheck } from "lucide-react";

/**
 * Cabeçalho do painel master.
 *
 * Fundo escuro é intencional: é o sinal visual permanente de "você está na
 * plataforma, não no seu restaurante". O crachá "Plataforma" reforça isso em
 * texto, porque cor sozinha não é acessível.
 */
export function AdminHeader({
  title,
  subtitle,
  backHref,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
}) {
  return (
    <header
      className="sticky top-0 z-30 bg-ink-950 text-white"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="app-shell flex min-h-14 items-center gap-2 px-4 py-2.5">
        {backHref ? (
          <Link
            href={backHref}
            aria-label="Voltar"
            className="tap-target -ml-2 grid place-items-center rounded-xl text-ink-300 hover:bg-white/10"
          >
            <ChevronLeft className="size-6" aria-hidden="true" />
          </Link>
        ) : (
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/10">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-ink-400">
            Plataforma
          </p>
          <h1 className="truncate text-[1.02rem] font-semibold leading-tight">{title}</h1>
          {subtitle && <p className="truncate text-xs text-ink-400">{subtitle}</p>}
        </div>
      </div>
    </header>
  );
}
