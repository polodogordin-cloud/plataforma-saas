"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Loader2,
  Minus,
  Plus,
  ReceiptText,
  Star,
  TicketPercent,
  Trash2,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { primaryButtonBase, primaryButtonStyle } from "@/components/public/themed";
import { useCart } from "@/components/public/cart-provider";
import { createOrder } from "@/actions/orders";
import { applyCoupon } from "@/actions/coupons";
import { CART_MAX_QUANTITY, ORDER_NOTES_MAX, lineTotal, toOrderItems } from "@/lib/cart";
import {
  CONSENT_TEXT,
  CONSENT_VERSION,
  MAX_CUSTOMER_NAME,
  describeProgram,
  isValidPhone,
  maskPhoneInput,
  normalizePhone,
  pointsForAmount,
  type LoyaltySettings,
} from "@/lib/loyalty";
import {
  COUPON_CODE_MAX,
  couponPreviewAmount,
  couponReasonMessage,
  describeCoupon,
  formatMoney,
  maskCouponCodeInput,
  type CouponValidation,
} from "@/lib/coupons";
import { DEFAULT_THEME, themeTokens } from "@/lib/theme";
import { formatPrice } from "@/lib/validation";
import type { RestaurantTheme, TableOrder } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Carrinho (revisão) e confirmação do pedido — Etapa 6.
 *
 * Duas etapas no mesmo painel, porque o cliente está com o celular na mão e
 * qualquer tela a mais no meio é desistência:
 *
 *  1. **Carrinho** — item, quantidade, preço unitário e subtotal, com −/+ e
 *     remover. Subtotal, taxas (ainda zero) e total.
 *  2. **Confirmar** — "Pedido para: Mesa 04", as linhas no formato do pedido,
 *     observação opcional e o botão "Enviar pedido".
 *
 * A mesa aparece, nunca é digitada: vem do QR Code/NFC. Se o cardápio foi
 * aberto pelo link sem mesa, o painel explica em vez de deixar enviar.
 *
 * O total mostrado aqui é uma estimativa calculada com o preço que o cardápio
 * tinha ao carregar. Depois de enviar, a tela de sucesso usa o total devolvido
 * pelo banco — que é o único oficial.
 */
