"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Minus, Plus, Star, X } from "lucide-react";
import { primaryButtonBase, primaryButtonStyle } from "@/components/public/themed";
import { DEFAULT_THEME } from "@/lib/theme";
import { formatPrice } from "@/lib/validation";
import type { PublicProduct, RestaurantTheme } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Detalhe do produto — tela cheia no celular, modal no desktop.
 *
 * Estrutura pensada para a Etapa 7 (adicionais/complementos): o corpo ponto
 * `#product-detail-options` é o encaixe reservado para os grupos de opções,
 * e o rodapé já calcula `preço unitário × quantidade` antes de qualquer extra.
 *
 * O botão "Adicionar ao pedido" entrega `(produto, quantidade)` ao carrinho e
 * fecha o painel. Quem decide o que fazer é o cardápio: aqui não há chamada de
 * rede, não há pedido — o envio só acontece na confirmação do carrinho.
 */
export function ProductDetail({
  product,
  open,
  onClose,
  onAdd,
  theme = DEFAULT_THEME,
}: {
  product: PublicProduct | null;
  open: boolean;
  onClose: () => void;
  /** Adiciona ao carrinho. Sem este callback o botão só confirma visualmente. */
  onAdd?: (product: PublicProduct, quantity: number) => void;
  /** Tema do cardápio — o detalhe é uma tela cheia, então segue as cores. */
  theme?: RestaurantTheme;
}) {
  const [mounted, setMounted] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [dragY, setDragY] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const dragStart = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // Reinicia a quantidade a cada produto aberto.
  useEffect(() => {
    if (!open) return;
    setQuantity(1);
    setFeedback(null);
    setDragY(0);
  }, [open, product?.id]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    const timer = window.setTimeout(() => panelRef.current?.focus(), 80);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  const trapFocus = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  if (!mounted || !open || !product) return null;

  const total = product.price * quantity;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Fechar"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-ink-950/50 backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-detail-title"
        tabIndex={-1}
        onKeyDown={trapFocus}
        style={{ transform: dragY ? `translateY(${dragY}px)` : undefined }}
        className={cn(
          "relative flex max-h-[94dvh] w-full flex-col overflow-hidden bg-[var(--mv-surface)] text-[var(--mv-text)] shadow-2xl outline-none sm:max-w-md sm:rounded-3xl",
          "animate-pop-in rounded-t-[1.75rem]",
          dragY === 0 && "transition-transform duration-200 sm:transition-none",
        )}
      >
        {/* Alça de arraste */}
        <div
          className="absolute inset-x-0 top-0 z-10 flex touch-none justify-center pt-2 sm:hidden"
          onPointerDown={(event) => {
            dragStart.current = event.clientY;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (dragStart.current === null) return;
            const delta = event.clientY - dragStart.current;
            if (delta > 0) setDragY(delta);
          }}
          onPointerUp={() => {
            if (dragY > 120) onClose();
            setDragY(0);
            dragStart.current = null;
          }}
          aria-hidden="true"
        >
          <span className="h-1.5 w-10 rounded-full bg-white/80 shadow-sm backdrop-blur-sm" />
        </div>

        {/* Fechar */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar detalhes"
          className="absolute right-3 top-3 z-20 grid size-10 place-items-center rounded-full bg-ink-950/55 text-white backdrop-blur-sm transition-transform active:scale-90"
        >
          <X className="size-5" aria-hidden="true" />
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {/* Imagem grande */}
          <div className="relative aspect-[4/3] w-full bg-[var(--mv-surface-muted)]">
            {product.image_url ? (
              <Image
                src={product.image_url}
                alt={product.name}
                fill
                sizes="(max-width: 640px) 100vw, 448px"
                priority
                className="object-cover"
              />
            ) : (
              <div className="grid size-full place-items-center bg-[var(--mv-primary-soft)]">
                <span className="text-5xl font-semibold text-[var(--mv-primary)] opacity-30" aria-hidden="true">
                  {product.name.slice(0, 1).toUpperCase()}
                </span>
              </div>
            )}
          </div>

          <div className="px-4 pb-4 pt-4">
            <div className="flex items-start gap-2">
              <h2
                id="product-detail-title"
                className="min-w-0 flex-1 text-xl font-semibold leading-tight text-[var(--mv-text)] text-balance"
              >
                {product.name}
              </h2>
              {product.is_featured && (
                <Star
                  className="mt-1 size-4 shrink-0 fill-[var(--mv-secondary)] text-[var(--mv-secondary)]"
                  aria-label="Destaque da casa"
                />
              )}
            </div>

            {product.description && (
              <p className="mt-2 text-sm leading-relaxed text-[var(--mv-text-muted)]">
                {product.description}
              </p>
            )}

            <p className="mt-3 text-lg font-semibold tabular-nums text-[var(--mv-primary)]">
              {formatPrice(product.price)}
            </p>

            {/*
              Encaixe reservado para adicionais, complementos, sabores e tamanhos.
              Quando existirem (Etapa 7), os grupos entram aqui e o total passa a
              considerar `product.price + extras`.
            */}
            <div id="product-detail-options" data-slot="product-options" className="mt-4" />

            {/* Quantidade */}
            <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-[var(--mv-border)] bg-[var(--mv-surface-muted)] p-2 pl-4">
              <span className="text-sm font-semibold text-[var(--mv-text)]">Quantidade</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                  disabled={quantity <= 1}
                  aria-label="Diminuir quantidade"
                  className="grid size-11 place-items-center rounded-xl bg-[var(--mv-surface)] text-[var(--mv-text)] shadow-sm transition disabled:opacity-40 active:scale-95"
                >
                  <Minus className="size-4.5" aria-hidden="true" strokeWidth={2.5} />
                </button>
                <span
                  className="w-9 text-center text-base font-semibold tabular-nums text-[var(--mv-text)]"
                  aria-live="polite"
                  aria-label={`Quantidade: ${quantity}`}
                >
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity((value) => Math.min(99, value + 1))}
                  aria-label="Aumentar quantidade"
                  className="grid size-11 place-items-center rounded-xl bg-[var(--mv-surface)] text-[var(--mv-text)] shadow-sm transition active:scale-95"
                >
                  <Plus className="size-4.5" aria-hidden="true" strokeWidth={2.5} />
                </button>
              </div>
            </div>

          </div>
        </div>

        {/* Aviso fica FORA da área rolável: se o cliente tocar o botão com a
            página rolada até o fim, a mensagem não pode nascer escondida. */}
        {feedback && (
          <p
            role="status"
            className="shrink-0 bg-amber-50 px-4 py-2.5 text-center text-sm font-medium text-amber-800"
          >
            {feedback}
          </p>
        )}

        {/* Rodapé fixo */}
        <footer
          className="shrink-0 border-t border-[var(--mv-border)] bg-[var(--mv-surface)] px-4 pt-3"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
        >
          <button
            type="button"
            onClick={() => {
              // Sem mesa (link sem QR/NFC) o cardápio continua navegável, mas
              // não há para onde enviar: avisamos em vez de fingir um carrinho.
              if (!onAdd) {
                setFeedback("Abra o cardápio pelo QR Code da mesa para fazer pedidos.");
                return;
              }
              onAdd(product, quantity);
            }}
            className={cn(primaryButtonBase, "w-full min-h-[3.25rem] justify-between px-5 text-base")}
            style={primaryButtonStyle(theme)}
          >
            <span>Adicionar ao pedido</span>
            <span className="tabular-nums">{formatPrice(total)}</span>
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
