import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Menuvo · Cardápios digitais para restaurantes",
    template: "%s · Menuvo",
  },
  description:
    "Crie o cardápio digital do seu restaurante, gerencie mesas e receba pedidos pelo QR Code. Simples no celular, bonito no salão.",
  applicationName: "Menuvo",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Menuvo",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0f14" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
