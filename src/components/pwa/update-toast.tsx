"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { SW_PATH } from "@/lib/pwa";

/**
 * Aviso de nova versão — Etapa 12, item 11 ("PWA após atualização").
 *
 * O SW novo fica em `waiting` em vez de assumir sozinho. Quando isso acontece,
 * mostramos "Nova versão disponível" com um botão. Recarregar por conta própria
 * seria pior: o dono pode estar no meio de um pedido, e um reload forçado perde
 * o que estava na tela.
 *
 * Um detalhe que costuma passar: **recarregar só depois** que o SW novo assume
 * (`controllerchange`). Recarregar antes devolve a página antiga servida pelo SW
 * antigo, e o aviso reaparece — o usuário clica duas, três vezes.
 */
export function UpdateToast() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    let disposed = false;

    const track = (registration: ServiceWorkerRegistration) => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        setWaiting(registration.waiting);
      }

      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          // `installed` com um controller ativo = versão nova esperando.
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            setWaiting(registration.waiting ?? installing);
          }
        });
      });
    };

    navigator.serviceWorker.getRegistration(SW_PATH).then((registration) => {
      if (registration && !disposed) track(registration);
    });

    // Só recarrega quando o SW novo realmente assume o controle.
    const onControllerChange = () => {
      if (reloading) window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, [reloading]);

  if (!waiting) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 px-3"
      style={{ paddingTop: "max(env(safe-area-inset-top), 0.5rem)" }}
    >
      <div className="app-shell">
        <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink-900 px-3 py-2.5 text-white shadow-lg">
          <RefreshCw className="size-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-xs leading-snug">
            Nova versão disponível.
          </p>
          <button
            type="button"
            onClick={() => {
              setReloading(true);
              waiting.postMessage({ type: "SKIP_WAITING" });
            }}
            className="min-h-9 shrink-0 rounded-lg bg-white/15 px-3 text-xs font-semibold"
          >
            Atualizar
          </button>
        </div>
      </div>
    </div>
  );
}
