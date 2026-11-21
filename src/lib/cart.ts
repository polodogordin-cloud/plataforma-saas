import type { CartItem, PublicProduct } from "@/lib/types";

/**
 * Regras do carrinho — Etapa 6.
 *
 * Módulo neutro (sem `server-only`, sem React): o mesmo código roda no
 * navegador, no provider e nos testes. Nada aqui decide preço final: o valor
 * exibido é só uma estimativa; quem manda é o total devolvido pelo banco.
 *
 * O carrinho vive no cliente (contexto + localStorage). Não existe tabela de
 * carrinho no banco: pedido é criado de uma vez, e o que não foi enviado não
 * existe do lado do servidor.
 */

/** Quantidade máxima por item — mesmo limite do banco (`quantity 1..99`). */
export const CART_MAX_QUANTITY = 99;

/** Teto de linhas distintas no carrinho — mesmo limite de `create_order`. */
export const CART_MAX_LINES = 50;

/** Observação do pedido: mesmo limite do banco, para nunca bater no erro. */
export const ORDER_NOTES_MAX = 300;

/** Chave do localStorage. Inclui a mesa: carrinho não atravessa de mesa. */
export const cartStorageKey = (tableToken: string) =>
  `menuvo_cart_${tableToken.toUpperCase()}`;

export function cartLineCount(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

/**
 * Total de uma linha, em reais.
 *
 * Calculado em centavos inteiros: somar `32.90 * 3 + 14.90` em ponto flutuante
 * dá `113.60000000000001`, e um total com esse valor vaza para a tela. O banco
 * usa `numeric`, então arredondar por linha aqui mantém os dois iguais.
 */
export function lineTotal(item: Pick<CartItem, "unit_price" | "quantity">): number {
  return (Math.round(item.unit_price * 100) * item.quantity) / 100;
}

export function cartSubtotal(items: CartItem[]): number {
  // Soma em centavos, divide uma vez só no fim.
  const cents = items.reduce(
    (sum, item) => sum + Math.round(item.unit_price * 100) * item.quantity,
    0,
  );
  return cents / 100;
}

/**
 * Adiciona (ou soma) um produto. Se o item já existe, soma a quantidade e
 * mantém o preço exibido — o preço "de verdade" só é resolvido no envio.
 */
export function addToCart(items: CartItem[], product: PublicProduct, quantity: number): CartItem[] {
  const amount = Math.min(Math.max(Math.trunc(quantity), 1), CART_MAX_QUANTITY);
  const index = items.findIndex((item) => item.product_id === product.id);

  if (index === -1) {
    if (items.length >= CART_MAX_LINES) return items;
    return [
      ...items,
      {
        product_id: product.id,
        name: product.name,
        unit_price: product.price,
        quantity: amount,
      },
    ];
  }

  return items.map((item, position) =>
    position === index
      ? { ...item, quantity: Math.min(item.quantity + amount, CART_MAX_QUANTITY) }
      : item,
  );
}

/** Define a quantidade de uma linha. Zero ou menos remove a linha. */
export function setCartQuantity(
  items: CartItem[],
  productId: string,
  quantity: number,
): CartItem[] {
  const amount = Math.trunc(quantity);
  if (amount <= 0) return items.filter((item) => item.product_id !== productId);

  return items.map((item) =>
    item.product_id === productId
      ? { ...item, quantity: Math.min(amount, CART_MAX_QUANTITY) }
      : item,
  );
}

export function removeFromCart(items: CartItem[], productId: string): CartItem[] {
  return items.filter((item) => item.product_id !== productId);
}

/** Quantidade já no carrinho para um produto (mostrada no detalhe). */
export function quantityInCart(items: CartItem[], productId: string): number {
  return items.find((item) => item.product_id === productId)?.quantity ?? 0;
}

/**
 * Corpo enviado ao banco: **somente** produto e quantidade.
 *
 * Preço, subtotal e total do carrinho ficam de fora de propósito. Se algum dia
 * alguém "otimizar" isto incluindo `price`, o servidor continuaria ignorando —
 * mas o contrato precisa ser óbvio na leitura.
 */
export function toOrderItems(items: CartItem[]): Array<{ product_id: string; quantity: number }> {
  return items.map((item) => ({ product_id: item.product_id, quantity: item.quantity }));
}

/** Recupera o carrinho salvo, descartando qualquer coisa fora do formato. */
export function parseStoredCart(raw: string | null): CartItem[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const items: CartItem[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const { product_id, name, unit_price, quantity } = record;

    if (typeof product_id !== "string" || !product_id) continue;
    if (typeof name !== "string" || !name) continue;
    if (typeof unit_price !== "number" || !Number.isFinite(unit_price) || unit_price < 0) continue;
    if (typeof quantity !== "number" || !Number.isFinite(quantity)) continue;

    const amount = Math.trunc(quantity);
    if (amount < 1) continue;
    if (items.some((item) => item.product_id === product_id)) continue;

    items.push({
      product_id,
      name,
      unit_price,
      quantity: Math.min(amount, CART_MAX_QUANTITY),
    });
    if (items.length >= CART_MAX_LINES) break;
  }

  return items;
}

export const EMPTY_CART: CartItem[] = [];
