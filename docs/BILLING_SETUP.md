# Facturación, prueba gratuita y Mercado Pago

## Comportamiento de VantixApp

- Cada organización nueva recibe una única prueba de 5 días, creada en la misma transacción que la organización y su membresía OWNER.
- La migración `20260719120000_billing_subscriptions` asigna una prueba finita de 5 días a cada organización preexistente. No se vuelve a crear al iniciar sesión, renombrar el negocio ni agregar integrantes.
- El onboarding inicial se serializa por el ID interno del usuario y recupera una membresía existente antes de crear. Así evita dobles pruebas por reintento o doble clic sin tomar decisiones destructivas basadas solo en el correo. Las organizaciones adicionales legítimas deben nacer por un flujo administrativo controlado y cada una conserva su propia suscripción.
- El estado efectivo se calcula en el servidor. `TRIALING` vigente y `ACTIVE` permiten operar. `PAST_DUE`, `EXPIRED` e `INCOMPLETE` bloquean. `CANCELED` mantiene acceso únicamente hasta `currentPeriodEndsAt`.
- Los mensajes entrantes y estados de entrega se conservan aunque la cuenta esté bloqueada; no se ejecutan IA, envíos automáticos ni acciones con consumo.

## Preparación manual de Mercado Pago

1. Configurar las variables listadas en `.env.example` únicamente en el entorno seguro del servidor.
2. Registrar `https://vantixapp.com.ar/api/webhooks/mercado-pago` como webhook y copiar su firma secreta al entorno.
3. Activar los eventos `subscription_preapproval` y `subscription_authorized_payment` (Planes y suscripciones). No se requieren planes externos: cada checkout crea una suscripción mensual sin plan asociado con el importe ARS del snapshot.
4. Probar con credenciales y usuarios de prueba en un entorno separado. No mezclar credenciales de prueba y producción.
5. Verificar un alta, un pago pendiente, una renovación aprobada, un pago rechazado, una cancelación, un cambio de plan y un webhook duplicado antes de habilitar cobros reales.

## Política de precio

El catálogo mensual de referencia es `STANDARD` USD 89, `PROFESSIONAL` USD 179 y `ENTERPRISE` USD 349. La interfaz y el checkout obtienen estos importes desde la misma configuración tipada.

El checkout guarda un snapshot inmutable con plan, USD de referencia, importe ARS, cotización, fuente y fecha. Ese importe se envía a Mercado Pago con frecuencia mensual. La renovación conserva el importe autorizado (`FIXED_UNTIL_EXPLICIT_CHANGE`). Una variación del dólar no altera silenciosamente una suscripción existente: cambiar el importe requiere un checkout explícito, un nuevo snapshot y aceptación del pagador.

El retorno del navegador no activa el plan. El acceso cambia únicamente después de consultar el estado server-side de Mercado Pago desde un webhook firmado o una sincronización administrativa.

## Datos que no se almacenan

VantixApp no recibe ni persiste números completos de tarjeta, códigos de seguridad ni credenciales de pago del pagador. Tampoco guarda payloads completos de webhooks: el ledger conserva una huella SHA-256, tipo, transición e identificadores operativos mínimos.
