import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Entrega o service worker — Etapa 12.
 *
 * Servido por rota em vez de arquivo estático por dois motivos que se somam:
 *
 *   1. **A versão precisa mudar a cada deploy.** O `VERSION` do SW é o que faz o
 *      navegador instalar a versão nova e apagar os caches antigos. Um arquivo
 *      com versão fixa nunca invalida nada — o clássico "limpa o cache que
 *      funciona". Aqui a versão é derivada do conteúdo do próprio SW mais a data
 *      do build, então qualquer mudança a altera.
 *
 *   2. **`Cache-Control` correto.** Servido como estático comum, o `sw.js` pode
 *      ficar em cache por muito tempo e a correção nunca chegar. Esta rota força
 *      revalidação e declara `Service-Worker-Allowed`.
 *
 * O corpo vem de `src/sw-source.js` (JS puro, legível e versionado). O arquivo
 * é lido do sistema em tempo de execução: em produção ele já está no bundle do
 * servidor.
 */
export const dynamic = "force-static";

/**
 * Versão do cache.
 *
 * É o **hash do conteúdo** do service worker. Consequência importante: a versão
 * só muda quando a política de cache muda. Um deploy que só mexe em página não
 * força o usuário a rebaixar tudo de novo — e um commit que muda o SW muda a
 * versão com certeza, mesmo que o arquivo tenha o mesmo tamanho de antes
 * (era esse o buraco de usar tamanho ou data).
 */
function cacheVersion(source: string): string {
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
  return `menuvo-v1-${hash}`;
}

function swSource(): string {
  // `process.cwd()` é a raiz do projeto em `next start` e na Vercel.
  const candidates = [
    join(process.cwd(), "src", "sw-source.js"),
    join(process.cwd(), "..", "src", "sw-source.js"),
  ];

  for (const file of candidates) {
    try {
      return readFileSync(file, "utf8");
    } catch {
      // tenta o próximo
    }
  }

  // Sem o fonte, devolve um SW que apenas assume o controle: o app continua
  // funcionando como site normal, sem cache — degradar é melhor que 500.
  return `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));`;
}

export function GET(): Response {
  const source = swSource();
  const body = source.replaceAll("__CACHE_VERSION__", cacheVersion(source));

  return new Response(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // `must-revalidate`: o navegador sempre pergunta. Um SW em cache longo é
      // um deploy que não chega.
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Service-Worker-Allowed": "/",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
