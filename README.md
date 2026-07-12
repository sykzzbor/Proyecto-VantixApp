# VantixApp

Plataforma de gestión comercial con agente de inteligencia artificial, bandeja de atención humana e integración con WhatsApp Cloud API. El proyecto reúne las **etapas 1 a 4** sobre una única arquitectura Next.js, Prisma y PostgreSQL, manteniendo aislamiento estricto por organización.

## Stack

| Capa | Tecnología |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack) |
| Lenguaje | TypeScript |
| Estilos | Tailwind CSS 4 + shadcn/ui |
| Base de datos | PostgreSQL |
| ORM | Prisma 7 |
| Autenticación | Better Auth |
| Validación | Zod + react-hook-form |
| Agente IA | OpenAI Responses API + function calling |

## Estado del proyecto: etapas 1 a 4

### Etapa 1 — Base de gestión

- Registro, inicio y cierre de sesión, recuperación de contraseña y rutas protegidas.
- Organizaciones aisladas, equipo, invitaciones y roles `OWNER`, `ADMIN`, `AGENT` y `VIEWER`.
- Perfil del negocio y CRUD de productos, servicios y preguntas frecuentes.
- Configuración del agente, dashboard, auditoría, validaciones y estados de interfaz.

### Etapa 2 — Agente y chat de prueba

- Chat de prueba persistido con `channel = "test"`.
- OpenAI Responses API con function calling para consultar negocio, productos, servicios y preguntas frecuentes.
- Reglas de derivación a atención humana, historial acotado, límites de herramientas y rate limiting.
- Modo `AI_PROVIDER=demo` para trabajar sin una clave paga y sin llamar a OpenAI.

### Etapa 3 — Bandeja profesional

- Bandeja responsive de tres paneles: conversaciones, hilo y ficha del cliente.
- Búsqueda, filtros, no leídos, clientes, responsables y estados `OPEN`, `PENDING` y `CLOSED`.
- Modos `AI` y `HUMAN`, tomar conversación, devolverla a la IA y responder manualmente.
- Auditoría y validación server-side de sesión, rol, organización y pertenencia de cada conversación.

### Etapa 4 — WhatsApp Cloud API

- Configuración de una integración por número, con el access token cifrado y siempre enmascarado en la interfaz.
- Webhook oficial para mensajes entrantes y estados `pending`, `sent`, `delivered`, `read` y `failed`.
- Creación o actualización de clientes, reutilización de conversaciones y respuestas humanas desde la bandeja.
- Idempotencia mediante el ID externo de Meta, errores seguros y reintentos como nuevos intentos de envío.
- Simulador local para probar mensajes y estados sin credenciales ni envíos reales.

## Roles

| Rol | Permisos |
| --- | --- |
| `OWNER` | Control total, incluida la configuración de WhatsApp y la eliminación de la organización. |
| `ADMIN` | Gestiona negocio, catálogo, agente, equipo, bandeja e integración de WhatsApp. |
| `AGENT` | Edita catálogo, toma conversaciones y responde; puede consultar el estado de WhatsApp, pero no sus credenciales. |
| `VIEWER` | Solo lectura, incluido el estado no sensible de la integración. |

## Seguridad

- La organización activa se resuelve **siempre desde la sesión autenticada** (`src/server/context.ts`). Nunca se acepta un `organization_id` enviado por el navegador.
- Toda entrada se valida en el servidor con Zod, además de la validación en el cliente.
- Cada consulta y mutación filtra por `organizationId`: un usuario no puede ver ni tocar datos de otra organización.
- Las contraseñas las gestiona Better Auth (hash scrypt, nunca texto plano).
- El middleware (`src/proxy.ts`) hace un chequeo optimista por cookie; la verificación real de sesión/rol ocurre en layouts, páginas y server actions.
- Los permisos por rol están centralizados en `src/lib/permissions.ts` y se aplican en el servidor.
- Cada `phone_number_id` se resuelve contra `whatsapp_integrations`; el webhook nunca acepta un `organization_id` del payload.
- Los access tokens se cifran con AES-256-GCM antes de persistirse, se descifran solo en el servidor y nunca se registran en logs o auditoría.
- El `POST` de WhatsApp valida `X-Hub-Signature-256` sobre el body raw mediante HMAC-SHA256 y comparación segura.
- Los IDs externos evitan procesar dos veces el mismo mensaje. Los estados de entrega son monotónicos y no retroceden si Meta los envía fuera de orden.
- Los errores expuestos al usuario están sanitizados; `audit_logs` no guarda tokens, payloads completos ni contenido completo de mensajes.

