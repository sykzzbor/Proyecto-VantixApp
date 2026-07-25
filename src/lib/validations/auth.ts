import { z } from "zod";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_ISSUE_MESSAGES,
  findPasswordIssue,
} from "@/server/auth/password-policy";

/**
 * Misma política que aplica el servidor, para que el formulario avise antes de
 * enviar. El chequeo del navegador es comodidad: el que decide es el hook de
 * Better Auth, que corre igual aunque alguien llame a la API directamente.
 */
const strongPassword = z
  .string()
  .min(MIN_PASSWORD_LENGTH, PASSWORD_ISSUE_MESSAGES.too_short)
  .max(MAX_PASSWORD_LENGTH, PASSWORD_ISSUE_MESSAGES.too_long)
  .superRefine((value, ctx) => {
    const issue = findPasswordIssue(value);
    if (issue) {
      ctx.addIssue({ code: "custom", message: PASSWORD_ISSUE_MESSAGES[issue] });
    }
  });

export const loginSchema = z.object({
  email: z.email("Ingresá un email válido."),
  password: z.string().min(1, "Ingresá tu contraseña."),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  name: z
    .string()
    .min(2, "Ingresá tu nombre completo.")
    .max(80, "El nombre es demasiado largo."),
  businessName: z
    .string()
    .min(2, "Ingresá el nombre de tu negocio.")
    .max(120, "El nombre del negocio es demasiado largo."),
  email: z.email("Ingresá un email válido."),
  password: strongPassword,
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({
  email: z.email("Ingresá un email válido."),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: strongPassword,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Las contraseñas no coinciden.",
    path: ["confirmPassword"],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Ingresá tu contraseña actual."),
    newPassword: strongPassword,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Las contraseñas no coinciden.",
    path: ["confirmPassword"],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
