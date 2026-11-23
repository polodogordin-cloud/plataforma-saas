"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Dices, Loader2, TriangleAlert } from "lucide-react";
import { Card, SectionTitle } from "@/components/ui/card";
import { generateCouponCode, saveCoupon } from "@/actions/coupons";
import {
  COUPON_DESCRIPTION_MAX,
  COUPON_MAX_USES_PER_CUSTOMER,
  COUPON_NAME_MAX,
  DISCOUNT_TYPE_LABEL,
  EMPTY_COUPON_FORM,
  describeCoupon,
  describeUsage,
  formatMoney,
  maskCouponCodeInput,
  parseCouponForm,
  parseDecimalInput,
  toCouponForm,
  type Coupon,
  type CouponDiscountType,
  type CouponForm as CouponFormValues,
} from "@/lib/coupons";
import { cn } from "@/lib/utils";

/**
 * Criar/editar cupom — Etapa 25.
 *
 * ─── Decisões de tela ─────────────────────────────────────────────────────
 *
 * 1. **O código mostra como vai ficar.** O campo aplica a máscara
 *    (`BEMVINDO10`) enquanto a pessoa digita, e o botão "gerar" cria um a partir
 *    do nome. Ninguém precisa saber que espaço e acento são removidos — o
 *    campo mostra o resultado antes de salvar.
 *
 * 2. **Prévia da regra.** Embaixo dos campos aparece a frase exata que o
 *    cliente vai ler ("10% de desconto · pedido mínimo R$ 30 · 1 uso por
 *    cliente"). Conferir a frase pronta é mais rápido que reler seis campos.
 *
 * 3. **Frete grátis aparece, mas avisa.** O tipo existe (o banco aceita) e não
 *    há delivery nesta etapa. Esconder faria o dono procurar; habilitar sem
 *    aviso prometeria um desconto que não abate nada.
 *
 * 4. **Erros no campo, não no topo.** Cada mensagem fica abaixo do campo que a
 *    causou: num formulário de dez campos no celular, um resumo no topo obriga
 *    a rolar para descobrir qual corrigir.
 */
