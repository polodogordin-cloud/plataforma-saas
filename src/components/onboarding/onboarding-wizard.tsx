"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  ChevronRight,
  ExternalLink,
  Loader2,
  PartyPopper,
  SkipForward,
} from "lucide-react";
import {
  applySuggestedCategories,
  finishOnboarding,
  saveOnboardingInfo,
  saveOnboardingProgress,
  saveSegment,
} from "@/actions/onboarding";
import { saveTheme } from "@/actions/theme";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form";
import { WizardHeader, StepSummary } from "@/components/onboarding/wizard-header";
import {
  StepCategories,
  StepInfo,
  StepProducts,
  StepQr,
  StepSegment,
  StepTables,
  StepTheme,
  StepWhatsapp,
} from "@/components/onboarding/step-content";
import {
  ONBOARDING_STEPS,
  canFinish,
  getStep,
  nextStep,
  previousStep,
  stepIndex,
  suggestedCategories,
  wizardProgress,
  type OnboardingStepId,
  type ProgressSteps,
  type RestaurantSegment,
} from "@/lib/onboarding";
import { THEME_PRESETS } from "@/lib/theme";
import type { RestaurantStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Wizard do onboarding — Etapa 21.
 *
 * ─── Mobile-first, e não "responsivo depois" ──────────────────────────────
 *
 * O wizard inteiro cabe numa coluna de 420 px: cabeçalho com etapa atual,
 * trilha de progresso, conteúdo da etapa e barra de ação fixa no rodapé. Em
 * tablet, a coluna centraliza com respiro; não há layout de duas colunas
 * porque o dono configura o restaurante no celular, em pé no salão.
 *
 * ─── Salvar automaticamente, sem "salvar" ─────────────────────────────────
 *
 * Cada avanço grava o mapa completo (`saveOnboardingProgress`). Se o dono
 * fechar o navegador no meio, a etapa atual já está no banco e o wizard reabre
 * nela — é o que o escopo chama de "continuar de onde parou".
 *
 * A escrita é **otimista e não bloqueante**: o avanço visual acontece na hora,
 * a gravação roda em transição. Se falhar, aparece um aviso e o progresso local
 * continua — perder a digitação porque a rede oscilou seria pior que salvar
 * dois segundos depois.
 *
 * ─── Por que o tema é salvo só quando há mudança ──────────────────────────
 *
 * `saveTheme` exige `custom_theme` (plano pago). O wizard não pode quebrar para
 * quem está no Grátis: se o dono não escolheu tema, nada é chamado; se
 * escolheu e o plano não permite, o retorno é uma mensagem clara e o wizard
 * segue com o tema padrão.
 */
export type WizardData = {
  restaurantId: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  segment: RestaurantSegment | null;
  themePreset: string | null;
  steps: ProgressSteps;
  completed: boolean;
  counts: {
    categories: number;
    products: number;
    tables: number;
    activeTables: number;
    whatsapp: boolean;
  };
  categories: string[];
  firstTable: { id: string; name: string } | null;
  status: RestaurantStatus;
};

type FinishPayload = {
  slug: string;
  tableId: string | null;
  tableName: string | null;
  canView: boolean;
};

export function OnboardingWizard({ initial }: { initial: WizardData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [steps, setSteps] = useState<ProgressSteps>(initial.steps);
  const [current, setCurrent] = useState<OnboardingStepId>(() => {
    const progress = wizardProgress(initial.steps);
    return initial.completed ? "whatsapp" : progress.resumeAt;
  });
  const [segment, setSegment] = useState<RestaurantSegment | null>(initial.segment);
  const [theme, setTheme] = useState<string | null>(initial.themePreset);
  const [categories, setCategories] = useState<string[]>(initial.categories);
  const [counts, setCounts] = useState(initial.counts);
  const [info, setInfo] = useState({
    name: initial.name,
    description: initial.description,
    logoUrl: initial.logoUrl,
  });

  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(
    null,
  );
  const [finished, setFinished] = useState<FinishPayload | null>(null);
  const [saving, setSaving] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);

  // Evita gravar o mapa com o estado anterior ao clique: o ref guarda sempre a
  // versão mais nova, mesmo dentro de uma transição disparada antes do render.
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const progress = useMemo(() => wizardProgress(steps), [steps]);
  const step = getStep(current)!;
  const index = stepIndex(current);
  const isLast = index === ONBOARDING_STEPS.length - 1;

  const persist = useCallback(
    (nextSteps: ProgressSteps, complete = false) =>
      new Promise<boolean>((resolve) => {
        setSaving(true);
        saveOnboardingProgress(nextSteps, complete)
          .then((result) => {
            if (!result.ok) {
              setMessage({ tone: "error", text: result.error });
              resolve(false);
            } else {
              resolve(true);
            }
          })
          .catch(() => {
            setMessage({
              tone: "error",
              text: "Não conseguimos salvar agora. Verifique a conexão — seu progresso continua nesta tela.",
            });
            resolve(false);
          })
          .finally(() => setSaving(false));
      }),
    [],
  );

  /**
   * Grava o conteúdo da etapa que tem formulário próprio.
   *
   * Hoje só "Informações" tem: as demais gravam no clique (segmento, tema,
   * categorias) ou não têm formulário (produtos/mesas/QR/WhatsApp são atalhos
   * para telas completas). A função existe separada para a regra ficar num
   * lugar só quando outra etapa ganhar campo.
   */
  async function persistStepContent(stepId: OnboardingStepId): Promise<boolean> {
    if (stepId !== "informacoes") return true;

    const result = await saveOnboardingInfo({
      name: info.name,
      description: info.description,
      logoUrl: info.logoUrl,
    });

    if (!result.ok) {
      setInfoError(result.fields?.name ?? result.error);
      setMessage({ tone: "error", text: result.error });
      return false;
    }
    return true;
  }

  /** Marca a etapa atual e avança. */
  const resolveCurrent = useCallback(
    async (state: "done" | "skipped") => {
      setMessage(null);

      // Gravar antes de marcar: marcar "concluída" uma etapa cujo formulário
      // falhou deixaria o checklist mentindo.
      if (state === "done") {
        const saved = await persistStepContent(current);
        if (!saved) return;
      }

      const nextSteps: ProgressSteps = { ...stepsRef.current, [current]: state };
      setSteps(nextSteps);

      const following = nextStep(current);
      if (following) setCurrent(following.id);

      // Sem `await`: o passo seguinte aparece na hora; a gravação acompanha.
      void persist(nextSteps);

      if (!following) {
        // Chegou ao fim: a tela de conclusão precisa do resultado do servidor.
        const result = await handleFinish(nextSteps);
        if (!result.ok) {
          setMessage({ tone: "error", text: result.error });
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, persist, info],
  );

  async function handleFinish(nextSteps: ProgressSteps) {
    if (!canFinish(nextSteps)) {
      setMessage({
        tone: "error",
        text: "Complete as informações do restaurante antes de finalizar.",
      });
      return { ok: false as const, error: "Informações incompletas." };
    }

    const result = await finishOnboarding();
    if (!result.ok) return result;

    setFinished({
      slug: result.slug,
      tableId: result.tableId,
      tableName: result.tableName,
      canView: result.canView,
    });
    router.refresh();
    return { ok: true as const };
  }

  function goBack() {
    const before = previousStep(current);
    if (before) {
      setCurrent(before.id);
      setMessage(null);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Ações específicas de etapa                                            */
  /* ---------------------------------------------------------------------- */

  const handleSegment = (value: RestaurantSegment) => {
    setSegment(value);
    startTransition(async () => {
      const result = await saveSegment(value);
      if (!result.ok) setMessage({ tone: "error", text: result.error });
    });
  };

  const handleApplySuggested = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await applySuggestedCategories(segment);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({ tone: "success", text: result.message });
      setCategories((previous) => {
        const merged = [...previous];
        for (const name of suggestedCategories(segment)) {
          if (!merged.some((item) => item.toLowerCase() === name.toLowerCase())) merged.push(name);
        }
        return merged;
      });
      setCounts((previous) => ({ ...previous, categories: previous.categories + result.created }));
      router.refresh();
    });
  };

  const handleTheme = (preset: string) => {
    setTheme(preset);
    setMessage(null);
    const chosen = THEME_PRESETS.find((item) => item.id === preset);
    if (!chosen) return;

    startTransition(async () => {
      const result = await saveTheme({
        preset: chosen.theme.preset,
        primaryColor: chosen.theme.primary_color,
        secondaryColor: chosen.theme.secondary_color,
        backgroundColor: chosen.theme.background_color,
        textColor: chosen.theme.text_color,
        buttonColor: chosen.theme.button_color,
        cardStyle: chosen.theme.card_style,
        buttonStyle: chosen.theme.button_style,
        logoUrl: info.logoUrl,
        coverUrl: null,
      });

      if (!result.ok) {
        // Plano sem `custom_theme` cai aqui. Não é erro fatal: o wizard
        // continua com o tema padrão e a mensagem explica.
        setMessage({ tone: "error", text: result.error });
      }
    });
  };

  /* ---------------------------------------------------------------------- */
  /* Tela final                                                            */
  /* ---------------------------------------------------------------------- */

  if (finished) {
    return (
      <FinalScreen
        slug={finished.slug}
        tableId={finished.tableId}
        tableName={finished.tableName}
        canView={finished.canView}
        restaurantName={info.name}
        steps={steps}
      />
    );
  }

  const canSkip = step.skippable;
  const suggested = suggestedCategories(segment);

  /* ---------------------------------------------------------------------- */
  /* Conteúdo por etapa                                                    */
  /* ---------------------------------------------------------------------- */

  const content = (
    <>
      {current === "informacoes" && (
        <StepInfo
          name={info.name}
          description={info.description}
          logoUrl={info.logoUrl}
          error={infoError}
          onChange={(patch) => {
            setInfoError(null);
            setInfo((previous) => ({ ...previous, ...patch }));
          }}
        />
      )}

      {current === "aparencia" && (
        <StepTheme selected={theme} segment={segment} onSelect={handleTheme} />
      )}

      {current === "segmento" && <StepSegment selected={segment} onSelect={handleSegment} />}

      {current === "categorias" && (
        <StepCategories
          segment={segment}
          existing={categories}
          suggested={suggested}
          onApply={handleApplySuggested}
          applyLabel={
            categories.length === 0 ? "Usar configuração sugerida" : "Adicionar as que faltam"
          }
        />
      )}

      {current === "produtos" && (
        <StepProducts
          hasCategories={categories.length > 0}
          productCount={counts.products}
        />
      )}

      {current === "mesas" && <StepTables tableCount={counts.tables} />}

      {current === "qrcode" && (
        <StepQr tableId={initial.firstTable?.id ?? null} tableName={initial.firstTable?.name ?? null} />
      )}

      {current === "whatsapp" && <StepWhatsapp configured={counts.whatsapp} />}
    </>
  );

  const showManagementLink =
    current === "produtos" || current === "mesas" || current === "whatsapp";

  return (
    <div className="flex min-h-dvh flex-col bg-ink-50">
      <div className="pt-safe">
        <div className="app-shell px-4 pt-3">
          <WizardHeader
            current={current}
            steps={steps}
            onBack={goBack}
            canGoBack={Boolean(previousStep(current))}
          />
        </div>
      </div>

      <main className="app-shell flex-1 px-4 pb-40 pt-4">
        <div className="mb-4">
          <h2 className="text-lg font-semibold tracking-tight text-ink-900 text-balance">
            {step.title}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-500">{step.description}</p>
        </div>

        {message && (
          <FormAlert tone={message.tone} className="mb-3">
            {message.text}
          </FormAlert>
        )}

        <div className="animate-fade-in">{content}</div>

        {showManagementLink && (
          <Link
            href={step.managementHref}
            className="tap-target mt-4 inline-flex items-center gap-1.5 rounded-xl px-1 text-sm font-semibold text-brand-700"
          >
            Abrir a tela completa
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        )}
      </main>

      {/* Barra de ação fixa: polegar alcança sem esticar a mão. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 backdrop-blur pb-safe">
        <div className="app-shell space-y-2 px-4 py-3">
          {canSkip && (
            <button
              type="button"
              onClick={() => void resolveCurrent("skipped")}
              disabled={pending || saving}
              className="tap-target inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-ink-500 transition hover:bg-ink-100 disabled:opacity-50"
            >
              <SkipForward className="size-4" aria-hidden="true" />
              Pular por enquanto
            </button>
          )}

          <Button
            type="button"
            size="lg"
            block
            loading={pending || saving}
            onClick={() => void resolveCurrent("done")}
          >
            {isLast ? "Finalizar configuração" : "Continuar"}
            {!isLast && !pending && !saving && <ArrowRight className="size-4.5" aria-hidden="true" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Tela final                                                                */
/* ========================================================================== */

/**
 * "Seu cardápio está pronto." — a única tela que o dono vê uma vez.
 *
 * Ela responde três perguntas em sequência visual: (1) acabou? (2) onde está meu
 * cardápio? (3) o que eu faço agora?
 *
 * O QR aparece **só** quando existe mesa ativa e o link público só é oferecido
 * quando o cardápio está publicado — mandar o dono abrir um 404 na primeira
 * impressão de produto é o tipo de detalhe que faz alguém desistir.
 */
function FinalScreen({
  slug,
  tableId,
  tableName,
  canView,
  restaurantName,
  steps,
}: {
  slug: string;
  tableId: string | null;
  tableName: string | null;
  canView: boolean;
  restaurantName: string;
  steps: ProgressSteps;
}) {
  const [copied, setCopied] = useState(false);
  const publicPath = `/r/${slug}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${publicPath}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function shareLink() {
    const url = `${window.location.origin}${publicPath}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: restaurantName, text: "Nosso cardápio digital", url });
        return;
      } catch {
        // Usuário cancelou o menu do sistema: cai no copiar.
      }
    }
    void copyLink();
  }

  return (
    <main className="min-h-dvh bg-white">
      <div className="pt-safe">
        <div className="app-shell flex min-h-[calc(100dvh-var(--safe-top,0px))] flex-col px-5 pb-10 pt-8">
          <div className="flex-1">
            <span className="grid size-16 place-items-center rounded-2xl bg-brand-600 text-white shadow-[var(--shadow-lift)]">
              <PartyPopper className="size-8" aria-hidden="true" />
            </span>

            <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink-900 text-balance">
              Seu cardápio está pronto.
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-500">
              {canView
                ? "O link já está no ar. Mande para os clientes e cole os QR Codes nas mesas."
                : "Tudo configurado. Falta publicar o cardápio para o link funcionar — é um toque no painel."}
            </p>

            {/* Link público */}
            <div className="mt-5 rounded-2xl border border-ink-200 bg-ink-50/70 p-3.5">
              <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-400">
                Link público
              </p>
              <p className="mt-0.5 truncate font-mono text-sm text-ink-800">{publicPath}</p>

              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className={cn(
                    "tap-target inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition",
                    copied ? "bg-brand-600 text-white" : "bg-white text-ink-800 ring-1 ring-inset ring-ink-200",
                  )}
                >
                  {copied ? <Check className="size-4" aria-hidden="true" /> : null}
                  {copied ? "Copiado" : "Copiar link"}
                </button>
                <button
                  type="button"
                  onClick={() => void shareLink()}
                  className="tap-target inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-white px-3 text-sm font-semibold text-ink-800 ring-1 ring-inset ring-ink-200"
                >
                  Compartilhar
                </button>
              </div>
            </div>

            {/* QR */}
            {tableId && (
              <div className="mt-3 flex items-center gap-3 rounded-2xl border border-ink-200 bg-white p-3">
                <div className="size-20 shrink-0 overflow-hidden rounded-lg border border-ink-100 bg-white p-1">
                  {/* eslint-disable-next-line @next/next/no-img-element -- PNG gerado no servidor, tamanho fixo */}
                  <img
                    src={`/app/mesas/${tableId}/qr`}
                    alt={`QR Code da ${tableName ?? "mesa"}`}
                    width={80}
                    height={80}
                    className="size-full object-contain"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900">{tableName ?? "Sua mesa"}</p>
                  <p className="text-xs leading-relaxed text-ink-500">
                    Baixe em PNG ou SVG na tela de mesas, pronto para impressão.
                  </p>
                  <Link
                    href="/app/mesas"
                    className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-700"
                  >
                    Ver todas as mesas
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            )}

            <div className="mt-5 rounded-2xl border border-ink-200 bg-white p-3.5">
              <p className="mb-1.5 text-sm font-semibold text-ink-900">O que ficou pronto</p>
              <StepSummary steps={steps} />
            </div>
          </div>

          <div className="mt-6 space-y-2.5">
            {canView ? (
              <ButtonLink href={publicPath} target="_blank" rel="noreferrer" size="lg" block>
                Visualizar cardápio
                <ExternalLink className="size-4" aria-hidden="true" />
              </ButtonLink>
            ) : (
              <ButtonLink href="/app" size="lg" block>
                Publicar meu cardápio
                <ArrowRight className="size-4" aria-hidden="true" />
              </ButtonLink>
            )}
            <ButtonLink href="/app" variant="secondary" size="lg" block>
              Abrir painel
            </ButtonLink>
          </div>
        </div>
      </div>
    </main>
  );
}

/** Indicador reutilizável (usado pelo painel enquanto o wizard carrega). */
export function WizardLoading() {
  return (
    <div className="grid min-h-dvh place-items-center bg-ink-50">
      <Loader2 className="size-6 animate-spin text-brand-600" aria-label="Carregando" />
    </div>
  );
}
