-- Preserva el acceso de las cuentas que ya existían antes de exigir
-- verificación de correo.
--
-- Sin esto, activar `requireEmailVerification` deja fuera a TODOS los usuarios
-- de email+contraseña creados hasta hoy: se registraron cuando la verificación
-- no existía, así que su `emailVerified` quedó en `false` (el valor por defecto
-- de Better Auth) y el login les devolvería 403 en el primer intento.
--
-- La verificación obligatoria aplica a los registros NUEVOS. Marcar como
-- verificadas las cuentas preexistentes no relaja nada para quien se registre
-- desde ahora: esas pasan por el flujo completo.
--
-- Solo alcanza a filas ya creadas al momento de correr la migración; es
-- idempotente y no toca a nadie que ya estuviera verificado.
UPDATE "users"
SET "emailVerified" = TRUE
WHERE "emailVerified" = FALSE;
