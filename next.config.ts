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
  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }]
      : [],
  },
  async headers() {
    return [
      {
        // O service worker **precisa** ser revalidado sempre. Servido como
        // estático comum ele fica 1 ano no cache do navegador e uma correção
        // de cache nunca chega ao aparelho — o bug clássico de PWA.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // A página de offline é a única coisa que o app precisa ter guardada
        // antes da rede cair; cache curto evita servir uma versão antiga.
        source: "/offline.html",
        headers: [{ key: "Cache-Control", value: "public, max-age=300" }],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Em produção: SAMEORIGIN evita clickjacking. Em dev/iframe preview: liberado.
          { key: "X-Frame-Options", value: isDev ? "ALLOWALL" : "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