## Puesta en marcha

### 1. Requisitos

- Node.js 20.9 o superior.
- Una base PostgreSQL (ver opciones abajo).

### 2. Instalar dependencias

```bash
npm install
```

### 3. Base de datos PostgreSQL

Elegí **una** de estas opciones:

**a) PostgreSQL local (Windows/Mac/Linux)**

1. Descargá el instalador desde <https://www.postgresql.org/download/> e instalalo (recordá la contraseña del usuario `postgres`).
2. Creá la base:
   ```bash
   createdb -U postgres vantixapp
   ```
   (o desde pgAdmin: click derecho en *Databases* → *Create*).
3. `DATABASE_URL` queda: `postgresql://postgres:TU_CONTRASEÑA@localhost:5432/vantixapp?schema=public`

**b) Docker**

```bash
docker run --name vantix-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=vantixapp -p 5432:5432 -d postgres:17
```

**c) Prisma Postgres local (lo más rápido, sin instalar nada)**

```bash
npx prisma dev
```

Deja un PostgreSQL local corriendo en la terminal y muestra la `DATABASE_URL` para pegar en `.env`. Mantené esa terminal abierta mientras uses la app.

**d) Base administrada**

- [Neon](https://neon.tech) o [Supabase](https://supabase.com): creá un proyecto gratuito y copiá la cadena de conexión de PostgreSQL.
- También podés usar `npx create-db` (Prisma Postgres en la nube) y pegar la URL resultante.

### 4. Variables de entorno

```bash
cp .env.example .env
```

Completá:

- `DATABASE_URL`: la cadena de conexión del paso anterior.
- `BETTER_AUTH_SECRET`: un secreto aleatorio (`openssl rand -base64 32`).
- `BETTER_AUTH_URL`: `http://localhost:3000` en desarrollo.
- `AI_PROVIDER`: usá `demo` para no llamar a OpenAI o `openai` para habilitar el proveedor real.
- `OPENAI_API_KEY`: clave de <https://platform.openai.com/api-keys>; solo es necesaria con `AI_PROVIDER=openai`.
- `OPENAI_MODEL`: opcional, por defecto `gpt-5-mini`.
- `WHATSAPP_VERIFY_TOKEN`: secreto compartido para la verificación `GET` del webhook.
- `META_APP_SECRET`: App Secret de la aplicación de Meta, usado para validar la firma del `POST`.
- `META_GRAPH_API_VERSION`: versión habilitada para la aplicación, con formato `vN.N`.
- `CREDENTIALS_ENCRYPTION_KEY`: clave de 32 bytes en 64 caracteres hexadecimales o base64. Podés generarla con `openssl rand -hex 32`.
- `WHATSAPP_DEV_MODE`: `true` habilita el simulador únicamente cuando `NODE_ENV` no es `production`.

Todas las variables anteriores son server-side. No les agregues el prefijo `NEXT_PUBLIC_`, no las incluyas en commits y reiniciá el servidor después de modificarlas.

Con `AI_PROVIDER=demo` o sin un proveedor real válido, Vantix guarda los mensajes entrantes, deja la conversación pendiente y permite atención manual. Nunca genera ni envía una respuesta automática simulada a WhatsApp.

### 5. Prisma y migraciones

En desarrollo, generá el cliente y aplicá las migraciones existentes de forma no destructiva:

```bash
npx prisma generate
npm run db:migrate
```

Para un despliegue, generá el cliente y aplicá únicamente las migraciones versionadas:

```bash
npx prisma generate
npm run db:deploy
```

No uses `prisma migrate reset`: elimina datos y no forma parte del flujo de este proyecto. Tampoco modifiques migraciones anteriores.

### 6. Seed opcional (cuenta demo con datos de ejemplo)

```bash
npm run db:seed
```

Credenciales demo: `demo@vantix.local` / `VantixDemo123`

### 7. Levantar la app

```bash
npm run dev
```

Abrí <http://localhost:3000>, registrate con tu negocio y listo.

## Scripts

| Script | Descripción |
| --- | --- |
| `npm run dev` | Servidor de desarrollo. |
| `npm run build` | Build de producción. |
| `npm run start` | Servir el build. |
| `npm run lint` | ESLint. |
| `npm run typecheck` | Chequeo de tipos con TypeScript. |
| `npm test` | Pruebas automatizadas de agente, webhook, seguridad y simulador. |
| `npx prisma generate` | Regenerar el cliente Prisma con la versión instalada. |
| `npm run db:migrate` | Crear/aplicar migraciones en desarrollo. |
| `npm run db:deploy` | Aplicar migraciones (producción/primer arranque). |
| `npm run db:seed` | Datos de ejemplo (cuenta demo). |
| `npm run db:studio` | Prisma Studio para inspeccionar la base. |

Antes de integrar o desplegar cambios, ejecutá con las versiones instaladas:

```bash
npx prisma generate
npm run lint
npm run typecheck
npm test
npm run build
```

La migración se ejecuta aparte con `npm run db:migrate` en desarrollo o `npm run db:deploy` en el entorno de despliegue; nunca con un reset.

## Agente de IA (etapa 2)

El chat de prueba está en **Dashboard → Agente IA → Chat de prueba**. Para probarlo:

1. Para usar OpenAI, configurá `AI_PROVIDER=openai`, completá `OPENAI_API_KEY` y reiniciá `npm run dev`. Para trabajar sin consumo pago, dejá `AI_PROVIDER=demo`.
2. Activá el agente en **Agente IA → Configuración**.
3. Cargá datos reales en Negocio, Productos, Servicios y Preguntas: el agente responde **solo** con esa información.

Cómo funciona:

- `POST /api/agent/chat` valida sesión, resuelve la organización desde la membresía del usuario (nunca del navegador) y aplica rate limiting (20 mensajes por minuto por usuario).
- El prompt se construye dinámicamente con la configuración de `agent_settings` (`src/server/agent/prompt.ts`).
- El modelo consulta datos mediante herramientas (`src/server/agent/tools.ts`), todas filtradas por la organización de la sesión: `get_business_information`, `search_products`, `search_services`, `search_faqs` y `request_human_support` (cambia la conversación a modo `HUMAN`).
- Control de costos: historial acotado a 12 mensajes, resultados de herramientas limitados (5 productos/servicios, 3 FAQs), máximo 4 rondas de herramientas y `max_output_tokens` fijo.
- Cada conversación de prueba usa `channel = "test"`; "Reiniciar" cierra la conversación y el historial queda en la base.
- `AI_PROVIDER=demo` impide crear el cliente de OpenAI. No se fabrica una respuesta para hacerla pasar por real.

## Bandeja de conversaciones (etapa 3)

La bandeja está en **Dashboard → Conversaciones** y reutiliza los mismos modelos `customers`, `conversations` y `messages` para todos los canales.

- El panel izquierdo busca por cliente, teléfono o contenido y filtra por estado y modo de atención.
- El hilo central diferencia mensajes del cliente, de la IA, del equipo y del sistema.
- El panel derecho muestra y, según permisos, permite editar la ficha del cliente.
- Abrir una conversación marca sus mensajes entrantes como leídos internamente y limpia el contador de no leídos.
- `OWNER`, `ADMIN` y `AGENT` pueden tomar una conversación y responder cuando está en modo `HUMAN`; `OWNER` y `ADMIN` también cambian estados y responsables.
- El canal de prueba mantiene su comportamiento anterior. WhatsApp agrega número, estado de entrega, error seguro y reintento sin rehacer los tres paneles.
- La vista se refresca aproximadamente cada cinco segundos; no depende de WebSockets.

## WhatsApp Cloud API (etapa 4)

### Arquitectura y reutilización

La configuración está en **Dashboard → Integraciones → WhatsApp**. `OWNER` y `ADMIN` pueden conectar, probar y desconectar; `AGENT` y `VIEWER` solo reciben información no sensible de estado.

- `whatsapp_integrations` relaciona un `phone_number_id` único con una organización.
- Cada conversación de WhatsApp conserva `channel = "whatsapp"` y la integración que debe usarse para responder.
- El token se cifra con AES-256-GCM, IV aleatorio, tag de autenticación y contexto adicional antes de guardarse. El frontend recibe únicamente una máscara.
- La lógica está separada en configuración, cifrado, firma, parser, persistencia, procesamiento, estados, cliente de Meta y automatización bajo `src/server/whatsapp/`.
- La etapa reutiliza permisos, auditoría, agente, clientes, conversaciones, mensajes y la acción de respuesta humana existentes.

### Webhook oficial

El callback es `/api/webhooks/whatsapp`:

- `GET` valida `hub.mode`, `hub.verify_token` y devuelve `hub.challenge` solo cuando la verificación es correcta.
- `POST` limita el tamaño, lee el body raw y valida `X-Hub-Signature-256` con `META_APP_SECRET` antes de parsear.
- La organización se obtiene exclusivamente desde `metadata.phone_number_id → whatsapp_integrations → organization_id`.
- Un número desconocido no crea clientes, conversaciones ni mensajes y tampoco se asigna a otra organización.
- La persistencia durable se completa antes del `200`; la automatización de IA/Meta se agenda después de la respuesta mediante `after()` de Next.js.
- No se guardan payloads completos. Los webhooks inválidos sin organización confiable se registran solo como eventos operativos sanitizados.

Para texto entrante, el servicio crea o actualiza el cliente, reutiliza una conversación no cerrada, guarda el mensaje con su ID externo y actualiza actividad y no leídos. Audio, imagen, documento, sticker y ubicación se convierten en un mensaje descriptivo con metadata mínima; no se descargan archivos.

Cada intento saliente comienza en `pending`; los recibos de Meta lo actualizan a `sent`, `delivered`, `read` o `failed`. Las transiciones evitan retrocesos por eventos fuera de orden. Un fallo conserva código y descripción sanitizados; el reintento crea un mensaje nuevo para preservar el intento y su ID anteriores.

La respuesta humana valida nuevamente sesión, rol, organización, conversación, modo `HUMAN` e integración activa. El token se descifra solo durante la llamada server-side a Graph API, que tiene timeout y no simula éxitos.

### Comportamiento sin OpenAI

Cuando `AI_PROVIDER=demo`, falta una clave válida o el agente no puede responder:

1. el mensaje entrante se persiste;
2. se conserva o crea cliente y conversación;
3. la conversación queda pendiente;
4. se agrega un aviso interno para el equipo;
5. no se llama a OpenAI ni se envía una respuesta automática a WhatsApp.

Si la conversación ya está en modo `HUMAN`, el agente tampoco se ejecuta. Una respuesta automática solo sale cuando el modo es `AI`, hay proveedor real, el agente genera correctamente el texto y Meta acepta el envío.

### Probar con el simulador local

El simulador no necesita credenciales de Meta y nunca envía a un número real:

1. En `.env`, configurá `WHATSAPP_DEV_MODE=true` y asegurate de no ejecutar con `NODE_ENV=production`.
2. Iniciá la aplicación con `npm run dev` e ingresá como `OWNER` o `ADMIN`.
3. Abrí **Dashboard → Integraciones → WhatsApp**. Al final de la página aparecerá **Simulador de webhook**.
4. Verificá la organización mostrada en modo solo lectura; se obtiene de la sesión y no se envía un ID desde el navegador.
5. Ingresá nombre ficticio, teléfono ficticio y mensaje. Presioná **Simular mensaje entrante**.
6. Abrí **Dashboard → Conversaciones** y comprobá el cliente, el canal WhatsApp, el mensaje, el estado pendiente y la persistencia al recargar.
7. Volvé al simulador y presioná `sent`, luego `delivered` y `read`. El mismo ID externo avanza por la secuencia.
8. Para comprobar errores, usá `failed`: la bandeja mostrará el intento fallido y su descripción segura.

Los botones de estados crean mensajes salientes simulados; responder manualmente desde la bandeja sigue requiriendo una integración real activa y nunca se marca como enviado de forma ficticia. El simulador queda bloqueado en producción aunque alguien intente invocar su Server Action directamente.

### Conectar Meta más adelante

1. Creá o elegí una aplicación en [Meta for Developers](https://developers.facebook.com/) y agregá el producto WhatsApp.
2. En Meta Business, obtené el WABA ID, Phone Number ID y un access token permanente con los permisos necesarios para administrar y enviar mensajes de WhatsApp.
3. Configurá en el servidor `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`, `META_GRAPH_API_VERSION` y una `CREDENTIALS_ENCRYPTION_KEY` nueva y privada.
4. Publicá Vantix bajo HTTPS y configurá `BETTER_AUTH_URL` con su origen público. La página de integración mostrará la URL completa del webhook.
5. Como `OWNER` o `ADMIN`, pegá WABA ID, Phone Number ID y access token en Vantix y guardá. El token no volverá a mostrarse.
6. En Meta → Webhooks, registrá la URL, usá exactamente el mismo `WHATSAPP_VERIFY_TOKEN` y suscribí el campo `messages` del número.
7. Volvé a Vantix, presioná **Probar conexión** y después enviá un mensaje de prueba al número para confirmar entrada, respuesta y recibos.

No reutilices claves de desarrollo en producción. La rotación de `CREDENTIALS_ENCRYPTION_KEY` requiere volver a cifrar o cargar nuevamente los access tokens guardados.

## Notas generales

- **Emails**: todavía no hay proveedor de email integrado.
  - El enlace de *recuperar contraseña* se imprime en la consola del servidor (donde corre `npm run dev`).
  - Las *invitaciones al equipo* se comparten copiando el enlace desde Dashboard → Equipo.
  - Para producción, conectá un proveedor (Resend, SendGrid, etc.) en `sendResetPassword` (`src/lib/auth.ts`) y en el alta de invitaciones.
- **Multi-organización**: el esquema soporta varias organizaciones por usuario, pero la experiencia actual resuelve una sola organización desde la sesión.
- **Moneda**: los precios se muestran en ARS (`src/lib/format.ts`). Cambiá el `Intl.NumberFormat` si usás otra moneda.

## Estructura del proyecto

```
prisma/
  schema.prisma          # Auth, organizaciones, catálogo, inbox, WhatsApp y auditoría
  migrations/            # Migraciones versionadas de las etapas 1 a 4
  seed.ts                # Datos demo opcionales
src/
  app/
    (auth)/              # /login, /registro, /recuperar-password, /restablecer-password
    onboarding/          # Crear la primera organización
    invitacion/[token]/  # Aceptar invitación al equipo
    dashboard/           # Gestión, agente, conversaciones e integraciones
    api/auth/[...all]/   # Handler de Better Auth
    api/webhooks/        # Webhook público firmado de WhatsApp
  components/            # UI por módulo; inbox y WhatsApp reutilizan shadcn/ui
  lib/                   # Auth, Prisma, permisos, Zod y formato
  server/                # contexto de sesión/organización, consultas,
                         # server actions y auditoría
    agent/               # Prompt, tools y ejecución del agente
    whatsapp/            # Cifrado, firma, parsing, persistencia, Meta y automatización
  proxy.ts               # Protección de rutas (middleware de Next 16)
```

## Límites intencionales de la etapa 4

- El envío saliente de WhatsApp admite únicamente texto. No hay envío de imágenes, audio, documentos o stickers.
- Los medios entrantes se guardan como descripción y metadata mínima; no se descargan ni almacenan permanentemente.
- No se implementaron mensajes template ni administración de plantillas de Meta. Los envíos reales deben respetar las ventanas y políticas vigentes de WhatsApp.
- No hay integración con Instagram, n8n, campañas, difusión masiva ni automatizaciones de marketing.
- No existe una cola durable. El webhook persiste primero y usa `after()` para el trabajo automático posterior; una instalación con requisitos de entrega estrictos deberá incorporar una cola externa.
- El rate limiting actual es en memoria y debe reemplazarse por almacenamiento compartido si la aplicación escala a varias instancias.
- La bandeja usa refresco periódico, no WebSockets ni eventos en tiempo real.
- Email transaccional, pagos y estadísticas avanzadas siguen fuera de este alcance.
