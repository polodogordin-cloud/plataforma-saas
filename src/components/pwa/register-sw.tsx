"use client";

import { useEffect } from "react";
import { SW_PATH, SW_SCOPE } from "@/lib/pwa";

/**
 * Registra o service worker — Etapa 12.
 *
 * Só em produção. Em `next dev` o SW interferiria no hot reload (servindo JS
 * antigo do cache) e produziria bugs que não existem no aparelho do cliente —
 * o tipo de fantasma que consome uma tarde inteira.
 *
 * Não renderiza nada: é um efeito, não um componente visual.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    // `load` e não no mount: registrar durante a hidratação compete por banda
    // com o próprio carregamento da página, e o SW não é urgente.
    const register = () => {
      if (cancelled) return;
      navigator.serviceWorker.register(SW_PATH, { scope: SW_SCOPE }).catch(() => {
        // Registro falhou (navegador antigo, contexto inseguro, iOS em modo
        // privado). O app continua funcionando como site normal — PWA é
        // melhoria progressiva, nunca requisito.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
