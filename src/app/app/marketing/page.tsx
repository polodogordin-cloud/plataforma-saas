import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Megaphone, TicketPercent, Users } from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { Card } from "@/components/ui/card";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { listCoupons } from "@/lib/data/coupons";
import { listCustomers } from "@/lib/data/loyalty";
import { getLoyaltySettings } from "@/lib/data/loyalty";

export const metadata: Metadata = { title: "Marketing" };

/**
 * Marketing — Etapa 25.
 *
 * Hub curto com o que já existe: cupons (novo), divulgação (Etapa 23) e
 * clientes/fidelidade (Etapa 24). Não é uma tela de navegação nova por gosto —
 * é o nível que faltava: "Cupons" sozinho no menu de Configurações pareceria
 * configuração, quando é ferramenta de venda.
 *
 * As campanhas futuras (por produto, por categoria, combos, happy hour) entram
 * como itens desta lista, desabilitados com o motivo — não como promessa vazia.
 */
export default async function MarketingPage() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const [coupons, customers, loyalty] = await Promise.all([
    listCoupons({ restaurantId: restaurant.id, limit: 100 }),
    listCustomers({ restaurantId: restaurant.id, limit: 1 }),
    getLoyaltySettings(restaurant.id),
  ]);

  const running = coupons.coupons.filter((coupon) => coupon.status === "active").length;

  return (
    <>
      <AppHeader title="Marketing" subtitle={restaurant.name} />

      <main className="app-shell space-y-3 px-4 pb-8 pt-4">
        <Link
          href="/app/marketing/cupons"
          className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-[var(--shadow-soft)] active:scale-[0.995]"
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
            <TicketPercent className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink-900">Cupons</span>
            <span className="block text-xs leading-snug text-ink-500">
              {running > 0
                ? `${running} no ar agora. Desconto validado no servidor.`
                : "Crie códigos de desconto com validade e limite de uso."}
            </span>
          </span>
          <ArrowRight className="size-5 shrink-0 text-ink-400" aria-hidden="true" />
        </Link>

        <Link
          href="/app/clientes"
          className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-[var(--shadow-soft)] active:scale-[0.995]"
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
            <Users className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink-900">Clientes e fidelidade</span>
            <span className="block text-xs leading-snug text-ink-500">
              {customers.total > 0
                ? `${customers.total} ${customers.total === 1 ? "cliente" : "clientes"}${
                    loyalty.enabled ? " · pontos ativos" : " · pontos desativados"
                  }`
                : "Quem voltou, quanto gastou e quantos pontos tem."}
            </span>
          </span>
          <ArrowRight className="size-5 shrink-0 text-ink-400" aria-hidden="true" />
        </Link>

        <Link
          href="/app/divulgar"
          className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-[var(--shadow-soft)] active:scale-[0.995]"
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
            <Megaphone className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink-900">Divulgar o cardápio</span>
            <span className="block text-xs leading-snug text-ink-500">
              Link, QR Code, mensagem para WhatsApp e redes sociais.
            </span>
          </span>
          <ArrowRight className="size-5 shrink-0 text-ink-400" aria-hidden="true" />
        </Link>

        {/*
          "Em breve" explícito, e não um botão que não faz nada. O escopo da
          Etapa 25 pede a arquitetura preparada para campanhas por produto,
          categoria, combos e happy hour — e a preparação está no banco
          (`coupon_type` fechado, redenções com snapshot). Prometer a tela seria
          mentir; esconder faria o dono procurar.
        */}
        <Card className="space-y-2 bg-ink-50/60">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Em breve</p>
          <ul className="space-y-1.5 text-xs leading-snug text-ink-600">
            <li>· Promoção por produto ou categoria</li>
            <li>· Combos e happy hour por horário</li>
            <li>· Desconto automático para cliente recorrente</li>
          </ul>
          <p className="text-[11px] leading-snug text-ink-500">
            A estrutura já guarda a origem de cada desconto no pedido, então nada do que existe
            hoje vai precisar ser refeito.
          </p>
        </Card>
      </main>
    </>
  );
}
