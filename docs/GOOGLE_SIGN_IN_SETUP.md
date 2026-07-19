# Inicio de sesión con Google

VantixApp usa el proveedor social oficial de Better Auth para identidad básica. Este flujo está separado de la conexión de Google Calendar y solicita únicamente `openid`, `email` y `profile`.

## Variables del servidor

- `GOOGLE_AUTH_CLIENT_ID`
- `GOOGLE_AUTH_CLIENT_SECRET`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`

Se recomienda crear un OAuth Client dedicado para identidad y cargarlo en `GOOGLE_AUTH_CLIENT_ID` y `GOOGLE_AUTH_CLIENT_SECRET`. Esto separa por completo sus autorizaciones de Google Calendar.

Si esas dos variables se omiten, VantixApp puede reutilizar `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` siempre que el mismo OAuth Client tenga autorizadas ambas redirect URIs. Los scopes y callbacks del código continúan separados. Una configuración dedicada parcial se rechaza en lugar de mezclar credenciales.

## Redirect URIs de Better Auth

- Producción: `https://proyecto-vantix-app.vercel.app/api/auth/callback/google`
- Desarrollo local: `http://localhost:3000/api/auth/callback/google`

La autorización de Calendar conserva su callback propio:

- Producción: `https://proyecto-vantix-app.vercel.app/api/integrations/google-calendar/callback`
- Desarrollo local: `http://localhost:3000/api/integrations/google-calendar/callback`

No se deben agregar scopes de Calendar al consentimiento de inicio de sesión.
