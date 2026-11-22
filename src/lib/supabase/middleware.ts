import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/env";

/**
 * Renova a sessão do Supabase em cada requisição e protege rotas privadas.
 * Padrão recomendado pelo @supabase/ssr — mantém os cookies sincronizados
 * entre Server Components, Server Actions e o navegador.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // `/admin` entra aqui só para exigir **sessão**. O papel de plataforma é
  // checado no layout e, de novo, em cada RPC — o middleware não consulta o
  // banco de propósito: ele roda em toda rota, e uma consulta por requisição
  // para decidir autorização seria lenta e frágil (o papel mudaria com cache).
  const isPrivate =
    pathname.startsWith("/app") ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/configuracoes") ||
    // Etapa 17: a cozinha é área autenticada, mas fora de `/app` — o KDS não
    // usa a navegação do salão. Só exige sessão aqui; o papel é decidido na
    // página e, de novo, nas RPCs.
    pathname === "/kitchen" ||
    pathname.startsWith("/kitchen/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    // Etapa 19: `/dashboard/billing` é o endereço que o escopo usa para a tela
    // de pagamento (o app fala pt-BR e a página real é `/app/pagamento`). Sem
    // esta linha, o alias abriria sem sessão e só falharia lá dentro.
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/");

  const isAuthPage =
    pathname === "/entrar" || pathname === "/criar-conta" || pathname === "/recuperar-senha";

  if (!user && isPrivate) {
    const url = request.nextUrl.clone();
    url.pathname = "/entrar";
    // Só caminho interno: `next` volta para o usuário depois do login e não
    // pode servir de trampolim para outro domínio.
    url.searchParams.set("next", safeRedirectPath(pathname, "/app"));
    return NextResponse.redirect(url);
  }

  // Já logado não precisa ver login/cadastro
  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    const next = safeRedirectPath(request.nextUrl.searchParams.get("next"), "/app");
    // Quem veio de /admin volta para /admin depois do login.
    url.pathname = next.startsWith("/admin") ? next : "/app";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
