import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  TABLE_SESSION_COOKIE,
  TABLE_URL_PATTERN,
  parseTableToken,
} from "@/lib/table-session";

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);

  // Mesa aberta por QR Code/NFC: guarda o token na sessão do cliente.
  //
  // Por que aqui e não na página: no App Router um Server Component não pode
  // gravar cookies (só Server Actions e Route Handlers podem). O middleware
  // roda antes da página e escreve na resposta, então a Etapa 6 já encontra a
  // mesa na sessão sem exigir login.
  const match = TABLE_URL_PATTERN.exec(request.nextUrl.pathname);
  // Só grava token com o formato emitido pelo banco: qualquer outra coisa na
  // URL não vira cookie de sessão.
  const token = parseTableToken(match?.[2]);

  if (token) {
    if (request.cookies.get(TABLE_SESSION_COOKIE)?.value !== token) {
      response.cookies.set(TABLE_SESSION_COOKIE, token, {
        path: "/",
        // 3 horas: cobre uma refeição; depois a pessoa reescaneia o QR.
        maxAge: 60 * 60 * 3,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Todas as rotas, exceto assets estáticos e imagens.
     *
     * Etapa 12 — as exclusões abaixo **não** são otimização, são correção:
     *
     *   • `manifest.webmanifest` e `sw.js` são o que o navegador busca para
     *     instalar o app. Passando pelo middleware, cada busca criava um cliente
     *     Supabase e um `getUser()` — e, com o Supabase fora do ar, a instalação
     *     falhava por um erro que nada tem a ver com ela. Nenhum dos dois precisa
     *     de sessão: o manifest é público por definição e o SW não vê cookies.
     *
     *   • `offline.html` é servido **justamente quando não há rede**. Se dependesse
     *     do middleware, poderia virar um 500 em vez da tela de "sem conexão" —
     *     exatamente no momento em que ela é a única coisa que o usuário vê.
     *
     * `icons/` já sai pela regra de extensões; está listado por clareza.
     */
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js$|manifest\\.webmanifest$|offline\\.html$|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
