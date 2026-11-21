import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { listMyRestaurants } from "@/lib/data/restaurants";
import { RestaurantSetupForm } from "./restaurant-form";

export const metadata: Metadata = {
  title: "Cadastre seu restaurante",
  description: "Informe os dados básicos do seu estabelecimento.",
};

export default async function OnboardingPage() {
  const restaurants = await listMyRestaurants();
  // Já tem restaurante: não faz sentido refazer o onboarding.
  if (restaurants.length > 0) redirect("/app");

  return (
    <main className="min-h-dvh bg-white">
      <div className="pt-safe">
        <div className="app-shell px-5 pt-5">
          <Logo href="/app" size="sm" />
        </div>
      </div>

      <div className="app-shell px-5 pb-12 pt-6">
        <ol className="mb-6 flex items-center gap-1.5" aria-label="Progresso do cadastro">
          <li className="flex shrink-0 items-center gap-1.5 text-[0.7rem] font-semibold text-brand-700">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand-600 text-[0.7rem] text-white">
              1
            </span>
            Conta
          </li>
          <li className="h-px flex-1 bg-brand-200" aria-hidden="true" />
          <li className="flex shrink-0 items-center gap-1.5 text-[0.7rem] font-semibold text-brand-700">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand-600 text-[0.7rem] text-white">
              2
            </span>
            Restaurante
          </li>
          <li className="h-px flex-1 bg-ink-200" aria-hidden="true" />
          <li className="flex shrink-0 items-center gap-1.5 text-[0.7rem] font-medium text-ink-400">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-ink-100 text-[0.7rem]">
              3
            </span>
            Cardápio
          </li>
        </ol>

        <header className="animate-fade-in">
          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight text-ink-900">
            Vamos criar seu restaurante
          </h1>
          <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-500">
            Só o básico agora. Você poderá completar logo, endereço e identidade depois,
            em Configurações.
          </p>
        </header>

        <div className="mt-7">
          <RestaurantSetupForm />
        </div>
      </div>
    </main>
  );
}
