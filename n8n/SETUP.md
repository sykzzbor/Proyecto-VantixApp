# n8n para VantixApp — Etapa 6C

Estos workflows preparan la conexión operativa de VantixApp con n8n sin entregar a n8n acceso a PostgreSQL ni credenciales de WhatsApp/Meta. Se importan inactivos y sin credenciales asociadas.

## Versión validada

La versión objetivo exacta es **n8n 2.25.7**, publicada como versión estable en el [repositorio oficial de n8n](https://github.com/n8n-io/n8n/releases/tag/n8n%402.25.7). Ese paquete usa `n8n-nodes-base` 2.25.2 y `n8n-workflow` 2.25.2, según el [paquete oficial de n8n 2.25.7](https://www.npmjs.com/package/n8n/v/2.25.7).

Los JSON usan únicamente nodos y propiedades comprobados contra esas versiones. Antes de actualizar n8n, volver a importar y validar los cuatro workflows en un entorno de prueba.

## Archivos e importación

Importar en este orden:

1. `workflows/vantix-error-handler.json`
2. `workflows/vantix-handoff-alert.json`
3. `workflows/vantix-follow-up.json`
4. `workflows/vantix-event-router.json`

Después de importar, mantenerlos inactivos hasta completar variables, credenciales y una prueba controlada. Los exports no contienen IDs de workflows importados; por eso los subworkflows se resuelven mediante variables de n8n.

## Variables de n8n (no secretas)

Crear estas variables en el proyecto de n8n:

- `VANTIX_APP_BASE_URL`: origen público HTTPS de VantixApp, sin ruta de API.
- `VANTIX_HANDOFF_WORKFLOW_ID`: ID asignado por n8n al workflow **Vantix - Handoff Alert**.
- `VANTIX_FOLLOWUP_WORKFLOW_ID`: ID asignado por n8n al workflow **Vantix - Follow-up**.
- `VANTIX_ERROR_WORKFLOW_ID`: ID asignado por n8n al workflow **Vantix - Error Handler**.

No guardar secretos en `$vars`. Los workflows no requieren habilitar acceso a variables de entorno desde Code nodes.

## Credenciales de n8n

Crear las credenciales dentro del almacén cifrado de n8n y seleccionarlas manualmente en los nodos indicados. Los JSON no incluyen nombres, IDs ni valores de credenciales.

### Firma de entrada

Crear una credencial **Crypto** cuyo campo HMAC corresponda al secreto de salida de VantixApp. Seleccionarla solamente en:

- **Verify incoming HMAC**, dentro de **Vantix - Event Router**.

La contraparte en VantixApp es la variable `N8N_WEBHOOK_SECRET`.

### Firma de callbacks y acciones

Crear una segunda credencial **Crypto** cuyo campo HMAC corresponda al secreto de callbacks/acciones de VantixApp. Seleccionarla en todos los nodos **Sign ... callback**, en **Sign handoff action** y en **Sign follow-up action**.

La contraparte en VantixApp es la variable `N8N_CALLBACK_SECRET`. No reutilizar el secreto de entrada.

## Variables de VantixApp/Vercel

La integración usa estos nombres del lado de VantixApp:

- `AUTOMATION_PROVIDER`
- `N8N_WEBHOOK_URL`
- `N8N_WEBHOOK_SECRET`
- `N8N_CALLBACK_SECRET`
- `N8N_WORKFLOWS_PUBLISHED` (señal no secreta; cambiar a `true` solo después de publicar los cuatro workflows)
- `AUTOMATION_CRON_SECRET`
- `AUTOMATION_DISPATCHER_ENABLED` (señal no secreta; dejar `false` hasta que el
  scheduler esté configurado y autorizado)
- `CRON_SECRET` para Vercel Cron, cuando corresponda

Opcionalmente, la infraestructura existente admite:

- `AUTOMATION_MAX_ATTEMPTS`
- `AUTOMATION_REQUEST_TIMEOUT_MS`

`N8N_WEBHOOK_URL` debe apuntar a la URL de producción del webhook **Receive Vantix event**, cuya ruta es `/webhook/vantix-events`. No configurar valores reales ni cambiar `AUTOMATION_PROVIDER` durante esta etapa de revisión: debe continuar en `mock`.

## Contrato firmado

### VantixApp → router

VantixApp envía el JSON crudo con los campos superiores:

```json
{
  "eventId": "<id del evento>",
  "runId": "<id del intento>",
  "organizationId": "<id de organización>",
  "type": "<tipo permitido>",
  "timestamp": 0,
  "schemaVersion": 1,
  "idempotencyKey": "<clave estable>",
  "payload": {}
}
```

La firma es HMAC SHA-256 sobre los bytes exactos del cuerpo UTF-8 y viaja como `x-vantix-signature: sha256=<digest hexadecimal>`. También se verifican `x-vantix-event-id`, `x-vantix-timestamp` y `x-vantix-schema-version`.

El router:

- obtiene el body crudo mediante el Webhook v1 con `rawBody`;
- compara la firma calculada con la recibida;
- exige que el timestamp del header coincida con el JSON y esté dentro de cinco minutos;
- valida versión, IDs, `runId`, tamaño y payload;
- elimina campos no permitidos antes de ejecutar un subworkflow;
- acepta solamente `conversation.handoff_requested`, `conversation.followup_due` y `automation.test`;
- responde `202` solo después de validar, incluyendo el ID de ejecución de n8n en el header de respuesta.

### n8n → callback

Todo callback usa `POST /api/webhooks/n8n/callback`, firma el body crudo con la credencial de callback y contiene como mínimo:

```json
{
  "eventId": "<id del evento>",
  "runId": "<id exacto del intento recibido>",
  "organizationId": "<id de organización>",
  "timestamp": 0,
  "status": "succeeded"
}
```

`timestamp` es un entero en milisegundos y su representación decimal debe coincidir exactamente con `x-vantix-timestamp`. Los errores pasan por **Vantix - Error Handler**, que descarta mensajes y stacks crudos y envía únicamente `errorCode` y `errorMessage` estables.

## Derivación humana

**Vantix - Handoff Alert** vuelve a validar el wrapper recibido del router y delega el envío exclusivamente a VantixApp. No selecciona destinatarios, no recibe números telefónicos, no renderiza plantillas y no conserva un ledger propio.

El workflow envía este único cuerpo crudo a `POST /api/webhooks/n8n/actions/send-handoff-alert`:

```json
{
  "eventId": "<id del evento>",
  "organizationId": "<id de organización>"
}
```

`runId` se conserva solo dentro de la ejecución para correlacionar el callback normal y nunca forma parte del cuerpo de la acción. El workflow genera `x-vantix-timestamp` en milisegundos y firma HMAC SHA-256 sobre la concatenación exacta `${timestamp}.${rawBody}` con la credencial Crypto asociada a `N8N_CALLBACK_SECRET`. El digest se envía como `x-vantix-signature: sha256=<digest hexadecimal>`.

VantixApp busca el evento y la regla reales, obtiene allí los números E.164 y la plantilla aprobada, usa su propia integración de WhatsApp Cloud API, registra auditoría e impide duplicados. n8n no recibe credenciales de Meta, teléfonos, texto de plantilla ni tokens.

La acción espera como máximo 30 segundos. Las respuestas `success` y `already_sent` generan el callback exitoso normal. `in_progress` y `not_executable` terminan sin callback para no producir estados falsos. Un timeout, un error de red o una respuesta HTTP `408`, `425`, `429` o `5xx` también termina sin callback: VantixApp conserva el evento para reconciliar un resultado potencialmente ambiguo sin duplicar avisos. La única excepción es HTTP `502` con `error: "send_failed"`, que confirma que Meta rechazó o no completó el envío y pasa al error handler. Los errores confirmados usan códigos estables y nunca propagan cuerpos, mensajes o detalles de red.

## Seguimiento automático

**Vantix - Follow-up** nunca recibe ni acepta un teléfono o mensaje arbitrario. Firma y envía solamente este cuerpo a `POST /api/webhooks/n8n/actions/send-followup`:

```json
{
  "eventId": "<id del evento>",
  "runId": "<id exacto del intento>",
  "organizationId": "<id de organización>",
  "conversationId": "<id de conversación>",
  "timestamp": 0
}
```

VantixApp busca el evento real, vuelve a validar todas las condiciones, renderiza el mensaje desde la regla guardada y lo envía con su integración de WhatsApp.

El workflow envía callback de éxito solamente cuando la acción responde HTTP `200` con `callbackRequired: true`. Si responde `callbackRequired: false` —por ejemplo, cancelado, reprogramado o ya en proceso— termina sin callback. También evita callback en conflictos `in_progress`/`not_executable`. Un retry usa el mismo `eventId` y VantixApp impide un segundo mensaje.

## Publicación y prueba controlada

No publicar ni activar los workflows durante esta etapa. Cuando exista una autorización posterior:

1. Completar las variables no secretas.
2. Seleccionar las dos credenciales Crypto en cada nodo correspondiente, incluida **Sign handoff action**.
3. Publicar primero **Error Handler**, **Handoff Alert** y **Follow-up**.
4. Publicar por último **Event Router** y copiar su Production URL a la configuración segura de VantixApp.
5. Confirmar que los cuatro workflows están publicados y recién entonces
   cambiar `N8N_WORKFLOWS_PUBLISHED` a `true`.
6. Confirmar que el scheduler llama al dispatcher con la credencial correcta y
   recién entonces cambiar `AUTOMATION_DISPATCHER_ENABLED` a `true`.
7. Mantener `AUTOMATION_PROVIDER=mock` hasta que la persona responsable autorice la activación.
8. Cuando se autorice, usar **Probar conexión** en VantixApp; la prueba solo debe considerarse exitosa después del callback firmado.
9. Probar derivación y seguimiento con datos locales o de prueba autorizados, nunca con datos inventados en producción.

Si se cambia el endpoint, cualquiera de las firmas o la credencial del
dispatcher, VantixApp invalida la verificación anterior y exige una nueva prueba
firmada. El fingerprint persistido es opaco y nunca contiene ni expone los
valores de esas credenciales.

## Controles de seguridad incluidos

- Los workflows se importan inactivos y sin credenciales.
- No hay nodos de PostgreSQL ni accesos directos a la base.
- No hay tokens, llamadas directas a Meta ni credenciales de WhatsApp.
- Los redirects HTTP están desactivados.
- El router firma/verifica sobre cuerpos crudos; no reserializa para verificar.
- Los callbacks correlacionan `eventId`, `organizationId` y el `runId` exacto del intento.
- Las ejecuciones exitosas, fallidas y manuales no se guardan; la política de redacción está en `all`.
- El error handler nunca propaga respuestas HTTP, stack traces ni mensajes arbitrarios.
- Las alertas de derivación y los seguimientos se envían únicamente desde VantixApp y no desde n8n.
