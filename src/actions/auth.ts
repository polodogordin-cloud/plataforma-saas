"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { RATE_LIMITS, checkRateLimit, clientKey } from "@/lib/rate-limit";
import { safeRedirectPath } from "@/lib/env";
import {
  signInSchema,
  signUpSchema,
  emailSchema,
  type ActionState,
} from "@/lib/validation";

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

/**
 * Origem para os links de e-mail (confirmação e recuperação).
 *
 * `headers()` é a fonte preferida em vez de `NEXT_PUBLIC_SITE_URL`: o link
 * precisa apontar para o host que o usuário está usando — inclusive num
 * preview de PR, onde o domínio é outro. A variável entra como fallback.
 */
async function siteOrigin() {
  const headerList = await headers();
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured && !configured.includes("localhost")) {
    return configured.replace(/\/$/, "");
  }
  const origin = headerList.get("origin");
  if (origin) return origin;
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/**
 * Consome uma tentativa do balde. Devolve a mensagem de erro quando estourou,
 * ou `null` quando pode seguir.
 *
 * Fica nas Server Actions, e não no middleware, porque é aqui que o custo
 * acontece: cada `signIn` errado é uma chamada ao Supabase Auth. O middleware
 * cobre as rotas de API equivalentes; as duas camadas usam o mesmo módulo.
 */
async function consumeAuthAttempt(rule: typeof RATE_LIMITS[keyof typeof RATE_LIMITS]) {
  const headerList = await headers();
  const result = checkRateLimit(rule, clientKey(headerList));

  if (result.allowed) return null;

  const minutes = Math.max(1, Math.ceil(result.retryAfter / 60));
  return `Muitas tentativas seguidas. Espere ${minutes} minuto${minutes > 1 ? "s" : ""} e tente de novo.`;
}

/** Login por e-mail e senha. */
export async function signIn(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  /*
   * O limite conta só tentativa com dados válidos: um erro de digitação no
   * e-mail não gasta a cota de quem está com pressa para entrar.
   */
  const blocked = await consumeAuthAttempt(RATE_LIMITS.signIn);
  if (blocked) return { ok: false, message: blocked };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return {
      ok: false,
      message:
        error.message.toLowerCase().includes("invalid login")
          ? "E-mail ou senha incorretos."
          : "Não foi possível entrar agora. Tente novamente.",
    };
  }

  // `safeRedirectPath` recusa `//evil.com` e afins: `?next=` é entrada de
  // usuário, e um redirect aberto num domínio de restaurante é phishing.
  const next = formData.get("next");
  redirect(safeRedirectPath(typeof next === "string" ? next : null));
}

/** Criação de conta. Envia e-mail de confirmação se o projeto exigir. */
export async function signUp(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  // Cadastro em massa polui o banco e consome cota de e-mail. 5/hora por IP.
  const blocked = await consumeAuthAttempt(RATE_LIMITS.signUp);
  if (blocked) return { ok: false, message: blocked };

  const supabase = await createClient();
  const origin = await siteOrigin();

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
    },
  });

  if (error) {
    return {
      ok: false,
      message:
        error.message.toLowerCase().includes("already registered")
          ? "Este e-mail já possui uma conta. Faça login."
          : "Não foi possível criar sua conta. Verifique os dados e tente novamente.",
    };
  }

  // Sem sessão = confirmação de e-mail habilitada no projeto.
  if (!data.session) {
    return {
      ok: true,
      message:
        "Conta criada! Enviamos um link de confirmação para o seu e-mail. Depois de confirmar, você será levado ao cadastro do restaurante.",
    };
  }

  redirect("/onboarding");
}

/** Envio de link de recuperação de senha. */
export async function requestPasswordReset(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: { email: [parsed.error.issues[0]?.message ?? "E-mail inválido."] },
    };
  }

  const blocked = await consumeAuthAttempt(RATE_LIMITS.recover);
  if (blocked) return { ok: false, message: blocked };

  const supabase = await createClient();
  const origin = await siteOrigin();

  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${origin}/auth/callback?next=/redefinir-senha`,
  });

  // Resposta neutra: não revela se o e-mail existe (boa prática de segurança).
  return {
    ok: true,
    message:
      "Se houver uma conta com este e-mail, enviamos um link para redefinir a senha. Verifique sua caixa de entrada e o spam.",
  };
}

/** Define a nova senha usando a sessão de recuperação. */
export async function updatePassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password.length < 8) {
    return { ok: false, fieldErrors: { password: ["Use pelo menos 8 caracteres."] } };
  }
  if (password !== confirmPassword) {
    return { ok: false, fieldErrors: { confirmPassword: ["As senhas não conferem."] } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return {
      ok: false,
      message: "Não foi possível alterar a senha. Solicite um novo link e tente de novo.",
    };
  }

  revalidatePath("/app");
  return { ok: true, message: "Senha alterada com sucesso." };
}

/** Encerra a sessão. */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/entrar");
}
