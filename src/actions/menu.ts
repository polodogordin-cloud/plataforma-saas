"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import {
  categorySchema,
  productSchema,
  parsePrice,
  toUuidOrNull,
  type ActionState,
} from "@/lib/validation";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function fieldErrorsFrom(error: unknown): ActionState["fieldErrors"] | undefined {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: Array<{ path: PropertyKey[]; message: string }> }).issues;
    const result: Record<string, string[]> = {};
    for (const issue of issues) {
      const key = String(issue.path[0] ?? "form");
      result[key] = [...(result[key] ?? []), issue.message];
    }
    return result;
  }
  return undefined;
}

const str = (value: FormDataEntryValue | null) => String(value ?? "").trim();
const bool = (value: FormDataEntryValue | null) => value === "on" || value === "true";

/**
 * Garante que só owner/admin mexam no cardápio, mesmo antes da RLS.
 * Retorna o restaurante ou uma mensagem de erro pronta.
 */
async function requireMenuEditor() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { error: "Restaurante não encontrado." as const };

  if (restaurant.role !== "owner" && restaurant.role !== "admin") {
    return { error: "Seu perfil não tem permissão para editar o cardápio." as const };
  }
  return { restaurant };
}

/** Traduz o erro do PostgREST em mensagem de campo amigável. */
function duplicateNameError(error: { code?: string; message?: string } | null) {
  if (!error) return null;
  if (error.code === "23505" && error.message?.includes("categories_restaurant_name_key")) {
    return "Já existe uma categoria com esse nome.";
  }
  if (error.code === "23505" && error.message?.includes("internal_code")) {
    return "Este código interno já está em uso.";
  }
  if (error.code === "23505") return "Este valor já está em uso.";
  if (error.code === "23503") return "Categoria inválida.";
  return null;
}

function revalidateMenu() {
  revalidatePath("/app", "layout");
  revalidatePath("/app/cardapio");
  revalidatePath("/app/cardapio/produtos");
}

/* -------------------------------------------------------------------------- */
/* Categorias                                                                  */
/* -------------------------------------------------------------------------- */

export async function createCategory(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = categorySchema.safeParse({
    name: str(formData.get("name")),
    description: str(formData.get("description")),
    isActive: !formData.has("isActive") ? true : bool(formData.get("isActive")),
  });

  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };

  const guard = await requireMenuEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const supabase = await createClient();
  const { error } = await supabase.from("categories").insert({
    restaurant_id: guard.restaurant.id,
    name: parsed.data.name,
    description: parsed.data.description || null,
    is_active: parsed.data.isActive,
  });

  if (error) {
    const friendly = duplicateNameError(error);
    if (friendly) return { ok: false, fieldErrors: { name: [friendly] } };
    return { ok: false, message: "Não foi possível criar a categoria." };
  }

  revalidateMenu();
  return { ok: true, message: "Categoria criada." };
}

export async function updateCategory(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const categoryId = toUuidOrNull(formData.get("categoryId"));
  if (!categoryId) return { ok: false, message: "Categoria não identificada." };

  const parsed = categorySchema.safeParse({
    name: str(formData.get("name")),
    description: str(formData.get("description")),
    isActive: !formData.has("isActive") ? true : bool(formData.get("isActive")),
  });

  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };

  const guard = await requireMenuEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const supabase = await createClient();
  const { error, data: updated } = await supabase
    .from("categories")
    .update({
      name: parsed.data.name,
      description: parsed.data.description || null,
      is_active: parsed.data.isActive,
    })
    .eq("id", categoryId)
    .eq("restaurant_id", guard.restaurant.id)
    .select("id");

  if (error) {
    const friendly = duplicateNameError(error);
    if (friendly) return { ok: false, fieldErrors: { name: [friendly] } };
    return { ok: false, message: "Não foi possível salvar a categoria." };
  }
  if (!updated?.length) return { ok: false, message: "Categoria não encontrada." };

  revalidateMenu();
  return { ok: true, message: "Categoria atualizada." };
}

/**
 * Exclui a categoria. Os produtos dela são preservados e passam para
 * "Sem categoria" (on delete set null). Retorna quantos foram movidos para
 * que a interface possa avisar antes.
 */
export async function deleteCategory(categoryId: string): Promise<ActionState> {
  const id = toUuidOrNull(categoryId);
  if (!id) return { ok: false, message: "Categoria não identificada." };

  const guard = await requireMenuEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const supabase = await createClient();
  const { error, data: deleted } = await supabase
    .from("categories")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", guard.restaurant.id)
    .select("id");

  if (error) return { ok: false, message: "Não foi possível excluir a categoria." };
  if (!deleted?.length) return { ok: false, message: "Categoria não encontrada." };

  revalidateMenu();
  return { ok: true, message: "Categoria excluída." };
}

/** Ativa/desativa a categoria (ação rápida do card). */
export async function toggleCategoryActive(categoryId: string, isActive: boolean) {
  const id = toUuidOrNull(categoryId);
  if (!id) return { ok: false, message: "Categoria não identificada." };

  const guard = await requireMenuEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const supabase = await createClient();
  const { error, data } = await supabase
    .from("categories")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("restaurant_id", guard.restaurant.id)
    .select("id");

  if (error || !data?.length) {
    return { ok: false, message: "Não foi possível atualizar a categoria." };
  }

  revalidateMenu();
  return { ok: true };
}

/** Reordena categorias (drag and drop). Recebe os ids na nova ordem. */
export async function reorderCategories(ids: string[]): Promise<ActionState> {
  const guard = await requireMenuEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const valid = ids.map((id) => toUuidOrNull(id)).filter((id): id is string => Boolean(id));
  if (!valid.length) return { ok: false, message: "Nada para reordenar." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_categories", {
    p_restaurant_id: guard.restaurant.id,
    p_ids: valid,
  });

  if (error) return { ok: false, message: "Não foi possível salvar a ordem." };

  revalidateMenu();
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Produtos                                                                    */
/* -------------------------------------------------------------------------- */

