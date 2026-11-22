import { NextResponse } from "next/server";
import { readDiagnostics, revision } from "@/lib/diagnostics";

/**
 * Diagnóstico da implantação — `/api/health`.
 *
 * ─── Por que existe ──────────────────────────────────────────────────────
 *
 * "O deploy subiu, mas o login não funciona" tem três causas comuns: variável
 * de ambiente faltando, chave trocada, ou banco fora do ar. Descobrir qual
 * delas olhando o log da Vercel é lento; um GET neste endpoint responde em um
 * segundo. É também o que um monitor de uptime bate a cada minuto.
 *
 * ─── O que ele publica, e o que não publica ──────────────────────────────
 *
 * Publica **estado**, nunca valor: `up` / `down` / `unconfigured` / `disabled`
 * / `degraded` / `unknown`, o ambiente, a versão e o commit curto. Não publica
 * URL do Supabase, chave, nome de bucket, contagem de tabela, nome de
 * restaurante nem mensagem de erro crua — mensagem de erro do Postgres costuma
 * citar schema e nome de função.
 *
 * ─── Por que é protegido em produção ─────────────────────────────────────
 *
 * Saber que o banco está fora do ar é informação útil para quem quer explorar.
 * Com `HEALTH_CHECK_SECRET` definido, o relatório **detalhado** exige
 * `Authorization: Bearer <secret>`; sem ele, a resposta é só o resumo
 * (`ok`, `env`, `version`, `checkedAt`) — o suficiente para um monitor de
 * uptime, insuficiente para reconhecimento.
 *
 * Fora de produção o relatório completo sai livre: é onde ele ajuda a depurar e
 * onde ninguém ganha nada espiando.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const report = await readDiagnostics();
  const secret = process.env.HEALTH_CHECK_SECRET?.trim();
  const authorized = secret ? timingSafeEqual(readBearer(request), secret) : false;

  // Sem segredo configurado fora de produção, o detalhe é liberado. Em produção
  // sem segredo, o detalhe fica fechado — o resumo já responde ao monitor.
  const detailed = authorized || (!secret && report.env !== "production");

  const body: Record<string, unknown> = {
    ok: report.ok,
    env: report.env,
    version: report.version,
    revision: report.revision ?? revision(),
    checkedAt: report.checkedAt,
  };

  if (detailed) {
    body.checks = report.checks.map((check) => ({
      id: check.id,
      label: check.label,
      state: check.state,
      detail: check.detail,
    }));
  } else {
    // Resumo público: um estado agregado, sem dizer qual peça caiu.
    body.state = report.ok ? "up" : "degraded";
  }

  return NextResponse.json(body, {
    status: report.ok ? 200 : 503,
    headers: {
      // Diagnóstico nunca vai para cache: o valor de agora é o que importa.
      "Cache-Control": "no-store, max-age=0",
    },
  });
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
 * bate a primeira letra" e "bate quase tudo" é mensurável — dá para descobrir o
 * segredo carácter a carácter. Não é paranoia num endpoint que qualquer um
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
