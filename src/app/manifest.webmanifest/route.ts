import type { MetadataRoute } from "next";
import {
  APP_DESCRIPTION,
  APP_FULL_NAME,
  APP_LANG,
  APP_NAME,
  BACKGROUND_COLOR,
  DISPLAY,
  ICONS,
  ORIENTATION,
  SCOPE,
  START_URL,
  THEME_COLOR,
} from "@/lib/pwa";

/**
 * Web App Manifest — Etapa 12, itens 1 e 4.
 *
 * Gerado em vez de servido como arquivo estático por um motivo concreto: os
 * ícones têm tamanho e o manifest precisa declará-los exatamente como foram
 * gerados. Um `manifest.webmanifest` escrito à mão em `public/` não participa do
 * build — se alguém trocar o ícone e esquecer o tamanho aqui, o Chrome recusa a
 * instalação com um erro que só aparece no aparelho.
 *
 * `start_url: /app` leva ao painel. Sem sessão, o middleware manda para
 * `/entrar?next=/app` e volta depois do login, então o ícone funciona para as
 * duas situações.
 */
/**
 * Nome exportado como `GET` e não `default`: um arquivo `route.ts` só aceita
 * handlers HTTP. Usar `manifest()` aqui seria sintaxe de `manifest.ts`, que tem
 * outra convenção de rota e outra URL.
 */
export const dynamic = "force-static";

export function GET(): Response {
  return Response.json(buildManifest(), {
    headers: {
      // Revalida de vez em quando, mas fica utilizável offline pelo SW.
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "Content-Type": "application/manifest+json",
    },
  });
}

function buildManifest(): MetadataRoute.Manifest {
  return {
    name: APP_FULL_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    id: "/",
    start_url: START_URL,
    scope: SCOPE,
    display: DISPLAY,
    orientation: ORIENTATION,
    lang: APP_LANG,
    dir: "ltr",
    theme_color: THEME_COLOR,
    background_color: BACKGROUND_COLOR,
    categories: ["business", "food", "productivity"],
    icons: ICONS.map((icon) => ({
      src: icon.src,
      sizes: icon.sizes,
      type: icon.type,
      purpose: icon.purpose,
    })),
    // Atalhos do toque longo no ícone: o painel de pedidos e o cardápio são as
    // duas telas que o dono abre com pressa. `start_url` deles herda o escopo.
    shortcuts: [
      {
        name: "Pedidos",
        short_name: "Pedidos",
        url: "/app/pedidos",
        description: "Acompanhar os pedidos das mesas",
      },
      {
        name: "Cardápio",
        short_name: "Cardápio",
        url: "/app/cardapio",
        description: "Editar produtos e categorias",
      },
    ],
    // Nada de chave, token ou versão interna aqui: o manifest é público por
    // definição (qualquer pessoa baixa `/manifest.webmanifest`).
  };
}
