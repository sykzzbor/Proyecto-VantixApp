# Meta Embedded Signup para VantixApp

Esta guía describe la preparación externa necesaria para que cada organización conecte su propio número de WhatsApp mediante **Meta Embedded Signup**. Seguirla no activa Meta, no publica workflows de n8n y no cambia `AUTOMATION_PROVIDER`: el proveedor debe permanecer en `mock` hasta completar y aprobar todas las verificaciones.

Meta modifica periódicamente sus pantallas, requisitos y versiones. Antes de activar producción, contrastar cada paso con la documentación oficial enlazada al final y con el panel de la aplicación de Meta.

## Contrato de seguridad de VantixApp

- El SDK de Facebook se carga únicamente dentro de `/dashboard/integraciones`.
- El navegador usa solamente el App ID y el Configuration ID, que son identificadores públicos.
- El App Secret, los tokens y la clave de cifrado existen únicamente en el servidor.
- El navegador envía al backend solo el código temporal devuelto por Facebook Login for Business. No envía `organizationId`, WABA ID, Phone Number ID, token, número ni credenciales.
- Los mensajes `postMessage` de Embedded Signup se aceptan solo desde los orígenes exactos de Facebook admitidos por la implementación y se validan antes de usarlos para actualizar el estado visual. Los IDs que Meta pueda incluir en esos mensajes no se consideran autoridad ni se persisten.
- El servidor intercambia el código, valida el token con Meta, comprueba su App ID, vigencia y permisos, deriva los activos autorizados, verifica la relación WABA/número y suscribe la aplicación a la WABA.
- Si Meta devuelve más de una WABA o más de un número posible y no puede determinarse una única combinación de forma verificable, VantixApp falla cerrado y muestra **Acción requerida**. Nunca elige un activo por posición, antigüedad o datos enviados por el navegador.
- El token validado se cifra con AES-256-GCM antes de persistirse y nunca vuelve a una respuesta HTTP ni al navegador.
- El webhook identifica la organización por el Phone Number ID guardado y no por un dato proporcionado por el cliente o por n8n.

## Variables necesarias

Configurar los valores reales únicamente en el almacén seguro del entorno. Este documento enumera nombres; no deben guardarse valores en Git.

### Meta y WhatsApp

- `META_APP_ID`: identificador público de la aplicación de Meta.
- `META_EMBEDDED_SIGNUP_CONFIG_ID`: identificador público de la configuración de Facebook Login for Business/Embedded Signup.
- `META_APP_SECRET`: secreto de la aplicación; solo servidor.
- `META_GRAPH_API_VERSION`: versión explícita de Graph API habilitada para la aplicación, con formato `vN.N`.
- `WHATSAPP_VERIFY_TOKEN`: secreto elegido por VantixApp para verificar el `GET` inicial del webhook.
- `CREDENTIALS_ENCRYPTION_KEY`: clave AES-256 usada para cifrar tokens en reposo.
- `BETTER_AUTH_URL`: origen público canónico HTTPS de VantixApp; también determina la URL del webhook.

La URL de callback resultante es:

```text
<BETTER_AUTH_URL>/api/webhooks/whatsapp
```

`META_APP_ID` y `META_EMBEDDED_SIGNUP_CONFIG_ID` pueden llegar a la pantalla autenticada de Integraciones. Ninguna de las otras variables puede incluirse en JavaScript del navegador.

### n8n, sin activarlo

- `AUTOMATION_PROVIDER` debe continuar en `mock`.
- `N8N_WEBHOOK_URL`
- `N8N_WEBHOOK_SECRET`
- `N8N_CALLBACK_SECRET`
- `N8N_WORKFLOWS_PUBLISHED`: confirmación no secreta; mantenerla desactivada hasta publicar los cuatro workflows.
- `AUTOMATION_CRON_SECRET`
- `AUTOMATION_DISPATCHER_ENABLED`: señal no secreta; mantenerla desactivada hasta que el dispatcher programado esté efectivamente configurado y autorizado.

Los valores, las URLs privadas y los nombres internos de estas variables no deben mostrarse en el Centro de Integraciones. La interfaz solo presenta categorías humanas como “endpoint pendiente” o “dispatcher pendiente”.

## A. Preparación que Vantix realiza una sola vez

