import "server-only";

/**
 * Limite de requisições — Etapa 14.
 *
 * ─── O que este módulo é, e o que ele não é ───────────────────────────────
 *
 * É um contador **em memória do processo**. Isso resolve o abuso real desta
 * fase — alguém segurando F5 num link de cardápio, ou um script batendo em
 * `/entrar` com senhas — e é o que dá para fazer sem contratar infraestrutura.
 * **Não** é um limite distribuído: cada instância serverless tem o seu mapa, e a
 * Vercel pode subir cinco instâncias ao mesmo tempo. Com duas instâncias, o
 * limite efetivo é o dobro; a instância que reciclou esquece o histórico.
 *
 * Por isso o limite é generoso por padrão: ele existe para barrar rajada, não
 * para cobrar cota. Quem precisar de garantia (plano por IP, por conta) liga um
 * Redis/Upstash atrás da mesma interface `RateLimiter` — nenhum chamador muda.
 *
 * O módulo é neutro (sem `next/*`, sem `window`), então o mesmo código roda no
 * middleware (edge) e nos route handlers (Node) e é testável direto.
 */

export type RateLimitRule = {
  /** Identificador do balde. Ex.: `auth:signin`. */
  name: string;
  /** Quantas requisições cabem na janela. */
  limit: number;
  /** Tamanho da janela em milissegundos. */
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Quando a janela atual se encerra (epoch ms). */
  resetAt: number;
  /** Segundos até poder tentar de novo quando `allowed` é false. */
  retryAfter: number;
};

/**
 * Regras por rota.
 *
 * Os números foram escolhidos pela ação do usuário, não por benchmark:
 *
 *   • `auth:signin` 10/5min por IP — uma pessoa erra a senha 2, 3 vezes. 10
 *     dá folga para quem tem pressa e ainda torna a força bruta inviável
 *     (10 tentativas a cada 5 minutos = ~2.880 por dia, contra 1 em 10^9 de
 *     chance por senha razoável).
 *   - `auth:signup` 5/hora — cadastro em massa é o vetor de poluição de banco.
 *   • `auth:recover` 5/hora — cada chamada dispara e-mail; o custo é do
 *     provedor e o incomodo é da caixa de entrada do usuário.
 *   • `order:create` 30/min por IP — o banco já tem anti-duplicata e cooldown
 *     por mesa; isto barra o script que varre tokens.
 *   • `public:menu` 240/min — um cardápio real carrega HTML + RSC + imagens;
 *     240 cobre turma inteira abrindo o QR ao mesmo tempo e ainda barra
 *     raspagem.
 */
export const RATE_LIMITS = {
  signIn: { name: "auth:signin", limit: 10, windowMs: 5 * 60_000 },
  signUp: { name: "auth:signup", limit: 5, windowMs: 60 * 60_000 },
  recover: { name: "auth:recover", limit: 5, windowMs: 60 * 60_000 },
  orderCreate: { name: "order:create", limit: 30, windowMs: 60_000 },
  tableRequest: { name: "table:request", limit: 20, windowMs: 60_000 },
  publicMenu: { name: "public:menu", limit: 240, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

type Bucket = { count: number; resetAt: number };

/**
 * Map global: no edge runtime, cada invocação pode reusar o mesmo isolate, e
 * um `Map` de módulo sobrevive entre requisições enquanto o processo viver.
 */
const globalStore = globalThis as unknown as {
  __menuvoRateLimit?: Map<string, Bucket>;
};

function store(): Map<string, Bucket> {
  globalStore.__menuvoRateLimit ??= new Map();
  return globalStore.__menuvoRateLimit;
}

/** Quantas chaves guardamos antes de varrer as expiradas. */
const SWEEP_THRESHOLD = 5_000;

export function checkRateLimit(
  rule: RateLimitRule,
  key: string,
  now: number = Date.now(),
): RateLimitResult {
  const map = store();
  const bucketKey = `${rule.name}:${key}`;

  // Sem esta varredura, um ataque com milhares de IPs deixa o mapa crescer
  // para sempre — o limitador vira o vetor de consumo de memória.
  if (map.size > SWEEP_THRESHOLD) {
    for (const [k, v] of map) {
      if (v.resetAt <= now) map.delete(k);
    }
  }

  const current = map.get(bucketKey);

  if (!current || current.resetAt <= now) {
    const resetAt = now + rule.windowMs;
    map.set(bucketKey, { count: 1, resetAt });
    return {
      allowed: true,
      limit: rule.limit,
      remaining: rule.limit - 1,
      resetAt,
      retryAfter: 0,
    };
  }

  current.count += 1;
  const remaining = Math.max(0, rule.limit - current.count);
  const allowed = current.count <= rule.limit;

  return {
    allowed,
    limit: rule.limit,
    remaining,
    resetAt: current.resetAt,
    retryAfter: allowed ? 0 : Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

/** Só para teste: limpa o estado entre cenários. */
export function resetRateLimits(): void {
  store().clear();
}

/**
 * Identifica o cliente para o balde.
 *
 * Em produção atrás de proxy/CDN, `x-forwarded-for` traz a cadeia
 * `cliente, proxy1, proxy2`; o primeiro é o cliente. Sem o header (dev), cai
 * num balde único — que é o certo: em dev não há abuso a medir.
 *
 * Não é identidade forte: `x-forwarded-for` é forjável se a origem não for
 * confiável. Por isso o limite é de rajada, não de cota, e as decisões
 * realmente sensíveis (autorização) continuam no banco.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? "local";
}

/** Headers padrão de resposta para limite excedido. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
  if (!result.allowed) headers["Retry-After"] = String(result.retryAfter);
  return headers;
}
