# Configuración de Tiendanube

## Aplicación del partner

1. Crear una aplicación en el portal de partners de Tiendanube.
2. Habilitar únicamente los scopes de lectura `read_products`, `read_customers` y `read_orders`.
3. Registrar como URL de redirección:
   `https://TU-DOMINIO/api/integrations/tiendanube/callback`
4. Configurar la URL de administración o preferencias en:
   `https://TU-DOMINIO/dashboard/integraciones/tiendanube`
5. Cargar en Vercel `TIENDANUBE_APP_ID` y `TIENDANUBE_CLIENT_SECRET`.
6. Mantener `NEXT_PUBLIC_APP_URL` con el origen HTTPS público de VantixApp.

El backend registra automáticamente los webhooks necesarios en:
`https://TU-DOMINIO/api/webhooks/tiendanube`

Eventos registrados: productos creados, actualizados o eliminados; pedidos creados, actualizados, pagados o cancelados; aplicación desinstalada, suspendida o reanudada.

## Seguridad y alcance

- El `state` OAuth vence, se usa una sola vez y queda ligado al usuario y a la organización.
- El token de Tiendanube se cifra en el servidor y nunca vuelve al navegador.
- Tiendanube informa que sus access tokens no vencen periódicamente. Si la aplicación se desinstala, se suspende o la API devuelve autorización inválida, VantixApp exige reconexión.
- Los webhooks se verifican sobre el body crudo con `x-linkedstore-hmac-sha256` y el Client Secret.
- La integración solo lee catálogo, variantes, stock, precios, clientes y pedidos. No modifica pedidos ni stock.
- El acceso requiere una suscripción activa Profesional o Empresarial.
