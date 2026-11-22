"use client";

import Image from "next/image";
import { Check, Sparkles, Wand2 } from "lucide-react";
import { ImagePicker } from "@/components/theme/image-picker";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { THEME_PRESETS } from "@/lib/theme";
import { SEGMENTS, SEGMENT_THEME, type RestaurantSegment } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

/**
 * Conteúdo de cada etapa do wizard — Etapa 21.
 *
 * ─── Princípio: uma decisão por tela ───────────────────────────────────────
 *
 * O escopo pede "formulários curtos, evitar telas enormes". Cada componente
 * abaixo é uma tela de celular com **um** objetivo: nomear, escolher tema,
 * escolher segmento, listar categorias. Nada de formulário com 12 campos — o
 * dono está em pé no salão, não numa mesa de escritório.
 *
 * ─── O que é reaproveitado ────────────────────────────────────────────────
 *
 * Nada de lógica paralela: `updateRestaurant`, `ImagePicker` e os presets de
 * tema já existem desde as Etapas 2/9 e são usados aqui como estão. O wizard é
 * uma **camada de condução** por cima do que o produto já faz — se ele
 * reimplementasse o formulário, as duas telas divergiriam na primeira correção.
 */

/* ========================================================================== */
/* Etapa 1 · Informações                                                     */
/* ========================================================================== */

export function StepInfo({
  name,
  description,
  logoUrl,
  onChange,
  error,
}: {
  name: string;
  description: string | null;
  logoUrl: string | null;
  onChange: (patch: { name?: string; description?: string | null; logoUrl?: string | null }) => void;
  error?: string | null;
}) {
  /*
   * Componente **controlado**: o wizard é dono do estado.
   *
   * A primeira versão guardava nome/descrição/logo aqui dentro e tinha um botão
   * "Salvar informações". Dois problemas: o "Continuar" da barra inferior
   * avançaria sem gravar, e quem digitasse e tocasse em Continuar perderia o
   * texto. Com o estado no pai, o mesmo clique que avança grava — e não existe
   * botão de salvar para o dono esquecer de tocar.
   */
  return (
    <div className="space-y-5">
      <ImagePicker
        kind="logo"
        label="Logo"
        hint="PNG, JPG ou WEBP. Redimensionamos para você."
        aspect="square"
        value={logoUrl}
        onChange={(url) => onChange({ logoUrl: url })}
      />

      <Field
        label="Nome do restaurante"
        name="name"
        autoComplete="organization"
        value={name}
        onChange={(event) => onChange({ name: event.target.value })}
        required
        error={error ?? undefined}
      />

      <Textarea
        label="Descrição"
        name="description"
        rows={3}
        maxLength={500}
        placeholder="Ex.: Hambúrguer artesanal no bairro, com pão de fermentação natural."
        value={description ?? ""}
        onChange={(event) => onChange({ description: event.target.value })}
        hint="Aparece embaixo do nome no cardápio."
      />

      <p className="text-xs leading-relaxed text-ink-400">
        A logo entra no cardápio quando você toca em Continuar.
      </p>
    </div>
  );
}

/* ========================================================================== */
/* Etapa 2 · Aparência                                                      */
/* ========================================================================== */

