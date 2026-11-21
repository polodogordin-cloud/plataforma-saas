"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, Loader2, Trash2, UploadCloud } from "lucide-react";
import { createUploadTarget } from "@/actions/theme";
import {
  ACCEPT_ATTRIBUTE,
  checkImageFile,
  optimizeImage,
  type UploadKind,
} from "@/lib/theme-upload";
import { getBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Upload de logo / capa — Etapa 9.
 *
 * Fluxo, do toque ao fim:
 *
 *   1. o arquivo é **validado** (tipo, tamanho e assinatura real);
 *   2. é **redimensionado no navegador** (`optimizeImage`) para o tamanho que a
 *      tela usa — 320 px de logo, 1600 px de capa;
 *   3. o servidor devolve um caminho autorizado (`createUploadTarget`) com o
 *      id do tenant ativo;
 *   4. sobe direto para o Storage — o arquivo **não passa** por Server Action;
 *   5. a URL pública volta para o editor, que atualiza o preview na hora.
 *
 * O `preview antes de salvar` do escopo é satisfeito duas vezes: a imagem
 * aparece aqui assim que sobe, e o preview do cardápio ao lado atualiza junto.
 * Só vai para o banco no botão "Salvar" do editor — se o dono desistir, o
 * tema antigo continua intacto (o arquivo fica no bucket, sem uso).
 */
export function ImagePicker({
  kind,
  label,
  hint,
  value,
  aspect,
  onChange,
  disabled,
}: {
  kind: UploadKind;
  label: string;
  hint: string;
  value: string | null;
  /** Proporção visual do slot: logo é quadrado, capa é 16:9. */
  aspect: "square" | "wide";
  onChange: (url: string | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "working">("idle");
  const [error, setError] = useState<string | null>(null);
  const [optimized, setOptimized] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setStatus("working");
    setOptimized(null);

    try {
      const checked = await checkImageFile(file);
      if (!checked.ok) {
        setError(checked.error);
        return;
      }

      const result = await optimizeImage(file, kind);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const target = await createUploadTarget(kind, result.extension);
      if (!target.ok) {
        setError(target.error);
        return;
      }

      const supabase = getBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from("restaurant-assets")
        .upload(target.path, result.blob, {
          cacheControl: "31536000",
          contentType: result.extension === "jpg" ? "image/jpeg" : `image/${result.extension}`,
          upsert: false,
        });

      if (uploadError) {
        setError("Não foi possível enviar a imagem. Verifique sua conexão.");
        return;
      }

      // A URL que o servidor calculou já carrega a versão no caminho
      // (`logo-{timestamp}.webp`), então trocar a imagem não fica presa em
      // cache do navegador nem do CDN.
      onChange(target.publicUrl);

      if (result.width > 0) {
        setOptimized(
          `Otimizada para ${result.width}×${result.height} px (${formatBytes(result.blob.size)}).`,
        );
      }
    } finally {
      setStatus("idle");
      // Permite escolher o MESMO arquivo de novo depois de remover.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink-700">{label}</p>
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOptimized(null);
              setError(null);
            }}
            disabled={disabled || status === "working"}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Remover
          </button>
        )}
      </div>

      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border border-dashed border-ink-300 bg-ink-50",
          aspect === "square" ? "aspect-square w-28" : "aspect-[16/9] w-full",
        )}
      >
        {value ? (
          <Image
            src={value}
            alt={`${label} do cardápio`}
            fill
            sizes={aspect === "square" ? "112px" : "(max-width: 640px) 100vw, 420px"}
            className="object-cover"
            unoptimized={value.startsWith("blob:")}
          />
        ) : (
          <div className="grid size-full place-items-center text-ink-400">
            <ImagePlus className="size-6" aria-hidden="true" />
          </div>
        )}

        {status === "working" && (
          <div className="absolute inset-0 grid place-items-center bg-white/80 backdrop-blur-sm">
            <span className="flex items-center gap-2 text-xs font-semibold text-ink-600">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Otimizando…
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || status === "working"}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-ink-200 bg-white px-3.5 text-sm font-semibold text-ink-700 transition hover:bg-ink-50 disabled:opacity-50"
        >
          <UploadCloud className="size-4" aria-hidden="true" />
          {value ? "Trocar imagem" : "Enviar imagem"}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
      </div>

      <p className="text-xs text-ink-500">{hint}</p>

      {optimized && <p className="text-xs font-medium text-brand-700">{optimized}</p>}

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