export function CouponForm({
  coupon,
  canEdit,
}: {
  coupon?: Coupon | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<CouponFormValues>(() =>
    coupon ? toCouponForm(coupon) : { ...EMPTY_COUPON_FORM },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [pending, startTransition] = useTransition();

  const update = <K extends keyof CouponFormValues>(key: K, value: CouponFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFeedback(null);
    setErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  };

  /** Prévia ao vivo com o que está no formulário. */
  const preview = useMemo(() => {
    const value = parseDecimalInput(values.discountValue) ?? 0;
    return describeCoupon({
      discount_type: values.discountType,
      discount_value: value,
      min_order_value: parseDecimalInput(values.minOrderValue) ?? 0,
      max_uses_per_customer: Number(values.maxUsesPerCustomer) || 1,
      max_discount: parseDecimalInput(values.maxDiscount),
    });
  }, [values]);

  const generate = () => {
    setGenerating(true);
    startTransition(async () => {
      const code = await generateCouponCode(values.name);
      setGenerating(false);
      if (!code) {
        setFeedback({ ok: false, text: "Não foi possível gerar um código agora." });
        return;
      }
      update("code", code);
      setFeedback({ ok: true, text: `Código gerado: ${code}` });
    });
  };

  const submit = () => {
    const parsed = parseCouponForm(values, coupon?.id ?? null);
    if (parsed.ok === false) {
      setErrors(parsed.errors);
      setFeedback({ ok: false, text: "Revise os campos destacados." });
      return;
    }

    setErrors({});
    startTransition(async () => {
      const result = await saveCoupon(parsed.payload);

      if (result.ok === false) {
        setFeedback({ ok: false, text: result.error });
        if (result.fieldErrors) setErrors(result.fieldErrors);
        return;
      }

      // Salvo: a ficha é a próxima tela. `replace` evita voltar para um
      // formulário já enviado pelo botão "voltar" do celular.
      router.replace(`/app/marketing/cupons/${result.coupon.id}`);
      router.refresh();
    });
  };

  if (!canEdit) {
    return (
      <Card>
        <p className="text-sm text-ink-500">
          Apenas dono ou administrador pode criar e alterar cupons.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------ básico */}
      {/* Uso atual antes dos campos: quem está editando precisa saber se ainda
          pode mexer no valor sem estragar uma promoção que já rodou. */}
      {coupon && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-ink-200 bg-ink-50/70 px-3 py-2">
          <span className="text-xs text-ink-600">
            Já usado <span className="font-semibold text-ink-900">{describeUsage(coupon.used_count, coupon.max_uses)}</span>
          </span>
          <span className="text-xs tabular-nums text-ink-600">
            Abateu <span className="font-semibold text-ink-900">{formatMoney(coupon.total_discount)}</span>
          </span>
        </div>
      )}

      <div>
        <SectionTitle title="O cupom" />
        <Card className="space-y-3">
          <Field label="Nome do cupom" hint="Só você vê. Serve para achar na lista." error={errors.name}>
            <input
              type="text"
              value={values.name}
              onChange={(event) => update("name", event.target.value.slice(0, COUPON_NAME_MAX))}
              maxLength={COUPON_NAME_MAX}
              placeholder="Ex.: Boas-vindas"
              className={inputClass}
            />
          </Field>

          <Field
            label="Código"
            hint="É o que o cliente digita. Só letras e números."
            error={errors.code}
          >
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={values.code}
                onChange={(event) => update("code", maskCouponCodeInput(event.target.value))}
                placeholder="BEMVINDO10"
                autoCapitalize="characters"
                autoComplete="off"
                aria-label="Código do cupom"
                className={cn(inputClass, "mt-0 flex-1 font-mono font-bold tracking-wide")}
              />
              <button
                type="button"
                onClick={generate}
                disabled={generating || pending}
                aria-label="Gerar código automaticamente"
                className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-ink-200 px-3 text-xs font-semibold text-ink-700 active:scale-[0.98] disabled:opacity-50"
              >
                {generating ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Dices className="size-3.5" aria-hidden="true" />
                )}
                Gerar
              </button>
            </div>
          </Field>

          <Field
            label="Descrição (opcional)"
            hint="Aparece para o cliente junto do cupom."
            error={errors.description}
          >
            <input
              type="text"
              value={values.description}
              onChange={(event) =>
                update("description", event.target.value.slice(0, COUPON_DESCRIPTION_MAX))
              }
              maxLength={COUPON_DESCRIPTION_MAX}
              placeholder="Ex.: 10% na primeira visita"
              className={inputClass}
            />
          </Field>
        </Card>
      </div>

      {/* --------------------------------------------------------- desconto */}
      <div>
        <SectionTitle title="Desconto" />
        <Card className="space-y-3">
          <div>
            <span className="text-xs font-semibold text-ink-700">Tipo de desconto</span>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {(["percentage", "fixed", "free_shipping"] as CouponDiscountType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => update("discountType", type)}
                  aria-pressed={values.discountType === type}
                  className={cn(
                    "min-h-11 rounded-xl border px-1 text-[11px] font-semibold leading-tight transition-colors",
                    values.discountType === type
                      ? "border-brand-500 bg-brand-50 text-brand-800"
                      : "border-ink-200 text-ink-600",
                  )}
                >
                  {DISCOUNT_TYPE_LABEL[type]}
                </button>
              ))}
            </div>
          </div>

          {values.discountType === "free_shipping" ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-800">
              Frete grátis ainda não abate nada: a casa não tem delivery nesta versão. O cupom
              fica registrado para quando existir.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Field
                label={values.discountType === "percentage" ? "Percentual (%)" : "Valor (R$)"}
                error={errors.discountValue}
              >
                <input
                  type="text"
                  inputMode="decimal"
                  value={values.discountValue}
                  onChange={(event) => update("discountValue", event.target.value.slice(0, 10))}
                  placeholder={values.discountType === "percentage" ? "10" : "5,00"}
                  className={inputClass}
                />
              </Field>

              {values.discountType === "percentage" && (
                <Field
                  label="Teto do desconto (R$)"
                  hint="Vazio = sem teto."
                  error={errors.maxDiscount}
                >
                  <input
                    type="text"
                    inputMode="decimal"
                    value={values.maxDiscount}
                    onChange={(event) => update("maxDiscount", event.target.value.slice(0, 10))}
                    placeholder="Opcional"
                    className={inputClass}
                  />
                </Field>
              )}
            </div>
          )}

          <Field
            label="Valor mínimo do pedido (R$)"
            hint="0 = vale em qualquer valor."
            error={errors.minOrderValue}
          >
            <input
              type="text"
              inputMode="decimal"
              value={values.minOrderValue}
              onChange={(event) => update("minOrderValue", event.target.value.slice(0, 10))}
              placeholder="0"
              className={inputClass}
            />
          </Field>

          <p className="rounded-xl bg-ink-50 px-3 py-2 text-xs leading-snug text-ink-600">
            <span className="font-semibold">Como o cliente lê:</span> {preview}
          </p>
        </Card>
      </div>

      {/* -------------------------------------------------------- validade */}
      <div>
        <SectionTitle title="Válido de quando a quando" />
        <Card className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Começa em" hint="Vazio = já vale." error={errors.startsAt}>
              <input
                type="datetime-local"
                value={values.startsAt}
                onChange={(event) => update("startsAt", event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Termina em" hint="Vazio = sem prazo." error={errors.endsAt}>
              <input
                type="datetime-local"
                value={values.endsAt}
                onChange={(event) => update("endsAt", event.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field
              label="Limite total de usos"
              hint="Vazio = ilimitado."
              error={errors.maxUses}
            >
              <input
                type="text"
                inputMode="numeric"
                value={values.maxUses}
                onChange={(event) => update("maxUses", event.target.value.slice(0, 7))}
                placeholder="Ilimitado"
                className={inputClass}
              />
            </Field>
            <Field
              label="Usos por cliente"
              hint={`1 a ${COUPON_MAX_USES_PER_CUSTOMER}.`}
              error={errors.maxUsesPerCustomer}
            >
              <input
                type="text"
                inputMode="numeric"
                value={values.maxUsesPerCustomer}
                onChange={(event) => update("maxUsesPerCustomer", event.target.value.slice(0, 3))}
                className={inputClass}
              />
            </Field>
          </div>

          <p className="rounded-xl bg-ink-50 px-3 py-2 text-xs leading-snug text-ink-600">
            O limite por cliente só vale para quem se identificou no pedido. Pedido anônimo não
            tem como ser contado — e o cupom não é negado por isso.
          </p>

          <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-ink-100 pt-3">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink-900">Cupom ativo</span>
              <span className="mt-0.5 block text-xs leading-snug text-ink-500">
                Desligado, ele fica na lista mas o cliente não consegue usar.
              </span>
            </span>
            <input
              type="checkbox"
              checked={values.active}
              onChange={(event) => update("active", event.target.checked)}
              className="size-5 shrink-0 accent-brand-600"
            />
          </label>
        </Card>
      </div>

      {feedback && (
        <p
          role="status"
          className={cn(
            "flex items-start gap-1.5 rounded-xl px-3 py-2 text-xs leading-snug",
            feedback.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700",
          )}
        >
          {feedback.ok ? (
            <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          )}
          {feedback.text}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-bold text-white active:scale-[0.99] disabled:opacity-60"
      >
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {pending ? "Salvando…" : coupon ? "Salvar cupom" : "Criar cupom"}
      </button>

      {coupon && (
        <p className="px-1 text-center text-[11px] leading-snug text-ink-500">
          Alterar o cupom não muda pedidos já feitos: eles guardam o desconto que foi aplicado.
        </p>
      )}
    </div>
  );
}

const inputClass =
  "mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none";

/**
 * Rótulo ligado ao campo de verdade.
 *
 * `<label>` em volta funciona no navegador, mas **não** dá nome acessível quando
 * o controle tem `id` próprio nem quando o filho é um `div` que agrupa dois
 * controles (o campo de código tem o input e o botão "Gerar"). Rótulo vazio no
 * formulário de cupom é erro caro: o dono troca o valor do desconto achando que
 * está trocando o limite de uso. Então:
 *
 *   - filho simples (input/textarea) recebe `id` + `aria-describedby`, e o
 *     `<label htmlFor>` é o nome;
 *   - filho agrupador recebe `role="group"` + `aria-labelledby`, e cada
 *     controle interno traz o próprio `aria-label`.
 */
function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactElement<Record<string, unknown>>;
}) {
  const id = useId();
  const hintId = hint || error ? `${id}-hint` : undefined;
  const grouped = children.type === "div";

  const child = {
    ...children,
    props: {
      ...children.props,
      ...(grouped
        ? { role: "group", "aria-labelledby": `${id}-label` }
        : {
            id: (children.props.id as string | undefined) ?? id,
            "aria-describedby": (children.props["aria-describedby"] as string | undefined) ?? hintId,
            ...(error ? { "aria-invalid": true } : {}),
          }),
    },
  } as React.ReactElement;

  return (
    <div className="block">
      {grouped ? (
        <span id={`${id}-label`} className="text-xs font-semibold text-ink-700">
          {label}
        </span>
      ) : (
        <label htmlFor={(children.props.id as string | undefined) ?? id} className="text-xs font-semibold text-ink-700">
          {label}
        </label>
      )}
      {child}
      {error ? (
        <span id={`${id}-hint`} className="mt-1 block text-[11px] text-red-600">
          {error}
        </span>
      ) : (
        hint && (
          <span id={`${id}-hint`} className="mt-1 block text-[11px] text-ink-500">
            {hint}
          </span>
        )
      )}
    </div>
  );
}
