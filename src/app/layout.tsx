import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/pwa/register-sw";
import { UpdateToast } from "@/components/pwa/update-toast";
import {
  APP_FULL_NAME,
  APP_NAME,
  BACKGROUND_COLOR,
  BACKGROUND_COLOR_DARK,
  FAVICON,
  THEME_COLOR,
} from "@/lib/pwa";

export const metadata: Metadata = {
  title: {
    default: "Menuvo · Cardápios digitais para restaurantes",
    template: "%s · Menuvo",
  },
  description:
    "Crie o cardápio digital do seu restaurante, gerencie mesas e receba pedidos pelo QR Code. Simples no celular, bonito no salão.",
  applicationName: APP_FULL_NAME,
  manifest: "/manifest.webmanifest",
  /**
   * iOS não lê o manifest para a instalação: precisa destes três. O
   * `appleWebApp` gera as meta tags que fazem o app abrir sem a barra do Safari
   * quando salvo na tela de início.
   */
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: FAVICON, sizes: "32x32", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false },
  other: {
    /*
     * O Next 15 gera `mobile-web-app-capable` a partir de `appleWebApp.capable`,
     * mas **não** gera a variante prefixada que o iOS < 16.4 exige para abrir
     * sem a barra do Safari quando salvo na tela de início. Sem esta linha, o
     * app "instalado" no iPhone abre dentro do navegador — comportamento que
     * parece bug do usuário, não do app.
     */
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: BACKGROUND_COLOR },
    { media: "(prefers-color-scheme: dark)", color: BACKGROUND_COLOR_DARK },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      {/* `theme-color` também no HTML: navegadores que não leem o manifest
          (Safari antigo) pintam a barra de status com o valor daqui. */}
      <head>
        <meta name="theme-color" content={THEME_COLOR} />
      </head>
      <body>
        {children}
        <ServiceWorkerRegistrar />
        <UpdateToast />
      </body>
    </html>
  );
}
