import type { NextConfig } from "next";

const supabaseHost = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
      : null;
  } catch {
    return null;
  }
})();

const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /*
   * Compressão: o CDN já comprime, mas `next start` numa VPS sem nginx não.
   * Ter as duas coisas não duplica a compressão — a Vercel passa o stream
   * direto quando o `Content-Encoding` já veio.
   */
  compress: true,

  // `console.log` de depuração sai do bundle de produção; `error` fica.
  compiler: {
    removeConsole: isDev ? false : { exclude: ["error", "warn"] },
  },

  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }]
      : [],
    /*
     * Cardápio é visto em 3G no salão. Servir AVIF/WebP corta 25–50% do peso
     * das fotos de produto em relação ao JPEG original do dono.
     */
    formats: ["image/avif", "image/webp"],
    // Foto de produto não muda depois de enviada; 31 dias de cache no CDN.
    minimumCacheTTL: 60 * 60 * 24 * 31,
  },

  async headers() {
    return [
      {
        /*
         * O service worker **precisa** ser revalidado sempre. Servido como
         * estático comum fica 1 ano no cache do navegador e uma correção de
         * cache nunca chega ao aparelho — o bug clássico de PWA.
         */
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // A página de offline é a única coisa que o app precisa ter guardada
        // antes da rede cair; cache curto evita servir versão antiga.
        source: "/offline.html",
        headers: [{ key: "Cache-Control", value: "public, max-age=300" }],
      },
      {
        /*
         * Assets do build têm hash no nome: o conteúdo de `/_next/static/` é
         * imutável por definição. Sem `immutable`, o navegador revalida JS e
         * CSS a cada visita — uma ida ao servidor por asset, por visita, no
         * celular do cliente.
         */
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        // Ícones do PWA também são versionados na prática (nome fixo, conteúdo
        // estável). Uma semana cobre troca de arte.
        source: "/icons/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],
      },
      {
        /*
         * Headers de segurança para **todas** as rotas.
         *
         * Ficam aqui, e não só no middleware, porque o matcher do middleware
         * exclui de propósito `sw.js`, `manifest.webmanifest`, `offline.html`
         * e os assets estáticos (Etapa 12: eles não podem depender de sessão
         * nem do Supabase). Sem este bloco, essas rotas saem sem
         * `nosniff` — e `offline.html` é justamente a página que o navegador
         * mostra quando a rede caiu.
         *
         * A CSP **não** está aqui: ela é montada por requisição no middleware
         * (nonce nas rotas dinâmicas, política de cache no cardápio ISR).
         *
         * `Vary` também não está aqui: o Next já emite o Vary correto para
         * RSC/router state. Duplicar produzia dois headers `Vary` na mesma
         * resposta.
         */
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()",
          },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
