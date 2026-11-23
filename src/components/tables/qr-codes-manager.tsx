"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Check,
  Copy,
  ExternalLink,
  LayoutTemplate,
  MoreHorizontal,
  RefreshCw,
  Share2,
  Smartphone,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { PlaceEditor } from "@/components/tables/place-editor";
import { regeneratePlaceToken } from "@/actions/qr-places";
import { PLACE_FORMATS, qrPublicPath, type PlaceStyle } from "@/lib/place-card";
import { cn } from "@/lib/utils";
import type { QrPlaceTable } from "@/lib/data/qr-place";

/**
 * Lista de QR Codes por mesa — Etapa 22.
 *
 * ─── Um card por mesa, com o essencial às vistas ──────────────────────────
 *
 * O dono abre esta tela com um objetivo concreto: baixar a plaquinha da mesa 3.
 * Por isso o card é grande, mostra o nome e o estado da mesa, e tem as ações
 * principais (visualizar, baixar, copiar, compartilhar) sem menu escondido. As
 * ações raras — regenerar — ficam atrás de uma confirmação que explica o preço.
 *
 * ─── O link vem do servidor ───────────────────────────────────────────────
 *
 * `origin` e `slug` chegam prontos da página. O componente nunca monta a URL a
 * partir do `window.location`: em preview, num domínio temporário ou atrás de
 * proxy, o `window.location` não é o domínio de produção — e a plaquinha
 * impressa apontaria para um endereço que morre no dia seguinte.
 */
