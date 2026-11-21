"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import {
  INSTALL_COPY,
  INSTALL_DISMISS_KEY,
  detectPlatform,
  isStandalone,
  shouldOfferInstall,
  type InstallPlatform,
} from "@/lib/pwa";

/** Evento `beforeinstallprompt` — só existe no Chrome/Edge Android. */
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const VISITS_KEY = "menuvo:visits";

/**
 * Convite para instalar o app — Etapa 12, item 6.
 *
 * Três regras do escopo que mudam o desenho do componente:
 *
 *   1. **Não mostrar repetidamente.** Dispensa é gravada com data; o convite só
 *      volta depois de 30 dias, e nunca antes da segunda visita.
 *   2. **Permitir dispensar.** Botão "Agora não" e um X, ambos gravam a mesma
 *      marca — não há duas formas de dizer não.
 *   3. **Instrução certa por plataforma.** Android tem `beforeinstallprompt` e
 *      ganha um botão que realmente instala. O Safari do iPhone **não** tem
 *      esse evento: mostrar "Instalar" ali seria prometer um botão inexistente,
 *      então o texto ensina o caminho (Compartilhar → Adicionar à Tela de
 *      Início).
 *
 * Quando o navegador não oferece instalação (Firefox Android, navegador in-app
 * de Instagram/WhatsApp — comum em restaurante), o componente não aparece: o
 * botão não faria nada.
 */
export function InstallPrompt({ storage }: { storage?: Storage }) {
  const [platform, setPlatform] = useState<InstallPlatform>("unknown");
  const [visible, setVisible] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const store = storage ?? window.localStorage;
    const detected = detectPlatform({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      platform: navigator.platform,
    });
    setPlatform(detected);

    const isStandaloneMode = isStandalone({
      displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
      navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone === true,
    });
    setStandalone(isStandaloneMode);

    // Conta visitas em vez de mostrar na primeira: quem chegou por engano não
    // precisa de um convite de instalação.
    const visits = Number(store.getItem(VISITS_KEY) ?? "0") + 1;
    store.setItem(VISITS_KEY, String(visits));

    const dismissedAt = Number(store.getItem(INSTALL_DISMISS_KEY) ?? "0") || null;

    const canShow = shouldOfferInstall({
      dismissAt: dismissedAt,
      now: Date.now(),
      visits,
      platform: detected,
      standalone: isStandaloneMode,
    });

    if (!canShow) return;

    // iOS não dispara evento: aparece direto com as instruções do Safari.
    if (detected === "ios") setVisible(true);

    const onBeforeInstall = (event: Event) => {
      // Impede o mini-infobar do Chrome: usamos o evento para desenhar o nosso
      // convite no momento que faz sentido, não no meio do primeiro scroll.
      event.preventDefault();
      setInstallEvent(event as InstallEvent);
      setVisible(true);
    };

    const onInstalled = () => {
      setVisible(false);
      setInstallEvent(null);
      store.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [storage]);

  const dismiss = () => {
    setVisible(false);
    try {
      (storage ?? window.localStorage).setItem(INSTALL_DISMISS_KEY, String(Date.now()));
    } catch {
      // Storage cheio ou bloqueado (Safari em modo privado): o convite some
      // nesta sessão e reaparece na próxima. Nada de quebrar a página por isso.
    }
  };

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    // Recusa no diálogo do navegador também conta como "não quero": não
    // insistimos no minuto seguinte.
    if (choice.outcome !== "accepted") dismiss();
    else setVisible(false);
    setInstallEvent(null);
  };

  if (!visible || standalone) return null;

  const isIos = platform === "ios";

  return (
    <aside
      // `role="complementary"` e não `alert`: não é urgente, é uma sugestão.
      role="complementary"
      aria-label="Instalar o aplicativo"
      className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 px-3 pb-2"
    >
      <div className="app-shell">
        <div className="mx-auto flex max-w-md items-start gap-3 rounded-2xl border border-ink-200 bg-white p-3 shadow-[0_12px_32px_-16px_rgba(16,24,40,0.35)]">
          <span
            aria-hidden="true"
            className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"
          >
            {isIos ? <Share className="size-5" /> : <Download className="size-5" />}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-snug text-ink-900">{INSTALL_COPY.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
              {isIos ? INSTALL_COPY.iosBody : INSTALL_COPY.androidBody}
            </p>

            <div className="mt-2 flex items-center gap-2">
              {isIos ? (
                <button
                  type="button"
                  onClick={dismiss}
                  className="min-h-11 rounded-xl bg-ink-100 px-3 text-xs font-semibold text-ink-700"
                >
                  {INSTALL_COPY.iosCta}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={install}
                  className="min-h-11 rounded-xl bg-brand-600 px-4 text-xs font-semibold text-white"
                >
                  {INSTALL_COPY.androidCta}
                </button>
              )}
              <button
                type="button"
                onClick={dismiss}
                className="min-h-11 px-3 text-xs font-semibold text-ink-500"
              >
                {INSTALL_COPY.dismiss}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={dismiss}
            aria-label="Fechar sugestão de instalação"
            // 44px de alvo: o X é o botão mais fácil de errar com o polegar, e
            // errar aqui faz o convite sumir por 30 dias sem querer.
            className="-m-1.5 grid size-11 shrink-0 place-items-center rounded-lg text-ink-400"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  );
}
