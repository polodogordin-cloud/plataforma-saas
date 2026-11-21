import { z } from "zod";

/** Validações compartilhadas entre formulários e Server Actions. */

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 48);

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Informe seu e-mail.")
  .email("Informe um e-mail válido.")
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(8, "A senha precisa ter pelo menos 8 caracteres.")
  .max(72, "A senha pode ter no máximo 72 caracteres.");

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Informe sua senha."),
});

export const signUpSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "Informe seu nome.")
      .max(80, "Nome muito longo."),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não conferem.",
  });

export const restaurantSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Informe o nome do restaurante.")
    .max(120, "Nome muito longo."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "O link precisa ter pelo menos 3 caracteres.")
    .max(48, "O link pode ter no máximo 48 caracteres.")
    .regex(slugPattern, "Use apenas letras minúsculas, números e hífens."),
  description: z.string().trim().max(500, "Máximo de 500 caracteres.").optional(),
  phone: z.string().trim().max(32, "Telefone inválido.").optional(),
  addressLine: z.string().trim().max(160).optional(),
  addressNumber: z.string().trim().max(20).optional(),
  district: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .max(2, "Use a sigla do estado (ex.: SP).")
    .optional(),
  postalCode: z.string().trim().max(9).optional(),
});

export const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Informe seu nome.").max(80, "Nome muito longo."),
  phone: z.string().trim().max(32, "Telefone inválido.").optional(),
});

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type RestaurantInput = z.infer<typeof restaurantSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;

/** Resultado padrão de Server Actions com validação. */
export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
};
