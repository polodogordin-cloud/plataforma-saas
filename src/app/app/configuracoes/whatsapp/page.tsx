import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { WhatsappSettingsForm } from "@/components/app/whatsapp-settings-form";
import { LimitReachedNotice } from "@/components/billing/usage-meter";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getWhatsappSettings } from "@/lib/data/whatsapp";
import { hasPlanFeature } from "@/lib/data/billing";
import { formatWhatsappNumber } from "@/lib/whatsapp";

export const metadata: Metadata = { title: "WhatsApp" };

/**
 * Configuração do WhatsApp — Etapa 13.
 *
 * A tela é do restaurante ativo, resolvido no servidor: não existe parâmetro de
 * restaurante na URL, então abrir "/whatsapp" nunca edita a casa de outra pessoa.
 *
 * O recurso `whatsapp` vem do plano (Etapa 11). Em vez de esconder a tela — o
 * dono continuaria procurando — mostramos o formulário com o motivo e o caminho
 * de upgrade. O botão de salvar também recusa no servidor, e o cardápio público
 * nem consulta o dado quando o plano não tem o recurso: esconder a tela nunca
 * foi autorização.
 */
export default async function WhatsappSettingsPage() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const [config, canUseWhatsapp] = await Promise.all([
    getWhatsappSettings(restaurant.id),
    hasPlanFeature(restaurant.id, "whatsapp"),
  ]);

  const publicUrl = `/r/${restaurant.slug}`;

  return (
    <>
      <AppHeader title="WhatsApp" subtitle={restaurant.name} />

      <main className="app-shell space-y-4 px-4 pb-8 pt-4">
        {!canUseWhatsapp && (
          <LimitReachedNotice
            message="O botão de WhatsApp faz parte dos planos Profissional e Premium. Você pode configurar agora — o botão aparece no cardápio quando o plano liberar."
            href="/planos"
          />
        )}

        <WhatsappSettingsForm
          restaurantName={restaurant.name}
          restaurantSlug={restaurant.slug}
          initialConfig={config}
          formattedPhone={formatWhatsappNumber(config.phone)}
          canUseWhatsapp={canUseWhatsapp}
        />

        {canUseWhatsapp && (
          <section className="rounded-2xl border border-ink-200 bg-ink-50 p-4">
            <h2 className="text-sm font-semibold text-ink-900">Como funciona</h2>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-ink-600">
              <li>
                • O cliente toca em <strong>Falar no WhatsApp</strong> no cardápio e o
                WhatsApp abre com a sua mensagem inicial já escrita.
              </li>
              <li>
                • Quem envia é o cliente, pelo aplicativo dele. O Menuvo não manda a
                mensagem e não sabe se ela foi enviada.
              </li>
              <li>
                • Nenhuma informação sua de painel, equipe ou plano aparece no cardápio.
              </li>
            </ul>

            <Link
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-700 underline-offset-2 hover:underline"
            >
              Abrir meu cardápio
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </Link>
          </section>
        )}
      </main>
    </>
  );
}
