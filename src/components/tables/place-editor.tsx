"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Loader2,
  RotateCcw,
  Save,
  Share2,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { resetPlaceStyle, savePlaceStyle } from "@/actions/qr-places";
import {
  DEFAULT_PLACE_STYLE,
  PLACE_FORMATS,
  PLACE_FORMAT_IDS,
  PLACE_TEMPLATES,
  checkQrContrast,
  checkTextContrast,
  clampStyleToFormat,
  contrastRatio,
  maxQrMm,
  placeGeometry,
  placeText,
  readabilityReport,
  type PlaceFormat,
  type PlaceStyle,
  type PlaceTemplateId,
} from "@/lib/place-card";
import { cn } from "@/lib/utils";

/**
 * Editor da plaquinha de QR Code — Etapa 22.
 *
 * ─── Preview em SVG de verdade, não uma imagem ────────────────────────────
 *
 * A prévia é montada no cliente com **as mesmas regras** do arquivo baixado:
 * medidas em mm, o mesmo formato, o mesmo tamanho de QR. Uma prévia "bonita" que
 * diverge do arquivo é pior que nenhuma: o dono aprova na tela e recebe outra
 * coisa na gráfica. Por isso a prévia usa `mm` num `<svg>` com `viewBox` — o
 * texto, o QR e as proporções batem com o SVG do servidor.
 *
 * O QR em si não é desenhado aqui (a matriz vem do servidor na página). Na
 * prévia ele aparece como um bloco com o padrão característico; o arquivo real
 * traz o código de verdade. Isso é dito na tela, sem esconder do dono.
 *
 * ─── Contraste: bloqueia, não avisa ────────────────────────────────────────
 *
 * A regra do escopo é "nunca permitir personalização que prejudique a leitura".
 * Avisar e deixar passar não cumpre isso: quem está com pressa confirma. Então o
 * botão de salvar e os de download desabilitam quando o contraste do QR cai
 * abaixo de 7:1 — e a explicação aparece no lugar do botão, em português claro.
 */

type Props = {
  open: boolean;
  onClose: () => void;
  initialStyle: PlaceStyle;
  restaurantName: string;
  /** Nome da primeira mesa, só para o preview ficar concreto. */
  previewTableName: string;
  logoUrl: string | null;
  canEdit: boolean;
  /** URL pública do QR da mesa de preview (para o link e o NFC). */
  previewUrl: string;
  /** Base para os downloads do preview (rota de arquivo do servidor). */
  downloadBase: string | null;
};

