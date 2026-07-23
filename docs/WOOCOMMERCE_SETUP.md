# Configuración de WooCommerce

Cada organización conecta su propia tienda desde **Integraciones → WooCommerce**
con la URL HTTPS de la tienda, Consumer Key y Consumer Secret. Las credenciales
se validan contra WooCommerce, se cifran en el servidor y nunca vuelven al
navegador.

VantixApp registra una URL distinta por conexión con este formato exacto:

```text
https://vantixapp.com.ar/api/webhooks/woocommerce/{webhookKey}
```

`{webhookKey}` es una clave opaca generada por VantixApp. No debe inventarse ni
copiarse entre organizaciones. Al conectar o reconectar una tienda, VantixApp
registra automáticamente los webhooks de productos, clientes y pedidos con su
clave correspondiente.

Para migrar una conexión existente al dominio canónico, el OWNER o ADMIN debe
reconectarla desde Integraciones para que WooCommerce revalide las credenciales
y registre las nuevas delivery URLs. La infraestructura nunca acepta la
organización desde el payload: la resuelve mediante la clave de la URL.