### 1. Preparar el negocio y la aplicación de Meta

1. Crear o seleccionar el portfolio empresarial de Vantix en Meta Business.
2. Completar la verificación del negocio y la verificación de acceso que Meta solicite.
3. Crear una aplicación de tipo **Business** en Meta for Developers y asociarla al portfolio verificado de Vantix.
4. Agregar los productos **WhatsApp** y **Facebook Login for Business**.
5. No usar una aplicación ni un número personal como infraestructura productiva.

Mientras la aplicación esté en modo Development, solo sus administradores, desarrolladores y testers autorizados pueden completar el flujo. Para clientes reales debe estar en Live y contar con las aprobaciones aplicables.

### 2. Crear la configuración de Embedded Signup

1. En Facebook Login for Business, crear una configuración destinada a WhatsApp Embedded Signup.
2. Elegir el flujo de Cloud API que permite al cliente seleccionar o crear su negocio, WABA y número.
3. Solicitar únicamente los permisos necesarios:
   - `business_management`, cuando Meta lo requiera para consultar o administrar los activos empresariales compartidos;
   - `whatsapp_business_management`, para consultar la WABA, números y suscripciones;
   - `whatsapp_business_messaging`, para enviar y recibir mensajes en nombre del negocio autorizado.
4. Habilitar el registro de sesión que requiera la versión actual del flujo.
5. Copiar el Configuration ID al almacén seguro con el nombre `META_EMBEDDED_SIGNUP_CONFIG_ID`.
6. No habilitar variantes como “solo compartir WABA” o coexistencia con WhatsApp Business App hasta que VantixApp implemente y pruebe expresamente esas ramas. El flujo estándar debe devolver una autorización utilizable para Cloud API.

El código debe usar la versión de flujo indicada por la configuración vigente de Meta. No fijar una versión antigua copiando ejemplos de terceros.

### 3. Configurar dominios y OAuth

1. Agregar el dominio canónico de producción a **App Domains**.
2. Agregar el mismo origen HTTPS a **Allowed domains** de la configuración de Embedded Signup.
3. En **Valid OAuth Redirect URIs**, registrar exactamente la URI que indique Facebook Login for Business para la integración. No usar comodines ni una URI parecida.
4. Configurar la URL pública y la política de privacidad, los términos y la eliminación de datos que Meta solicite para App Review.
5. Usar el dominio de producción estable. Las URLs temporales de Preview no deben habilitarse salvo una prueba explícita y controlada.
6. Para desarrollo local, usar únicamente cuentas con rol en la aplicación y el mecanismo de desarrollo admitido por Meta; nunca trasladar secretos al navegador para sortear restricciones de dominio.

Un error de dominio u OAuth debe quedar como **Configuración de Meta pendiente** o **Acción requerida**. No debe degradarse a un formulario que acepte IDs del navegador.

### 4. Configurar el webhook central

1. En el producto Webhooks/WhatsApp de la aplicación, seleccionar el objeto `whatsapp_business_account`.
2. Configurar como Callback URL:

   ```text
   https://<dominio-canónico>/api/webhooks/whatsapp
   ```

3. Usar como Verify Token el valor almacenado en `WHATSAPP_VERIFY_TOKEN`.
4. Verificar que Meta complete correctamente el desafío `GET`.
5. Suscribir como mínimo el campo `messages`, que incluye mensajes y estados de entrega.
6. Para observar cambios operativos de Embedded Signup, habilitar solo los campos que el backend desplegado pueda procesar de forma segura, por ejemplo `account_update`, `account_review_update`, `phone_number_name_update`, `phone_number_quality_update` y `message_template_status_update`.
7. Confirmar que cada `POST` real incluya `X-Hub-Signature-256` y que VantixApp lo valide con `META_APP_SECRET` sobre el body crudo.

La configuración global del webhook no alcanza por sí sola. Después de cada onboarding, VantixApp debe ejecutar la suscripción de la aplicación sobre la WABA autorizada (`/{WABA-ID}/subscribed_apps`) y guardar el resultado seguro de esa operación.

### 5. Solicitar Advanced Access y App Review

