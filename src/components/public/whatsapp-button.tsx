"use client";

import { MessageCircle } from "lucide-react";
import { useMemo } from "react";
import { buildWhatsappLink, type WhatsappConfig } from "@/lib/whatsapp";
import type { RestaurantTheme } from "@/lib/types";
import { themeTokens } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * Botão "Falar no WhatsApp" do cardápio público — Etapa 13.
 *
 * ─── Por que é um `<a>` e não um `onClick` ────────────────────────────────
 *
 * O link `wa.me` é o mecanismo oficial e **não precisa de JavaScript**: o
 * navegador do celular reconhece o esquema e abre o app. Usar `<a href>` tem
 * três consequências boas:
 *
 *   • funciona mesmo se o JS falhar (cardápio no 3G do salão);
 *   • o "toque longo" oferece "copiar link", que é o que muita gente faz;
 *   • leitores de tela anunciam como link, com o destino certo — a semântica
 *     de "abrir outra coisa" fica correta.
 *
 * ─── Sem telemetria, sem contagem ─────────────────────────────────────────
 *
 * Não sabemos se a pessoa enviou a mensagem. Se o link foi aberto, foi o app do
 * WhatsApp que abriu. Por isso o texto do botão promete **abrir a conversa**,
 * não "enviar": prometer envio seria mentira em qualquer caso em que a pessoa
 * feche o app.
 */
export function WhatsappButton({
  config,
  restaurantName,
  theme,
  className,
}: {
  config: WhatsappConfig | null | undefined;
  restaurantName: string;
  theme?: RestaurantTheme;
  className?: string;
}) {
  const tokens = theme ? themeTokens(theme) : null;

  const href = useMemo(() => {
    if (!config?.phone || !config.isActive) return null;
    return buildWhatsappLink({ phone: config.phone, message: config.message });
  }, [config?.phone, config?.isActive, config?.message]);

  if (!href) return null;

  return (
    <a
      href={href}
      // `noopener`: o wa.me é outra origem; não deve receber `window.opener`.
      target="_blank"
      rel="noopener noreferrer"
      // A conversa é do restaurante. O rótulo diz para onde vai, para quem usa
      // leitor de tela não descobrir só depois de sair do cardápio.
      aria-label={`Falar no WhatsApp com ${restaurantName}`}
      className={cn(
        // Alvo de 56px: o botão mais tocado do rodapé, com o polegar, em pé.
        "flex min-h-14 w-full items-center justify-center gap-2.5 rounded-2xl px-5 py-3.5",
        "text-[0.95rem] font-semibold shadow-sm transition active:scale-[0.99]",
        "focus-visible:outline-2 focus-visible:outline-offset-2",
        className,
      )}
      style={{
        // Verde do WhatsApp (#25D366) com texto escuro: contraste 8:1, acima de
        // AA. Texto branco sobre esse verde dá 1.9:1 e reprovaria — é o erro
        // clássico de botão "WhatsApp".
        backgroundColor: "#25d366",
        color: "#0b3d24",
        outlineColor: tokens?.primary ?? "#0f9250",
      }}
    >
      <MessageCircle className="size-5 shrink-0" aria-hidden="true" strokeWidth={2.4} />
      Falar no WhatsApp
    </a>
  );
}
