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
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
