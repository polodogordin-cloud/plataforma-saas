import type { Metadata } from "next";
import PaymentPage from "@/app/app/pagamento/page";

/**
 * `/dashboard/billing` — alias da tela de pagamento.
 *
 * O escopo da Etapa 19 pede esta rota; o app fala português (`/app/...`) desde
 * a Etapa 1. Em vez de criar uma **segunda** tela de assinatura (proibido pelo
 * item 23) ou renomear tudo, esta rota reexporta o mesmo componente — um
 * caminho, uma tela.
 *
 * `dynamic` é literal aqui: o Next lê esse campo estaticamente na análise do
 * módulo, então ele não pode vir de um `export` importado.
 */
export const metadata: Metadata = { title: "Pagamento" };
export const dynamic = "force-dynamic";

export default PaymentPage;