1. Solicitar **Advanced Access** para los permisos que el caso real requiera, normalmente `whatsapp_business_management` y `whatsapp_business_messaging`; incluir `business_management` cuando se consulten activos empresariales compartidos.
2. Preparar para App Review un usuario de revisión, instrucciones reproducibles y un video que muestre:
   - inicio de sesión en VantixApp;
   - botón **Conectar WhatsApp**;
   - Embedded Signup completo;
   - número conectado y estado seguro en Integraciones;
   - recepción de un mensaje por webhook;
   - respuesta desde VantixApp;
   - desconexión o revocación cuando corresponda.
3. Explicar por qué cada permiso es imprescindible. No solicitar permisos que VantixApp no utilice.
4. Publicar políticas de privacidad, términos, instrucciones de eliminación de datos y datos de contacto válidos.
5. No considerar la aplicación lista por el solo hecho de que el flujo funcione para administradores en Development.

### 6. Tech Provider y requisitos comerciales

VantixApp conecta activos pertenecientes a negocios clientes. Por eso debe completar el proceso de **Tech Provider/Access Verification** que Meta muestre para este modelo antes de onboarding productivo de terceros. Los requisitos pueden incluir:

- negocio de Vantix verificado;
- aplicación asociada a ese negocio;
- aceptación de los términos de Meta Business Messaging;
- App Review y Advanced Access;
- demostración del producto y del manejo de datos de clientes;
- información de soporte y cumplimiento.

Ser Tech Provider no convierte a Vantix en Meta ni permite prometer aprobaciones. Si Vantix adopta el modelo de Solution Partner o comparte una línea de crédito, debe completar además el flujo contractual y de facturación correspondiente. Esta implementación no comparte automáticamente una línea de crédito.

## B. Pasos que realiza cada cliente

El cliente no debería tener que copiar tokens, WABA IDs ni Phone Number IDs desde WhatsApp Manager.

1. Un OWNER o ADMIN abre `/dashboard/integraciones` y toca **Conectar WhatsApp**.
2. Inicia sesión en la ventana oficial de Meta con una cuenta que tenga control suficiente sobre el portfolio empresarial que quiere conectar.
3. Selecciona o crea el negocio y la cuenta de WhatsApp que Meta ofrece en el flujo.
4. Selecciona un número existente compatible o registra uno nuevo.
5. Verifica el número con el método que Meta ofrezca y completa el nombre visible solicitado.
6. Revisa y autoriza los permisos de VantixApp.
7. Agrega o confirma el método de facturación si Meta lo exige para ese negocio.
8. Finaliza el popup y vuelve a VantixApp. La pantalla queda en **Conectando** mientras el servidor valida la autorización.
9. Espera el estado **Conectado**. Si aparece **Acción requerida**, sigue la instrucción segura mostrada y vuelve a iniciar el flujo; no pega IDs ni tokens.
10. Usa **Probar conexión** para confirmar que el número sigue accesible y que la suscripción está operativa.

Meta puede exigir verificación del negocio, aprobación del nombre visible, PIN de dos pasos, facturación o revisión adicional. El cliente completa esas decisiones dentro de las superficies oficiales de Meta. VantixApp solo refleja un estado sanitizado.

### Números usados en WhatsApp Business App

La coexistencia entre WhatsApp Business App y Cloud API es un flujo específico de Meta, con eventos y requisitos adicionales. No debe prometerse ni activarse usando la configuración estándar. Hasta que VantixApp implemente y pruebe explícitamente esa variante, el cliente debe elegir un número elegible para el flujo Cloud API estándar o seguir la migración que indique Meta.

## C. Qué automatiza VantixApp y qué sigue dependiendo de Meta

| VantixApp puede automatizar | Meta o el cliente deben aprobar/completar |
| --- | --- |
| Abrir el SDK oficial con IDs públicos. | Inicio de sesión y autorización del usuario de Meta. |
| Enviar al servidor únicamente el código temporal. | Control del usuario sobre el portfolio y los activos elegidos. |
| Intercambiar el código sin exponer el App Secret. | Verificación del negocio y Access Verification/Tech Provider. |
| Validar token, App ID, expiración y scopes. | App Review y Advanced Access. |
| Derivar y verificar WABA y número con Graph API. | Alta y verificación del número/PIN. |
| Consultar el nombre verificado y el número visible. | Aprobación del nombre visible. |
| Suscribir la aplicación a la WABA y recibir webhooks firmados. | Disponibilidad y políticas de la plataforma Meta. |
| Cifrar el token y aislar la integración por organización. | Método de pago, límites, calidad y restricciones de la cuenta. |
| Probar la conexión, registrar auditoría y mostrar errores sanitizados. | Aprobación de plantillas y categorías de conversación. |
| Deshabilitar la integración sin borrar conversaciones ni mensajes. | Revocaciones o restricciones impuestas por Meta. |

