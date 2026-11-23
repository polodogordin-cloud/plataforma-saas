import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { NotificationPreferencesForm } from "@/components/notifications/notification-preferences-form";
import { Card, SectionTitle } from "@/components/ui/card";
import { getActiveRestaurant, getSessionUser } from "@/lib/data/restaurants";
import { getNotificationPreferences } from "@/lib/data/notifications";
import { NOTIFICATION_CHANNELS } from "@/lib/notifications";

export const metadata: Metadata = { title: "Notificações" };

/**
 * Preferências da central — Etapa 26.
 *
 * O painel de notificações (o sino) resolve o "o que aconteceu". Esta tela
 * resolve "o que eu quero saber". Separar as duas evita o pior lugar possível
 * para um formulário: dentro de uma folha que abre e fecha.
 */
export default async function NotificationsSettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/entrar?next=/app/notificacoes");

  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const preferences = await getNotificationPreferences(restaurant.id);

  return (
    <>
      <AppHeader title="Notificações" subtitle={restaurant.name} />

      <main className="app-shell px-4 pb-8 pt-4">
        <Link
          href="/app"
          className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-ink-500"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Início
        </Link>

        <NotificationPreferencesForm
          restaurantId={restaurant.id}
          initialDisabled={preferences.disabled}
          catalog={preferences.catalog}
        />

        {/* ------------------------------------------------------ canais */}
        <div className="mt-5">
          <SectionTitle title="Por onde avisar" />
          <Card className="space-y-2">
            {NOTIFICATION_CHANNELS.map((channel) => (
              <div
                key={channel.id}
                className="flex items-center justify-between gap-3 border-b border-ink-100 pb-2 last:border-0 last:pb-0"
              >
                <span className="text-sm text-ink-800">{channel.label}</span>
                {channel.state === "ready" ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    Ativo
                  </span>
                ) : (
                  <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-500">
                    Em breve
                  </span>
                )}
              </div>
            ))}
          </Card>

          {/*
            Honestidade sobre o escopo: a central funciona no painel e por tempo
            real. Push, e-mail, WhatsApp e SMS aparecem aqui como "em breve"
            porque a preparação existe no banco (a notificação é registro, não
            fila), mas **nenhum envio foi implementado**. Prometer o contrário
            faria o dono esperar uma mensagem que nunca chega.
          */}
          <p className="mt-2 px-1 text-[11px] leading-snug text-ink-500">
            Hoje os avisos aparecem só dentro do painel, em tempo real. Push, e-mail, WhatsApp e
            SMS ainda não existem — a estrutura já guarda o aviso para o envio ser ligado depois sem
            refazer nada.
          </p>
        </div>
      </main>
    </>
  );
}
