/**
 * Estado del formulario de verificación de correo.
 *
 * Vive fuera del archivo `"use server"` porque un módulo de server actions
 * solo puede exportar funciones async: cualquier constante exportada desde ahí
 * rompe el build con `invalid-use-server-value`.
 */
export type VerifyEmailFormState = {
  status: "idle" | "error";
  error: string | null;
  /** Sube en cada intento para que la UI sepa que hubo respuesta nueva. */
  attempt: number;
};

export const INITIAL_VERIFY_STATE: VerifyEmailFormState = {
  status: "idle",
  error: null,
  attempt: 0,
};