VantixApp no debe afirmar que una plantilla, un número, un negocio o la aplicación están aprobados hasta que Meta lo confirme.

## Verificación antes de habilitar clientes reales

1. El Centro de Integraciones no muestra App Secret, tokens, WABA ID ni Phone Number ID a roles de solo lectura.
2. Sin App ID o Configuration ID, el botón queda deshabilitado y muestra **Configuración de Meta pendiente**.
3. Cancelar o cerrar el popup no crea ni modifica una integración.
4. Un código inválido o usado devuelve un error sanitizado y no persiste credenciales.
5. El token depurado pertenece al App ID configurado, está vigente y contiene los permisos requeridos.
6. La WABA y el número se derivan de datos consultados a Meta, no de `postMessage` ni del body del navegador.
7. El Phone Number ID no está asociado a otra organización.
8. La aplicación figura suscripta a la WABA y el webhook firmado llega a la organización correcta.
9. Una integración desconectada no procesa mensajes ni permite envíos.
10. Reconectar no duplica la integración ni borra historial.
11. Los logs no contienen código OAuth, token, App Secret, números completos ni payloads de Meta.
12. La verificación se completa primero con cuentas y activos de prueba autorizados; nunca con datos inventados en producción.

## Checklist final para activar n8n más adelante

Este checklist es posterior al desarrollo y no autoriza ninguna acción en n8n durante esta tarea.

1. Publicar primero los subworkflows **Error Handler**, **Handoff Alert** y **Follow-up**.
2. Publicar después **Event Router**.
3. Obtener la Production URL HTTPS del webhook del router.
4. Configurar los secretos correspondientes en Vercel y en el almacén cifrado de credenciales de n8n; no guardarlos en `$vars` ni en los JSON.
5. Confirmar que los cuatro workflows están publicados y recién entonces habilitar `N8N_WORKFLOWS_PUBLISHED`.
6. Confirmar que el dispatcher programado existe y recién entonces habilitar `AUTOMATION_DISPATCHER_ENABLED`.
7. Ejecutar desde VantixApp una prueba firmada controlada, todavía con el proveedor global en `mock`.
8. Esperar y verificar el callback firmado; una aceptación HTTP de n8n sin callback no cuenta como éxito.
9. Cambiar `AUTOMATION_PROVIDER` a `n8n` únicamente después de que el diagnóstico esté completo y la prueba haya finalizado correctamente.
10. Probar una derivación humana y un seguimiento con datos de prueba autorizados, verificando idempotencia, callback y ausencia de duplicados.

Toda rotación posterior del endpoint, de una firma o de la credencial del
dispatcher invalida la verificación anterior y requiere repetir la prueba. Solo
se persiste un fingerprint opaco de la configuración probada, nunca sus valores.

Consultar también [`n8n/SETUP.md`](../n8n/SETUP.md) para el contrato HMAC, variables de subworkflows y orden de publicación.

## Referencias oficiales

- [Meta — Embedded Signup: overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview)
- [Meta — Embedded Signup: implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)
- [Meta — colección oficial de Embedded Signup en Postman](https://www.postman.com/meta/whatsapp-business-platform/collection/du6gzjv/embedded-signup)
- [Meta — Debug Token para obtener las WABA compartidas](https://www.postman.com/meta/whatsapp-business-platform/request/i1mz7w8/debug-token)
- [Meta — Phone Numbers de una WABA](https://www.postman.com/meta/whatsapp-business-platform/request/o84xigu/phone-numbers)
- [Meta — colección oficial de WhatsApp Cloud API](https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api)
- [Meta — términos para Tech Providers](https://www.facebook.com/legal/BM-tech-provider-terms)
- [Meta Blueprint — curso de WhatsApp Embedded Signup](https://www.facebookblueprint.com/student/path/253152-whatsapp-embedded-signup-course)
