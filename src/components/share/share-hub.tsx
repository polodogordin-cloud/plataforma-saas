"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Check,
  Copy,
  ExternalLink,
  AtSign,
  Camera,
  Globe,
  Link2,
  Mail,
  MessageCircle,
  Music2,
  Pencil,
  ThumbsUp,
  Send,
  Share2,
  Smartphone,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { saveShareHeadline } from "@/actions/share";
import {
  COPY_ONLY_CHANNELS,
  DEFAULT_SHARE_HEADLINE,
  MAX_HEADLINE_LENGTH,
  SHARE_CHANNELS,
  absoluteUrl,
  bioSnippet,
  channelUrl,
  composeShareMessage,
  menuPath,
  nativeSharePayload,
  orderPath,
  readShareOutcome,
  sanitizeHeadline,
  supportsNativeShare,
  tablePath,
  whatsappShareUrl,
  type ShareChannelId,
} from "@/lib/share";
import { cn } from "@/lib/utils";

/**
 * "Divulgar meu cardápio" — Etapa 23.
 *
 * ─── A ordem da tela é a ordem de uso ────────────────────────────────────
 *
 * O dono abre esta tela com o celular na mão e um objetivo: mandar o link para
 * alguém. Então o primeiro bloco é **compartilhar agora** (botão nativo,
 * WhatsApp, copiar), e só depois vêm QR geral, mensagem editável e os canais que
 * exigem copiar e colar. Colocar a personalização da mensagem no topo faria o
 * dono parar de divulgar para configurar.
 *
 * ─── Uma mensagem, várias saídas ─────────────────────────────────────────
 *
 * Todo canal usa `composeShareMessage` — a mesma função do servidor. Se o texto
 * do WhatsApp e o texto do copiar divergissem, o dono que edita a chamada veria
 * uma coisa na tela e enviaria outra.
 *
 * ─── Honestidade sobre o que o navegador faz ─────────────────────────────
 *
 * Instagram e TikTok estão marcados como "copiar e colar" e a interface diz isso.
 * Não existe publicação automática: o compartilhamento nativo (quando o aparelho
 * tem) abre a folha do sistema, que é o único caminho real para publicar no
 * Instagram a partir do navegador.
 */

type TableOption = { id: string; name: string; code: string | null; publicToken: string; active: boolean };
type OrderOption = { id: string; orderNumber: number; tableName: string; tableId: string; tablePublicToken: string };

