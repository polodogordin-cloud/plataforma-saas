import type { Metadata, Viewport } from "next";
import { notFound, redirect } from "next/navigation";
import { PrintPreviewScreen } from "@/components/printing/print-preview-screen";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getPrintConfig, getPrintOrder } from "@/lib/data/printing";

/**
 * `/app/pedidos/[id]/imprimir` — Etapa 18.
 *
 * Rota própria de impressão. Server Component: o cupom já vem pronto no HTML,
 * então o botão "Imprimir" funciona mesmo antes da hidratação — importante num
 * tablet de cozinha com Android modesto.
 *
 * Guardas em três camadas, como no resto do projeto:
 *
 *   1. middleware exige sessão (`/app` está nas rotas privadas);
 *   2. esta página exige restaurante ativo e confere o tenant;
 *   3. `get_print_order` recusa pedido de outro restaurante mesmo que a URL
 *      seja digitada à mão.
 */

export const metadata: Metadata = {
  title: "Imprimir pedido",
  // Documento com dados do pedido: nunca indexado, nunca guardado em cache.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  maximumScale: 1,
  themeColor: "#f7f7f8",
};

export const dynamic = "force-dynamic";

export default async function PrintOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ auto?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const [document, config] = await Promise.all([
    getPrintOrder(id),
    getPrintConfig(restaurant.id),
  ]);

  // Pedido de outra casa e pedido inexistente dão o mesmo 404: nem a existência
  // vaza.
  if (!document || document.restaurant.id !== restaurant.id) notFound();

  return (
    <PrintPreviewScreen
      document={document}
      profiles={config.profiles}
      printers={config.printers}
      autoRequested={query.auto === "1"}
    />
  );
}
