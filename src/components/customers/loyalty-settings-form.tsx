"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { Card, SectionTitle } from "@/components/ui/card";
import { saveLoyaltySettings } from "@/actions/loyalty";
import {
  MAX_PROGRAM_NOTE,
  describeProgram,
  parseLoyaltyForm,
  toLoyaltyForm,
  type LoyaltySettings,
} from "@/lib/loyalty";
import { cn } from "@/lib/utils";

/**
 * Configuração do programa de pontos — Etapa 24.
 *
 * ─── Decisões de tela ─────────────────────────────────────────────────────
 *
 * 1. **Desligar não apaga a regra.** O switch desliga o programa mas mantém os
 *    números no formulário: quem pausa em dezembro e reabre em janeiro não
 *    recadastra tudo. Quem apaga é o botão de restaurar, explícito.
 *
 * 2. **Prévia da regra em texto.** Ao lado dos campos aparece exatamente o que
 *    o cliente vai ler no cardápio ("1 ponto por R$ 1 · 50 pontos no cadastro").
 *    É mais rápido conferir a frase pronta do que reler quatro campos.
 *
 * 3. **Resgate desligado por padrão.** `redeem_value = 0` significa que o saldo
 *    acumula mas ninguém pode trocar. Prometer troca sem o dono decidir o valor
 *    faria o cliente cobrar algo que a casa não combinou.
 */
export function LoyaltySettingsForm({
  initial,
  canEdit,
}: {
  initial: LoyaltySettings;
  canEdit: boolean;
}) {
  const [values, setValues] = useState(() => toLoyaltyForm(initial));
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const update = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFeedback(null);
    setFieldErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  };

  /** Prévia ao vivo: usa a mesma regra de formatação do cardápio. */
  const preview = useMemo(() => {
    const parsed = parseLoyaltyForm(values);
    if (parsed.ok === false) return null;
    return describeProgram({ ...parsed.settings, cashback_percent: 0 });
  }, [values]);

  const save = () => {
    const parsed = parseLoyaltyForm(values);
    if (parsed.ok === false) {
      setFieldErrors(parsed.errors);
      setFeedback({ ok: false, text: "Revise os campos destacados." });
      return;
    }

    setFieldErrors({});
    startTransition(async () => {
      const result = await saveLoyaltySettings({
        enabled: parsed.settings.enabled,
        points_per_currency: parsed.settings.points_per_currency,
        signup_bonus: parsed.settings.signup_bonus,
        birthday_bonus: parsed.settings.birthday_bonus,
        redeem_value: parsed.settings.redeem_value,
        program_note: parsed.settings.program_note,
      });
      setFeedback({ ok: result.ok, text: result.ok ? result.message : result.error });
    });
  };

  if (!canEdit) {
    return (
      <Card>
        <p className="text-sm text-ink-500">
          Apenas dono ou administrador do restaurante pode alterar o programa de pontos.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* --------------------------------------------------------- liga/desliga */}
      <Card className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink-900">Programa de fidelidade</p>
          <p className="mt-0.5 text-xs leading-snug text-ink-500">
            {values.enabled
              ? "Ligado — o cliente vê os pontos no cardápio e acumula a cada pedido entregue."
              : "Desligado — o cardápio não mostra pontos e nenhum ponto novo é creditado."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={values.enabled}
          aria-label="Ligar programa de fidelidade"
          onClick={() => update("enabled", !values.enabled)}
          className={cn(
            "relative h-7 w-12 shrink-0 rounded-full transition-colors",
            values.enabled ? "bg-brand-600" : "bg-ink-200",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-6 rounded-full bg-white shadow transition-transform",
              values.enabled ? "translate-x-5.5" : "translate-x-0.5",
            )}
          />
        </button>
      </Card>

      {/* ------------------------------------------------------------- regra */}
      <div>
        <SectionTitle title="Como o cliente acumula" />
        <Card className="space-y-3">
          <Field
            label="Pontos por R$ 1 gasto"
            hint="Ex.: 1 = R$ 1 vale 1 ponto; 2 = o dobro."
            error={fieldErrors.pointsPerCurrency}
          >
            <input
              type="text"
              inputMode="decimal"
              value={values.pointsPerCurrency}
              onChange={(event) => update("pointsPerCurrency", event.target.value.slice(0, 8))}
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Bônus no cadastro" hint="Pontos de boas-vindas." error={fieldErrors.signupBonus}>
              <input
                type="text"
                inputMode="numeric"
                value={values.signupBonus}
                onChange={(event) => update("signupBonus", event.target.value.slice(0, 7))}
                className={inputClass}
              />
            </Field>
            <Field label="Bônus de aniversário" hint="1x por ano." error={fieldErrors.birthdayBonus}>
              <input
                type="text"
                inputMode="numeric"
                value={values.birthdayBonus}
                onChange={(event) => update("birthdayBonus", event.target.value.slice(0, 7))}
                className={inputClass}
              />
            </Field>
          </div>

          <Field
            label="Quanto vale 1 ponto no resgate (R$)"
            hint="0 = resgate desligado por enquanto."
            error={fieldErrors.redeemValue}
          >
            <input
              type="text"
              inputMode="decimal"
              value={values.redeemValue}
              onChange={(event) => update("redeemValue", event.target.value.slice(0, 8))}
              className={inputClass}
            />
          </Field>

          <p className="rounded-xl bg-ink-50 px-3 py-2 text-xs leading-snug text-ink-600">
            O resgate de pontos ainda é feito pelo atendente no balcão — o cardápio mostra o saldo,
            mas não oferece troca automática. Assim a casa controla o desconto antes de existir
            caixa integrado.
          </p>
        </Card>
      </div>

      {/* -------------------------------------------------------------- texto */}
      <div>
        <SectionTitle title="Mensagem para o cliente" />
        <Card className="space-y-2">
          <textarea
            value={values.programNote}
            onChange={(event) => update("programNote", event.target.value.slice(0, MAX_PROGRAM_NOTE))}
            rows={3}
            maxLength={MAX_PROGRAM_NOTE}
            placeholder={preview ?? "Ex.: A cada R$ 1 você ganha 1 ponto. Junte e troque na casa."}
            className="w-full resize-none rounded-xl border border-ink-200 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none"
          />
          <div className="flex items-center justify-between text-[11px] text-ink-500">
            <span>Opcional — vazio usa a descrição automática.</span>
            <span className="tabular-nums">
              {values.programNote.length}/{MAX_PROGRAM_NOTE}
            </span>
          </div>
          {fieldErrors.programNote && (
            <p className="text-xs text-red-600">{fieldErrors.programNote}</p>
          )}
        </Card>
      </div>

      {/* ------------------------------------------------------------- prévia */}
      {values.enabled && preview && (
        <Card className="space-y-1 border-brand-200 bg-brand-50">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">
            Como aparece no cardápio
          </p>
          <p className="text-sm font-medium leading-snug text-brand-900">{preview}</p>
        </Card>
      )}

      {feedback && (
        <p
          role="status"
          className={cn(
            "flex items-start gap-1.5 rounded-xl px-3 py-2 text-xs leading-snug",
            feedback.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700",
          )}
        >
          {feedback.ok && <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />}
          {feedback.text}
        </p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-bold text-white active:scale-[0.99] disabled:opacity-60"
      >
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {pending ? "Salvando…" : "Salvar programa"}
      </button>
    </div>
  );
}

const inputClass =
  "mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm tabular-nums text-ink-900 focus:border-brand-500 focus:outline-none";

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-ink-700">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11px] text-red-600">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-[11px] text-ink-500">{hint}</span>
      )}
    </label>
  );
}
