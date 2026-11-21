"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink, Link2Off } from "lucide-react";
import type { RestaurantStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Bloco "seu cardápio público" no painel.
 *
 * Só mostra o link quando o restaurante está publicado. Em rascunho/pausado,
 * explica o que fazer em vez de entregar um link que daria 404 — o dono
 * imprimiria um QR Code quebrado.
 */
export function PublicLink({
  slug,
  status,
  baseUrl,
}: {
  slug: string;
  status: RestaurantStatus;
  /** Origem usada na exibição (ex.: menuvo.app). O link real é sempre relativo. */
  baseUrl?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const path = `/r/${slug}`;
  const isPublished = status === "published";
  const display = `${baseUrl ?? "menuvo.app"}${path}`;

  const copy = () => {
    startTransition(async () => {
      try {
        await navigator.clipboard.writeText(`${window.location.origin}${path}`);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch {
        // Clipboard bloqueado (http ou permissão negada): o link continua visível.
        setCopied(false);
      }
    });
  };

  if (!isPublished) {
    return (
      <div className="flex items-start gap-3 rounded-xl bg-ink-100/80 px-3.5 py-3">
        <Link2Off className="mt-0.5 size-4.5 shrink-0 text-ink-400" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-700">Cardápio público desativado</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
            Ative o cardápio acima para liberar o link <span className="font-mono">{path}</span>{" "}
            e o QR Code das mesas.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 rounded-xl bg-brand-50/70 px-3.5 py-3 ring-1 ring-inset ring-brand-200/70">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-brand-900">Seu cardápio está no ar</p>
        <p className="mt-0.5 truncate font-mono text-xs text-brand-800/80">{display}</p>
      </div>

      <div className="flex gap-2">
        <Link
          href={path}
          target="_blank"
          rel="noreferrer"
          className="tap-target inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white px-3 text-sm font-semibold text-brand-800 shadow-sm ring-1 ring-inset ring-brand-200 active:scale-[0.98]"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          Abrir
        </Link>

        <button
          type="button"
          onClick={copy}
          disabled={pending}
          className={cn(
            "tap-target inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors",
            copied ? "bg-brand-600 text-white" : "bg-brand-600 text-white hover:bg-brand-700",
          )}
        >
          {copied ? (
            <>
              <Check className="size-4" aria-hidden="true" />
              Copiado
            </>
          ) : (
            <>
              <Copy className="size-4" aria-hidden="true" />
              Copiar link
            </>
          )}
        </button>
      </div>

      <p className="text-[0.7rem] leading-relaxed text-brand-800/70">
        Link para o Instagram, WhatsApp e QR Codes das mesas.
      </p>
    </div>
  );
}
