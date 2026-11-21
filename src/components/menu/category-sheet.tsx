"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createCategory, updateCategory } from "@/actions/menu";
import { Sheet } from "@/components/ui/sheet";
import { Field, Textarea } from "@/components/ui/field";
import { FormAlert, SubmitButton } from "@/components/ui/form";
import { SwitchField } from "@/components/ui/switch";
import type { Category } from "@/lib/types";
import type { ActionState } from "@/lib/validation";

const initialState: ActionState = { ok: false };

type Props = {
  open: boolean;
  onClose: () => void;
  category?: Category | null;
};

/**
 * Bottom sheet de criação/edição de categoria.
 * O corpo remonta a cada abertura, evitando erros e campos antigos na tela.
 */
export function CategorySheet({ open, onClose, category }: Props) {
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (open) setGeneration((value) => value + 1);
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={category ? "Editar categoria" : "Nova categoria"}
      description={
        category
          ? "Altere o nome, a descrição ou a visibilidade."
          : "Ex.: Hambúrgueres, Pizzas, Porções, Bebidas, Combos."
      }
      footer={
        <SubmitButton form="category-form" pendingLabel="Salvando…">
          {category ? "Salvar alterações" : "Criar categoria"}
        </SubmitButton>
      }
    >
      <CategoryFormBody
        key={`${category?.id ?? "new"}-${generation}`}
        category={category}
        onClose={onClose}
      />
    </Sheet>
  );
}

type BodyProps = Omit<Props, "open">;

function CategoryFormBody({ category, onClose }: BodyProps) {
  const router = useRouter();
  const isEdit = Boolean(category);

  const [state, formAction] = useActionState(
    isEdit ? updateCategory : createCategory,
    initialState,
  );

  useEffect(() => {
    if (!state.ok) return;
    onClose();
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  return (
    <form id="category-form" action={formAction} className="space-y-4" noValidate>
      {isEdit && <input type="hidden" name="categoryId" value={category!.id} />}

      {state.message && !state.ok && <FormAlert tone="error">{state.message}</FormAlert>}

      <Field
        label="Nome da categoria"
        name="name"
        defaultValue={category?.name ?? ""}
        placeholder="Hambúrgueres"
        autoComplete="off"
        required
        autoFocus={!isEdit}
        error={state.fieldErrors?.name?.[0]}
      />

      <Textarea
        label="Descrição (opcional)"
        name="description"
        rows={2}
        maxLength={300}
        defaultValue={category?.description ?? ""}
        placeholder="Uma frase que aparece abaixo do título."
        error={state.fieldErrors?.description?.[0]}
      />

      <div className="rounded-xl border border-ink-200 px-3.5 py-3">
        <SwitchField
          name="isActive"
          label="Categoria ativa"
          description="Desativada, ela não aparece no cardápio do cliente — os produtos continuam salvos."
          defaultChecked={category?.is_active ?? true}
        />
      </div>

      <p className="text-xs leading-relaxed text-ink-400">
        Imagem da categoria chega junto com o editor de identidade visual (Etapa 8). O espaço
        já está reservado no banco.
      </p>
    </form>
  );
}
