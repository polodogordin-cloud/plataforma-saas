import "server-only";

import { readEnvironment, resolveAppEnv, type AppEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Diagnóstico da implantação — Etapa 20.
 *
 * ─── Por que existe ────────────────────────────────────────────────────────
 *
 * A Etapa 14 criou `/api/health` para responder "o deploy subiu e o login não
 * funciona, qual das peças caiu?". Este módulo é a mesma pergunta feita para
 * **mais** peças (autenticação, armazenamento, realtime, webhooks) e em um
 * formato que serve tanto ao monitor de uptime quanto à tela técnica do
 * `/admin`.
 *
 * ─── A regra que não se negocia ────────────────────────────────────────────
 *
 * **Nunca devolve valor de configuração.** Cada peça responde um estado curto:
 *
 *   `up`           — respondeu, como esperado
 *   `down`         — não respondeu
 *   `unconfigured` — a variável não existe neste ambiente
 *   `disabled`     — existe e está desligada de propósito (webhook, realtime)
 *   `degraded`     — respondeu, mas não como o esperado
 *   `unknown`      — não foi possível medir sem efeito colateral
 *
 * Nada de URL do projeto, chave, nome de bucket com dado de cliente, mensagem
 * crua do Postgres ou stack trace. O motivo é o mesmo do endpoint original:
 * diagnóstico é lido por quem descobriu a URL, e mensagem de driver cita host e
 * porta; mensagem de Postgres cita schema e nome de função.
 *
 * ─── O que é medido e como ─────────────────────────────────────────────────
 *
 * Tudo é uma chamada barata e **sem efeito colateral** (nenhum `insert`, nenhum
 * `update`). Onde a medição exigiria escrever — upload de teste, evento de
 * realtime — a peça aparece como `unknown`, e a tela diz que não foi medido.
 * Inventar "tudo certo" num painel é pior do que admitir que não se mediu.
 */

export type CheckState =
  | "up"
  | "down"
  | "unconfigured"
  | "disabled"
  | "degraded"
  | "unknown";

export type Check = {
  /** Identificador estável (usado na UI como âncora). */
  id: "database" | "auth" | "storage" | "realtime" | "webhooks" | "environment";
  label: string;
  state: CheckState;
  /** Explicação curta em português, sem detalhe de infraestrutura. */
  detail: string;
};

export type DiagnosticsReport = {
  ok: boolean;
  env: AppEnv;
  version: string;
  checkedAt: string;
  /** Versão do commit, quando a plataforma informa (Vercel). */
  revision: string | null;
  checks: Check[];
};

/** Versão exibida. Vem do `package.json` em tempo de build. */
const APP_VERSION = "0.1.0";

function stateDetail(state: CheckState, up: string, down: string): string {
  return state === "up" ? up : down;
}

/**
 * Banco + autenticação.
 *
 * `public_plans` prova três coisas de uma vez: a URL está certa, a chave anon
 * está certa e o Postgres está de pé. Ela é `SECURITY DEFINER` e liberada para
 * `anon` — não depende de sessão, então funciona antes de qualquer login.
 */
async function checkDatabaseAndAuth(): Promise<{
  database: { state: CheckState; detail: string };
  auth: { state: CheckState; detail: string };
}> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return {
      database: { state: "unconfigured", detail: "Sem URL ou chave do Supabase neste ambiente." },
      auth: { state: "unconfigured", detail: "Depende do Supabase, que não está configurado." },
    };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("public_plans");

    if (error) {
      const code = (error.code ?? "").toUpperCase();
      const status = Number(error.code);

      // 401/403 = chave recusada. É problema de autenticação, não de banco:
      // separar os dois evita "o banco caiu" quando a chave foi rotacionada.
      if (code === "PGRST301" || status === 401 || status === 403) {
        return {
          database: { state: "up", detail: "Conectado, mas a chave pública foi recusada." },
          auth: { state: "down", detail: "A chave pública foi recusada pelo projeto." },
        };
      }
      if (status === 404 || code === "PGRST202") {
        return {
          database: { state: "degraded", detail: "Conectado, mas falta a função de diagnóstico (migration)." },
          auth: { state: "degraded", detail: "Não foi possível confirmar a autenticação." },
        };
      }
      return {
        database: { state: "down", detail: "O banco respondeu com erro." },
        auth: { state: "down", detail: "Não foi possível confirmar a autenticação." },
      };
    }

    return {
      database: { state: "up", detail: "Consultas respondendo." },
      auth: { state: "up", detail: "Chave pública aceita pelo projeto." },
    };
  } catch {
    return {
      database: { state: "down", detail: "Sem alcance ao banco (DNS, TLS ou timeout)." },
      auth: { state: "down", detail: "Depende do banco, que não respondeu." },
    };
  }
}

/**
 * Armazenamento.
 *
 * `listBuckets` é chamada **com a sessão do usuário** (não existe chave
 * service_role no app, por escolha). Um usuário autenticado comum não tem
 * permissão de listar buckets — então o esperado aqui é um erro de permissão:
 * ele prova que a API de Storage respondeu e que a RLS está no caminho. Um
 * "sucesso" retornando buckets também é `up` (acontece se a policy mudar).
 *
 * Se a chamada falhar por rede, é `down`. Se a URL nem existe, `unconfigured`.
 */
