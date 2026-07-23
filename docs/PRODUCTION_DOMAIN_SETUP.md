# Dominio canónico de producción

El único origen público canónico de VantixApp es:

```text
https://vantixapp.com.ar
```

`https://www.vantixapp.com.ar` y el alias anterior de Vercel redirigen de forma
permanente al dominio sin `www`, conservando ruta y query string.

## Variables de runtime

Configurar en producción, sin barra final:

```text
BETTER_AUTH_URL=https://vantixapp.com.ar
NEXT_PUBLIC_APP_URL=https://vantixapp.com.ar
```

Better Auth confía en el origen canónico, el host `www` que redirige, los hosts
de deployment controlados por Vercel y `localhost` únicamente en desarrollo.
Las mutaciones del navegador continúan siendo same-origin; no se habilita CORS
abierto. Los webhooks son server-to-server y validan sus propias firmas.

## Callbacks OAuth

- Google Login: `https://vantixapp.com.ar/api/auth/callback/google`
- Google Calendar: `https://vantixapp.com.ar/api/integrations/google-calendar/callback`
- Google Sheets: `https://vantixapp.com.ar/api/integrations/google-sheets/callback`
- Tiendanube: `https://vantixapp.com.ar/api/integrations/tiendanube/callback`

## Webhooks

- Mercado Pago: `https://vantixapp.com.ar/api/webhooks/mercado-pago`
- Tiendanube: `https://vantixapp.com.ar/api/webhooks/tiendanube`
- WhatsApp/Meta: `https://vantixapp.com.ar/api/webhooks/whatsapp`
- YCloud: `https://vantixapp.com.ar/api/webhooks/ycloud`
- WooCommerce:
  `https://vantixapp.com.ar/api/webhooks/woocommerce/{webhookKey}`

La clave de WooCommerce es distinta por conexión y la genera VantixApp.
