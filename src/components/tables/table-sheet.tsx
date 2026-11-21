"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createTable, updateTable } from "@/actions/tables";
import { Sheet } from "@/components/ui/sheet";
import { Field, Textarea } from "@/components/ui/field";
import { FormAlert, SubmitButton } from "@/components/ui/form";
import { SwitchField } from "@/components/ui/switch";
import { TABLE_STATUS_LABEL, type RestaurantTable, type TableStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/validation";

const initialState: ActionState = { ok: false };

/** Ocupação editável ("inactive" é derivado de `is_active`, não se escolhe aqui). */
const OCCUPANCY = [
  { value: "free", label: TABLE_STATUS_LABEL.free },
  { value: "occupied", label: TABLE_STATUS_LABEL.occupied },
  { value: "reserved", label: TABLE_STATUS_LABEL.reserved },
] as const satisfies readonly { value: TableStatus; label: string }[];

type Props = {
  open: boolean;
  onClose: () => void;
  table?: RestaurantTable | null;
  /** Sugestão de nome para a próxima mesa ("Mesa 04"). */
  suggestedName?: string;
  onDelete?: (table: RestaurantTable) => void;
};

/**
 * Bottom sheet de criação/edição de mesa.
 * O corpo remonta a cada abertura: nada de erro ou valor da mesa anterior.
 */
export function TableSheet({ open, ...rest }: Props) {
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (open) setGeneration((value) => value + 1);
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={rest.onClose}
      title={rest.table ? "Editar mesa" : "Nova mesa"}
      description={
        rest.table
          ? rest.table.name
          : "O QR Code é gerado automaticamente ao criar a mesa."
      }
      footer={<TableSheetFooter {...rest} />}
    >
      <TableFormBody key={`${rest.table?.id ?? "new"}-${generation}`} {...rest} />
    </Sheet>
  );
}

type BodyProps = Omit<Props, "open">;

function TableSheetFooter({ table, onDelete }: BodyProps) {
  return (
    <div className="space-y-2">
      <SubmitButton form="table-form" pendingLabel="Salvando…">
        {table ? "Salvar alterações" : "Criar mesa"}
      </SubmitButton>
      {table && onDelete && (
        <button
          type="button"
          onClick={() => onDelete(table)}
          className="tap-target inline-flex w-full items-center justify-center rounded-xl px-4 text-sm font-semibold text-red-600 hover:bg-red-50"
        >
          Excluir mesa
        </button>
      )}
    </div>
  );
}

function TableFormBody({ table, onClose, suggestedName }: BodyProps) {
  const router = useRouter();
  const isEdit = Boolean(table);
  const [occupancy, setOccupancy] = useState<TableStatus>(
    table && table.status !== "inactive" ? table.status : "free",
  );

  const [state, formAction] = useActionState(
    isEdit ? updateTable : createTable,
    initialState,
  );

  useEffect(() => {
    if (!state.ok) return;
    onClose();
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  return (
    <form id="table-form" action={formAction} className="space-y-4" noValidate>
      {isEdit && <input type="hidden" name="tableId" value={table!.id} />}

      {/*
        Erro do formulário (Etapa 11: inclui limite de plano). Quando a causa é
        limite, a mensagem vem acompanhada do caminho para ver os planos — um
        "não foi possível criar" repetido sem saída parece bug.
      */}
      {state.message && !state.ok && (
        <FormAlert tone="error">
          <span className="block">{state.message}</span>
          {state.fieldErrors?.plan ? (
            <Link
              href="/planos"
              className="tap-target -my-1 inline-flex min-h-11 items-center font-semibold underline"
            >
              Ver planos
            </Link>
          ) : null}
        </FormAlert>
      )}

      <Field
        label="Nome da mesa"
        name="name"
        defaultValue={table?.name ?? suggestedName ?? ""}
        placeholder="Mesa 01"
        autoComplete="off"
        required
        autoFocus={!isEdit}
        hint="Ex.: Mesa 01, Varanda 02, Balcão 01"
        error={state.fieldErrors?.name?.[0]}
      />

      <Field
        label="Identificação (opcional)"
        name="code"
        defaultValue={table?.code ?? ""}
        placeholder="Perto da janela"
        autoComplete="off"
        maxLength={40}
        hint="Um detalhe que ajude a equipe a localizar a mesa."
        error={state.fieldErrors?.code?.[0]}
      />

      <Textarea
        label="Observação (opcional)"
        name="notes"
        rows={2}
        maxLength={300}
        defaultValue={table?.notes ?? ""}
        placeholder="6 lugares, banco corrido"
        error={state.fieldErrors?.notes?.[0]}
      />

      {/* Ocupação é rótulo operacional; não muda a visibilidade pública. */}
      {isEdit && (
        <div>
          <p className="text-sm font-medium text-ink-800">Ocupação</p>
          <div className="mt-1.5 flex gap-2" role="radiogroup" aria-label="Ocupação da mesa">
            {OCCUPANCY.map(({ value, label }) => (
              <label
                key={value}
                className={cn(
                  "relative inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-xl border px-2 text-center text-[0.8rem] font-semibold transition-colors",
                  "has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand-100",
                  occupancy === value
                    ? "border-brand-600 bg-brand-50 text-brand-800"
                    : "border-ink-200 bg-white text-ink-600",
                )}
              >
                <input
                  type="radio"
                  name="status"
                  value={value}
                  checked={occupancy === value}
                  onChange={() => setOccupancy(value)}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-400">
            Ajuda a equipe a ver o salão. Não altera o acesso pelo QR Code.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-ink-200 px-3.5 py-3">
        <SwitchField
          name="isActive"
          label="Mesa ativa"
          description="Desativada, o QR Code deixa de abrir o cardápio — útil para mesas em reforma ou fora do salão."
          defaultChecked={table?.is_active ?? true}
        />
      </div>

      <p className="text-xs leading-relaxed text-ink-400">
        O número da mesa é só um rótulo. O acesso público usa um código único e
        aleatório, então renomear a mesa não invalida o QR Code já impresso.
      </p>
    </form>
  );
}
