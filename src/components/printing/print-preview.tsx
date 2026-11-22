"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Dispara a impressão de uma área que já está na página.
 *
 * O detalhe que justifica este componente existir separado: `window.print()`
 * imprime **o documento inteiro**, e quem decide o que sai é o CSS. Aqui o
 * papel é o `.thermal-sheet` do `globals.css`, que esconde o resto por
 * `visibility` (válido para o cartão do QR, que mora em portal). Não há
 * biblioteca de impressão, não há iframe oculto, não há canvas: três coisas que
 * quebram em celular e no Safari.
 */

export function PrintButton({
  label = "Imprimir",
  disabled,
  onBeforePrint,
  className,
  variant = "primary",
  size = "lg",
}: {
  label?: string;
  disabled?: boolean;
  /**
   * Chamado **antes** de abrir a janela. Serve para registrar a solicitação
   * (`logPrintJob`). Não é aguardado bloqueando a impressão de propósito: um
   * log lento não pode atrasar um cupom no meio do serviço.
   */
  onBeforePrint?: () => void;
  className?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "lg" | "sm";
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      disabled={disabled}
      loading={busy}
      onClick={() => {
        onBeforePrint?.();
        setBusy(true);
        /*
         * O `await` de um tick dá tempo ao React de pintar o estado de
         * "enviando" antes do diálogo bloquear a thread. Sem isso, o botão
         * congela sem feedback no Android modesto.
         */
        window.setTimeout(() => {
          try {
            window.print();
          } finally {
            setBusy(false);
          }
        }, 60);
      }}
    >
      <Printer className="size-4.5" aria-hidden="true" />
      {label}
    </Button>
  );
}

/**
 * Ajusta o `@page` à largura do rolo.
 *
 * `@page { size: 58mm auto }` é o que faz o driver não tentar encaixar o cupom
 * numa folha A4 — o modo de falha mais comum de impressão térmica pelo
 * navegador: o cupom sai minúsculo no canto de uma folha.
 *
 * A injeção em `<style>` é feita no cliente porque o tamanho depende da escolha
 * da pessoa, que muda sem recarregar. A regra é curta de propósito: se o
 * navegador não entender `auto`, ele mantém a página padrão em vez de quebrar.
 */
export function PageSizeStyle({ width }: { width: "58" | "80" }) {
  useEffect(() => {
    const id = "thermal-page-size";
    const existing = document.getElementById(id);
    if (existing) existing.remove();

    const style = document.createElement("style");
    style.id = id;
    style.textContent = `@media print { @page { size: ${width === "58" ? "58mm" : "80mm"} auto; margin: 0; } }`;
    document.head.appendChild(style);

    return () => {
      style.remove();
    };
  }, [width]);

  return null;
}
