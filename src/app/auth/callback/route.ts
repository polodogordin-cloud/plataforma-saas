import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Troca o código do Supabase Auth por uma sessão.
 * Usado por: confirmação de e-mail, recuperação de senha e magic links.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/app";
  // Só aceita caminhos internos — evita open redirect.
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/app";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/entrar?erro=link-invalido`);
}
