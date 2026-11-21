import { redirect } from "next/navigation";
import { BottomNav } from "@/components/app/bottom-nav";
import { SuspendedNotice } from "@/components/app/suspended-notice";
import { getActiveRestaurant, getSessionUser } from "@/lib/data/restaurants";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Defesa em profundidade: o middleware já protege, mas o layout confirma.
  const user = await getSessionUser();
  if (!user) redirect("/entrar?next=/app");

  /**
   * Suspensão (Etapa 10, item 6): o painel inteiro fica bloqueado, e não só a
   * criação de conteúdo. Um dono suspenso que continuasse a navegar veria
   * dados e tentaria salvar coisas que o banco recusaria — frustração sem
   * explicação. A tela diz o motivo e a quem recorrer.
   *
   * Isto é conforto, não segurança: o cadeado real é o trigger
   * `guard_restaurant_admin_fields` + as RPCs guardadas por
   * `is_platform_admin()`. Quem chamar a API direto continua barrado.
   */
  const restaurant = await getActiveRestaurant();
  if (restaurant?.status === "suspended") {
    return (
      <SuspendedNotice
        restaurantName={restaurant.name}
        reason={restaurant.suspended_reason}
        suspendedAt={restaurant.suspended_at}
      />
    );
  }

  return (
    <div className="min-h-dvh bg-ink-50">
      {/* pb: espaço para a navegação fixa + área segura do iOS */}
      <div className="pb-[calc(4.25rem+env(safe-area-inset-bottom))]">{children}</div>
      <BottomNav />
    </div>
  );
}
