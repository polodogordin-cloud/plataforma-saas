"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { restaurantSchema, profileSchema, type ActionState } from "@/lib/validation";

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

/**
 * Cria o restaurante do usuário via RPC atômica (restaurante + vínculo owner).
 * O user_id é resolvido no banco por auth.uid() — não vem do cliente.
 */
export async function createRestaurant(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = restaurantSchema.safeParse({
    name: str(formData.get("name")),
    slug: str(formData.get("slug")),
    description: str(formData.get("description")),
    phone: str(formData.get("phone")),
    addressLine: str(formData.get("addressLine")),
    addressNumber: str(formData.get("addressNumber")),
    district: str(formData.get("district")),
    city: str(formData.get("city")),
    state: str(formData.get("state")),
    postalCode: str(formData.get("postalCode")),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/entrar?next=/onboarding");

  const { error } = await supabase.rpc("create_restaurant", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_description: parsed.data.description || null,
    p_phone: parsed.data.phone || null,
    p_address_line: parsed.data.addressLine || null,
    p_address_number: parsed.data.addressNumber || null,
    p_district: parsed.data.district || null,
    p_city: parsed.data.city || null,
    p_state: parsed.data.state || null,
    p_postal_code: parsed.data.postalCode || null,
  });

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        fieldErrors: { slug: ["Este link já está em uso. Escolha outro."] },
      };
    }
    if (error.code === "22023") {
      return { ok: false, fieldErrors: { name: ["Informe um nome válido."] } };
    }
    return { ok: false, message: "Não foi possível criar o restaurante. Tente novamente." };
  }

  revalidatePath("/app");
  revalidatePath("/onboarding");

  // Etapa 21: quem acabou de criar a casa cai direto no passo a passo — sem
  // isso, o painel novo aparecia vazio e o dono não sabia o que fazer primeiro.
  redirect("/app/onboarding");
}

/** Atualiza dados do restaurante (owner/admin — validado pela RLS). */
export async function updateRestaurant(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const restaurantId = str(formData.get("restaurantId"));
  if (!restaurantId) return { ok: false, message: "Restaurante não identificado." };

  const parsed = restaurantSchema.safeParse({
    name: str(formData.get("name")),
    slug: str(formData.get("slug")),
    description: str(formData.get("description")),
    phone: str(formData.get("phone")),
    addressLine: str(formData.get("addressLine")),
    addressNumber: str(formData.get("addressNumber")),
    district: str(formData.get("district")),
    city: str(formData.get("city")),
    state: str(formData.get("state")),
    postalCode: str(formData.get("postalCode")),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  // `.select("id")` é essencial: sem ele a RLS filtraria as linhas em silêncio
  // e o usuário veria "salvo" mesmo sem nada ter sido alterado.
  const { error, data: updated } = await supabase
    .from("restaurants")
    .update({
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description || null,
      phone: parsed.data.phone || null,
      address_line: parsed.data.addressLine || null,
      address_number: parsed.data.addressNumber || null,
      district: parsed.data.district || null,
      city: parsed.data.city || null,
      state: parsed.data.state || null,
      postal_code: parsed.data.postalCode || null,
    })
    .eq("id", restaurantId)
    .select("id");

  if (error) {
    if (error.code === "23505") {
      return { ok: false, fieldErrors: { slug: ["Este link já está em uso."] } };
    }
    if (error.code === "42501") {
      return { ok: false, message: "Você não tem permissão para editar este restaurante." };
    }
    return { ok: false, message: "Não foi possível salvar. Tente novamente." };
  }

  if (!updated?.length) {
    return { ok: false, message: "Você não tem permissão para editar este restaurante." };
  }

  revalidatePath("/app", "layout");
  revalidatePath("/app/configuracoes/restaurante");
  return { ok: true, message: "Dados do restaurante atualizados." };
}

/** Alterna o status de publicação do cardápio (etapa 3 fará a publicação real). */
export async function setRestaurantStatus(status: "draft" | "published" | "paused") {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar");

  const { data: membership } = await supabase
    .from("restaurant_users")
    .select("restaurant_id, role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .in("role", ["owner", "admin"])
    .limit(1)
    .maybeSingle();

  if (!membership) return { ok: false, message: "Sem permissão." };

  const { error, data: updated } = await supabase
    .from("restaurants")
    .update({ status })
    .eq("id", membership.restaurant_id)
    .select("id");

  if (error || !updated?.length) {
    return { ok: false, message: "Não foi possível atualizar o status." };
  }

  revalidatePath("/app", "layout");
  return { ok: true };
}

/** Atualiza o perfil do usuário logado. */
export async function updateProfile(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = profileSchema.safeParse({
    fullName: str(formData.get("fullName")),
    phone: str(formData.get("phone")),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/entrar");

  const { error, data: updated } = await supabase
    .from("users")
    .update({ full_name: parsed.data.fullName, phone: parsed.data.phone || null })
    .eq("id", user.id)
    .select("id");

  if (error) return { ok: false, message: "Não foi possível salvar seu perfil." };
  if (!updated?.length) return { ok: false, message: "Não foi possível salvar seu perfil." };

  await supabase.auth.updateUser({ data: { full_name: parsed.data.fullName } });

  revalidatePath("/app", "layout");
  revalidatePath("/app/configuracoes");
  return { ok: true, message: "Perfil atualizado." };
}
