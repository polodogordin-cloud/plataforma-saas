import { redirect } from "next/navigation";
import { BottomNav } from "@/components/app/bottom-nav";
import { SuspendedNotice } from "@/components/app/suspended-notice";
import { SubscriptionNotice } from "@/components/app/subscription-notice";
import { getActiveRestaurant, getSessionUser } from "@/lib/data/restaurants";
import { getMySubscription } from "@/lib/data/billing";
import { SUBSCRIPTION_STATE_ALLOWS_ACCESS } from "@/lib/types";

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

  /**
   * Assinatura sem acesso (Etapa 11).
   *
   * `expired` e `cancelled` trancam o painel com uma tela que explica e leva
   * para `/planos`. `past_due` continua entrando de propósito: o restaurante em
   * atraso ainda está operando, e travar o salão por causa de uma fatura em
   * processamento custaria mais do que a mensalidade.
   *
   * De novo: conforto, não segurança. O trigger `enforce_subscription_active`
   * é quem recusa escrita em produto, mesa e categoria.
   */
  const subscription = await getMySubscription(restaurant?.id);
  if (subscription && !SUBSCRIPTION_STATE_ALLOWS_ACCESS[subscription.status]) {
    return (
      <SubscriptionNotice
        restaurantName={restaurant?.name ?? null}
        status={subscription.status}
        periodEnd={subscription.period_end}
        trialEnd={subscription.trial_end}
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
