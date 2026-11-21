"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import {
  Check,
  ChevronDown,
  Eye,
  Loader2,
  Palette,
  RotateCcw,
  Save,
  Sparkles,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { ColorField } from "@/components/theme/color-field";
import { ImagePicker } from "@/components/theme/image-picker";
import { MenuPreview } from "@/components/theme/menu-preview";
import { ThemeScope } from "@/components/public/themed";
import { resetTheme, saveTheme } from "@/actions/theme";
import {
  BUTTON_STYLES,
  CARD_STYLES,
  THEME_PRESETS,
  mix,
  themeTokens,
} from "@/lib/theme";
import type { ButtonStyle, CardStyle, RestaurantTheme, ThemePresetId } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Editor de personalização do cardápio — Etapa 9.
 *
 * ─── Como está organizado ───────────────────────────────────────────────────
 *
 * O escopo pede "sem editor complexo" no celular, então a tela tem:
 *
 *   • **preview fixo no topo** (sticky), no formato de um celular. Toda
 *     alteração aparece nele na hora — é o feedback que substitui "salvar e
 *     abrir o cardápio para ver";
 *   • **três abas** — Tema (presets), Cores, Estilo — em vez de um formulário
 *     gigante. Cada aba cabe numa tela sem rolagem infinita;
 *   • **accordions** dentro das abas para os campos menos usados;
 *   • **botões grandes** e o `Salvar` fixo no rodapé, sempre alcançável.
 *
 * ─── Estado ────────────────────────────────────────────────────────────────
 *
 * Uma cópia local (`draft`) do tema. Nada é enviado até "Salvar" — assim o
 * dono pode testar dez paletas e desistir sem sujar a produção. `dirty`
 * controla o aviso de "alterações não salvas".
 */
