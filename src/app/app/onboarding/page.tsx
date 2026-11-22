import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { OnboardingWizard, type WizardData } from "@/components/onboarding/onboarding-wizard";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getOnboardingSnapshot } from "@/lib/data/onboarding";
import { getRestaurantTheme } from "@/lib/data/theme";
import { listCategories } from "@/lib/data/menu";
import { listTables } from "@/lib/data/tables";

/**
 * `/app/onboarding` — wizard de configuração (Etapa 21).
 *
 * ─── Por que fica dentro de `/app` ─────────────────────────────────────────
 *
 * O `/onboarding` original é a criação do restaurante: público para quem acabou
 * de criar conta e ainda não tem casa. Este é diferente — o restaurante já
 * existe, e tudo aqui exige sessão e vínculo. Ficar sob `/app` reaproveita o
 * middleware (sessão), o layout (restaurante ativo, casa suspensa) e a barra
 * inferior, sem duplicar guarda.
 *
 * ─── Uma carga, seis consultas em paralelo ────────────────────────────────
 *
 * O wizard precisa de restaurante, progresso, tema, categorias e primeira mesa.
 * Buscar tudo em série seria seis round-trips numa tela que abre em 4G; em
 * paralelo é uma janela só. Todas as leituras passam por RLS/tenant.
 *
 * ─── Sem tela branca ──────────────────────────────────────────────────────
 *
 * Quando a RPC de onboarding não existe (deploy à frente da migration) ou o
 * restaurante não é do usuário, a página manda para `/app` em vez de quebrar:
 * o dashboard continua funcionando, e é ele que mostra o checklist.
 */

export const metadata: Metadata = {
  title: "Configuração inicial",
  // Tela de trabalho: nunca indexada, nunca em cache.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AppOnboardingPage() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const [snapshot, theme, categories, tables] = await Promise.all([
    getOnboardingSnapshot(restaurant.id),
    getRestaurantTheme(restaurant.id),
    listCategories(restaurant.id),
    listTables(restaurant.id),
  ]);

  // Sem snapshot = RPC ausente ou tenant não resolvido. O painel é o lugar
  // seguro: ele lê os mesmos dados por outro caminho.
  if (!snapshot) redirect("/app");

  const firstTable = tables.find((table) => table.is_active) ?? null;

  const data: WizardData = {
    restaurantId: snapshot.restaurantId,
    name: snapshot.name,
    slug: snapshot.slug,
    description: snapshot.description,
    logoUrl: theme.logo_url ?? snapshot.logoUrl,
    segment: snapshot.segment,
    themePreset: theme.preset,
    steps: snapshot.steps,
    completed: snapshot.completed,
    counts: snapshot.counts,
    categories: categories.map((category) => category.name),
    firstTable: firstTable ? { id: firstTable.id, name: firstTable.name } : null,
    status: restaurant.status,
  };

  return (
    <div className="min-h-dvh bg-ink-50">
      <div className="pt-safe">
        <div className="app-shell flex items-center justify-between gap-2 px-4 pt-3">
          <Logo href="/app" size="sm" />
          <a
            href="/app"
            className="tap-target inline-flex items-center rounded-lg px-2 text-xs font-semibold text-ink-500 hover:bg-ink-100"
          >
            Configurar depois
          </a>
        </div>
      </div>

      <OnboardingWizard initial={data} />
    </div>
  );
}
