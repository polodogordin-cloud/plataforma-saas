"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createNfcTag, updateNfcTag } from "@/actions/nfc";
import { Sheet } from "@/components/ui/sheet";
import { Field } from "@/components/ui/field";
import { FormAlert, SubmitButton } from "@/components/ui/form";
import { SwitchField } from "@/components/ui/switch";
import { NFC_STATUS_LABEL, type NfcStatus, type TableNfcTag } from "@/lib/types";
import type { ActionState } from "@/lib/validation";
import { cn } from "@/lib/utils";

const initialState: ActionState = { ok: false };

const STATUS_OPTIONS: { value: NfcStatus; label: string; hint: string }[] = [
  { value: "not_configured", label: NFC_STATUS_LABEL.not_configured, hint: "Ainda não gravei" },
  { value: "configured", label: NFC_STATUS_LABEL.configured, hint: "Já gravei a URL" },
  { value: "tested", label: NFC_STATUS_LABEL.tested, hint: "Gravei e testei" },
  { value: "disabled", label: NFC_STATUS_LABEL.disabled, hint: "TAG fora de uso" },
];

/**
 * Cadastro/edição de TAG.
 *
 * O identificador da TAG é opcional e o texto diz isso com todas as letras:
 * obrigar o número físico travaria quem usa um app que não mostra o UID.
 */
export function NfcTagSheet({ open, ...rest }: { open: boolean } & BodyProps) {
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (open) setGeneration((value) => value + 1);
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={rest.onClose}
      title={rest.tag ? "Editar TAG" : "Nova TAG NFC"}
      description={rest.tag ? rest.tableName : "A URL é gerada sozinha — só cadastre a TAG."}
      footer={
        <SubmitButton form="nfc-form" pendingLabel="Salvando…">
          {rest.tag ? "Salvar TAG" : "Cadastrar TAG"}
        </SubmitButton>
      }
    >
      <Body key={`${rest.tag?.tag_id ?? "new"}-${generation}`} {...rest} />
    </Sheet>
  );
}

type BodyProps = {
  tag: TableNfcTag | null;
  tableId: string;
  tableName: string;
  onClose: () => void;
};

function Body({ tag, tableId, onClose }: BodyProps) {
  const router = useRouter();
  const isEdit = Boolean(tag);

  const [status, setStatus] = useState<NfcStatus>(tag?.status ?? "not_configured");
  const [state, formAction] = useActionState(isEdit ? updateNfcTag : createNfcTag, initialState);

  useEffect(() => {
    if (!state.ok) return;
    onClose();
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  return (
    <form id="nfc-form" action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="tableId" value={tableId} />
      {isEdit && <input type="hidden" name="tagId" value={tag!.tag_id} />}

      {state.message && !state.ok && <FormAlert tone="error">{state.message}</FormAlert>}

      <Field
        label="Rótulo (opcional)"
        name="label"
        defaultValue={tag?.label ?? ""}
        placeholder="TAG da placa"
        autoComplete="off"
        maxLength={60}
        hint="Ajuda quando a mesa tem mais de uma TAG."
        error={state.fieldErrors?.label?.[0]}
      />

      <Field
        label="Identificador da TAG (opcional)"
        name="tagIdentifier"
        defaultValue={tag?.tag_identifier ?? ""}
        placeholder="04:A2:33:1B:7C:80"
        autoComplete="off"
        maxLength={64}
        hint="O UID que o aplicativo de gravação mostra. Não precisa preencher."
        error={state.fieldErrors?.tagIdentifier?.[0]}
      />

      <fieldset>
        <legend className="text-sm font-medium text-ink-800">Status</legend>
        <input type="hidden" name="status" value={status} />
        <div className="mt-1.5 space-y-1.5">
          {STATUS_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 transition-colors",
                "has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand-100",
                status === option.value
                  ? "border-brand-600 bg-brand-50"
                  : "border-ink-200 bg-white",
              )}
            >
              <input
                type="radio"
                name="status-radio"
                value={option.value}
                checked={status === option.value}
                onChange={() => setStatus(option.value)}
                className="size-4 accent-brand-600"
              />
              <span className="flex-1 text-[0.85rem] font-semibold text-ink-800">
                {option.label}
              </span>
              <span className="text-[0.7rem] text-ink-400">{option.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="rounded-xl border border-ink-200 px-3.5 py-3">
        <SwitchField
          name="isActive"
          label="TAG ativa"
          description="Desativada, a TAG sai do resumo sem perder o histórico."
          defaultChecked={tag?.is_active ?? true}
        />
      </div>
    </form>
  );
}
