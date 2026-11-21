import { NextResponse } from "next/server";
import { readEnvironment } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Diagnóstico da implantação — `/api/health`.
 *
 * ─── Por que existe ──────────────────────────────────────────────────────
 *
 * "O deploy subiu, mas o login não funciona" tem três causas comuns: variável
 * de ambiente faltando, chave trocada, ou banco fora do ar. Descobrir qual
 * delas olhando o log da Vercel é lento; um GET neste endpoint responde em um
 * segundo.
 *
 * ─── O que ele publica, e o que não publica ──────────────────────────────
 *
 * Publica **estado**, nunca valor: `set` / `missing` / `invalid`, o ambiente
 * (`development` / `staging` / `production`) e se o banco respondeu. Não
 * publica URL do Supabase, chave, contagem de tabela, nome de restaurante nem
 * mensagem de erro crua — mensagem de erro do Postgres costuma citar schema e
 * nome de função.
 *
 * ─── Por que é protegido em produção ─────────────────────────────────────
 *
 * Saber que o banco está fora do ar é informação útil para quem quer explorar.
 * Com `HEALTH_CHECK_SECRET` definido, exige `Authorization: Bearer <secret>` e
 * responde 401 sem ele. Sem a variável, responde só o mínimo (`ok` e
 * `env`) — o suficiente para um monitor de uptime, insuficiente para
 * reconhecimento.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { env, vars, ok } = readEnvironment();
  const secret = process.env.HEALTH_CHECK_SECRET?.trim();

  const authorized = secret
    ? timingSafeEqual(readBearer(request), secret)
    : false;

  // Sem segredo configurado, produção mostra o mínimo; fora de produção, o
  // relatório completo (é onde ele ajuda a depurar).
  const detailed = authorized || !secret;

  const database = await checkDatabase();

  const healthy = ok && database.state !== "down";

  const body: Record<string, unknown> = {
    ok: healthy,
    env,
    checkedAt: new Date().toISOString(),
  };

  if (detailed) {
    body.database = database.state;
    body.envVars = vars.map((item) => ({
      name: item.name,
      state: item.state,
      // A dica só aparece quando algo está errado: "tudo certo" não precisa
      // de texto, e listar impacto de tudo polui o JSON.
      ...(item.state === "set" ? {} : { impact: item.impact }),
    }));
    if (database.state === "down") {
      // Motivo classificado, não a mensagem do driver (que cita host e porta).
      body.databaseError = database.reason;
    }
  }

  return NextResponse.json(body, {
    status: healthy ? 200 : 503,
    headers: {
      // Diagnóstico nunca vai para cache: o valor de agora é o que importa.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

type DatabaseState =
  | { state: "up" }
  | { state: "unconfigured" }
  | { state: "down"; reason: string };

/**
 * Uma consulta barata que **também** prova autenticação: `public_plans` é uma
 * RPC aberta ao papel `anon`. Se ela responde, URL e chave anon estão certas e
 * o Postgres está de pé — os três problemas que motivam este endpoint.
 */
async function checkDatabase(): Promise<DatabaseState> {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return { state: "unconfigured" };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("public_plans");

    if (error) {
      // Classifica em vez de repassar: a mensagem do PostgREST traz detalhe de
      // infraestrutura, e este endpoint pode ser lido por quem descobriu a URL.
      const code = (error.code ?? "").toUpperCase();
      const status = Number(error.code);
      if (code === "PGRST301" || status === 401 || status === 403) {
        return { state: "down", reason: "auth_rejected" };
      }
      if (status === 404 || code === "PGRST202") {
        return { state: "down", reason: "rpc_missing" };
      }
      return { state: "down", reason: "query_failed" };
    }

    return { state: "up" };
  } catch {
    // Timeout, DNS, TLS: o banco não está alcançável deste processo.
    return { state: "down", reason: "unreachable" };
  }
}

function readBearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? "";
}

/**
 * Comparação em tempo constante.
 *
 * `===` sai no primeiro carácter diferente, e a diferença de tempo entre "não
 * bate a primeira letra" e "bate quase tudo" é mensurável — dá para descobrir
 * o segredo carácter a carácter. Não é paranoia num endpoint que qualquer um
 * alcança.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