async function checkStorage(): Promise<{ state: CheckState; detail: string }> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return { state: "unconfigured", detail: "Sem URL do Supabase neste ambiente." };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.storage.listBuckets();

    if (!error) {
      return {
        state: "up",
        detail: `API de armazenamento respondendo${data ? ` (${data.length} bucket(s) visível(is))` : ""}.`,
      };
    }

    // Erro de autorização aqui é o comportamento esperado — e uma boa notícia.
    const message = `${error.message ?? ""}`.toLowerCase();
    if (message.includes("permission") || message.includes("not allowed") || message.includes("policy")) {
      return { state: "up", detail: "API respondendo e negando listagem (RLS no lugar)." };
    }

    // Qualquer outra coisa é falha de verdade, mas sem repassar a mensagem.
    return { state: "down", detail: "A API de armazenamento não respondeu como esperado." };
  } catch {
    return { state: "down", detail: "Sem alcance ao armazenamento." };
  }
}

/**
 * Realtime.
 *
 * Não há como provar que o canal entrega sem abrir uma conexão WebSocket e
 * receber um evento — o que é caro e tem efeito colateral num endpoint público.
 * O que **dá** para afirmar sem mentir: se a URL do Supabase existe (o app
 * deriva o endpoint `wss://` dela) e se o recurso está no plano. Marcar `up` só
 * porque a variável existe seria exatamente o "tudo certo" inventado que este
 * painel não faz. Por isso: `unknown`, com o motivo.
 */
function checkRealtime(): { state: CheckState; detail: string } {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return { state: "unconfigured", detail: "Sem URL do Supabase neste ambiente." };
  }
  return {
    state: "unknown",
    detail: "Não medido: exigiria abrir canal e receber evento. Endpoint derivado da URL do projeto.",
  };
}

/**
 * Webhooks.
 *
 * A Etapa 19 (cobrança por PIX) não usa webhook — a confirmação é humana e
 * registrada. Dizer "webhooks OK" quando não existe provedor seria mentira; o
 * estado correto é `disabled` enquanto `PAYMENT_PROVIDER` não apontar para um
 * provedor com entrega assíncrona.
 */
function checkWebhooks(): { state: CheckState; detail: string } {
  const provider = (process.env.PAYMENT_PROVIDER ?? "manual_pix").trim().toLowerCase();
  const hasProvider = provider !== "manual_pix" && provider !== "manual";

  if (!hasProvider) {
    return {
      state: "disabled",
      detail: "Nenhum provedor com entrega assíncrona. Confirmação de pagamento é manual.",
    };
  }

  return {
    state: process.env.PAYMENT_WEBHOOK_SECRET ? "unconfigured" : "down",
    detail: process.env.PAYMENT_WEBHOOK_SECRET
      ? `Provedor "${provider}" configurado, mas a rota de webhook ainda não existe nesta versão.`
      : "Provedor configurado sem segredo de webhook definido.",
  };
}

/** Ambiente e variáveis obrigatórias. */
function checkEnvironment(): { state: CheckState; detail: string } {
  const { vars, ok } = readEnvironment();
  const missing = vars.filter((item) => item.state !== "set");

  if (ok) return { state: "up", detail: "Todas as variáveis obrigatórias presentes." };

  // Só a contagem e o nome das que faltam: nome de variável não é segredo e é o
  // que a pessoa precisa para corrigir.
  return {
    state: "down",
    detail: `Faltando ou inválida(s): ${missing.map((item) => item.name).join(", ")}.`,
  };
}

/**
 * Relatório completo.
 *
 * `ok` é `false` quando alguma peça **essencial** está fora: banco, autenticação
 * ou ambiente. `unknown`/`disabled`/`degraded` não derrubam o serviço — realtime
 * não medido não impede ninguém de pedir comida.
 */
export async function readDiagnostics(): Promise<DiagnosticsReport> {
  const [{ database, auth }, storage] = await Promise.all([
    checkDatabaseAndAuth(),
    checkStorage(),
  ]);

  const environment = checkEnvironment();
  const checks: Check[] = [
    { id: "database", label: "Banco de dados", ...database },
    { id: "auth", label: "Autenticação", ...auth },
    { id: "storage", label: "Armazenamento", ...storage },
    { id: "realtime", label: "Realtime", ...checkRealtime() },
    { id: "webhooks", label: "Webhooks", ...checkWebhooks() },
    { id: "environment", label: "Ambiente e variáveis", ...environment },
  ];

  const essential = checks.filter((c) =>
    ["database", "auth", "environment"].includes(c.id),
  );

  return {
    ok: essential.every((c) => c.state === "up" || c.state === "degraded"),
    env: resolveAppEnv(),
    version: APP_VERSION,
    checkedAt: new Date().toISOString(),
    revision: revision(),
    checks,
  };
}

/**
 * Commit do deploy, quando a plataforma informa.
 *
 * Na Vercel chega em `VERCEL_GIT_COMMIT_SHA`; fora dela, `null`. Não é segredo:
 * um SHA de commit público não dá acesso a nada. Serve para o suporte confirmar
 * que o cliente está na versão que já tem a correção.
 */
export function revision(): string | null {
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? "").trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return null;
  // Minúsculo para o suporte comparar com `git log --oneline` sem tropeçar em
  // maiúscula de plataforma.
  return sha.slice(0, 7).toLowerCase();
}

/** Atalho usado pelo `/api/health` para o resumo público. */
export function summarize(report: DiagnosticsReport): { ok: boolean; state: CheckState } {
  if (report.ok) return { ok: true, state: "up" };
  const firstBad = report.checks.find((c) => c.state === "down" || c.state === "unconfigured");
  return { ok: false, state: firstBad?.state ?? "down" };
}

export { stateDetail };
