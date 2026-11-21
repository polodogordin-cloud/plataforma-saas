import Link from "next/link";
import { CalendarX2, ClockAlert, CreditCard } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import type { SubscriptionState } from "@/lib/types";
import { formatDate } from "@/lib/utils";

/**
 * Tela mostrada quando a assinatura impede o uso do painel — Etapa 11.
 *
 * Três estados diferentes, três textos diferentes, porque a ação do dono muda:
 *
 *   • `expired`   → o teste ou o período acabou; escolha um plano.
 *   • `cancelled` → ele mesmo cancelou; pode reativar escolhendo de novo.
 *   • `past_due`  → ainda **entra**, mas vê o aviso de regularização.
 *
 * O bloqueio real não é esta tela: o trigger `enforce_subscription_active`
 * recusa inserts de produtos, mesas e categorias, e o cardápio público segue no
 * ar (o cliente no salão não tem culpa da cobrança). Esta tela só explica.
 */
export function SubscriptionNotice({
  restaurantName,
  status,
  periodEnd,
  trialEnd,
}: {
  restaurantName: string | null;
  status: SubscriptionState;
  periodEnd?: string | null;
  trialEnd?: string | null;
}) {
  const expired = status === "expired";
  const deadline = expired ? trialEnd ?? periodEnd : periodEnd;

  return (
    <main className="app-shell flex min-h-dvh flex-col items-center justify-center px-6 py-10 text-center">
      <span
        className={
          expired
            ? "grid size-16 place-items-center rounded-2xl bg-amber-50 text-amber-600"
            : "grid size-16 place-items-center rounded-2xl bg-ink-100 text-ink-600"
        }
      >
        {expired ? (
          <CalendarX2 className="size-8" aria-hidden="true" />
        ) : (
          <ClockAlert className="size-8" aria-hidden="true" />
        )}
      </span>

      <h1 className="mt-4 text-xl font-semibold text-ink-900">
        {expired ? "Seu período de acesso terminou" : "Sua assinatura está cancelada"}
      </h1>

      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-600">
        {expired ? (
          <>
            {restaurantName ? <strong>{restaurantName}</strong> : "Seu restaurante"} ficou fora do
            período de teste{deadline ? ` em ${formatDate(deadline)}` : ""}. Sua casa, seu cardápio e
            seus pedidos <strong>continuam salvos</strong> — nada foi apagado.
          </>
        ) : (
          <>
            O acesso ao painel de {restaurantName ?? "sua casa"} fica pausado enquanto não houver um
            plano ativo. O cardápio público continua no ar e os pedidos seguem chegando.
          </>
        )}
      </p>

      <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
        <ButtonLink href="/planos" size="lg" block>
          <CreditCard className="size-4" aria-hidden="true" />
          Escolher um plano
        </ButtonLink>
        <ButtonLink href="/app/plano" size="md" variant="secondary" block>
          Ver meu plano
        </ButtonLink>
      </div>

      <p className="mt-6 max-w-xs text-xs leading-relaxed text-ink-500">
        Precisa de ajuda com a cobrança? Fale com o suporte da plataforma e informe o nome da casa.
      </p>

      <Link href="/app/configuracoes" className="mt-4 text-xs font-semibold text-ink-600 underline-offset-4 hover:underline">
        Ver configurações da conta
      </Link>
    </main>
  );
}
