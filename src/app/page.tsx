import Link from "next/link";
import {
  ArrowRight,
  Check,
  ClipboardList,
  Nfc,
  QrCode,
  Smartphone,
  Sparkles,
  Store,
  Wifi,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { ButtonLink } from "@/components/ui/button";

const steps = [
  {
    icon: Store,
    title: "Cadastre seu restaurante",
    text: "Nome, link e contato. Leva menos de 2 minutos.",
  },
  {
    icon: ClipboardList,
    title: "Monte o cardápio",
    text: "Categorias, produtos, fotos e preços — tudo organizado.",
  },
  {
    icon: QrCode,
    title: "Espalhe o QR Code",
    text: "O cliente aponta a câmera e o cardápio abre na hora.",
  },
];

const benefits = [
  {
    icon: Smartphone,
    title: "Feito para o celular",
    text: "Botões grandes, tudo ao alcance do dedão. Gerencie do salão, da cozinha ou de casa.",
  },
  {
    icon: Sparkles,
    title: "Simples de verdade",
    text: "Sem planilhas e sem sistemas complicados. Telas limpas e diretas ao ponto.",
  },
  {
    icon: QrCode,
    title: "QR Code e NFC",
    text: "Cardápio por QR Code na mesa ou por aproximação — sem app para o cliente baixar.",
  },
  {
    icon: ClipboardList,
    title: "Pedidos na palma da mão",
    text: "Acompanhe cada pedido conforme chega, sem gritar pela cozinha.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-white">
      {/* Cabeçalho */}
      <header
        className="sticky top-0 z-30 border-b border-ink-100 bg-white/85 backdrop-blur-lg"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="app-shell flex min-h-14 items-center justify-between px-4">
          <Logo href="/" size="sm" />
          <div className="flex items-center gap-1.5">
            <Link
              href="/entrar"
              className="tap-target inline-flex items-center rounded-xl px-2.5 text-sm font-semibold text-ink-700 hover:bg-ink-100"
            >
              Entrar
            </Link>
            <ButtonLink href="/criar-conta" size="sm" className="rounded-xl">
              Criar conta
            </ButtonLink>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-brand-100 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-20 top-40 size-56 rounded-full bg-accent-400/20 blur-3xl"
          />

          <div className="app-shell relative px-5 pb-10 pt-10 sm:pt-14">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 ring-1 ring-inset ring-brand-200">
              <Sparkles className="size-3.5" aria-hidden="true" />
              Cardápio digital em minutos
            </span>

            <h1 className="mt-5 text-[2.1rem] leading-[1.1] font-semibold tracking-tight text-ink-900 sm:text-5xl">
              O cardápio do seu restaurante
              <span className="block text-brand-700">direto no celular do cliente</span>
            </h1>

            <p className="mt-4 max-w-md text-[1.02rem] leading-relaxed text-ink-600">
              Crie o cardápio digital, gere QR Codes das mesas e acompanhe os pedidos.
              Sem aplicativo para baixar, sem complicação.
            </p>

            <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
              <ButtonLink href="/criar-conta" size="lg" block className="sm:w-auto sm:px-7">
                Criar meu cardápio grátis
                <ArrowRight className="size-4.5" aria-hidden="true" />
              </ButtonLink>
              <ButtonLink
                href="/entrar"
                size="lg"
                variant="secondary"
                block
                className="sm:w-auto sm:px-7"
              >
                Já tenho conta
              </ButtonLink>
            </div>

            <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-400">
              <Check className="size-3.5 text-brand-600" aria-hidden="true" />
              Grátis para começar · Sem cartão de crédito
            </p>

            {/* Mockup do celular — CSS puro, sem imagem pesada */}
            <div className="relative mt-9 flex justify-center" aria-hidden="true">
              <div className="animate-float w-full max-w-[17.5rem] rounded-[2rem] border-[6px] border-ink-900 bg-ink-900 p-0 shadow-[0_30px_60px_-30px_rgba(14,15,20,0.55)]">
                <div className="relative overflow-hidden rounded-[1.6rem] bg-white">
                  <div className="flex items-center justify-between bg-ink-900 px-4 py-1.5">
                    <span className="text-[0.6rem] font-medium text-white/70">9:41</span>
                    <span className="h-1 w-8 rounded-full bg-white/40" aria-hidden="true" />
                    <Wifi className="size-2.5 text-white/70" aria-hidden="true" />
                  </div>

                  <div className="space-y-3 p-3.5">
                    <div className="flex items-center gap-2.5">
                      <span className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-800 text-xs font-semibold text-white">
                        C
                      </span>
                      <div className="flex-1">
                        <p className="text-[0.7rem] font-semibold text-ink-900">Cantina da Praça</p>
                        <p className="text-[0.6rem] text-ink-400">Mesa 4 · Aberto agora</p>
                      </div>
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[0.55rem] font-semibold text-brand-700">
                        Ao vivo
                      </span>
                    </div>

                    <div className="flex gap-1.5">
                      {["Pratos", "Bebidas", "Sobremesas"].map((tag, index) => (
                        <span
                          key={tag}
                          className={
                            index === 0
                              ? "rounded-full bg-ink-900 px-2.5 py-1 text-[0.55rem] font-semibold text-white"
                              : "rounded-full bg-ink-100 px-2.5 py-1 text-[0.55rem] font-medium text-ink-500"
                          }
                        >
                          {tag}
                        </span>
                      ))}
                    </div>

                    {[
                      { name: "Bruschetta da casa", price: "R$ 24", tag: "Mais pedido" },
                      { name: "Fettuccine ao funghi", price: "R$ 46", tag: null },
                      { name: "Limonada siciliana", price: "R$ 12", tag: "Vegano" },
                    ].map((item) => (
                      <div
                        key={item.name}
                        className="flex items-center gap-2.5 rounded-xl border border-ink-100 bg-white p-2"
                      >
                        <span className="size-9 shrink-0 rounded-lg bg-gradient-to-br from-ink-100 to-ink-200" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[0.62rem] font-semibold text-ink-900">
                            {item.name}
                          </p>
                          <p className="text-[0.55rem] text-ink-400">
                            {item.tag ? `${item.tag} · ` : ""}
                            {item.price}
                          </p>
                        </div>
                        <span className="grid size-5 shrink-0 place-items-center rounded-md bg-brand-600 text-[0.7rem] leading-none text-white">
                          +
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Como funciona */}
        <section className="border-y border-ink-100 bg-ink-50/70 py-12">
          <div className="app-shell px-5">
            <h2 className="text-2xl font-semibold tracking-tight text-ink-900">
              Do zero ao cardápio no ar
            </h2>
            <p className="mt-1.5 text-[0.95rem] text-ink-500">Três passos. Nenhuma instalação.</p>

            <ol className="mt-6 space-y-3">
              {steps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <li key={step.title} className="card flex items-start gap-3.5 p-4">
                    <span className="relative grid size-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                      <Icon className="size-5" aria-hidden="true" />
                      <span className="absolute -right-1 -top-1 grid size-4.5 place-items-center rounded-full bg-brand-600 text-[0.6rem] font-bold text-white">
                        {index + 1}
                      </span>
                    </span>
                    <div>
                      <h3 className="text-[0.95rem] font-semibold text-ink-900">{step.title}</h3>
                      <p className="mt-0.5 text-sm leading-relaxed text-ink-500">{step.text}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* Benefícios */}
        <section className="py-12">
          <div className="app-shell px-5">
            <h2 className="text-2xl font-semibold tracking-tight text-ink-900">
              Pensado para quem vive o salão
            </h2>
            <p className="mt-1.5 text-[0.95rem] text-ink-500">
              Restaurantes, lanchonetes, pizzarias, bares e cafeterias.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {benefits.map((benefit) => {
                const Icon = benefit.icon;
                return (
                  <div key={benefit.title} className="card p-4">
                    <span className="grid size-10 place-items-center rounded-xl bg-ink-900 text-white">
                      <Icon className="size-[1.15rem]" aria-hidden="true" />
                    </span>
                    <h3 className="mt-3 text-[0.95rem] font-semibold text-ink-900">
                      {benefit.title}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-ink-500">{benefit.text}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* NFC destaque */}
        <section className="pb-12">
          <div className="app-shell px-5">
            <div className="relative overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950 p-6 text-white">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-white/10 blur-2xl"
              />
              <Nfc className="size-7 text-brand-200" aria-hidden="true" />
              <h2 className="mt-3 text-xl font-semibold tracking-tight">
                Um toque. O cardápio abre.
              </h2>
              <p className="mt-1.5 max-w-sm text-[0.92rem] leading-relaxed text-brand-100">
                Além do QR Code, a Menuvo vai suportar etiquetas NFC na mesa: o cliente
                encosta o celular e o pedido começa.
              </p>
              <span className="mt-4 inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white ring-1 ring-inset ring-white/25">
                Chegando na Etapa 5
              </span>
            </div>
          </div>
        </section>

        {/* CTA final */}
        <section className="pb-14">
          <div className="app-shell px-5">
            <div className="card p-6 text-center">
              <h2 className="text-xl font-semibold tracking-tight text-ink-900">
                Pronto para digitalizar seu cardápio?
              </h2>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-500">
                Crie sua conta gratuitamente e monte o cardápio ainda hoje.
              </p>
              <ButtonLink href="/criar-conta" size="lg" block className="mt-5">
                Começar agora
                <ArrowRight className="size-4.5" aria-hidden="true" />
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink-100 py-8 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        <div className="app-shell flex flex-col items-center gap-3 px-5 text-center">
          <Logo href="/" size="sm" />
          <p className="text-xs text-ink-400">
            © {new Date().getFullYear()} Menuvo · Cardápios digitais para restaurantes
          </p>
          <div className="flex gap-4 text-xs font-medium text-ink-500">
            <Link href="/entrar" className="tap-target inline-flex items-center">
              Entrar
            </Link>
            <Link href="/criar-conta" className="tap-target inline-flex items-center">
              Criar conta
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
