import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings2, Users } from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { Card } from "@/components/ui/card";
import { CustomersList } from "@/components/customers/customers-list";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getLoyaltySettings, listCustomers } from "@/lib/data/loyalty";
import { getRestaurantTimezone } from "@/lib/data/timezone";
import { describeProgram } from "@/lib/loyalty";

export const metadata: Metadata = { title: "Clientes" };

/**
 * Clientes e fidelidade — Etapa 24.
 *
 * A primeira página vem do servidor (RSC) e a busca/paginação continua no
 * cliente: abrir a tela no celular do dono é uma requisição só, e digitar no
 * campo de busca não recarrega a página.
 *
 * ─── Por que a tela se chama "Clientes" e não "Fidelidade" ────────────────
 *
 * O programa de pontos é uma parte do que o dono ganha aqui; o que ele procura
 * é **gente**. "Fidelidade" é o nome de um recurso, "Clientes" é o nome de um
 * grupo de pessoas — e essa é a linguagem que ele usa no balcão.
 */
export default async function CustomersPage() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const [settings, list, timeZone] = await Promise.all([
    getLoyaltySettings(restaurant.id),
    listCustomers({ restaurantId: restaurant.id, limit: 50 }),
    getRestaurantTimezone(restaurant.id),
  ]);

  const programText = describeProgram(settings);

  return (
    <>
      <AppHeader title="Clientes" subtitle={restaurant.name} />

      <main className="app-shell px-4 pb-6 pt-4">
        {/* --------------------------------------------------- programa */}
        <Card className="mb-4 space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink-900">
                {settings.enabled ? "Programa de pontos ativo" : "Programa de pontos desativado"}
              </p>
              <p className="mt-0.5 text-xs leading-snug text-ink-500">
                {programText ??
                  "Ative para o cliente acumular pontos a cada pedido entregue e ver o saldo no cardápio."}
              </p>
            </div>
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
              <Users className="size-4" aria-hidden="true" />
            </span>
          </div>

          <Link
            href="/app/clientes/fidelidade"
            className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-ink-200 text-xs font-semibold text-ink-700 active:scale-[0.99]"
          >
            <Settings2 className="size-3.5" aria-hidden="true" />
            {settings.enabled ? "Ajustar programa de pontos" : "Ativar programa de pontos"}
          </Link>
        </Card>

        <CustomersList
          restaurantId={restaurant.id}
          initialCustomers={list.customers}
          initialTotal={list.total}
          programEnabled={settings.enabled}
          timeZone={timeZone}
        />
      </main>
    </>
  );
}
