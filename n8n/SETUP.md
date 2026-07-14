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
- `VANTIX_HANDOFF_NOTIFICATION_URL`: endpoint HTTPS del canal de avisos gestionado por n8n.
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

Crear una segunda credencial **Crypto** cuyo campo HMAC corresponda al secreto de callbacks/acciones de VantixApp. Seleccionarla en todos los nodos **Sign ... callback** y en **Sign follow-up action**.

La contraparte en VantixApp es la variable `N8N_CALLBACK_SECRET`. No reutilizar el secreto de entrada.

### Canal de avisos

Crear una credencial **HTTP Header Auth** propia de n8n para el servicio configurado en `VANTIX_HANDOFF_NOTIFICATION_URL` y seleccionarla en **Notify allowed recipients**.

Ese servicio debe aceptar el cuerpo mínimo del aviso, responder con `2xx` únicamente cuando acepte la notificación y respetar el header `Idempotency-Key`. También se puede reemplazar ese nodo por un nodo oficial de Slack, Teams o correo, conservando la entrada validada, la deduplicación y las ramas de éxito/error.

## Variables de VantixApp/Vercel

La integración usa estos nombres del lado de VantixApp:

- `AUTOMATION_PROVIDER`
- `N8N_WEBHOOK_URL`
- `N8N_WEBHOOK_SECRET`
- `N8N_CALLBACK_SECRET`
- `AUTOMATION_CRON_SECRET`
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

**Vantix - Handoff Alert** vuelve a validar el evento y construye un aviso con:

- IDs del evento, organización y conversación;
- nombre visible del negocio y nombre seguro del cliente;
- enlace interno y fecha de solicitud;
- agente asignado, cuando existe;
- destinatarios ya autorizados por VantixApp.

No recibe historial de conversación, tokens ni objetos Prisma.

Antes de contactar el canal, el workflow reserva `eventId + idempotencyKey` en los datos estáticos globales y propaga la misma clave mediante `Idempotency-Key`. Solo un `2xx` cambia el ledger a `succeeded`; únicamente ese estado puede omitir una notificación y emitir callback exitoso. Un estado `reserved` se reintenta con la misma clave y nunca se presenta como éxito por sí solo.

El workflow conserva `handoffNotificationLedger` hasta siete días, sujeto a la cota de 10.000 entradas, una ventana superior a los reintentos automáticos previstos. No lo limpies manualmente. Los datos estáticos de n8n no son un lock distribuido fuerte y solo se persisten al finalizar ejecuciones de producción; por eso el canal externo **debe garantizar idempotencia** para `Idempotency-Key`. Las ejecuciones manuales del editor no sirven para verificar esta protección. Si el canal elegido no ofrece ese contrato, no activar `HANDOFF_ALERT`: se prioriza no duplicar avisos y no informar éxitos falsos.

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

Después de la revisión de código:

1. Completar las variables no secretas.
2. Seleccionar las dos credenciales Crypto en cada nodo correspondiente.
3. Seleccionar la credencial del canal de avisos.
4. Publicar primero **Error Handler**, **Handoff Alert** y **Follow-up**.
5. Publicar por último **Event Router** y copiar su Production URL a la configuración segura de VantixApp.
6. Mantener `AUTOMATION_PROVIDER=mock` hasta que la persona responsable autorice la activación.
7. Cuando se autorice, usar **Probar conexión** en VantixApp; la prueba solo debe considerarse exitosa después del callback firmado.
8. Probar derivación y seguimiento con datos locales o de prueba autorizados, nunca con datos inventados en producción.

## Controles de seguridad incluidos

- Los workflows se importan inactivos y sin credenciales.
- No hay nodos de PostgreSQL ni accesos directos a la base.
- No hay tokens, llamadas directas a Meta ni credenciales de WhatsApp.
- Los redirects HTTP están desactivados.
- El router firma/verifica sobre cuerpos crudos; no reserializa para verificar.
- Los callbacks correlacionan `eventId`, `organizationId` y el `runId` exacto del intento.
- Las ejecuciones exitosas, fallidas y manuales no se guardan; la política de redacción está en `all`.
- El error handler nunca propaga respuestas HTTP, stack traces ni mensajes arbitrarios.
- El seguimiento se envía únicamente desde VantixApp y no desde n8n.
