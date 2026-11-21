"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  EMPTY_CART,
  addToCart as addToCartItems,
  cartLineCount,
  cartStorageKey,
  cartSubtotal,
  parseStoredCart,
  quantityInCart,
  removeFromCart as removeFromCartItems,
  setCartQuantity as setCartQuantityItems,
} from "@/lib/cart";
import type { CartItem, PublicProduct } from "@/lib/types";

/**
 * Carrinho do cliente — Etapa 6.
 *
 * Escopo desta camada:
 *  - guarda os itens em memória e em `localStorage`, para o cliente não perder
 *    o que escolheu ao trocar de tela, girar o celular ou recarregar;
 *  - guarda a MESA da sessão (token + nome) — o cliente nunca digita a mesa,
 *    ela vem do QR Code / NFC da URL (item 4 do escopo);
 *  - não envia nada: quem cria o pedido é `createOrder`, no servidor.
 *
 * O carrinho é separado por token de mesa: trocar de mesa abre outro carrinho,
 * e nada vaza de uma mesa para outra.
 */

type CartContextValue = {
  items: CartItem[];
  /** Total de unidades (2x X-Bacon + 1x Coca = 3). */
  count: number;
  /** Estimativa local do subtotal — o total oficial vem do banco. */
  subtotal: number;
  /** `false` quando o cardápio foi aberto sem QR Code/NFC de mesa. */
  canOrder: boolean;
  tableName: string | null;
  tableToken: string | null;
  addItem: (product: PublicProduct, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clear: () => void;
  quantityOf: (productId: string) => number;
  /** Falso até o carrinho salvo ser lido — evita "piscar" vazio no 1º paint. */
  ready: boolean;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({
  children,
  tableToken,
  tableName,
}: {
  children: React.ReactNode;
  tableToken?: string | null;
  tableName?: string | null;
}) {
  const [items, setItems] = useState<CartItem[]>(EMPTY_CART);
  const [ready, setReady] = useState(false);
  const storageKey = tableToken ? cartStorageKey(tableToken) : null;
  /** Evita gravar por cima do carrinho salvo antes de hidratar. */
  const hydrated = useRef(false);

  // Carrega o carrinho salvo daquela mesa.
  useEffect(() => {
    if (!storageKey) {
      setReady(true);
      return;
    }
    try {
      setItems(parseStoredCart(window.localStorage.getItem(storageKey)));
    } catch {
      setItems(EMPTY_CART);
    }
    hydrated.current = true;
    setReady(true);
  }, [storageKey]);

  // Persiste a cada mudança (depois da hidratação).
  useEffect(() => {
    if (!storageKey || !hydrated.current) return;
    try {
      if (items.length === 0) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, JSON.stringify(items));
    } catch {
      // Modo privado / cota cheia: o carrinho segue só em memória.
    }
  }, [items, storageKey]);

  const addItem = useCallback((product: PublicProduct, quantity = 1) => {
    setItems((current) => addToCartItems(current, product, quantity));
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setItems((current) => setCartQuantityItems(current, productId, quantity));
  }, []);

  const removeItem = useCallback((productId: string) => {
    setItems((current) => removeFromCartItems(current, productId));
  }, []);

  const clear = useCallback(() => setItems(EMPTY_CART), []);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      count: cartLineCount(items),
      subtotal: cartSubtotal(items),
      canOrder: Boolean(tableToken),
      tableName: tableName ?? null,
      tableToken: tableToken ?? null,
      addItem,
      setQuantity,
      removeItem,
      clear,
      quantityOf: (productId: string) => quantityInCart(items, productId),
      ready,
    }),
    [items, tableToken, tableName, addItem, setQuantity, removeItem, clear, ready],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart precisa estar dentro de <CartProvider>.");
  }
  return context;
}
