import "server-only";

import { headers } from "next/headers";
import { resolveSiteOrigin, type AppEnv, resolveAppEnv } from "@/lib/env";

/**
 * Origem pública desta requisição — leitura única, no servidor.
 *
 * Existe para que QR Code, `canonical`, sitemap e e-mail de recuperação
 * concordem sobre o endereço do site. Antes, cada um fazia a própria conta com
 * `headers()` e o resultado divergia entre eles.
 *
 * Só é chamável de um contexto com requisição (página, action, route handler).
 */
export async function getRequestOrigin(): Promise<string | null> {
  let host: string | null = null;
  let proto: string | null = null;

  try {
    const headerList = await headers();
    host =
      headerList.get("x-forwarded-host") ??
      headerList.get("host") ??
      null;
    proto = headerList.get("x-forwarded-proto") ?? null;
  } catch {
    // Fora de uma requisição (build estático, teste unitário): só a variável
    // de ambiente responde.
  }

  return resolveSiteOrigin({ requestHost: host, requestProto: proto });
}

/**
 * Origem pública **garantida**: cai no domínio de produção quando nem a
 * variável nem o header respondem.
 *
 * Use quando o valor precisa existir (QR Code, link de e-mail). Para
 * `canonical` prefira `getRequestOrigin`, que devolve `null` e deixa a metadata
 * omitir o campo em vez de inventar um domínio.
 */
export async function requireRequestOrigin(): Promise<string> {
  const origin = await getRequestOrigin();
  if (origin) return origin;

  const env: AppEnv = resolveAppEnv();
  return env === "development" ? "http://localhost:3000" : "https://menuvo.app";
}

/**
 * `metadataBase` — a base para o Next montar `og:image`/`canonical` absolutos.
 *
 * Lê **só** a variável de ambiente, de propósito: `headers()` aqui tornaria a
 * rota dinâmica e mataria o ISR do cardápio (foi o que aconteceu na primeira
 * tentativa desta etapa, e o `npm run build` mostrou a rota mudando de ○/ISR
 * para ƒ).
 *
 * Devolve `undefined` quando não há URL configurada — o Next então usa
 * caminhos relativos, e o `og:image` some em vez de apontar para um domínio
 * inventado. Preferível: um cardápio sem preview no WhatsApp é melhor que um
 * preview com a imagem errada.
 */
export function metadataBaseUrl(): URL | undefined {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return undefined;

  try {
    const url = new URL(configured.includes("://") ? configured : `https://${configured}`);
    return url;
  } catch {
    return undefined;
  }
}