export async function createProduct(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = productSchema.safeParse({
    name: str(formData.get("name")),
    description: str(formData.get("description")),
    price: str(formData.get("price")),
    categoryId: str(formData.get("categoryId")),
    isAvailable: !formData.has("isAvailable") ? true : bool(formData.get("isAvailable")),
    isFeatured: bool(formData.get("isFeatured")),
    internalCode: str(formData.get("internalCode")),
  });

  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };

  const guard = await requireMenuEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const price = parsePrice(parsed.data.price);
  if (price === null) {
    return { ok: false, fieldErrors: { price: ["Preço inválido. Use 0,00."] } };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("products").insert({
    restaurant_id: guard.restaurant.id,
    category_id: toUuidOrNull(parsed.data.categoryId),
    name: parsed.data.name,
    description: parsed.data.description || null,
    price,
    is_available: parsed.data.isAvailable,
    is_featured: parsed.data.isFeatured,
    internal_code: parsed.data.internalCode || null,
  });

  if (error) {
    const friendly = duplicateNameError(error);
    if (friendly) return { ok: false, fieldErrors: { internalCode: [friendly] } };
    return { ok: false, message: "Não foi possível criar o produto." };
  }

  revalidateMenu();
  return { ok: true, message: "Produto criado." };
}

export async function updateProduct(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = toUuidOrNull(formData.get("productId"));
  if (!productId) return { ok: false, message: "Produto não identificado." };

  const parsed = productSchema.safeParse({
    name: str(formData.get("name")),
    description: str(formData.get("description")),
    price: str(formData.get("price")),
    categoryId: str(formData.get("categoryId")),
    isAvailable: !formData.has("isAvailable") ? true : bool(formData.get("isAvailable")),
    isFeatured: bool(formData.get("isFeatured")),
    internalCode: str(formData.get("internalCode")),
  });

  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };

  const guard = await requireMenuEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const price = parsePrice(parsed.data.price);
  if (price === null) {
    return { ok: false, fieldErrors: { price: ["Preço inválido. Use 0,00."] } };
  }

  const supabase = await createClient();
  const { error, data: updated } = await supabase
    .from("products")
    .update({
      category_id: toUuidOrNull(parsed.data.categoryId),
      name: parsed.data.name,
      description: parsed.data.description || null,
      price,
      is_available: parsed.data.isAvailable,
      is_featured: parsed.data.isFeatured,
      internal_code: parsed.data.internalCode || null,
    })
    .eq("id", productId)
    .eq("restaurant_id", guard.restaurant.id)
    .select("id");

  if (error) {
    const friendly = duplicateNameError(error);
    if (friendly) return { ok: false, fieldErrors: { internalCode: [friendly] } };
    return { ok: false, message: "Não foi possível salvar o produto." };
  }
  if (!updated?.length) return { ok: false, message: "Produto não encontrado." };

  revalidateMenu();
  return { ok: true, message: "Produto atualizado." };
}

export async function deleteProduct(productId: string): Promise<ActionState> {
  const id = toUuidOrNull(productId);
  if (!id) return { ok: false, message: "Produto não identificado." };

  const guard = await requireMenuEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const supabase = await createClient();
  const { error, data: deleted } = await supabase
    .from("products")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", guard.restaurant.id)
    .select("id");

  if (error) return { ok: false, message: "Não foi possível excluir o produto." };
  if (!deleted?.length) return { ok: false, message: "Produto não encontrado." };

  revalidateMenu();
  return { ok: true, message: "Produto excluído." };
}

/** Ação rápida: disponível/indisponível. */
export async function toggleProductAvailable(productId: string, isAvailable: boolean) {
  const id = toUuidOrNull(productId);
  if (!id) return { ok: false, message: "Produto não identificado." };

  const guard = await requireMenuEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const supabase = await createClient();
  const { error, data } = await supabase
    .from("products")
    .update({ is_available: isAvailable })
    .eq("id", id)
    .eq("restaurant_id", guard.restaurant.id)
    .select("id");

  if (error || !data?.length) {
    return { ok: false, message: "Não foi possível atualizar o produto." };
  }

  revalidateMenu();
  return { ok: true };
}

/** Reordena produtos dentro de uma categoria. */
export async function reorderProducts(ids: string[]): Promise<ActionState> {
  const guard = await requireMenuEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const valid = ids.map((id) => toUuidOrNull(id)).filter((id): id is string => Boolean(id));
  if (!valid.length) return { ok: false, message: "Nada para reordenar." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_products", {
    p_restaurant_id: guard.restaurant.id,
    p_ids: valid,
  });

  if (error) return { ok: false, message: "Não foi possível salvar a ordem." };

  revalidateMenu();
  return { ok: true };
}

/** Move um produto para outra categoria (usado no arrastar entre grupos). */
export async function moveProductToCategory(productId: string, categoryId: string | null) {
  const id = toUuidOrNull(productId);
  if (!id) return { ok: false, message: "Produto não identificado." };

  const guard = await requireMenuEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const supabase = await createClient();
  const { error, data } = await supabase
    .from("products")
    .update({ category_id: toUuidOrNull(categoryId), position: 0 })
    .eq("id", id)
    .eq("restaurant_id", guard.restaurant.id)
    .select("id");

  if (error || !data?.length) {
    return { ok: false, message: "Não foi possível mover o produto." };
  }

  revalidateMenu();
  return { ok: true };
}

/** Redireciona para a tela de edição (usado por formulários de criação). */
export async function redirectToMenu() {
  redirect("/app/cardapio");
}