export function ShareHub({
  restaurantName,
  restaurantSlug,
  headline: initialHeadline,
  isPublished,
  origin,
  tables,
  orders,
  canEdit,
}: {
  restaurantName: string;
  restaurantSlug: string;
  /**
   * A logo **não** é usada aqui: quem a desenha é a arte de compartilhamento
   * (`og:image`), gerada no servidor. Mostrá-la nesta tela duplicaria o peso
   * sem servir para nada — o dono já sabe qual é a própria marca.
   */
  logoUrl?: string | null;
  headline: string | null;
  isPublished: boolean;
  /** Origem pública resolvida no servidor. */
  origin: string;
  tables: TableOption[];
  orders: OrderOption[];
  canEdit: boolean;
}) {
  const router = useRouter();

  const [headline, setHeadline] = useState(initialHeadline ?? "");
  const [savedHeadline, setSavedHeadline] = useState(initialHeadline ?? "");
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [canNativeShare, setCanNativeShare] = useState(false);

  // `navigator.share` só existe no cliente, e a checagem precisa acontecer
  // depois da hidratação: renderizar o botão no servidor e removê-lo no cliente
  // faria o layout pular na primeira pintura.
  useEffect(() => {
    setCanNativeShare(supportsNativeShare(navigator));
  }, []);

  const menuUrl = useMemo(() => absoluteUrl(origin, menuPath(restaurantSlug)), [origin, restaurantSlug]);

  const message = useMemo(
    () =>
      composeShareMessage({
        restaurantName,
        url: menuUrl,
        headline: headline || savedHeadline,
      }),
    [restaurantName, menuUrl, headline, savedHeadline],
  );

  const flash = useCallback((key: string) => {
    setCopied(key);
    window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 2200);
  }, []);

  const copy = useCallback(
    async (text: string, key: string) => {
      setError(null);
      try {
        await navigator.clipboard.writeText(text);
        flash(key);
      } catch {
        // Sem Clipboard API (http, navegador antigo, permissão negada): o texto
        // continua visível e selecionável na tela. Falhar em silêncio faria o
        // dono achar que copiou.
        setError("O navegador não deixou copiar. Toque e segure no texto para copiar.");
      }
    },
    [flash],
  );

  const shareNative = useCallback(async () => {
    setError(null);
    try {
      await navigator.share(
        nativeSharePayload({ restaurantName, url: menuUrl, headline: headline || savedHeadline }),
      );
    } catch (shareError) {
      if (readShareOutcome(shareError) === "cancelled") return;
      // Navegador mentiu sobre o suporte (raro, mas acontece fora de HTTPS):
      // cai no copiar em vez de deixar o dono sem saída.
      await copy(message, "menu");
    }
  }, [restaurantName, menuUrl, headline, savedHeadline, copy, message]);

  const save = useCallback(() => {
    startTransition(async () => {
      const result = await saveShareHeadline({ headline });
      if (result.ok) {
        setSavedHeadline(result.headline ?? "");
        setNotice(result.message ?? "Mensagem salva.");
        setEditing(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }, [headline, router]);

  const openChannel = useCallback(
    (channel: ShareChannelId) => {
      const url = channelUrl({ channel, url: menuUrl, message, restaurantName });
      if (!url) {
        // Instagram/TikTok: não existe URL de envio. Copiamos a mensagem e
        // explicamos onde colar — em vez de um botão que não faz nada.
        void copy(message, channel);
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    },
    [copy, menuUrl, message, restaurantName],
  );

  const downloadQr = useCallback((format: "svg" | "png") => {
    // Navegação direta (e não `fetch` + blob): o `Content-Disposition` da rota já
    // é `attachment`, e no celular isso abre o "salvar em Arquivos" do sistema —
    // o caminho que o dono precisa para mandar a placa para a gráfica.
    window.location.href = `/app/divulgar/qr?format=${format}`;
  }, []);

  const dirty = headline !== savedHeadline;

  return (
    <div className="flex flex-col gap-4">
      {/* ───────────── 1. Link + compartilhar agora ───────────── */}
      <section className="rounded-2xl bg-white p-4 shadow-[var(--shadow-soft)]">
        <h2 className="text-base font-semibold text-ink-900">Seu cardápio público</h2>

        {!isPublished ? (
          <div className="mt-2 rounded-xl bg-ink-100/80 px-3 py-2.5">
            <p className="text-sm leading-relaxed text-ink-600">
              O cardápio está <strong>desativado</strong>. O link abaixo só abre depois que você
              publicar o restaurante — divulgue depois disso para ninguém cair em uma página
              indisponível.
            </p>
          </div>
        ) : null}

        <div className="mt-3 flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2.5">
          <Link2 className="size-4 shrink-0 text-ink-400" aria-hidden="true" />
          <code className="min-w-0 flex-1 break-all text-xs text-ink-700">
            {menuUrl.replace(/^https?:\/\//, "")}
          </code>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {canNativeShare && (
            <Button block onClick={() => void shareNative()}>
              <Share2 className="size-4" aria-hidden="true" />
              Compartilhar
            </Button>
          )}
          <Button
            block
            variant={canNativeShare ? "secondary" : "primary"}
            onClick={() => openChannel("whatsapp")}
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            WhatsApp
          </Button>
          <Button block variant="secondary" onClick={() => void copy(menuUrl, "menu")}>
            {copied === "menu" ? (
              <Check className="size-4 text-brand-600" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
            {copied === "menu" ? "Link copiado" : "Copiar link"}
          </Button>
          <ButtonLink href={menuUrl} label="Visualizar" />
        </div>
      </section>

      {/* ───────────── 2. QR principal ───────────── */}
      <section className="rounded-2xl bg-white p-4 shadow-[var(--shadow-soft)]">
        <div className="flex items-start gap-4">
          <div className="size-24 shrink-0 overflow-hidden rounded-xl ring-1 ring-inset ring-ink-200">
            {/* QR do restaurante inteiro — a rota da Etapa 4, mesmo gerador. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/app/divulgar/qr"
              alt={`QR Code do cardápio de ${restaurantName}`}
              width={96}
              height={96}
              className="size-full object-contain"
            />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-ink-900">QR Code do cardápio</h2>
            <p className="mt-0.5 text-sm leading-relaxed text-ink-600">
              Um código para o cardápio inteiro — para a porta, o balcão, o adesivo da sacola.
              Para mesas, use os{" "}
              <Link href="/app/mesas/qrcodes" className="font-semibold text-brand-700 underline">
                QR Codes das mesas
              </Link>
              .
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => downloadQr("svg")}>
                Baixar SVG
              </Button>
              <Button size="sm" variant="secondary" onClick={() => downloadQr("png")}>
                Baixar PNG
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────── 3. Mensagem editável ───────────── */}
      <section className="rounded-2xl bg-white p-4 shadow-[var(--shadow-soft)]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink-900">Mensagem</h2>
            <p className="mt-0.5 text-xs leading-snug text-ink-500">
              O nome do restaurante e o link entram sozinhos. Você edita a chamada.
            </p>
          </div>
          {canEdit && !editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden="true" />
              Editar
            </Button>
          )}
        </div>

        {editing ? (
          <div className="mt-3 flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-600">Chamada</span>
              <input
                type="text"
                value={headline}
                onChange={(event) => setHeadline(event.target.value)}
                maxLength={MAX_HEADLINE_LENGTH}
                placeholder={DEFAULT_SHARE_HEADLINE}
                className="min-h-11 rounded-xl border border-ink-200 px-3 text-sm text-ink-900 outline-none focus:border-brand-600"
              />
            </label>
            <div className="flex items-center justify-between text-xs text-ink-500">
              <span>
                {sanitizeHeadline(headline).length}/{MAX_HEADLINE_LENGTH}
              </span>
              <button
                type="button"
                onClick={() => setHeadline("")}
                className="font-semibold text-ink-600 underline"
              >
                Usar a padrão
              </button>
            </div>
            <div className="flex gap-2">
              <Button size="sm" loading={pending} onClick={save} disabled={!dirty}>
                Salvar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setHeadline(savedHeadline);
                  setEditing(false);
                }}
              >
                <X className="size-4" aria-hidden="true" />
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-ink-50 px-3 py-2.5 font-sans text-sm leading-relaxed text-ink-700">
            {message}
          </pre>
        )}

        {notice && (
          <p className="mt-2 flex items-center gap-2 text-sm font-medium text-brand-700">
            <Check className="size-4" aria-hidden="true" />
            {notice}
          </p>
        )}
        {error && <p className="mt-2 text-sm font-medium text-red-700">{error}</p>}

        {!editing && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button size="sm" variant="secondary" onClick={() => void copy(message, "message")}>
              {copied === "message" ? (
                <Check className="size-4 text-brand-600" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
              {copied === "message" ? "Copiado" : "Copiar mensagem"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => openChannel("whatsapp")}>
              <Send className="size-4" aria-hidden="true" />
              Enviar no WhatsApp
            </Button>
          </div>
        )}
      </section>

      {/* ───────────── 4. Canais ───────────── */}
      <section className="rounded-2xl bg-white p-4 shadow-[var(--shadow-soft)]">
        <h2 className="text-base font-semibold text-ink-900">Outros canais</h2>
        <p className="mt-0.5 text-xs leading-snug text-ink-500">
          Instagram e TikTok não permitem publicar direto do navegador. Nesses, a mensagem é
          copiada para você colar no story, na bio ou na legenda.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {SHARE_CHANNELS.filter((channel) => channel.id !== "native" && channel.id !== "whatsapp" && channel.id !== "copy").map(
            (channel) => {
              const Icon = channelIcon(channel.id);
              const isCopyOnly = !channel.direct;
              const isCopied = copied === channel.id;

              return (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => openChannel(channel.id)}
                  className="tap-target flex items-center gap-2.5 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-left transition active:scale-[0.99] hover:bg-ink-50"
                >
                  <Icon className="size-4.5 shrink-0 text-ink-600" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink-900">{channel.label}</span>
                    <span className="block truncate text-[0.7rem] leading-snug text-ink-500">
                      {isCopied ? "Copiado para colar" : isCopyOnly ? "Copiar e colar" : channel.hint}
                    </span>
                  </span>
                  {isCopied ? (
                    <Check className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
                  ) : isCopyOnly ? (
                    <Copy className="size-3.5 shrink-0 text-ink-400" aria-hidden="true" />
                  ) : (
                    <ExternalLink className="size-3.5 shrink-0 text-ink-400" aria-hidden="true" />
                  )}
                </button>
              );
            },
          )}
        </div>

        <div className="mt-3 rounded-xl bg-ink-50 px-3 py-2.5">
          <p className="text-xs font-semibold text-ink-700">Texto para a bio do Instagram</p>
          <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-ink-600">
            {bioSnippet({ restaurantName, url: menuUrl })}
          </pre>
          <Button
            size="sm"
            variant="ghost"
            className="mt-1"
            onClick={() =>
              void copy(bioSnippet({ restaurantName, url: menuUrl }), "bio")
            }
          >
            {copied === "bio" ? <Check className="size-4 text-brand-600" /> : <Copy className="size-4" />}
            {copied === "bio" ? "Copiado" : "Copiar texto"}
          </Button>
        </div>
      </section>

      {/* ───────────── 5. Outros links ───────────── */}
      <ShareLinksSection
        origin={origin}
        restaurantSlug={restaurantSlug}
        tables={tables}
        orders={orders}
        copied={copied}
        onCopy={copy}
      />

      <p className="px-1 text-center text-xs leading-relaxed text-ink-500">
        {COPY_ONLY_CHANNELS.length > 0
          ? "Nada aqui publica sozinho: o envio é sempre você quem faz, pelo app escolhido."
          : null}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ShareLinksSection(props: {
  origin: string;
  restaurantSlug: string;
  tables: TableOption[];
  orders: OrderOption[];
  copied: string | null;
  onCopy: (text: string, key: string) => Promise<void>;
}) {
  const { origin, restaurantSlug, tables, orders, copied, onCopy } = props;
  const [tab, setTab] = useState<"menu" | "table" | "order">("menu");
  const [tableId, setTableId] = useState(tables[0]?.id ?? "");
  const [orderId, setOrderId] = useState(orders[0]?.id ?? "");

  const selectedTable = tables.find((table) => table.id === tableId) ?? tables[0] ?? null;
  const selectedOrder = orders.find((order) => order.id === orderId) ?? orders[0] ?? null;

  const currentUrl = (() => {
    if (tab === "menu") return absoluteUrl(origin, menuPath(restaurantSlug));
    if (tab === "table" && selectedTable) {
      return absoluteUrl(origin, tablePath(restaurantSlug, selectedTable.publicToken));
    }
    if (tab === "order" && selectedOrder) {
      return absoluteUrl(
        origin,
        orderPath({
          restaurantSlug,
          publicToken: selectedOrder.tablePublicToken,
          orderNumber: selectedOrder.orderNumber,
        }),
      );
    }
    return absoluteUrl(origin, menuPath(restaurantSlug));
  })();

  return (
    <section className="rounded-2xl bg-white p-4 shadow-[var(--shadow-soft)]">
      <h2 className="text-base font-semibold text-ink-900">Links</h2>
      <p className="mt-0.5 text-xs leading-snug text-ink-500">
        Copie o link que precisar. O link da mesa identifica a mesa no pedido; o do pedido abre o
        acompanhamento.
      </p>

      {/*
        As abas existem só quando há o que mostrar. Uma aba "Pedido" que abre um
        seletor vazio é pior que a ausência dela: o dono toca esperando um link e
        encontra um beco. Sem pedido nenhum, a explicação aparece abaixo das abas.
      */}
      <div className="mt-3 flex gap-1 rounded-xl bg-ink-100 p-1">
        {[
          { id: "menu" as const, label: "Geral" },
          ...(tables.length > 0 ? [{ id: "table" as const, label: "Mesa" }] : []),
          ...(orders.length > 0 ? [{ id: "order" as const, label: "Pedido" }] : []),
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            aria-pressed={tab === item.id}
            className={cn(
              "tap-target flex-1 rounded-lg px-2 py-2 text-sm font-semibold transition",
              tab === item.id ? "bg-white text-ink-900 shadow-sm" : "text-ink-600",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "table" && tables.length > 1 && (
        <select
          value={tableId}
          onChange={(event) => setTableId(event.target.value)}
          className="mt-2 min-h-11 w-full rounded-xl border border-ink-200 px-3 text-sm text-ink-900"
          aria-label="Escolher mesa"
        >
          {tables.map((table) => (
            <option key={table.id} value={table.id}>
              {table.name}
              {table.active ? "" : " (inativa)"}
            </option>
          ))}
        </select>
      )}

      {tab === "order" && orders.length > 0 && (
        <select
          value={orderId}
          onChange={(event) => setOrderId(event.target.value)}
          className="mt-2 min-h-11 w-full rounded-xl border border-ink-200 px-3 text-sm text-ink-900"
          aria-label="Escolher pedido"
        >
          {orders.map((order) => (
            <option key={order.id} value={order.id}>
              #{order.orderNumber} · {order.tableName}
            </option>
          ))}
        </select>
      )}

      {(tables.length === 0 || orders.length === 0) && (
        <p className="mt-2 rounded-xl bg-ink-50 px-3 py-2 text-sm leading-relaxed text-ink-600">
          {tables.length === 0
            ? "Nenhuma mesa cadastrada ainda — crie uma em Mesas para ter o link da mesa. "
            : ""}
          {orders.length === 0
            ? "Nenhum pedido ainda: o link de acompanhamento aparece aqui depois do primeiro pedido."
            : ""}
        </p>
      )}

      <div className="mt-2 rounded-xl bg-ink-50 px-3 py-2.5">
        <code className="break-all text-xs text-ink-700">{currentUrl}</code>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void onCopy(currentUrl, `link-${tab}`)}
          disabled={(tab === "table" && !selectedTable) || (tab === "order" && !selectedOrder)}
        >
          {copied === `link-${tab}` ? (
            <Check className="size-4 text-brand-600" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
          {copied === `link-${tab}` ? "Copiado" : "Copiar link"}
        </Button>
        <a
          href={currentUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="tap-target inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-ink-200 bg-white px-3 text-sm font-semibold text-ink-800 hover:bg-ink-50"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          Abrir
        </a>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

/** Ícone por canal. `lucide-react` não tem marca de Instagram/Facebook/TikTok. */
function channelIcon(id: ShareChannelId) {
  switch (id) {
    // `lucide-react` removeu os ícones de marca (Instagram/Facebook) por questão
    // de licença. Usamos equivalentes neutros: câmera para o Instagram e "joinha"
    // para o Facebook — o rótulo escrito ao lado é quem identifica o canal.
    case "instagram":
      return Camera;
    case "facebook":
      return ThumbsUp;
    case "tiktok":
      return Music2;
    case "google":
      return Globe;
    case "telegram":
      return Send;
    case "email":
      return Mail;
    case "whatsapp":
      return MessageCircle;
    default:
      return Smartphone;
  }
}

function ButtonLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="tap-target inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-ink-200 bg-white px-3 text-sm font-semibold text-ink-800 hover:bg-ink-50"
    >
      <ExternalLink className="size-4" aria-hidden="true" />
      {label}
    </a>
  );
}
