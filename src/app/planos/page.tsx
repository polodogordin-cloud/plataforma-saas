import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { PlanCard } from "@/components/billing/plan-card";
import { getPublicPlans } from "@/lib/data/billing";
import { getSessionUser } from "@/lib/data/restaurants";
import { limitOf } from "@/lib/plan-rules";
import { PLAN_LIMIT_KEYS, PLAN_LIMIT_LABEL } from "@/lib/types";

export const metadata: Metadata = {
  title: "Planos",
  description: "Escolha o plano do seu restaurante: cardápio digital, QR Code, NFC e pedidos na mesa.",
};

export const revalidate = 60;

/**
 * Vitrine de planos — Etapa 11, item 6.
 *
 * Pública de propósito: quem ainda não tem conta precisa ver o preço antes de
 * se cadastrar. Os dados vêm de `public_plans`, que devolve **só** planos
 * ativos e os campos da vitrine (nada de assinatura, nada de uso de cliente).
 *
 * Cards verticais, um por linha no celular; nenhuma tabela de comparação — o
 * escopo proíbe, e tabela de 6 colunas em 320px é ilegível de qualquer jeito.
 */
export default async function PlansPage() {
  const [payload, user] = await Promise.all([getPublicPlans(), getSessionUser()]);
  const { plans, trial_days: trialDays } = payload;

  // Plano do meio em destaque quando há três ou mais — é o que a maioria
  // escolhe, e destacar o mais caro teria o efeito contrário.
  const featuredIndex = plans.length >= 3 ? 1 : -1;

  const ctaHref = user ? "/app/plano" : "/criar-conta";

  return (
    <div className="min-h-dvh bg-ink-50">
      <header className="border-b border-ink-200/80 bg-white">
        <div className="app-shell flex min-h-16 items-center justify-between gap-3 px-4">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-ink-700">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Menuvo
          </Link>
          {!user && (
            <Link href="/entrar" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700">
              Entrar
            </Link>
          )}
        </div>
      </header>

      <main className="app-shell px-4 pb-12 pt-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
            <Sparkles className="size-3.5" aria-hidden="true" />
            {trialDays} dias grátis para testar
          </p>
          <h1 className="mt-3 text-[1.7rem] font-bold leading-tight tracking-tight text-ink-900">
            Um plano para cada tamanho de casa
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-600">
            Comece grátis, cresça quando o salão encher. Sem fidelidade e sem cobrança automática nesta
            versão — a troca é imediata e registrada.
          </p>
        </div>

        {plans.length === 0 ? (
          <p className="mx-auto mt-8 max-w-md rounded-[var(--radius-card)] border border-ink-200 bg-white p-5 text-center text-sm text-ink-500">
            Nenhum plano disponível no momento. Fale com a gente pelo formulário de contato.
          </p>
        ) : (
          <ul className="mx-auto mt-7 flex max-w-2xl flex-col gap-4">
            {plans.map((plan, index) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                highlighted={index === featuredIndex}
                featuredLabel="Mais escolhido"
                cta={
                  <ButtonLink
                    href={ctaHref}
                    block
                    size="lg"
                    variant={index === featuredIndex ? "primary" : "secondary"}
                  >
                    {plan.price <= 0 ? "Começar grátis" : "Começar agora"}
                  </ButtonLink>
                }
                footer={
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-500">
                    {PLAN_LIMIT_KEYS.slice(0, 4).map((key) => (
                      <div key={key}>
                        <dt className="inline">{PLAN_LIMIT_LABEL[key]}: </dt>
                        <dd className="inline font-medium text-ink-700">
                          {limitOf(plan.limits, key) ?? "sem limite"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                }
              />
            ))}
          </ul>
        )}

        <p className="mx-auto mt-8 max-w-md text-center text-xs leading-relaxed text-ink-500">
          Os valores e limites são definidos pela plataforma e podem mudar sem aviso. Já tem conta?{" "}
          <Link href="/app/plano" className="font-semibold text-brand-700">
            Veja seu plano atual
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