export function QrCodesManager({
  restaurantName,
  restaurantSlug,
  logoUrl,
  origin,
  tables,
  style: initialStyle,
  canEdit,
}: {
  restaurantName: string;
  restaurantSlug: string;
  logoUrl: string | null;
  /** Origem pública resolvida no servidor. */
  origin: string;
  tables: QrPlaceTable[];
  style: PlaceStyle;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editorOpen, setEditorOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [rotateTarget, setRotateTarget] = useState<QrPlaceTable | null>(null);
  const [rotateResult, setRotateResult] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  /** URL absoluta de cada mesa, montada aqui a partir de dados do servidor. */
  const urlFor = useCallback(
    (table: QrPlaceTable) =>
      `${origin}${qrPublicPath({ restaurantSlug, publicToken: table.publicToken })}`,
    [origin, restaurantSlug],
  );

  const previewTable = tables[0] ?? null;

  const copy = useCallback(async (table: QrPlaceTable) => {
    const url = `${origin}${qrPublicPath({ restaurantSlug, publicToken: table.publicToken })}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(table.id);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Sem clipboard (http, navegador antigo): seleciona o link visível para o
      // usuário copiar à mão, em vez de falhar em silêncio.
      setOpenMenu(table.id);
    }
  }, [origin, restaurantSlug]);

  const share = useCallback(
    async (table: QrPlaceTable) => {
      const url = `${origin}${qrPublicPath({ restaurantSlug, publicToken: table.publicToken })}`;
      const data = {
        title: `${restaurantName} — ${table.name}`,
        text: `Acesse o cardápio da ${table.name}:`,
        url,
      };

      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        try {
          await navigator.share(data);
          return;
        } catch {
          // Usuário cancelou o compartilhamento nativo: cai no copiar.
        }
      }
      await copy(table);
    },
    [copy, origin, restaurantName, restaurantSlug],
  );

  const rotate = useCallback(async () => {
    if (!rotateTarget) return;
    setRotating(true);
    const result = await regeneratePlaceToken(rotateTarget.id);
    setRotating(false);
    if (result.ok) {
      setRotateResult(
        `Novo QR Code gerado para ${rotateTarget.name}. O código anterior continua funcionando por 30 minutos; reimprima a plaquinha desta mesa.`,
      );
      setRotateTarget(null);
      router.refresh();
    } else {
      setRotateResult(String(result.error));
      setRotateTarget(null);
    }
  }, [rotateTarget, router]);

  const total = tables.length;
  const active = tables.filter((table) => table.isActive).length;

  const summary = useMemo(() => {
    if (!total) return null;
    return `${total} ${total === 1 ? "mesa" : "mesas"} · ${active} ${active === 1 ? "ativa" : "ativas"} · arte ${PLACE_FORMATS[initialStyle.format].label.toLowerCase()}`;
  }, [active, initialStyle.format, total]);

  return (
    <>
      {/* Cabeçalho de seção: contexto antes da lista. */}
      <section className="mb-4 flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-[var(--shadow-soft)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink-900">QR Codes das mesas</h2>
            <p className="mt-0.5 text-sm leading-snug text-ink-600">
              {total
                ? summary
                : "Crie uma mesa no salão para gerar o primeiro QR Code."}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setEditorOpen(true)}>
            <LayoutTemplate className="size-4" aria-hidden="true" />
            Criar placa
          </Button>
        </div>

        <p className="rounded-xl bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
          O QR Code aponta para o <strong>link público da mesa</strong>. Editar produtos, preços,
          categorias ou o tema do cardápio não muda o código já impresso.
        </p>
      </section>

      {rotateResult && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-brand-50 px-3 py-2.5 text-sm leading-relaxed text-brand-800 ring-1 ring-inset ring-brand-200">
          <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">{rotateResult}</span>
          <button
            type="button"
            onClick={() => setRotateResult(null)}
            className="text-xs font-semibold text-brand-700 underline"
          >
            Fechar
          </button>
        </div>
      )}

      {total === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-200 bg-white px-4 py-10 text-center">
          <Smartphone className="mx-auto size-8 text-ink-300" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-ink-800">Nenhuma mesa cadastrada</p>
          <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-ink-500">
            O QR Code é gerado a partir de uma mesa. Cadastre a primeira para começar.
          </p>
          <ButtonLinkFallback />
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {tables.map((table) => {
            const url = urlFor(table);
            const scannable = table.isActive && table.status === "active";

            return (
              <li
                key={table.id}
                className="rounded-2xl bg-white p-4 shadow-[var(--shadow-soft)]"
              >
                <div className="flex items-start gap-3">
                  <TableThumb table={table} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink-900">{table.name}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
                              scannable
                                ? "bg-brand-50 text-brand-700"
                                : "bg-ink-100 text-ink-600",
                            )}
                          >
                            <span
                              className={cn(
                                "size-1.5 rounded-full",
                                scannable ? "bg-brand-600" : "bg-ink-400",
                              )}
                              aria-hidden="true"
                            />
                            {scannable ? "Pronta para uso" : "Inativa"}
                          </span>
                          {table.code && <span className="font-mono">{table.code}</span>}
                          {table.hasStaleToken && <span>Token antigo ainda válido</span>}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOpenMenu(openMenu === table.id ? null : table.id)}
                        aria-label={`Mais ações para ${table.name}`}
                        aria-expanded={openMenu === table.id}
                        className="tap-target -mr-1 -mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-ink-500 hover:bg-ink-100"
                      >
                        <MoreHorizontal className="size-5" aria-hidden="true" />
                      </button>
                    </div>

                    <p className="mt-1.5 truncate font-mono text-[0.7rem] text-ink-400" title={url}>
                      {url.replace(/^https?:\/\//, "")}
                    </p>
                  </div>
                </div>

                {/* Ações principais — sem esconder o que o dono veio fazer. */}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      window.location.href = `/app/mesas/${table.id}/qr/place?format=svg`;
                    }}
                  >
                    <LayoutTemplate className="size-4" aria-hidden="true" />
                    Baixar SVG
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      window.location.href = `/app/mesas/${table.id}/qr/place?format=png`;
                    }}
                  >
                    <LayoutTemplate className="size-4" aria-hidden="true" />
                    Baixar PNG
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => copy(table)}>
                    {copied === table.id ? (
                      <Check className="size-4 text-brand-600" aria-hidden="true" />
                    ) : (
                      <Copy className="size-4" aria-hidden="true" />
                    )}
                    {copied === table.id ? "Copiado" : "Copiar link"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void share(table)}>
                    <Share2 className="size-4" aria-hidden="true" />
                    Compartilhar
                  </Button>
                </div>

                {openMenu === table.id && (
                  <div className="mt-2 flex flex-col gap-1 rounded-xl bg-ink-50 p-1.5">
                    <MenuAction
                      icon={<ExternalLink className="size-4" aria-hidden="true" />}
                      label="Testar QR Code"
                      hint="Abre o cardápio desta mesa"
                      onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
                    />
                    <MenuAction
                      icon={<Wifi className="size-4" aria-hidden="true" />}
                      label="URL para NFC"
                      hint="Copie e grave em uma TAG com um app de gravação"
                      onClick={() => void copy(table)}
                    />
                    {canEdit && (
                      <MenuAction
                        icon={<RefreshCw className="size-4" aria-hidden="true" />}
                        label="Regenerar QR Code"
                        hint="Invalida a plaquinha já impressa desta mesa"
                        danger
                        onClick={() => {
                          setOpenMenu(null);
                          setRotateTarget(table);
                        }}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <PlaceEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        initialStyle={initialStyle}
        restaurantName={restaurantName}
        previewTableName={previewTable?.name ?? "Mesa 01"}
        logoUrl={logoUrl}
        canEdit={canEdit}
        previewUrl={
          previewTable
            ? urlFor(previewTable)
            : `${origin}${qrPublicPath({ restaurantSlug, publicToken: "…" })}`
        }
        downloadBase={previewTable ? `/app/mesas/${previewTable.id}/qr/place` : null}
      />

      <ConfirmSheet
        open={rotateTarget !== null}
        onClose={() => setRotateTarget(null)}
        title={`Regenerar o QR Code da ${rotateTarget?.name ?? "mesa"}?`}
        description={
          <span className="flex flex-col gap-2">
            <span>
              O código atual deixa de valer depois de 30 minutos. A plaquinha e a TAG NFC que já
              estão na mesa precisam ser trocadas.
            </span>
            <span className="text-ink-500">
              Use quando alguém de fora ficou com o link. O cardápio, os produtos e os pedidos não
              são afetados.
            </span>
          </span>
        }
        confirmLabel={rotating ? "Gerando…" : "Regenerar"}
        onConfirm={rotate}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */

function MenuAction({
  icon,
  label,
  hint,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "tap-target flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-white",
        danger && "text-red-700",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className={cn("block text-xs leading-snug", danger ? "text-red-600" : "text-ink-500")}>
          {hint}
        </span>
      </span>
    </button>
  );
}

/**
 * Miniatura do QR no card.
 *
 * É o QR de verdade, servido pela rota de imagem já existente
 * (`/app/mesas/{id}/qr`), em 96 px. Reusar a rota significa que a miniatura e o
 * arquivo baixado são o mesmo código — se a miniatura abrisse e o arquivo não, a
 * diferença apareceria aqui.
 */
function TableThumb({ table }: { table: QrPlaceTable }) {
  return (
    <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-ink-200">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/app/mesas/${table.id}/qr`}
        alt={`QR Code da ${table.name}`}
        width={64}
        height={64}
        className="size-full object-contain"
        loading="lazy"
      />
    </div>
  );
}

function ButtonLinkFallback() {
  return (
    <Link
      href="/app/mesas"
      className="tap-target mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white"
    >
      Ir para Mesas
    </Link>
  );
}
