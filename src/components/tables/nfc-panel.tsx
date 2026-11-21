"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCheck,
  Copy,
  ExternalLink,
  HelpCircle,
  Loader2,
  MapPin,
  Nfc,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { NfcStatusBadge, NFC_STATUS_CHIP, resolveNfcDisplay } from "@/components/tables/nfc-status-badge";
import { NfcTagSheet } from "@/components/tables/nfc-tag-sheet";
import {
  deleteNfcTag,
  setNfcStatus,
  toggleNfcTag,
} from "@/actions/nfc";
import {
  NFC_EVENT_LABEL,
  NFC_STATUS_LABEL,
  type NfcEvent,
  type NfcStatus,
  type TableNfcTag,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Seção NFC da mesa.
 *
 * A mensagem central desta tela: a TAG NFC aponta para a MESMA URL do QR Code.
 * Não existe "link de NFC" separado, e é isso que garante que melhorar o
 * cardápio nunca obrigue a regravar a TAG.
 */
export function NfcPanel({
  tableId,
  tableName,
  origin,
  tags,
  history,
  canEdit,
}: {
  tableId: string;
  tableName: string;
  origin: string;
  tags: TableNfcTag[];
  /** Histórico enxuto da mesa, mais recente primeiro. */
  history?: NfcEvent[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState<"tag" | "url" | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [form, setForm] = useState<{ open: boolean; tag: TableNfcTag | null }>({
    open: false,
    tag: null,
  });
  const [confirm, setConfirm] = useState<TableNfcTag | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /**
   * URL absoluta da TAG.
   *
   * Vem do banco (`nfc_url`, calculada a partir do slug e do token atuais) e
   * só recebe a origem aqui. A TAG e o QR Code apontam para exatamente esta
   * string.
   */
  const primary = tags.find((tag) => tag.is_active && tag.status !== "disabled") ?? tags[0] ?? null;
  const publicPath = primary?.nfc_url ?? null;
  const absoluteUrl = publicPath ? `${origin}${publicPath}` : null;

  const copy = useCallback(async (value: string, kind: "tag" | "url") => {
    setError(null);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard bloqueado (http, iOS antigo): mostra a URL para copiar à mão.
      setError("Não foi possível copiar automaticamente. Toque e segure na URL acima.");
    }
  }, []);

  const changeStatus = (tag: TableNfcTag, status: NfcStatus) => {
    setPendingId(tag.tag_id);
    setError(null);
    startTransition(async () => {
      const result = await setNfcStatus(tag.tag_id, status, tableId);
      if (!result.ok) setError(result.message ?? "Não foi possível atualizar a TAG.");
      setPendingId(null);
      router.refresh();
    });
  };

  const toggleActive = (tag: TableNfcTag) => {
    setPendingId(tag.tag_id);
    setError(null);
    startTransition(async () => {
      const result = await toggleNfcTag(tag.tag_id, !tag.is_active, tableId);
      if (!result.ok) setError(result.message ?? "Não foi possível atualizar a TAG.");
      setPendingId(null);
      router.refresh();
    });
  };

  const remove = async () => {
    if (!confirm) return;
    const result = await deleteNfcTag(confirm.tag_id, tableId);
    if (!result.ok) setError(result.message ?? "Não foi possível remover a TAG.");
    setConfirm(null);
    router.refresh();
  };

  const display = resolveNfcDisplay(primary);

  return (
    <section
      aria-labelledby="nfc-titulo"
      className="overflow-hidden rounded-2xl border border-ink-200/80 bg-white"
    >
      <header className="flex items-start gap-3 border-b border-ink-100 px-4 py-3.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink-900 text-white">
          <Nfc className="size-4.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="nfc-titulo" className="text-[0.95rem] font-semibold text-ink-900">
            NFC
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
            A TAG encostada no celular abre a mesma página do QR Code.
          </p>
        </div>
        <NfcStatusBadge tag={primary} className="mt-0.5 shrink-0" />
      </header>

      <div className="space-y-3 px-4 py-4">
        {/* URL para gravar */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-400">
              URL da TAG
            </p>
            {primary?.needs_rerecord && (
              <span className="text-[0.7rem] font-semibold text-amber-700">
                URL mudou — regrave
              </span>
            )}
          </div>

          {absoluteUrl ? (
            <>
              <p className="mt-1 select-all break-all rounded-xl bg-ink-100 px-3 py-2.5 font-mono text-[0.7rem] leading-relaxed text-ink-700">
                {absoluteUrl}
              </p>

              {canEdit && (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => copy(absoluteUrl, "url")}
                    className={cn(
                      "tap-target inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition-colors",
                      copied === "url"
                        ? "border-brand-600 bg-brand-50 text-brand-800"
                        : "border-ink-200 bg-white text-ink-700",
                    )}
                  >
                    {copied === "url" ? (
                      <>
                        <Check className="size-4" aria-hidden="true" />
                        Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="size-4" aria-hidden="true" />
                        Copiar URL NFC
                      </>
                    )}
                  </button>

                  <a
                    href={publicPath ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tap-target inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3 text-sm font-semibold text-ink-700"
                  >
                    <ExternalLink className="size-4" aria-hidden="true" />
                    Testar URL
                  </a>
                </div>
              )}
            </>
          ) : (
            <p className="mt-1 rounded-xl bg-ink-100 px-3 py-2.5 text-sm leading-relaxed text-ink-500">
              Cadastre a TAG abaixo para liberar a URL de gravação.
            </p>
          )}

          <p className="mt-2 flex items-start gap-1.5 text-[0.7rem] leading-relaxed text-ink-400">
            <MapPin className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            A URL é gerada automaticamente e não muda quando você edita o cardápio.
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {/* TAGs cadastradas */}
        {tags.length > 0 && (
          <ul className="space-y-2">
            {tags.map((tag) => {
              const busy = pendingId === tag.tag_id;
              return (
                <li
                  key={tag.tag_id}
                  className={cn(
                    "rounded-xl border px-3 py-2.5",
                    tag.needs_rerecord
                      ? "border-amber-200 bg-amber-50/60"
                      : tag.is_active
                        ? "border-ink-200 bg-white"
                        : "border-ink-200 bg-ink-50/60",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-900">
                        {tag.label ?? "TAG principal"}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[0.7rem] text-ink-500">
                        {tag.tag_identifier ? (
                          <span className="font-mono">{tag.tag_identifier}</span>
                        ) : (
                          <span className="text-ink-400">sem identificador</span>
                        )}
                        {!tag.is_active && <span>· desativada</span>}
                      </p>
                    </div>
                    {busy ? (
                      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-ink-400" aria-hidden="true" />
                    ) : (
                      <NfcStatusBadge tag={tag} showDot className="shrink-0" />
                    )}
                  </div>

                  {tag.needs_rerecord && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-[0.7rem] font-medium leading-relaxed text-amber-800">
                      <RefreshCw className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                      A URL da mesa mudou depois desta gravação. Copie a URL acima e grave
                      a TAG novamente.
                    </p>
                  )}

                  {canEdit && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {/* Só oferece "configurado" a quem ainda não chegou lá:
                          oferecer isso a uma TAG testada seria pedir uma regressão. */}
                      {tag.status !== "configured" && tag.status !== "tested" && tag.is_active && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => changeStatus(tag, "configured")}
                          className="tap-target inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 text-[0.8rem] font-semibold text-white disabled:opacity-60"
                        >
                          <CheckCheck className="size-4" aria-hidden="true" />
                          {tag.needs_rerecord ? "Marcar regravada" : "Marcar como configurado"}
                        </button>
                      )}

                      {tag.status === "configured" && tag.is_active && !tag.needs_rerecord && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => changeStatus(tag, "tested")}
                          className="tap-target inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 text-[0.8rem] font-semibold text-ink-700 disabled:opacity-60"
                        >
                          <Check className="size-4" aria-hidden="true" />
                          Já testei
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => toggleActive(tag)}
                        className="tap-target inline-flex items-center justify-center rounded-lg border border-ink-200 bg-white px-3 text-[0.8rem] font-semibold text-ink-600 disabled:opacity-60"
                      >
                        {tag.is_active ? "Desativar" : "Ativar"}
                      </button>

                      <button
                        type="button"
                        onClick={() => setForm({ open: true, tag })}
                        className="tap-target inline-flex items-center justify-center rounded-lg border border-ink-200 bg-white px-3 text-[0.8rem] font-semibold text-ink-600"
                      >
                        Editar
                      </button>

                      <button
                        type="button"
                        onClick={() => setConfirm(tag)}
                        aria-label={`Remover ${tag.label ?? "TAG"}`}
                        className="tap-target grid w-11 place-items-center rounded-lg border border-ink-200 bg-white text-ink-400"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {canEdit && (
          <button
            type="button"
            onClick={() => setForm({ open: true, tag: null })}
            className="tap-target inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-ink-300 bg-white text-sm font-semibold text-ink-600"
          >
            <Plus className="size-4" aria-hidden="true" />
            {tags.length === 0 ? "Cadastrar TAG NFC" : "Adicionar outra TAG"}
          </button>
        )}

        {history && history.length > 0 && (
          <details className="rounded-xl border border-ink-200 bg-white px-3 py-2.5">
            <summary className="cursor-pointer list-none text-[0.8rem] font-semibold text-ink-700">
              Histórico ({history.length})
            </summary>
            <ul className="mt-2 space-y-1.5">
              {history.slice(0, 8).map((event) => (
                <li key={event.id} className="flex gap-2 text-[0.72rem] leading-snug">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-ink-300" aria-hidden="true" />
                  <span className="min-w-0 flex-1 text-ink-600">
                    {NFC_EVENT_LABEL[event.event]}
                    {event.event === "status_changed" && event.to_status && (
                      <span className="text-ink-400">
                        {" "}
                        → {NFC_STATUS_LABEL[event.to_status].toLowerCase()}
                      </span>
                    )}
                  </span>
                  <time
                    dateTime={event.created_at}
                    className="shrink-0 tabular-nums text-ink-400"
                  >
                    {formatWhen(event.created_at)}
                  </time>
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* Instruções */}
        <div className="rounded-xl bg-ink-50 px-3 py-2.5">
          <button
            type="button"
            onClick={() => setShowHelp((value) => !value)}
            aria-expanded={showHelp}
            className="flex w-full items-center gap-2 text-left"
          >
            <HelpCircle className="size-4 shrink-0 text-brand-700" aria-hidden="true" />
            <span className="flex-1 text-[0.8rem] font-semibold text-ink-800">
              Como gravar a TAG
            </span>
            <span className="text-[0.7rem] font-medium text-brand-700">
              {showHelp ? "Ocultar" : "Ver passos"}
            </span>
          </button>

          {showHelp && <NfcInstructions />}
        </div>

        <p className="text-[0.7rem] leading-relaxed text-ink-400">
          O navegador não grava a TAG sozinho — a gravação é feita por um aplicativo
          próprio do celular, como o NFC Tools. Aqui você administra a URL e o estado de
          cada TAG.
        </p>
      </div>

      <NfcTagSheet
        open={form.open}
        tag={form.tag}
        tableId={tableId}
        tableName={tableName}
        onClose={() => setForm({ open: false, tag: null })}
      />

      <ConfirmSheet
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title="Remover TAG?"
        confirmLabel="Remover TAG"
        description={
          confirm ? (
            <>
              <strong>{confirm.label ?? "TAG principal"}</strong> sai do cadastro. O
              histórico continua guardado. Se a TAG física for continuar na mesa, prefira{" "}
              <strong>desativar</strong>.
            </>
          ) : null
        }
        onConfirm={remove}
      />
    </section>
  );
}

/** Passos para o dono, escritos para caber em uma tela de celular. */
export function NfcInstructions() {
  const steps = [
    "Copie a URL da TAG aqui em cima.",
    "Abra o aplicativo de gravação NFC (NFC Tools, TagWriter…).",
    "Toque em “Adicionar registro” e escolha “URL”.",
    "Cole a URL copiada.",
    "Encoste a TAG no celular e toque em gravar.",
    "Aproxime o celular de novo para testar o cardápio.",
  ];

  return (
    <div className="mt-2.5">
      <p className="text-[0.75rem] leading-relaxed text-ink-600">
        Grave a URL na TAG usando um aplicativo compatível — o Menuvo não grava a TAG.
      </p>
      <ol className="mt-2 space-y-1.5">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-2 text-[0.75rem] leading-snug text-ink-700">
            <span
              className="mt-px grid size-4.5 shrink-0 place-items-center rounded-full bg-brand-100 text-[0.65rem] font-bold text-brand-800"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[0.7rem] leading-relaxed text-ink-400">
        Dica: TAGs NTAG213, 215 e 216 funcionam bem para URL. A leitura é feita pela
        câmera ou pela área NFC do próprio celular do cliente.
      </p>
    </div>
  );
}

/** Data curta sem depender do locale do navegador ("21/11 14:32"). */
function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${day}/${month} ${hour}:${minute}`;
}

/** Rótulos usados nos chips do formulário. */
export const NFC_STATUS_OPTIONS: { value: NfcStatus; label: string }[] = [
  { value: "not_configured", label: NFC_STATUS_LABEL.not_configured },
  { value: "configured", label: NFC_STATUS_LABEL.configured },
  { value: "tested", label: NFC_STATUS_LABEL.tested },
  { value: "disabled", label: NFC_STATUS_LABEL.disabled },
];

export { NFC_STATUS_CHIP };
