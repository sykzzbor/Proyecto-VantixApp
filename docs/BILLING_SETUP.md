# Facturación, prueba gratuita y Mercado Pago

## Comportamiento de VantixApp

- Cada organización nueva recibe una única prueba de 5 días, creada en la misma transacción que la organización y su membresía OWNER.
- La migración `20260719120000_billing_subscriptions` asigna una prueba finita de 5 días a cada organización preexistente. No se vuelve a crear al iniciar sesión, renombrar el negocio ni agregar integrantes.
- El onboarding inicial se serializa por el ID interno del usuario y recupera una membresía existente antes de crear. Así evita dobles pruebas por reintento o doble clic sin tomar decisiones destructivas basadas solo en el correo. Las organizaciones adicionales legítimas deben nacer por un flujo administrativo controlado y cada una conserva su propia suscripción.
- El estado efectivo se calcula en el servidor. `TRIALING` vigente y `ACTIVE` permiten operar. `PAST_DUE`, `EXPIRED` e `INCOMPLETE` bloquean. `CANCELED` mantiene acceso únicamente hasta `currentPeriodEndsAt`.
- Los mensajes entrantes y estados de entrega se conservan aunque la cuenta esté bloqueada; no se ejecutan IA, envíos automáticos ni acciones con consumo.

## Preparación manual de Mercado Pago

1. Crear tres planes mensuales en ARS para `STANDARD`, `PROFESSIONAL` y `ENTERPRISE`.
2. Antes de habilitar checkout, confirmar que cada importe coincide exactamente con la conversión y redondeo mostrados por VantixApp. El backend rechaza diferencias para no cobrar otro valor.
3. Configurar las variables listadas en `.env.example` únicamente en el entorno seguro del servidor.
4. Registrar `https://TU-DOMINIO/api/webhooks/mercado-pago` como webhook y copiar su firma secreta al entorno.
5. Suscribir notificaciones de suscripciones/preapproval y pagos autorizados de suscripciones.
6. Probar en un entorno de prueba separado. No mezclar credenciales de prueba y producción.
7. Verificar un alta, un pago rechazado, una cancelación y un webhook duplicado antes de habilitar cobros reales.

## Política de precio

El checkout guarda un snapshot inmutable con plan, USD de referencia, importe ARS, cotización, fuente y fecha. La renovación conserva el importe autorizado (`FIXED_UNTIL_EXPLICIT_CHANGE`). Una variación del dólar no altera silenciosamente una suscripción existente: cambiar el importe requiere un flujo explícito, un nuevo snapshot y aceptación del pagador.

El retorno del navegador no activa el plan. El acceso cambia únicamente después de consultar el estado server-side de Mercado Pago desde un webhook firmado o una sincronización administrativa.

## Datos que no se almacenan

VantixApp no recibe ni persiste números completos de tarjeta, códigos de seguridad ni credenciales de pago del pagador. Tampoco guarda payloads completos de webhooks: el ledger conserva una huella SHA-256, tipo, transición e identificadores operativos mínimos.
