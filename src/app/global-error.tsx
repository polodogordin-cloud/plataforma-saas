"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

/**
 * Erro de último recurso — quando o **layout raiz** falha.
 *
 * `error.tsx` cobre o erro de uma página; este arquivo cobre o erro que escapa
 * dele. Uma vez que o layout raiz quebrou, não há `next/link` nem provider
 * confiável (o Next exige um documento completo aqui, com `html` e `body`).
 * Por isso: CSS inline mínimo, zero dependência de componente, zero contexto.
 *
 * ─── O que NÃO aparece na tela ────────────────────────────────────────────
 *
 * Mensagem de exceção, stack e `digest` não vão para o visitante. Em produção
 * isso vaza caminho de arquivo, nome de tabela e chave de API — o clássico
 * "erro bonito no dev, mapa do sistema aberto em produção". O `digest` (hash
 * curto que o Next gera) é o identificador certo: aparece na tela, casa com o
 * log do servidor, e não conta nada a quem não tem acesso ao log.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    /*
     * Um único ponto de telemetria. Quando houver Sentry/Datadog, é aqui que
     * ele entra — e só aqui, porque um erro que chegou até o layout raiz é o
     * que mais precisa de rastro.
     */
    console.error("[global-error]", error.digest ?? "sem digest", error.message);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "#f7f8f9",
          color: "#191b22",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <main style={{ maxWidth: "22rem", textAlign: "center" }}>
          <span
            aria-hidden="true"
            style={{
              display: "grid",
              placeItems: "center",
              width: "56px",
              height: "56px",
              margin: "0 auto",
              borderRadius: "16px",
              background: "#fef2f2",
              color: "#dc2626",
            }}
          >
            <TriangleAlert size={28} />
          </span>

          <h1 style={{ margin: "18px 0 0", fontSize: "22px", fontWeight: 600 }}>
            Algo saiu do prato
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: "14px", lineHeight: 1.6, color: "#5c6170" }}>
            A plataforma teve um problema inesperado. Nada do seu cardápio ou dos
            seus pedidos foi perdido.
          </p>

          {error.digest && (
            <p
              style={{
                margin: "14px 0 0",
                fontSize: "12px",
                color: "#7a8090",
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
              }}
            >
              Código do erro: {error.digest}
            </p>
          )}

          <div style={{ display: "grid", gap: "10px", marginTop: "22px" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                minHeight: "48px",
                padding: "0 20px",
                border: 0,
                borderRadius: "12px",
                background: "#0f9250",
                color: "#ffffff",
                fontSize: "15px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <RotateCcw size={17} aria-hidden="true" />
              Tentar novamente
            </button>

            {/*
              `window.location` e não `next/link`: se o layout raiz falhou, o
              router do cliente pode estar no mesmo estado quebrado. Um reload
              completo é a única saída garantida.
            */}
            <button
              type="button"
              onClick={() => window.location.assign("/")}
              style={{
                minHeight: "48px",
                padding: "0 20px",
                border: "1px solid #e3e5ea",
                borderRadius: "12px",
                background: "#ffffff",
                color: "#3d4250",
                fontSize: "15px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Ir para o início
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
