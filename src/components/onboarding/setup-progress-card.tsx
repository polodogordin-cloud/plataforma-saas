import Link from "next/link";
import { ArrowRight, Check, CircleDashed } from "lucide-react";
import type { SetupOverview } from "@/lib/onboarding";
import { displayPercent } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

/**
 * Card de progresso da configuração no dashboard — Etapa 21.
 *
 * ─── Server Component de propósito ─────────────────────────────────────────
 *
 * Isto é leitura pura: nenhum estado, nenhum clique além de navegar. Manter como
 * Server Component significa zero JavaScript no bundle por um card que aparece
 * em toda abertura do painel — e o dono abre o painel muitas vezes por dia.
 *
 * ─── O número ─────────────────────────────────────────────────────────────
 *
 * `Configuração: 85% concluída` vem do checklist, não do wizard. É a diferença
 * entre "passei por seis telas" e "meu restaurante está configurado". O texto
 * ao lado do número muda com o que falta, para o card nunca ser um número sem
 * próxima ação.
 *
 * ─── Dois modos ───────────────────────────────────────────────────────────
 *
 *   • incompleto → card com barra, percentual e a lista do que falta (até 4);
 *   • completo   → uma linha discreta, porque não há mais o que fazer aqui.
 *
 * Só o modo incompleto ocupa espaço nobre no topo do painel.
 */
export function SetupProgressCard({
  overview,
  onWizard,
}: {
  overview: SetupOverview;
  /** `true` quando o wizard ainda não foi concluído: mostra o atalho para ele. */
  onWizard: boolean;
}) {
  const percent = displayPercent(overview.percent);
  const pending = overview.items.filter((item) => !item.done);

  if (pending.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl bg-brand-50 px-3.5 py-2.5 ring-1 ring-inset ring-brand-200/70">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
          <Check className="size-3.5" aria-hidden="true" />
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-brand-900">
          Configuração completa
        </p>
        <span className="shrink-0 text-xs font-semibold text-brand-700">100%</span>
      </div>
    );
  }

  const shown = pending.slice(0, 4);
  const remaining = pending.length - shown.length;

  return (
    <section
      aria-labelledby="config-progresso"
      className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-4 shadow-[var(--shadow-soft)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="config-progresso" className="text-sm font-semibold text-ink-900">
            Configuração: {percent}% concluída
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
            {remaining > 0 || shown.length > 0
              ? `${pending.length} ${pending.length === 1 ? "item falta" : "itens faltam"} para o cardápio ficar redondo.`
              : "Tudo pronto."}
          </p>
        </div>

        {onWizard && (
          <Link
            href="/app/onboarding"
            className="tap-target inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-50 px-2.5 text-xs font-semibold text-brand-800 ring-1 ring-inset ring-brand-200 active:scale-[0.98]"
          >
            Continuar
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>

      {/* Barra: largura proporcional, rótulo acessível com o valor exato. */}
      <div
        role="progressbar"
        aria-valuenow={overview.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progresso da configuração"
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-ink-100"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-700 transition-[width] duration-500"
          style={{ width: `${Math.max(percent, 4)}%` }}
        />
      </div>

      <ul className="mt-3 space-y-1">
        {shown.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition hover:bg-ink-50 active:scale-[0.995]"
            >
              <CircleDashed className="size-4 shrink-0 text-ink-300" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[0.82rem] text-ink-700">
                {item.action}
              </span>
              <ArrowRight className="size-3.5 shrink-0 text-ink-300" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>

      {remaining > 0 && (
        <p className="mt-1 pl-1.5 text-[0.72rem] text-ink-400">
          + {remaining} {remaining === 1 ? "item" : "itens"}
        </p>
      )}

      {overview.readyToPublish && (
        <p className={cn("mt-2.5 rounded-lg bg-brand-50 px-2.5 py-2 text-[0.72rem] leading-relaxed text-brand-800")}>
          O essencial está pronto: você já pode publicar o cardápio e receber
          pedidos. O que falta é refinamento.
        </p>
      )}
    </section>
  );
}