export function CartSheet({
  open,
  onClose,
  onSent,
  theme = DEFAULT_THEME,
  loyalty,
}: {
  open: boolean;
  onClose: () => void;
  onSent: (order: TableOrder) => void;
  /** Tema do restaurante — o carrinho é a última tela antes do envio. */
  theme?: RestaurantTheme;
  /**
   * Regra de fidelidade da casa (Etapa 24).
   *
   * Chega como prop, e não por fetch no navegador: o dado já vem com o cardápio
   * (é público), e uma consulta a mais aqui seria uma ida ao servidor no
   * exato momento em que o cliente está com fome. `null` = programa desligado;
   * a tela de identificação simplesmente não aparece.
   */
  loyalty?: LoyaltySettings | null;
}) {
  const tokens = themeTokens(theme);
  const {
    items,
    subtotal,
    count,
    tableName,
    tableToken,
    canOrder,
    setQuantity,
    removeItem,
    clear,
  } = useCart();

  const [step, setStep] = useState<"cart" | "confirm">("cart");
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Identificação opcional — Etapa 24.
   *
   * `identify` começa desligado em todo carrinho: o caminho padrão continua
   * sendo "escolher, enviar, comer". Quem toca em "Quero acumular pontos"
   * abre os campos; quem não toca não vê formulário nenhum.
   *
   * O aceite é um segundo toque obrigatório (checkbox), separado do botão de
   * abrir os campos: consentimento pré-marcado não é consentimento.
   */
  const [identify, setIdentify] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [identifyError, setIdentifyError] = useState<string | null>(null);

  /*
   * Cupom — Etapa 25.
   *
   * Três estados, não um: o código digitado, o resultado da conferência no
   * banco e o "estou conferindo". Separados porque o desconto mostrado na tela
   * só pode existir **depois** de o banco responder — calcular na hora com o
   * que o cliente digitou seria mostrar um desconto que pode não valer.
   *
   * `applied` é limpo sempre que o carrinho muda (ver o efeito abaixo): um
   * cupom de valor mínimo pode deixar de valer quando o cliente remove um item.
   */
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [couponChecking, setCouponChecking] = useState(false);
  const [applied, setApplied] = useState<CouponValidation | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  const couponDiscount = applied?.ok ? Math.min(applied.amount, subtotal) : 0;
  const estimatedTotal = Math.max(0, subtotal - couponDiscount);

  const programEnabled = Boolean(loyalty?.enabled);
  const programText = loyalty ? describeProgram(loyalty) : null;
  const previewPoints = loyalty ? pointsForAmount(subtotal, loyalty.points_per_currency) : 0;

  // Config errada (programa ligado sem regra) não vira promessa vazia.
  const showIdentify = programEnabled && Boolean(programText);

  // Sempre volta para a revisão ao fechar, e limpa o erro de uma tentativa
  // anterior: reabrir o carrinho não deve mostrar um erro "fantasma".
  useEffect(() => {
    if (!open) return;
    setStep("cart");
    setError(null);
    // A identificação é por pedido, não por aparelho: reabrir o carrinho com os
    // campos preenchidos faria a pessoa achar que já aceitou antes.
    setIdentify(false);
    setConsent(false);
    setIdentifyError(null);
    // Cupom é por pedido também: reabrir não pode mostrar um desconto de um
    // carrinho que não existe mais.
    setCouponOpen(false);
    setCouponInput("");
    setApplied(null);
    setCouponError(null);
  }, [open]);

  /*
   * O carrinho mudou → o cupom pode ter deixado de valer.
   *
   * Em vez de recarimprimir um desconto que talvez não valha mais, esquecemos
   * o resultado e pedimos para conferir de novo. Uma conferência automática a
   * cada toque em +/− seria uma ida ao servidor por toque.
   */
  const couponKey = `${applied?.code ?? ""}:${subtotal}`;
  useEffect(() => {
    if (!applied) return;
    // Mantém quando nada mudou (inclusive no primeiro render após aplicar).
    if (applied.ok && Math.min(applied.amount, subtotal) === couponDiscount) return;
    setApplied(null);
  }, [couponKey]);

  const notesLeft = ORDER_NOTES_MAX - notes.length;

  const send = useCallback(async () => {
    if (!tableToken || sending) return;

    setSending(true);
    setError(null);
    setIdentifyError(null);

    /*
     * Identificação — decidida aqui, não no banco.
     *
     * Só vai nome/telefone se a pessoa abriu os campos **e** marcou o aceite.
     * A checagem de telefone acontece antes do envio: esperar o banco recusar
     * faria o cliente perder o carrinho por um erro de digitação em um campo
     * opcional.
     */
    const identifying = showIdentify && identify;

    if (identifying) {
      if (!consent) {
        setIdentifyError("Marque a autorização para registrar seus pontos.");
        setSending(false);
        return;
      }
      if (!customerName.trim() && !customerPhone.trim()) {
        setIdentifyError("Informe seu nome ou seu WhatsApp.");
        setSending(false);
        return;
      }
      if (customerPhone.trim() && !isValidPhone(customerPhone)) {
        setIdentifyError("Confira o WhatsApp: informe DDD e número.");
        setSending(false);
        return;
      }
    }

    const result = await createOrder({
      tableToken,
      items: toOrderItems(items),
      notes: notes.slice(0, ORDER_NOTES_MAX),
      customerName: identifying ? customerName.slice(0, MAX_CUSTOMER_NAME) : "",
      customerPhone: identifying ? normalizePhone(customerPhone) ?? "" : "",
      consent: identifying && consent,
      // Só o código. O valor do desconto é do banco.
      couponCode: applied?.ok ? (applied.code ?? "") : "",
    });

    setSending(false);

    if (result.ok === false) {
      setError(result.error);
      return;
    }

    // A tela de sucesso usa o que o BANCO gravou, não a estimativa local.
    const order: TableOrder = {
      order_id: result.order.order_id,
      order_number: result.order.order_number,
      table_name: result.order.table_name,
      status: result.order.status,
      subtotal: result.order.subtotal,
      fees: 0,
      discount: result.order.discount,
      total: result.order.total,
      coupon_code: result.order.coupon_code,
      notes: notes.trim() || null,
      created_at: result.order.created_at,
      items: items.map((item) => ({
        product_id: item.product_id,
        name: item.name,
        unit_price: item.unit_price,
        quantity: item.quantity,
        subtotal: lineTotal(item),
        notes: null,
      })),
    };

    // Pedido virou registro no banco: o carrinho cumpriu o papel. Limpar aqui
    // (e não na tela de sucesso) cobre também o reload no meio do caminho.
    setNotes("");
    setIdentify(false);
    setCustomerName("");
    setCustomerPhone("");
    setConsent(false);
    clear();
    onSent(order);
  }, [
    tableToken,
    sending,
    items,
    notes,
    customerName,
    customerPhone,
    consent,
    identify,
    showIdentify,
    onSent,
    clear,
  ]);

  const checkCoupon = useCallback(async () => {
    if (!tableToken || couponChecking) return;

    const code = maskCouponCodeInput(couponInput);
    if (code.length < 3) {
      setCouponError("Digite o código do cupom.");
      return;
    }

    setCouponChecking(true);
    setCouponError(null);

    const result = await applyCoupon({
      tableToken,
      code,
      subtotal,
      // O telefone só é usado para o limite por cliente. Vai quando a pessoa já
      // preencheu a identificação; sem ele, essa regra é pulada pelo banco.
      customerPhone: customerPhone.trim() ? normalizePhone(customerPhone) ?? "" : "",
    });

    setCouponChecking(false);

    if (result.ok === false) {
      setCouponError(result.error);
      setApplied(null);
      return;
    }

    if (!result.validation.ok) {
      setCouponError(couponReasonMessage(result.validation.reason));
      setApplied(null);
      return;
    }

    setApplied(result.validation);
    setCouponInput(result.validation.code ?? code);
  }, [tableToken, couponChecking, couponInput, subtotal, customerPhone]);

  const clearCoupon = useCallback(() => {
    setApplied(null);
    setCouponInput("");
    setCouponError(null);
  }, []);

  const lines = useMemo(() => items, [items]);

  return (
    <Sheet
      open={open}
      onClose={() => {
        onClose();
      }}
      title={step === "cart" ? "Seu pedido" : "Confirmar pedido"}
      description={
        step === "cart"
          ? tableName
            ? `Pedido para: ${tableName}`
            : "Revise os itens antes de enviar"
          : "Confira tudo antes de enviar para a cozinha"
      }
      size="tall"
      footer={
        step === "cart" ? (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between px-1 text-sm">
              <span className="text-[var(--mv-text-muted)]">
                Total estimado
                {couponDiscount > 0 ? (
                  <span className="ml-1 font-semibold text-[var(--mv-primary)]">
                    com desconto
                  </span>
                ) : null}
              </span>
              <span className="text-lg font-bold tabular-nums text-[var(--mv-text)]">
                {formatPrice(estimatedTotal)}
              </span>
            </div>
            <button
              type="button"
              disabled={!canOrder || count === 0}
              onClick={() => setStep("confirm")}
              className={cn(primaryButtonBase, "w-full min-h-[3.25rem] text-base")}
              style={primaryButtonStyle(theme)}
            >
              Continuar
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {error && (
              <p
                role="alert"
                className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700"
              >
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={send}
              disabled={sending || !canOrder}
              className={cn(primaryButtonBase, "w-full min-h-[3.25rem] text-base")}
              style={primaryButtonStyle(theme)}
            >
              {sending ? "Enviando…" : "Enviar pedido"}
            </button>
            <button
              type="button"
              onClick={() => setStep("cart")}
              disabled={sending}
              className="tap-target flex w-full items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-[var(--mv-text-muted)] disabled:opacity-50"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Voltar ao carrinho
            </button>
          </div>
        )
      }
    >
      {/* Sem mesa (link do cardápio, não QR/NFC): pedir não é possível. */}
      {!canOrder ? (
        <div className="rounded-2xl border border-dashed border-[var(--mv-border)] bg-[var(--mv-surface-muted)] px-5 py-8 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--mv-surface)] text-2xl shadow-sm">
            🪑
          </span>
          <p className="mt-3 text-sm font-semibold text-[var(--mv-text)]">Escaneie o QR Code da mesa</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-[var(--mv-text-muted)]">
            Para enviar um pedido, abra o cardápio pelo QR Code ou pela TAG NFC que está na sua
            mesa. Aí sabemos para onde levar o pedido.
          </p>
        </div>
      ) : count === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--mv-border)] bg-[var(--mv-surface-muted)] px-5 py-8 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--mv-surface)] text-[var(--mv-text-muted)] shadow-sm">
            <ReceiptText className="size-6" aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-semibold text-[var(--mv-text)]">Seu carrinho está vazio</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-[var(--mv-text-muted)]">
            Toque em um item do cardápio para adicionar ao pedido.
          </p>
          <button
            type="button"
            className="mt-4 inline-flex min-h-12 items-center justify-center rounded-xl border border-[var(--mv-border)] bg-[var(--mv-surface)] px-4 text-sm font-semibold text-[var(--mv-text)]"
            onClick={onClose}
          >
            Ver o cardápio
          </button>
        </div>
      ) : step === "cart" ? (
        /* ------------------------------------------------- carrinho */
        <div className="space-y-4">
          <ul className="space-y-2">
            {lines.map((item) => (
              <li
                key={item.product_id}
                className="rounded-2xl border border-[var(--mv-border)] bg-[var(--mv-surface)] p-3"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.95rem] font-semibold leading-snug text-[var(--mv-text)]">
                      {item.name}
                    </p>
                    <p className="mt-0.5 text-xs tabular-nums text-[var(--mv-text-muted)]">
                      {formatPrice(item.unit_price)} cada
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.product_id)}
                    aria-label={`Remover ${item.name}`}
                    className="grid size-10 shrink-0 place-items-center rounded-xl text-[var(--mv-text-muted)] transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="size-4.5" aria-hidden="true" />
                  </button>
                </div>

                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1 rounded-xl bg-[var(--mv-surface-muted)] p-1">
                    <button
                      type="button"
                      onClick={() => setQuantity(item.product_id, item.quantity - 1)}
                      aria-label={`Diminuir ${item.name}`}
                      className="grid size-10 place-items-center rounded-lg bg-[var(--mv-surface)] text-[var(--mv-text)] shadow-sm active:scale-95"
                    >
                      <Minus className="size-4" aria-hidden="true" strokeWidth={2.5} />
                    </button>
                    <span
                      className="w-8 text-center text-sm font-semibold tabular-nums text-[var(--mv-text)]"
                      aria-label={`${item.quantity} de ${item.name}`}
                    >
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQuantity(item.product_id, item.quantity + 1)}
                      disabled={item.quantity >= CART_MAX_QUANTITY}
                      aria-label={`Aumentar ${item.name}`}
                      className="grid size-10 place-items-center rounded-lg bg-[var(--mv-surface)] text-[var(--mv-text)] shadow-sm disabled:opacity-40 active:scale-95"
                    >
                      <Plus className="size-4" aria-hidden="true" strokeWidth={2.5} />
                    </button>
                  </div>

                  <span className="text-[0.95rem] font-semibold tabular-nums text-[var(--mv-text)]">
                    {formatPrice(lineTotal(item))}
                  </span>
                </div>
              </li>
            ))}
          </ul>

          {/*
            Cupom — Etapa 25.

            Fica entre a lista e o resumo porque a pessoa lê de cima para baixo:
            viu o que pediu, agora tenta o desconto, depois confere o total. O
            campo nasce fechado num link — quem não tem cupom não vê formulário
            e não fica procurando um.
          */}
          <div className="rounded-2xl border border-[var(--mv-border)] bg-[var(--mv-surface)] px-4 py-3">
            {!couponOpen && !applied ? (
              <button
                type="button"
                onClick={() => setCouponOpen(true)}
                className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-[var(--mv-text)]">
                  <TicketPercent className="size-4 text-[var(--mv-primary)]" aria-hidden="true" />
                  Tenho um cupom
                </span>
                <ChevronDown className="size-4 text-[var(--mv-text-muted)]" aria-hidden="true" />
              </button>
            ) : applied?.ok ? (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--mv-primary)]">
                    <Check className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{applied.code}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--mv-text-muted)]">
                    {formatMoney(couponDiscount)} de desconto
                  </p>
                </div>
                <button
                  type="button"
                  onClick={clearCoupon}
                  className="min-h-9 shrink-0 text-xs font-semibold text-[var(--mv-text-muted)] underline"
                >
                  Remover
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block">
                  <span className="text-xs font-medium text-[var(--mv-text-muted)]">
                    Código do cupom
                  </span>
                  <div className="mt-1 flex gap-2">
                    <input
                      type="text"
                      value={couponInput}
                      onChange={(event) => {
                        setCouponInput(maskCouponCodeInput(event.target.value));
                        setCouponError(null);
                      }}
                      maxLength={COUPON_CODE_MAX}
                      autoComplete="off"
                      autoCapitalize="characters"
                      placeholder="BEMVINDO10"
                      className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--mv-border)] bg-[var(--mv-bg)] px-3 text-sm uppercase tracking-wide text-[var(--mv-text)] placeholder:normal-case placeholder:tracking-normal placeholder:text-[var(--mv-text-muted)] focus:border-[var(--mv-primary)] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={checkCoupon}
                      disabled={couponChecking || couponInput.length < 3}
                      className="min-h-11 shrink-0 rounded-xl bg-[var(--mv-primary)] px-4 text-sm font-bold text-white disabled:opacity-50 active:scale-[0.98]"
                    >
                      {couponChecking ? "…" : "Aplicar"}
                    </button>
                  </div>
                </label>

                {couponError && (
                  <p className="text-xs font-medium text-red-600" role="alert">
                    {couponError}
                  </p>
                )}

                {!couponError && (
                  <p className="text-[11px] leading-snug text-[var(--mv-text-muted)]">
                    O desconto é conferido na hora e de novo no envio.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Resumo de valores. "Taxas" já aparece zerada: o espaço existe, a
              regra de taxa (garçom/entrega) é de outra etapa. */}
          <dl className="space-y-1.5 rounded-2xl bg-[var(--mv-surface-muted)] px-4 py-3 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-[var(--mv-text-muted)]">Subtotal</dt>
              <dd className="font-medium tabular-nums text-[var(--mv-text)]">{formatPrice(subtotal)}</dd>
            </div>
            {couponDiscount > 0 && (
              <div className="flex items-baseline justify-between">
                <dt className="text-[var(--mv-text-muted)]">
                  Desconto{applied?.code ? ` (${applied.code})` : ""}
                </dt>
                <dd className="font-medium tabular-nums text-[var(--mv-primary)]">
                  − {formatMoney(couponDiscount)}
                </dd>
              </div>
            )}
            <div className="flex items-baseline justify-between">
              <dt className="text-[var(--mv-text-muted)]">Taxas</dt>
              <dd className="tabular-nums text-[var(--mv-text-muted)]">{formatPrice(0)}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-[var(--mv-border)] pt-1.5">
              <dt className="font-semibold text-[var(--mv-text)]">Total</dt>
              <dd className="text-base font-bold tabular-nums text-[var(--mv-text)]">
                {formatPrice(estimatedTotal)}
              </dd>
            </div>
            {couponDiscount > 0 && (
              <p className="pt-0.5 text-[11px] leading-snug text-[var(--mv-text-muted)]">
                Total estimado. O valor final é o que o restaurante confirma no envio.
              </p>
            )}
          </dl>
        </div>
      ) : (
        /* ------------------------------------------------ confirmação */
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--mv-primary)]/30 bg-[var(--mv-primary-soft)] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--mv-primary)]">
              Pedido para
            </p>
            <p className="text-lg font-bold text-[var(--mv-text)]">{tableName}</p>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--mv-text-muted)]">
              Itens ({count})
            </h3>
            <ul className="mt-2 divide-y divide-[var(--mv-border)] rounded-2xl border border-[var(--mv-border)] bg-[var(--mv-surface)] px-4">
              {lines.map((item) => (
                <li key={item.product_id} className="flex items-baseline gap-2 py-2.5">
                  <span className="shrink-0 text-sm font-bold tabular-nums text-[var(--mv-primary)]">
                    {item.quantity}x
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium text-[var(--mv-text)]">
                    {item.name}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-[var(--mv-text-muted)]">
                    {formatPrice(lineTotal(item))}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <label
              htmlFor="order-notes"
              className="flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-[var(--mv-text-muted)]"
            >
              <span>Observações do pedido</span>
              <span
                className={notesLeft <= 30 ? "tabular-nums text-amber-600" : "tabular-nums"}
                aria-live="polite"
              >
                {notes.length}/{ORDER_NOTES_MAX}
              </span>
            </label>
            <textarea
              id="order-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value.slice(0, ORDER_NOTES_MAX))}
              maxLength={ORDER_NOTES_MAX}
              rows={2}
              placeholder="Ex.: sem cebola, ponto da carne bem passado"
              className="mt-1.5 w-full resize-none rounded-2xl border border-[var(--mv-border)] bg-[var(--mv-surface)] px-3.5 py-2.5 text-sm text-[var(--mv-text)] placeholder:text-[var(--mv-text-muted)] focus:border-[var(--mv-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--mv-primary-soft)]"
            />
          </div>

          {/*
            Identificação opcional — Etapa 24.

            O bloco nasce fechado, num único botão. Quem não quer pontos não vê
            formulário; quem quer abre, preenche e marca o aceite. Nome e
            WhatsApp são **ambos opcionais** (com um dos dois já dá para
            reconhecer), e o aceite é obrigatório só para quem optou por se
            identificar — ver `upsert_customer_for_order`.
          */}
          {showIdentify && (
            <div className="rounded-2xl border border-[var(--mv-border)] bg-[var(--mv-surface)] px-4 py-3.5">
              {!identify ? (
                <button
                  type="button"
                  onClick={() => {
                    setIdentify(true);
                    setIdentifyError(null);
                  }}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[var(--mv-text)]">
                      Quero acumular pontos
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-[var(--mv-text-muted)]">
                      {programText}
                      {previewPoints > 0 ? ` · este pedido vale ${previewPoints} pontos` : ""}
                    </span>
                  </span>
                  <Star
                    className="size-5 shrink-0 text-[var(--mv-primary)]"
                    aria-hidden="true"
                  />
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--mv-text)]">
                        Seus pontos
                      </p>
                      <p className="mt-0.5 text-xs leading-snug text-[var(--mv-text-muted)]">
                        {programText}
                        {previewPoints > 0 ? ` · este pedido vale ${previewPoints} pontos` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIdentify(false);
                        setIdentifyError(null);
                      }}
                      className="shrink-0 text-xs font-semibold text-[var(--mv-text-muted)] underline"
                    >
                      Agora não
                    </button>
                  </div>

                  <div className="grid gap-2">
                    <label className="block">
                      <span className="text-xs font-medium text-[var(--mv-text-muted)]">Nome</span>
                      <input
                        type="text"
                        value={customerName}
                        onChange={(event) =>
                          setCustomerName(event.target.value.slice(0, MAX_CUSTOMER_NAME))
                        }
                        maxLength={MAX_CUSTOMER_NAME}
                        autoComplete="name"
                        placeholder="Como quer ser chamado"
                        className="mt-1 w-full rounded-xl border border-[var(--mv-border)] bg-[var(--mv-bg)] px-3 py-2 text-sm text-[var(--mv-text)] placeholder:text-[var(--mv-text-muted)] focus:border-[var(--mv-primary)] focus:outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-[var(--mv-text-muted)]">WhatsApp</span>
                      <input
                        type="tel"
                        inputMode="tel"
                        value={customerPhone}
                        onChange={(event) => setCustomerPhone(maskPhoneInput(event.target.value))}
                        autoComplete="tel"
                        placeholder="(85) 99999-8888"
                        className="mt-1 w-full rounded-xl border border-[var(--mv-border)] bg-[var(--mv-bg)] px-3 py-2 text-sm text-[var(--mv-text)] placeholder:text-[var(--mv-text-muted)] focus:border-[var(--mv-primary)] focus:outline-none"
                      />
                    </label>
                  </div>

                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                      className="mt-0.5 size-4 shrink-0 accent-[var(--mv-primary)]"
                    />
                    <span className="text-[11px] leading-snug text-[var(--mv-text-muted)]">
                      {CONSENT_TEXT}
                    </span>
                  </label>

                  {identifyError && (
                    <p className="text-xs font-medium text-red-600" role="alert">
                      {identifyError}
                    </p>
                  )}

                  <p className="text-[11px] leading-snug text-[var(--mv-text-muted)]">
                    Versão do aceite: {CONSENT_VERSION}. Você pode pedir a exclusão dos seus
                    dados ao restaurante a qualquer momento.
                  </p>
                </div>
              )}
            </div>
          )}

          <div
            className="flex items-baseline justify-between rounded-2xl px-4 py-3"
            style={{ backgroundColor: tokens.button, color: tokens.buttonText }}
          >
            <span className="text-sm text-white/80">Total</span>
            <span className="text-xl font-bold tabular-nums">{formatPrice(subtotal)}</span>
          </div>

          <p className="text-center text-xs leading-snug text-[var(--mv-text-muted)]">
            O preço final é confirmado pela cozinha ao aceitar o pedido.
          </p>

          {sending && (
            <p className="flex items-center justify-center gap-2 text-xs text-[var(--mv-text-muted)]" role="status">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Enviando para a cozinha…
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}
