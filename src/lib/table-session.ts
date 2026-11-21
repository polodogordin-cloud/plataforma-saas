/**
 * Contexto de mesa na sessão do cliente.
 *
 * Por que cookie e não só a URL: nas próximas etapas (carrinho, chamada de
 * garçom, pedido) o cliente navega entre telas e a URL deixa de carregar o
 * token. Guardar o token aqui mantém a mesa identificada sem pedir login.
 *
 * Segurança: o cookie contém **apenas o token público**, o mesmo que está
 * impresso no QR Code e visível na barra de endereço. Não é credencial de
 * painel e não autoriza escrita nenhuma — qualquer ação da Etapa 6 vai
 * revalidar o token no banco (`resolve_table_token`), que por sua vez exige
 * restaurante publicado e mesa ativa.
 *
 * O middleware grava o valor no primeiro acesso; a página lê.
 */

export const TABLE_SESSION_COOKIE = "menuvo_table";

/** `/r/{slug}/table/{token}` — grupo 2 é o token. */
export const TABLE_URL_PATTERN = /^\/r\/([^/]+)\/table\/([^/]+)\/?$/;

/** Formato do token gerado pelo banco: 24 caracteres, sem 0/1/I/L/O. */
const TOKEN_PATTERN = /^[2-9A-HJKMNP-Z]{10,64}$/;

export type TableSession = {
  token: string;
  restaurantSlug: string;
};

export function parseTableToken(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const value = raw.trim().toUpperCase();
  return TOKEN_PATTERN.test(value) ? value : null;
}