export function StepTheme({
  selected,
  segment,
  onSelect,
}: {
  selected: string | null;
  segment: RestaurantSegment | null;
  onSelect: (preset: string) => void;
}) {
  const suggested = segment ? SEGMENT_THEME[segment] : null;

  return (
    <div className="space-y-3">
      {suggested && (
        <p className="flex items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-2 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-200">
          <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
          Sugerimos um tema para o seu segmento. Você pode trocar depois.
        </p>
      )}

      <ul className="grid grid-cols-2 gap-2.5">
        {THEME_PRESETS.map((preset) => {
          const isSelected = selected === preset.id;
          const isSuggested = suggested === preset.id;
          return (
            <li key={preset.id}>
              <button
                type="button"
                onClick={() => onSelect(preset.id)}
                aria-pressed={isSelected}
                className={cn(
                  "relative flex w-full flex-col overflow-hidden rounded-2xl border-2 bg-white text-left transition",
                  "active:scale-[0.985]",
                  isSelected ? "border-brand-600 shadow-[var(--shadow-lift)]" : "border-ink-200",
                )}
              >
                {/* Amostra de cores: a decisão é visual, então a miniatura manda. */}
                <div className="flex h-16 w-full">
                  {preset.swatch.map((color, index) => (
                    <span
                      key={`${preset.id}-${index}`}
                      className="flex-1"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink-900">
                      {preset.name}
                    </span>
                    {isSuggested && (
                      <span className="block text-[0.65rem] font-medium text-brand-700">
                        sugerido
                      </span>
                    )}
                  </span>
                  {isSelected && (
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
                      <Check className="size-3" aria-hidden="true" />
                    </span>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ========================================================================== */
/* Etapa 3 · Segmento                                                       */
/* ========================================================================== */

export function StepSegment({
  selected,
  onSelect,
}: {
  selected: RestaurantSegment | null;
  onSelect: (segment: RestaurantSegment) => void;
}) {
  return (
    <ul className="grid grid-cols-2 gap-2.5">
      {SEGMENTS.map((segment) => {
        const isSelected = selected === segment.id;
        return (
          <li key={segment.id}>
            <button
              type="button"
              onClick={() => onSelect(segment.id)}
              aria-pressed={isSelected}
              className={cn(
                "flex h-full w-full flex-col items-start gap-1 rounded-2xl border-2 px-3 py-3 text-left transition",
                "active:scale-[0.985]",
                isSelected
                  ? "border-brand-600 bg-brand-50"
                  : "border-ink-200 bg-white hover:border-ink-300",
              )}
            >
              <span className="text-2xl leading-none" aria-hidden="true">
                {segment.emoji}
              </span>
              <span className="text-sm font-semibold text-ink-900">{segment.label}</span>
              <span className="text-[0.68rem] leading-snug text-ink-500">{segment.hint}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ========================================================================== */
/* Etapa 4 · Categorias                                                     */
/* ========================================================================== */

export function StepCategories({
  segment,
  existing,
  suggested,
  onApply,
  applyLabel,
}: {
  segment: RestaurantSegment | null;
  existing: string[];
  suggested: string[];
  onApply: () => void;
  applyLabel: string;
}) {
  const hasModel = suggested.length > 0;

  return (
    <div className="space-y-4">
      {hasModel ? (
        <div className="rounded-2xl border border-ink-200 bg-white p-3.5">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
            <Wand2 className="size-4 text-brand-600" aria-hidden="true" />
            Modelo sugerido
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
            Categorias vazias não aparecem no cardápio. Elas só organizam o
            cadastro — nenhum produto de exemplo é criado.
          </p>

          <ul className="mt-3 space-y-1.5">
            {suggested.map((name) => {
              const already = existing.some(
                (item) => item.trim().toLowerCase() === name.trim().toLowerCase(),
              );
              return (
                <li
                  key={name}
                  className="flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2 text-sm"
                >
                  <span
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded-full",
                      already ? "bg-brand-600 text-white" : "bg-white text-ink-300 ring-1 ring-ink-200",
                    )}
                    aria-hidden="true"
                  >
                    {already ? <Check className="size-3" /> : null}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate", already ? "text-ink-500 line-through" : "text-ink-800")}>
                    {name}
                  </span>
                  {already && <span className="text-[0.65rem] text-ink-400">já existe</span>}
                </li>
              );
            })}
          </ul>

          <Button type="button" onClick={onApply} block className="mt-3">
            {applyLabel}
          </Button>
        </div>
      ) : (
        <p className="rounded-xl bg-ink-50 px-3.5 py-3 text-sm leading-relaxed text-ink-600">
          {segment
            ? "Este segmento não tem modelo sugerido. Crie as categorias do seu jeito — você pode adicionar quantas quiser."
            : "Escolha um segmento para receber uma sugestão de categorias, ou crie as suas do zero."}
        </p>
      )}

      <div>
        <p className="mb-1.5 text-sm font-medium text-ink-700">
          No seu cardápio agora ({existing.length})
        </p>
        {existing.length === 0 ? (
          <p className="rounded-xl border border-dashed border-ink-200 px-3 py-4 text-center text-sm text-ink-400">
            Nenhuma categoria ainda
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {existing.map((name) => (
              <li
                key={name}
                className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-200"
              >
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Etapa 5 · Produtos (atalho para a tela completa)                          */
/* ========================================================================== */

export function StepProducts({
  hasCategories,
  productCount,
}: {
  hasCategories: boolean;
  productCount: number;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-ink-200 bg-white p-4">
        <p className="text-sm font-semibold text-ink-900">
          {productCount > 0
            ? `${productCount} ${productCount === 1 ? "produto cadastrado" : "produtos cadastrados"}`
            : "Nenhum produto ainda"}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          O cadastro completo tem foto, descrição, opcionais e disponibilidade.
          Aqui você só precisa dos primeiros — nome e preço bastam para o
          cardápio funcionar.
        </p>

        {!hasCategories && (
          <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs leading-relaxed text-amber-900">
            Crie uma categoria antes de cadastrar produtos: o produto precisa
            pertencer a uma seção do cardápio.
          </p>
        )}
      </div>

      <ul className="space-y-1.5 text-sm text-ink-600">
        <li className="flex gap-2">
          <span className="text-brand-600" aria-hidden="true">•</span>
          Nome curto: o cliente lê de longe no celular.
        </li>
        <li className="flex gap-2">
          <span className="text-brand-600" aria-hidden="true">•</span>
          Preço em reais, com vírgula: <span className="font-mono">24,90</span>.
        </li>
        <li className="flex gap-2">
          <span className="text-brand-600" aria-hidden="true">•</span>
          Foto depois — ela pesa no carregamento e pode ficar para o fim.
        </li>
      </ul>
    </div>
  );
}

/* ========================================================================== */
/* Etapa 6 · Mesas                                                          */
/* ========================================================================== */

export function StepTables({ tableCount }: { tableCount: number }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-ink-200 bg-white p-4">
        <p className="text-sm font-semibold text-ink-900">
          {tableCount > 0
            ? `${tableCount} ${tableCount === 1 ? "mesa cadastrada" : "mesas cadastradas"}`
            : "Nenhuma mesa ainda"}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          Cada mesa recebe um QR Code próprio. O cliente escaneia, vê o cardápio
          e o pedido chega já identificado com o número da mesa.
        </p>
      </div>

      <div className="rounded-2xl border border-ink-200 bg-ink-50/60 p-4">
        <p className="text-sm font-semibold text-ink-800">Não tem salão?</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-600">
          Só delivery também funciona: use o link público do cardápio no
          Instagram e no WhatsApp. Pule esta etapa e a de QR Code.
        </p>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Etapa 7 · QR Code                                                        */
/* ========================================================================== */

/**
 * Prévia do QR da primeira mesa ativa.
 *
 * A imagem vem de `/app/mesas/{id}/qr`, que já exige sessão e confere o
 * tenant — não há URL de QR solta no HTML público. `unoptimized` porque é um
 * PNG gerado no servidor: mandar pelo otimizador do Next reprocessaria um
 * bitmap que já sai no tamanho certo.
 */
export function StepQr({
  tableId,
  tableName,
}: {
  tableId: string | null;
  tableName: string | null;
}) {
  if (!tableId) {
    return (
      <div className="rounded-2xl border border-dashed border-ink-200 px-4 py-8 text-center">
        <p className="text-sm font-semibold text-ink-700">Nenhuma mesa ativa</p>
        <p className="mx-auto mt-1 max-w-[16rem] text-xs leading-relaxed text-ink-500">
          O QR Code é gerado a partir da mesa. Cadastre ou ative uma mesa para
          liberar o código.
        </p>
      </div>
    );
  }

  const src = `/app/mesas/${tableId}/qr`;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-ink-200 bg-white p-4 text-center">
        <p className="text-sm font-semibold text-ink-900">{tableName ?? "Sua mesa"}</p>
        <div className="mx-auto mt-2 size-44 overflow-hidden rounded-xl border border-ink-100 bg-white p-2">
          <Image
            src={src}
            alt={`QR Code da ${tableName ?? "mesa"}`}
            width={320}
            height={320}
            unoptimized
            className="size-full object-contain"
          />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-ink-500">
          Imprima, plastifique e cole na mesa. Se a mesa for trocada de lugar, o
          código continua valendo.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <a
          href={`${src}?format=png`}
          className="tap-target inline-flex min-h-11 items-center justify-center rounded-xl bg-ink-100 px-3 text-sm font-semibold text-ink-800"
        >
          Baixar PNG
        </a>
        <a
          href={`${src}?format=svg`}
          className="tap-target inline-flex min-h-11 items-center justify-center rounded-xl bg-ink-100 px-3 text-sm font-semibold text-ink-800"
        >
          Baixar SVG
        </a>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Etapa 8 · WhatsApp                                                       */
/* ========================================================================== */

export function StepWhatsapp({ configured }: { configured: boolean }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-ink-200 bg-white p-4">
        <p className="text-sm font-semibold text-ink-900">
          {configured ? "WhatsApp conectado" : "WhatsApp não conectado"}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          Quando conectado, o cardápio mostra um botão que abre a conversa com o
          número da casa, já com a mensagem inicial preenchida. O pedido em si
          continua pelo sistema — o WhatsApp é o canal de contato.
        </p>
      </div>

      <p className="rounded-xl bg-ink-50 px-3.5 py-3 text-xs leading-relaxed text-ink-600">
        Esta etapa é opcional. Você pode conectar depois em{" "}
        <strong className="font-semibold text-ink-800">Configurações → WhatsApp</strong>{" "}
        sem perder nada do que já configurou.
      </p>
    </div>
  );
}
