"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createProduct, updateProduct } from "@/actions/menu";
import { Sheet } from "@/components/ui/sheet";
import { Field, Textarea } from "@/components/ui/field";
import { FormAlert, SubmitButton } from "@/components/ui/form";
import { SwitchField } from "@/components/ui/switch";
import { formatPrice } from "@/lib/validation";
import type { Category, Product } from "@/lib/types";
import type { ActionState } from "@/lib/validation";
import { cn } from "@/lib/utils";

const initialState: ActionState = { ok: false };

type Props = {
  open: boolean;
  onClose: () => void;
  product?: Product | null;
  categories: Category[];
  defaultCategoryId?: string | null;
  onDelete?: (product: Product) => void;
};

/**
 * Formulário de produto em bottom sheet, otimizado para o polegar.
 *
 * O corpo é remontado a cada abertura (`key` por produto + contador), então
 * erros de uma tentativa anterior não reaparecem e o preço sempre começa com
 * o valor do produto selecionado — nunca com o do último item editado.
 */
export function ProductSheet({ open, ...rest }: Props) {
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (open) setGeneration((value) => value + 1);
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={rest.onClose}
      size="tall"
      title={rest.product ? "Editar produto" : "Novo produto"}
      description={
        rest.product ? rest.product.name : "Preencha o essencial — foto e adicionais vêm depois."
      }
      footer={<ProductSheetFooter {...rest} />}
    >
      <ProductFormBody key={`${rest.product?.id ?? "new"}-${generation}`} {...rest} />
    </Sheet>
  );
}

/** Rodapé com o submit: usa `form="product-form"` para ficar fora do <form>. */
type BodyProps = Omit<Props, "open">;

function ProductSheetFooter({ product, onDelete }: BodyProps) {
  return (
    <div className="space-y-2">
      <SubmitButton form="product-form" pendingLabel="Salvando…">
        {product ? "Salvar alterações" : "Adicionar produto"}
      </SubmitButton>
      {product && onDelete && (
        <button
          type="button"
          onClick={() => onDelete(product)}
          className="tap-target inline-flex w-full items-center justify-center rounded-xl px-4 text-sm font-semibold text-red-600 hover:bg-red-50"
        >
          Excluir produto
        </button>
      )}
    </div>
  );
}

function ProductFormBody({ product, categories, defaultCategoryId, onClose }: BodyProps) {
  const router = useRouter();
  const isEdit = Boolean(product);

  const [state, formAction] = useActionState(
    isEdit ? updateProduct : createProduct,
    initialState,
  );

  const [price, setPrice] = useState(
    product ? String(product.price).replace(".", ",") : "",
  );

  useEffect(() => {
    if (!state.ok) return;
    onClose();
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  // Prévia do preço interpretado enquanto digita.
  const numeric = Number(price.replace(/[^\d,.-]/g, "").replace(",", "."));
  const preview = Number.isFinite(numeric) && numeric > 0 ? formatPrice(numeric) : null;

  return (
    <form id="product-form" action={formAction} className="space-y-4" noValidate>
      {isEdit && <input type="hidden" name="productId" value={product!.id} />}

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
        label="Nome do produto"
        name="name"
        defaultValue={product?.name ?? ""}
        placeholder="X-Burger Especial"
        autoComplete="off"
        required
        autoFocus={!isEdit}
        error={state.fieldErrors?.name?.[0]}
      />

      <Textarea
        label="Descrição (opcional)"
        name="description"
        rows={2}
        maxLength={400}
        defaultValue={product?.description ?? ""}
        placeholder="Ingredientes, porção, detalhes…"
        error={state.fieldErrors?.description?.[0]}
      />

      <Field
        label="Preço"
        name="price"
        value={price}
        onChange={(event) => setPrice(event.target.value)}
        inputMode="decimal"
        placeholder="0,00"
        prefix="R$"
        required
        error={state.fieldErrors?.price?.[0]}
        hint={preview ? `Será salvo como ${preview}` : "Use vírgula para centavos: 32,90"}
      />

      {/* Categoria em chips: mais rápido que um select no celular */}
      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-ink-700">Categoria</legend>
        <div className="flex flex-wrap gap-2">
          <CategoryChip
            name="categoryId"
            value=""
            label="Sem categoria"
            defaultChecked={!product?.category_id && !defaultCategoryId}
          />
          {categories.map((category) => (
            <CategoryChip
              key={category.id}
              name="categoryId"
              value={category.id}
              label={category.name}
              defaultChecked={
                product ? product.category_id === category.id : defaultCategoryId === category.id
              }
            />
          ))}
        </div>
        {categories.length === 0 && (
          <p className="mt-2 text-xs text-ink-500">
            Crie uma categoria primeiro para organizar o cardápio.
          </p>
        )}
      </fieldset>

      <div className="space-y-2 rounded-xl border border-ink-200 px-3.5 py-3">
        <SwitchField
          name="isAvailable"
          label="Disponível para venda"
          description="Indisponível aparece no painel, mas não no cardápio do cliente."
          defaultChecked={product?.is_available ?? true}
        />
        <div className="h-px bg-ink-100" />
        <SwitchField
          name="isFeatured"
          label="Destacar no cardápio"
          description="Aparece primeiro, com selo de destaque."
          defaultChecked={product?.is_featured ?? false}
        />
      </div>

      <Field
        label="Código interno (opcional)"
        name="internalCode"
        defaultValue={product?.internal_code ?? ""}
        placeholder="XB-01"
        autoCapitalize="characters"
        hint="Ajuda a identificar o item na cozinha ou no PDV."
        error={state.fieldErrors?.internalCode?.[0]}
      />

      <p className="text-xs leading-relaxed text-ink-400">
        Foto do produto chega junto com o upload de imagens (Etapa 8). O campo já existe no
        banco e será exibido no card automaticamente.
      </p>
    </form>
  );
}

function CategoryChip({
  name,
  value,
  label,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label
      className={cn(
        "tap-target inline-flex cursor-pointer select-none items-center rounded-full border px-3.5 text-sm font-medium transition-colors",
        "border-ink-200 bg-white text-ink-600",
        "has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-800",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="sr-only"
      />
      {label}
    </label>
  );
}