export function ThemeEditor({
  restaurantId,
  restaurantName,
  tagline,
  initialTheme,
  sampleItems,
  isPublished,
  slug,
}: {
  restaurantId: string;
  restaurantName: string;
  tagline: string | null;
  initialTheme: RestaurantTheme;
  sampleItems: { name: string; price: string }[];
  isPublished: boolean;
  slug: string;
}) {
  const [draft, setDraft] = useState<RestaurantTheme>(initialTheme);
  const [tab, setTab] = useState<"temas" | "cores" | "estilo">("temas");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [opens, setOpens] = useState<Record<string, boolean>>({ cores: true });
  const [pending, startTransition] = useTransition();

  const tokens = themeTokens(draft);

  /** Atualiza o rascunho e marca como "sujo" (fora de transição: é só UI). */
  const patch = useCallback((changes: Partial<RestaurantTheme>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setDirty(true);
    setSaved(null);
    setError(null);
  }, []);

  function applyPreset(id: ThemePresetId) {
    const preset = THEME_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    patch({
      ...preset.theme,
      // Imagens continuam as do restaurante: o preset é paleta + forma.
      logo_url: draft.logo_url,
      cover_url: draft.cover_url,
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await saveTheme({
        preset: draft.preset,
        primaryColor: draft.primary_color,
        secondaryColor: draft.secondary_color,
        backgroundColor: draft.background_color,
        textColor: draft.text_color,
        buttonColor: draft.button_color,
        cardStyle: draft.card_style,
        buttonStyle: draft.button_style,
        logoUrl: draft.logo_url,
        coverUrl: draft.cover_url,
      });

      if (result.ok === false) {
        setError(result.error);
        return;
      }

      setDraft(result.theme);
      setDirty(false);
      setSaved(result.message);
    });
  }

  function doReset() {
    startTransition(async () => {
      const result = await resetTheme();
      if (result.ok === false) {
        setError(result.error);
        setConfirmReset(false);
        return;
      }
      // Relê a página para o tema padrão voltar a valer no editor e no preview.
      window.location.reload();
    });
  }

  const suggestions = useMemo(
    () => ({
      primary: [
        draft.primary_color,
        mix(draft.primary_color, "#000000", 0.25),
        mix(draft.primary_color, "#ffffff", 0.25),
        draft.secondary_color,
        tokens.text,
      ].filter((color, index, all) => all.indexOf(color) === index),
      background: [draft.background_color, "#ffffff", "#f7efe2", "#16181d", "#f2f2f2"],
    }),
    [draft, tokens.text],
  );

  return (
    <div className="pb-28">
      {/* -------------------------------------------------- preview fixo */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-ink-200/70 bg-ink-50/95 px-4 py-3 backdrop-blur-lg">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
            <Eye className="size-3.5" aria-hidden="true" />
            Prévia
          </div>

          {/*
            Escala: a moldura tem 320 px de largura fixa. Em telas estreitas
            (320 px) ela cabe; em telas um pouco maiores usamos escala 1. No
            mobile ocupamos a largura toda com o zoom proporcional.
          */}
          <div className="flex-1" />

          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[0.65rem] font-bold",
              dirty ? "bg-amber-50 text-amber-800" : "bg-brand-50 text-brand-700",
            )}
          >
            {dirty ? "Não salvo" : "Salvo"}
          </span>
        </div>

        <div className="mt-2 flex justify-center">
          <div
            className="origin-top"
            style={{
              transform: "scale(var(--preview-scale, 1))",
              // A moldura é 320x620; o wrapper reserva a altura já escalada
              // para não abrir um buraco no layout.
              marginBottom: "calc((var(--preview-scale, 1) - 1) * 620px)",
            }}
          >
            <ThemeScope theme={draft} className="rounded-[1.75rem]">
              <MenuPreview
                theme={draft}
                restaurantName={restaurantName}
                tagline={tagline}
                items={sampleItems}
              />
            </ThemeScope>
          </div>
        </div>
      </div>

      {/* --------------------------------------------------------- abas */}
      <div className="mt-3 flex gap-1.5" role="tablist" aria-label="Seções da personalização">
        {(
          [
            { id: "temas", label: "Temas", icon: Sparkles },
            { id: "cores", label: "Cores", icon: Palette },
            { id: "estilo", label: "Estilo", icon: Type },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.id)}
              className={cn(
                "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition-colors",
                active
                  ? "bg-ink-900 text-white"
                  : "bg-white text-ink-600 ring-1 ring-inset ring-ink-200",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* -------------------------------------------------------- temas */}
      {tab === "temas" && (
        <section className="mt-3 space-y-3" aria-label="Temas prontos">
          <p className="text-sm text-ink-500">
            Comece por um tema pronto e ajuste o que quiser. Dá para trocar de
            ideia a qualquer momento.
          </p>

          <ul className="grid grid-cols-2 gap-2.5">
            {THEME_PRESETS.map((preset) => {
              const active = draft.preset === preset.id;
              return (
                <li key={preset.id}>
                  <button
                    type="button"
                    onClick={() => applyPreset(preset.id)}
                    aria-pressed={active}
                    className={cn(
                      "flex w-full flex-col overflow-hidden rounded-2xl border bg-white text-left transition active:scale-[0.99]",
                      active
                        ? "border-brand-500 ring-2 ring-brand-100"
                        : "border-ink-200 hover:border-ink-300",
                    )}
                  >
                    {/* Amostra do tema: as três cores numa faixa */}
                    <span className="flex h-14 w-full" aria-hidden="true">
                      <span className="h-full flex-1" style={{ backgroundColor: preset.swatch[0] }} />
                      <span className="h-full flex-1" style={{ backgroundColor: preset.swatch[1] }} />
                      <span className="h-full flex-1" style={{ backgroundColor: preset.swatch[2] }} />
                    </span>

                    <span className="flex w-full items-start gap-1.5 p-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1 text-sm font-semibold text-ink-900">
                          {preset.name}
                          {active && (
                            <Check className="size-3.5 text-brand-600" aria-hidden="true" strokeWidth={3} />
                          )}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-[0.7rem] leading-snug text-ink-500">
                          {preset.description}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Textos do cardápio */}
          <Accordion
            id="textos"
            title="Nome e descrição"
            summary="Aparecem na capa do cardápio"
            open={Boolean(opens.textos)}
            onToggle={() => setOpens((value) => ({ ...value, textos: !value.textos }))}
          >
            <p className="text-sm leading-relaxed text-ink-600">
              O nome e a descrição vêm do cadastro do restaurante — assim não
              existe um texto no cardápio e outro na ficha da casa.
            </p>
            <a
              href="/app/configuracoes/restaurante"
              className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-ink-200 bg-white px-4 text-sm font-semibold text-brand-700"
            >
              Editar nome, descrição e endereço
            </a>
          </Accordion>
        </section>
      )}

      {/* -------------------------------------------------------- cores */}
      {tab === "cores" && (
        <section className="mt-3 space-y-4 rounded-2xl border border-ink-200 bg-white p-4">
          <ColorField
            label="Cor principal"
            hint="Capa do cardápio, categorias ativas e preços."
            value={draft.primary_color}
            onChange={(color) => patch({ primary_color: color })}
            suggestions={suggestions.primary}
          />

          <ColorField
            label="Cor secundária"
            hint="Estrelas de destaque, detalhes e ícones."
            value={draft.secondary_color}
            onChange={(color) => patch({ secondary_color: color })}
            suggestions={suggestions.primary}
          />

          <ColorField
            label="Cor de fundo"
            hint="O papel do cardápio. Também define se o tema é claro ou escuro."
            value={draft.background_color}
            onChange={(color) => patch({ background_color: color })}
            suggestions={suggestions.background}
          />

          <ColorField
            label="Cor do texto"
            hint="Ajustamos automaticamente se ficar difícil de ler no fundo."
            value={draft.text_color}
            onChange={(color) => patch({ text_color: color })}
            contrastAgainst={draft.background_color}
            contrastLabel="contraste"
          />

          <ColorField
            label="Cor dos botões"
            hint="Botão de adicionar e barra do carrinho. O texto do botão é escolhido por contraste."
            value={draft.button_color}
            onChange={(color) => patch({ button_color: color })}
            suggestions={suggestions.primary}
            contrastAgainst={draft.background_color}
            contrastLabel="no fundo"
          />
        </section>
      )}

      {/* ------------------------------------------------------- estilo */}
      {tab === "estilo" && (
        <div className="mt-3 space-y-3">
          {/* Logo e capa */}
          <section className="rounded-2xl border border-ink-200 bg-white p-4">
            <h2 className="text-sm font-bold text-ink-900">Imagens</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              PNG, JPG ou WEBP. Redimensionamos antes de enviar para o cardápio
              abrir rápido no celular.
            </p>

            <div className="mt-4 space-y-5">
              <ImagePicker
                kind="logo"
                label="Logo"
                hint="Quadrada, aparece ao lado do nome. Redimensionada para 320×320."
                aspect="square"
                value={draft.logo_url}
                disabled={pending}
                onChange={(url) => patch({ logo_url: url })}
              />

              <ImagePicker
                kind="cover"
                label="Capa"
                hint="Foto do salão, do prato principal ou da fachada. Formato 16:9."
                aspect="wide"
                value={draft.cover_url}
                disabled={pending}
                onChange={(url) => patch({ cover_url: url })}
              />
            </div>
          </section>

          {/* Estilo dos cards */}
          <section className="rounded-2xl border border-ink-200 bg-white p-4">
            <h2 className="text-sm font-bold text-ink-900">Estilo dos cards</h2>
            <div className="mt-3 grid gap-2" role="radiogroup" aria-label="Estilo dos cards">
              {CARD_STYLES.map((style) => (
                <StyleOption
                  key={style.id}
                  id={style.id as CardStyle}
                  label={style.label}
                  hint={style.hint}
                  selected={draft.card_style === style.id}
                  kind="card"
                  onSelect={() => patch({ card_style: style.id })}
                />
              ))}
            </div>
          </section>

          {/* Estilo dos botões */}
          <section className="rounded-2xl border border-ink-200 bg-white p-4">
            <h2 className="text-sm font-bold text-ink-900">Estilo dos botões</h2>
            <div className="mt-3 grid gap-2" role="radiogroup" aria-label="Estilo dos botões">
              {BUTTON_STYLES.map((style) => (
                <StyleOption
                  key={style.id}
                  id={style.id as ButtonStyle}
                  label={style.label}
                  hint={style.hint}
                  selected={draft.button_style === style.id}
                  kind="button"
                  onSelect={() => patch({ button_style: style.id })}
                />
              ))}
            </div>
          </section>

          {/* Restaurar padrão — ação destrutiva, com confirmação */}
          <section className="rounded-2xl border border-ink-200 bg-white p-4">
            <h2 className="text-sm font-bold text-ink-900">Começar de novo</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Volta ao tema padrão do Menuvo e remove logo e capa personalizados.
            </p>
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              disabled={pending}
              className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-600 disabled:opacity-50"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              Restaurar tema padrão
            </button>
          </section>
        </div>
      )}

      {/* ------------------------------------------------- barra de salvar */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 px-4 pt-3 backdrop-blur-lg"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
      >
        <div className="mx-auto w-full max-w-lg space-y-1.5">
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              {saved ? (
                <p role="status" className="flex items-center gap-1.5 text-sm font-semibold text-brand-700">
                  <Check className="size-4" aria-hidden="true" strokeWidth={3} />
                  {saved}
                </p>
              ) : (
                <p className="text-xs text-ink-500">
                  {isPublished
                    ? "Publicado em /r/" + slug
                    : "Publique o cardápio para o tema aparecer para os clientes."}
                </p>
              )}
            </div>

            <Button onClick={submit} loading={pending} disabled={!dirty} className="shrink-0">
              <Save className="size-4" aria-hidden="true" />
              Salvar
            </Button>
          </div>
        </div>
      </div>

      <ConfirmSheet
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Restaurar tema padrão?"
        description={
          <p>
            As cores, o logo e a capa personalizados serão removidos. O cardápio
            continua no ar, com o tema padrão do Menuvo.
          </p>
        }
        confirmLabel="Restaurar"
        onConfirm={doReset}
      />

      {/* Spinner global de "salvando" para telas lentas */}
      {pending && (
        <span className="sr-only" role="status">
          <Loader2 className="animate-spin" />
          Salvando
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Accordion({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`accordion-${id}`}
        className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink-900">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-ink-500">{summary}</span>
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-ink-400 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div id={`accordion-${id}`} className="border-t border-ink-100 px-4 py-3">
          {children}
        </div>
      )}
    </div>
  );
}

function StyleOption({
  id,
  label,
  hint,
  selected,
  kind,
  onSelect,
}: {
  id: CardStyle | ButtonStyle;
  label: string;
  hint: string;
  selected: boolean;
  kind: "card" | "button";
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
        selected
          ? "border-brand-500 bg-brand-50/60 ring-2 ring-brand-100"
          : "border-ink-200 bg-white",
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center border-2 border-ink-300"
        style={{
          borderRadius:
            kind === "card"
              ? id === "rounded"
                ? "0.9rem"
                : id === "soft"
                  ? "0.6rem"
                  : "0.3rem"
              : id === "pill"
                ? "999px"
                : id === "outline"
                  ? "0.75rem"
                  : "0.5rem",
          backgroundColor: kind === "button" && id === "outline" ? "transparent" : "#e6e7eb",
        }}
      >
        <span className="text-[0.6rem] font-bold text-ink-500">{kind === "card" ? "Aa" : "＋"}</span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink-900">{label}</span>
        <span className="mt-0.5 block text-xs text-ink-500">{hint}</span>
      </span>

      {selected && <Check className="size-4 shrink-0 text-brand-600" aria-hidden="true" strokeWidth={3} />}
    </button>
  );
}
