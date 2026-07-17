# Google Calendar — configuración (Etapas 6D.1A y 6D.1B)

La integración conecta cada organización con una cuenta de Google Calendar
(OAuth 2.0 oficial), permite elegir un calendario, consultar disponibilidad y
gestionar turnos. Las herramientas de Claude no forman parte de esta etapa.

## 1. Crear el proyecto en Google Cloud

1. Entrá a <https://console.cloud.google.com> y creá (o elegí) un proyecto.
2. En **APIs & Services → Library**, habilitá **Google Calendar API**.
3. En **APIs & Services → OAuth consent screen**:
   - User type: **External** (o Internal si usás Google Workspace propio).
   - Completá nombre de la app, email de soporte y dominios.
   - Scopes: agregá exactamente los permisos mínimos que usa VantixApp:
     - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
     - `https://www.googleapis.com/auth/calendar.events.freebusy`
     - `https://www.googleapis.com/auth/calendar.events`
   - Una conexión creada anteriormente con `calendar.readonly` deberá
     reconectarse para autorizar la gestión de eventos.
   - Mientras la app esté en modo **Testing**, agregá como *test users* los
     emails de las cuentas de Google que van a conectar.

## 2. Crear las credenciales OAuth

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Web application**.
3. En **Authorized redirect URIs** agregá exactamente:
   - Producción: `https://proyecto-vantix-app.vercel.app/api/integrations/google-calendar/callback`
   - Desarrollo: `http://localhost:3000/api/integrations/google-calendar/callback`
4. Guardá y copiá el **Client ID** y el **Client Secret**.

## 3. Variables de entorno

Solo en el servidor (Vercel → Project → Settings → Environment Variables, o el
`.env` local). Nunca con prefijo `NEXT_PUBLIC_`.

| Variable | Valor |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Client ID del paso 2 |
| `GOOGLE_CLIENT_SECRET` | Client Secret del paso 2 |

La URL de callback se deriva de `BETTER_AUTH_URL` (ya configurada); no hay que
cargarla por separado. Si `BETTER_AUTH_URL` cambia, actualizá también la
redirect URI autorizada en Google Cloud.

## 4. Aplicar la migración

La etapa agrega dos tablas (`google_calendar_connections`,
`google_oauth_states`) con una migración aditiva. Aplicala como siempre, desde
un entorno confiable:

```bash
npm run db:deploy
```

## 5. Probar

1. Ingresá como OWNER o ADMIN y abrí **Dashboard → Integraciones**.
2. En la tarjeta **Google Calendar**, tocá **Conectar con Google** y aceptá el
   consentimiento.
3. De vuelta en el panel: **Elegir calendario**, **Probar conexión**,
   **Reconectar** y **Desconectar** quedan disponibles.
4. AGENT y VIEWER ven la tarjeta en solo lectura.

## Seguridad

- Tokens (access y refresh) cifrados con AES-256-GCM
  (`CREDENTIALS_ENCRYPTION_KEY`); nunca viajan al navegador ni a logs.
- `state` OAuth de un solo uso, con vencimiento de 10 minutos, guardado como
  hash SHA-256 y atado a la organización y al usuario de la sesión (CSRF y
  anti-replay; el doble callback se rechaza).
- Scopes separados y mínimos: listado de calendarios, FreeBusy y gestión de
  eventos. Una conexión sin los tres permisos falla cerrada y solicita
  reconexión antes de crear, reprogramar o cancelar.
- Desconectar revoca el token en Google (best effort) y borra las credenciales.