export function PlaceEditor({
  open,
  onClose,
  initialStyle,
  restaurantName,
  previewTableName,
  logoUrl,
  canEdit,
  previewUrl,
  downloadBase,
}: Props) {
  const router = useRouter();
  const [style, setStyle] = useState<PlaceStyle>(initialStyle);
  const [saved, setSaved] = useState<PlaceStyle>(initialStyle);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Reabrir com a arte salva (não com o rascunho abandonado da vez anterior).
  useEffect(() => {
    if (!open) return;
    setStyle(saved);
    setError(null);
    setNotice(null);
    setCopied(false);
    // `saved` de propósito fora das deps: o efeito roda na abertura, não a cada
    // mudança de rascunho.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const report = useMemo(() => readabilityReport(style), [style]);
  const qrContrast = useMemo(() => checkQrContrast(style.qrDark, style.qrLight), [style]);
  const textContrast = useMemo(
    () => checkTextContrast(style.text, style.background),
    [style],
  );
  const dirty = useMemo(() => JSON.stringify(style) !== JSON.stringify(saved), [style, saved]);

  const patch = useCallback((changes: Partial<PlaceStyle>) => {
    // Toda mudança passa pelo encaixe no formato: reduzir para 80×80 mm com o QR
    // de 60 mm precisa encolher o QR (e mostrar o novo valor no controle), não
    // guardar um estilo que a validação vai recusar depois.
    setStyle((current) => clampStyleToFormat({ ...current, ...changes }));
    setError(null);
    setNotice(null);
  }, []);

  const save = useCallback(() => {
    if (!canEdit) return;
    startTransition(async () => {
      const result = await savePlaceStyle(style);
      if (result.ok) {
        setSaved(result.style);
        setNotice(result.message ?? "Arte salva.");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }, [canEdit, router, style]);

  const restoreDefault = useCallback(() => {
    startTransition(async () => {
      const result = await resetPlaceStyle();
      if (result.ok) {
        setStyle(result.style);
        setSaved(result.style);
        setNotice(result.message ?? "Arte padrão restaurada.");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }, [router]);

  const copyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(previewUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Não foi possível copiar. Toque e segure no link para copiar.");
    }
  }, [previewUrl]);

  /** Baixa o arquivo real do servidor com a arte atual (mesmo sem salvar). */
  const download = useCallback(
    (format: "svg" | "png") => {
      if (!downloadBase || !report.ok) return;
      const params = new URLSearchParams({
        format,
        style: JSON.stringify(style),
      });
      window.location.href = `${downloadBase}?${params.toString()}`;
    },
    [downloadBase, report.ok, style],
  );

  const template = PLACE_TEMPLATES.find((item) => item.id === style.template) ?? PLACE_TEMPLATES[0]!;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Criar placa"
      description="Escolha o modelo, veja como fica e baixe pronto para imprimir."
      size="tall"
      footer={
        <div className="flex flex-col gap-2">
          {!report.ok && (
            <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-700 ring-1 ring-inset ring-red-200">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{report.problems[0]}</span>
            </p>
          )}
          {error && <p className="text-sm font-medium text-red-700">{error}</p>}
          {notice && (
            <p className="flex items-center gap-2 text-sm font-medium text-brand-700">
              <Check className="size-4" aria-hidden="true" />
              {notice}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              onClick={() => download("svg")}
              disabled={!report.ok || !downloadBase}
            >
              <Download className="size-4" aria-hidden="true" />
              SVG
            </Button>
            <Button
              variant="secondary"
              onClick={() => download("png")}
              disabled={!report.ok || !downloadBase}
            >
              <Download className="size-4" aria-hidden="true" />
              PNG
            </Button>
          </div>
          {canEdit ? (
            <Button block loading={pending} onClick={save} disabled={!report.ok || !dirty}>
              <Save className="size-4" aria-hidden="true" />
              {dirty ? "Salvar para todas as mesas" : "Arte salva"}
            </Button>
          ) : (
            <p className="rounded-xl bg-ink-100 px-3 py-2 text-sm text-ink-600">
              Você pode baixar as plaquinhas. Para personalizar, peça a um proprietário ou
              administrador.
            </p>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-5 pb-2">
        {/* ---------- Preview ---------- */}
        <div className="flex flex-col items-center gap-2">
          <PlacePreview
            style={style}
            restaurantName={restaurantName}
            tableName={previewTableName}
            logoUrl={logoUrl}
          />
          <p className="text-center text-xs leading-relaxed text-ink-500">
            {PLACE_FORMATS[style.format].widthMm}×{PLACE_FORMATS[style.format].heightMm} mm ·
            QR de {style.qrSizeMm} mm · prévia ilustrativa do código
          </p>
        </div>

        {/* ---------- Modelos ---------- */}
        <Section title="Modelo" hint="O que aparece na placa além do QR Code.">
          <div className="grid grid-cols-2 gap-2">
            {PLACE_TEMPLATES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => patch({ template: item.id as PlaceTemplateId })}
                aria-pressed={style.template === item.id}
                className={cn(
                  "tap-target flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition",
                  style.template === item.id
                    ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600"
                    : "border-ink-200 bg-white",
                )}
              >
                <span className="text-sm font-semibold text-ink-900">{item.label}</span>
                <span className="text-xs leading-snug text-ink-500">{item.hint}</span>
              </button>
            ))}
          </div>
          {template.showNfc && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 ring-1 ring-inset ring-amber-200">
              A placa NFC mostra o símbolo e a palavra NFC. O navegador não grava a TAG — use um
              aplicativo de gravação com a URL copiada abaixo.
            </p>
          )}
        </Section>

        {/* ---------- Formato ---------- */}
        <Section title="Formato" hint="Escolha pelo tipo de suporte que você vai usar.">
          <div className="grid grid-cols-3 gap-2">
            {PLACE_FORMAT_IDS.map((id) => {
              const format = PLACE_FORMATS[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => patch({ format: id as PlaceFormat })}
                  aria-pressed={style.format === id}
                  className={cn(
                    "tap-target flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 transition",
                    style.format === id
                      ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600"
                      : "border-ink-200 bg-white",
                  )}
                >
                  <span className="text-sm font-semibold text-ink-900">{format.label}</span>
                  <span className="text-[0.7rem] text-ink-500">
                    {format.widthMm}×{format.heightMm} mm
                  </span>
                </button>
              );
            })}
          </div>
        </Section>

        {/* ---------- Tamanho do QR e margem ---------- */}
        <Section title="Tamanho do QR" hint="Abaixo de 30 mm a câmera começa a errar.">
          <Slider
            label="Largura do QR Code"
            value={style.qrSizeMm}
            min={30}
            max={maxQrMm(style.format, style.marginMm)}
            step={1}
            suffix=" mm"
            onChange={(value) => patch({ qrSizeMm: value })}
          />
          <Slider
            label="Margem até a borda"
            value={style.marginMm}
            min={4}
            max={16}
            step={1}
            suffix=" mm"
            onChange={(value) => patch({ marginMm: value })}
          />
        </Section>

        {/* ---------- Conteúdo ---------- */}
        <Section title="Conteúdo" hint="Menos texto, mais longe o QR é lido.">
          <Toggle
            label="Nome do restaurante"
            checked={style.showRestaurant}
            onChange={(checked) => patch({ showRestaurant: checked })}
          />
          <Toggle
            label="Nome da mesa"
            checked={style.showTable}
            onChange={(checked) => patch({ showTable: checked })}
          />
          <Toggle
            label="Logo"
            description={
              logoUrl
                ? "Usa a logo do cardápio."
                : "Adicione uma logo nas configurações do restaurante para usar aqui."
            }
            checked={style.showLogo}
            disabled={!logoUrl}
            onChange={(checked) => patch({ showLogo: checked })}
          />
        </Section>

        {/* ---------- Cores ---------- */}
        <Section title="Cores" hint="O contraste é verificado antes de salvar.">
          <div className="grid grid-cols-2 gap-3">
            <ColorField
              label="QR Code"
              value={style.qrDark}
              onChange={(value) => patch({ qrDark: value })}
            />
            <ColorField
              label="Fundo do QR"
              value={style.qrLight}
              onChange={(value) => patch({ qrLight: value })}
            />
            <ColorField
              label="Fundo da placa"
              value={style.background}
              onChange={(value) => patch({ background: value })}
            />
            <ColorField
              label="Texto"
              value={style.text}
              onChange={(value) => patch({ text: value })}
            />
          </div>

          <div className="flex flex-col gap-1.5 rounded-xl bg-ink-50 px-3 py-2.5">
            <ContrastLine
              label="QR × fundo do QR"
              ratio={qrContrast.ratio}
              ok={qrContrast.ok}
              minimum={7}
            />
            <ContrastLine
              label="Texto × fundo da placa"
              ratio={textContrast.ratio}
              ok={textContrast.ok}
              minimum={4.5}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => patch({ ...DEFAULT_PLACE_STYLE })}>
              <Sparkles className="size-4" aria-hidden="true" />
              Usar preto no branco
            </Button>
            <Button size="sm" variant="ghost" onClick={restoreDefault} loading={pending}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Restaurar padrão
            </Button>
          </div>
        </Section>

        {/* ---------- NFC ---------- */}
        {template.showNfc && (
          <Section
            title="URL para NFC"
            hint="Copie e grave em uma TAG com um aplicativo de gravação."
          >
            <div className="flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2">
              <code className="min-w-0 flex-1 break-all text-xs text-ink-700">{previewUrl}</code>
              <Button size="sm" variant="ghost" onClick={copyUrl} aria-label="Copiar URL para NFC">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={copyUrl}>
                {copied ? "URL copiada" : "Copiar URL"}
              </Button>
              {previewUrl && (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="tap-target inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold text-ink-700 hover:bg-ink-100"
                >
                  <Share2 className="size-4" aria-hidden="true" />
                  Testar
                </a>
              )}
            </div>
          </Section>
        )}

        {/* ---------- Avançado ---------- */}
        <button
          type="button"
          onClick={() => setShowAdvanced((value) => !value)}
          className="tap-target flex items-center justify-between rounded-xl border border-ink-200 px-3 py-2.5 text-sm font-semibold text-ink-700"
          aria-expanded={showAdvanced}
        >
          O que muda o QR já impresso
          <ChevronDown className={cn("size-4 transition", showAdvanced && "rotate-180")} />
        </button>
        {showAdvanced && (
          <div className="flex flex-col gap-2 rounded-xl bg-ink-50 px-3 py-3 text-sm leading-relaxed text-ink-700">
            <p>
              O QR aponta para o <strong>link público da mesa</strong>, não para o número dela.
              Editar produtos, preços, categorias ou o tema do cardápio <strong>não</strong> afeta
              o código impresso.
            </p>
            <p>
              Só duas ações invalidam uma placa: <strong>regenerar o QR</strong> desta mesa e{" "}
              <strong>trocar o link</strong> do restaurante. As duas pedem confirmação e avisam
              quais mesas precisam ser reimpressas.
            </p>
            <p className="text-xs text-ink-500">
              Contraste atual do QR: {contrastRatio(style.qrDark, style.qrLight).toFixed(1)}:1
              (mínimo 7:1). A zona silenciosa de 4 módulos já vem embutida no arquivo.
            </p>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Preview                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Placa em SVG, proporcional ao arquivo real.
 *
 * Desenha uma grade de módulos no lugar do QR: o objetivo é mostrar tamanho e
 * distribuição, não o código. Um QR falso que **parecesse** escaneável seria
 * pior — se alguém apontasse a câmera para a tela e funcionasse, seria por
 * acidente.
 */
export function PlacePreview({
  style,
  restaurantName,
  tableName,
  logoUrl,
}: {
  style: PlaceStyle;
  restaurantName: string;
  tableName: string;
  logoUrl: string | null;
}) {
  const format = PLACE_FORMATS[style.format];
  const template = PLACE_TEMPLATES.find((item) => item.id === style.template) ?? PLACE_TEMPLATES[0]!;
  const geometry = placeGeometry(style);
  const text = placeText({ restaurantName, tableName, style });
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(3);

  // Ajusta a escala visual ao espaço disponível no celular; o viewBox continua
  // em mm, então a proporção nunca mente.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const compute = () => {
      const width = element.clientWidth || 280;
      setScale(Math.min(width / format.widthMm, 3.4));
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(element);
    return () => observer.disconnect();
  }, [format.widthMm]);

  /**
   * Grade decorativa no lugar do QR.
   *
   * São 21×21 módulos com os três marcadores de posição — o suficiente para o
   * olho reconhecer "é um QR deste tamanho". Não é um código válido de
   * propósito: um QR falso que **funcionasse** na tela seria pior, porque
   * alguém poderia imprimir a prévia achando que serve.
   */
  const modules = 21;
  const pitch = style.qrSizeMm / (modules + 8); // 4 módulos de zona silenciosa de cada lado
  const originX = geometry.qrX + pitch * 4;
  const originY = geometry.qrY + pitch * 4;

  const finder = (col: number, row: number) => {
    const x = originX + col * pitch;
    const y = originY + row * pitch;
    return (
      <g key={`f-${col}-${row}`}>
        <rect x={x} y={y} width={pitch * 7} height={pitch * 7} />
        <rect x={x + pitch} y={y + pitch} width={pitch * 5} height={pitch * 5} fill={style.qrLight} />
        <rect x={x + pitch * 2} y={y + pitch * 2} width={pitch * 3} height={pitch * 3} />
      </g>
    );
  };

  return (
    <div ref={ref} className="w-full max-w-xs">
      <svg
        width={format.widthMm * scale}
        height={format.heightMm * scale}
        viewBox={`0 0 ${format.widthMm} ${format.heightMm}`}
        role="img"
        aria-label={`Prévia da plaquinha no modelo ${template.label}`}
        className="mx-auto rounded-lg shadow-[var(--shadow-soft)]"
      >
        <rect width={format.widthMm} height={format.heightMm} fill={style.background} />

        {style.showLogo && logoUrl && geometry.logoY !== null && (
          <image
            href={logoUrl}
            x={(format.widthMm - 12) / 2}
            y={geometry.logoY - 6}
            width={12}
            height={12}
            preserveAspectRatio="xMidYMid meet"
          />
        )}

        {text.table && geometry.tableY !== null && (
          <text
            x={format.widthMm / 2}
            y={geometry.tableY}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={5.5}
            fontWeight={700}
            fill={style.text}
          >
            {text.table}
          </text>
        )}

        {text.restaurant && geometry.restaurantY !== null && (
          <text
            x={format.widthMm / 2}
            y={geometry.restaurantY}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={2.6}
            fontWeight={600}
            fill={style.text}
            opacity={0.72}
          >
            {text.restaurant.toUpperCase()}
          </text>
        )}

        <rect
          x={geometry.qrX}
          y={geometry.qrY}
          width={style.qrSizeMm}
          height={style.qrSizeMm}
          fill={style.qrLight}
        />
        <g fill={style.qrDark}>
          {finder(0, 0)}
          {finder(14, 0)}
          {finder(0, 14)}
          {Array.from({ length: 8 }).map((_, row) =>
            Array.from({ length: 8 }).map((__, col) =>
              (row * 3 + col * 5) % 4 === 0 ? (
                <rect
                  key={`d-${row}-${col}`}
                  x={originX + pitch * (9 + col)}
                  y={originY + pitch * (7 + row)}
                  width={pitch}
                  height={pitch}
                />
              ) : null,
            ),
          )}
        </g>

        {text.instruction && geometry.instructionY !== null && (
          <text
            x={format.widthMm / 2}
            y={geometry.instructionY}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={2.7}
            fontWeight={600}
            fill={style.text}
          >
            {text.instruction}
          </text>
        )}

        {text.nfc && geometry.nfcY !== null && (
          <text
            x={format.widthMm / 2}
            y={geometry.nfcY}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={2.3}
            fontWeight={700}
            letterSpacing={0.3}
            fill={style.text}
            opacity={0.72}
          >
            NFC
          </text>
        )}
      </svg>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Campos                                                                      */
/* -------------------------------------------------------------------------- */

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        {hint && <p className="text-xs leading-snug text-ink-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  // Clampa o valor atual na faixa: mudar de formato pode deixar o QR maior que
  // o novo máximo, e o `input` com `value` fora do range fica travado.
  const clamped = Math.max(min, Math.min(max, value));

  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-sm text-ink-700">
        {label}
        <span className="font-semibold tabular-nums text-ink-900">
          {clamped}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={clamped}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-11 w-full accent-brand-600"
      />
    </label>
  );
}

function Toggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "tap-target flex items-center justify-between gap-3 rounded-xl border border-ink-200 px-3 py-2.5",
        disabled && "opacity-55",
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink-900">{label}</span>
        {description && (
          <span className="block text-xs leading-snug text-ink-500">{description}</span>
        )}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-5 shrink-0 accent-brand-600"
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-600">{label}</span>
      <span className="flex items-center gap-2 rounded-xl border border-ink-200 px-2 py-1.5">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          className="size-8 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0"
        />
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={7}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-mono text-xs uppercase text-ink-700 outline-none"
        />
      </span>
    </label>
  );
}

function ContrastLine({
  label,
  ratio,
  ok,
  minimum,
}: {
  label: string;
  ratio: number;
  ok: boolean;
  minimum: number;
}) {
  return (
    <p className={cn("flex items-center justify-between text-xs", ok ? "text-ink-600" : "text-red-700")}>
      <span>{label}</span>
      <span className="font-semibold tabular-nums">
        {ratio.toFixed(1)}:1 {ok ? "✓" : `· mínimo ${minimum}:1`}
      </span>
    </p>
  );
}

/** Botão de download isolado, usado fora do editor (lista de mesas). */
export function DownloadButtons({
  base,
  style,
  disabled,
}: {
  base: string | null;
  style: PlaceStyle;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState<"svg" | "png" | null>(null);

  const go = (format: "svg" | "png") => {
    if (!base) return;
    setPending(format);
    const params = new URLSearchParams({ format, style: JSON.stringify(style) });
    window.location.href = `${base}?${params.toString()}`;
    window.setTimeout(() => setPending(null), 1200);
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => go("svg")} disabled={disabled || !base}>
        {pending === "svg" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        SVG
      </Button>
      <Button size="sm" variant="secondary" onClick={() => go("png")} disabled={disabled || !base}>
        {pending === "png" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        PNG
      </Button>
    </>
  );
}
