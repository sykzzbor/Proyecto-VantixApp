-- Permite que la persona invitada rechace explícitamente una invitación.
--
-- Hasta ahora solo existía REVOKED, que es la acción de quien invita. Sin un
-- estado propio, rechazar obligaba a reutilizar REVOKED y se perdía quién
-- tomó la decisión.
--
-- Migración ADITIVA: agrega un valor al enum. No altera filas existentes ni
-- cambia el comportamiento de ningún estado actual.
ALTER TYPE "InvitationStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
