# Configuración de Google Sheets

Google Sheets usa un OAuth propio, separado tanto del inicio de sesión con
Google como de Google Calendar. Los tokens se guardan cifrados y nunca llegan
al navegador.

## Google Cloud

1. Habilitar **Google Sheets API** en el proyecto.
2. Crear un cliente OAuth 2.0 de tipo **Aplicación web**.
3. Agregar la URL de producción autorizada:
   `https://vantixapp.com.ar/api/integrations/google-sheets/callback`.
4. Para desarrollo local agregar:
   `http://localhost:3000/api/integrations/google-sheets/callback`.
5. Configurar la pantalla de consentimiento para el scope
   `https://www.googleapis.com/auth/spreadsheets`.

No se solicita acceso general a Google Drive. Por eso Vantix puede crear una
hoja o vincular una hoja existente por su URL/ID, que Google valida con la
cuenta autorizada, pero no enumera todo el Drive del usuario.

## Variables del servidor

- `GOOGLE_SHEETS_CLIENT_ID`
- `GOOGLE_SHEETS_CLIENT_SECRET`
- `BETTER_AUTH_URL`
- `CREDENTIALS_ENCRYPTION_KEY`

Después de configurarlas, desplegar, abrir **Integraciones → Google Sheets** y
conectar la cuenta. Google Sheets se mantiene bloqueado durante la prueba y se
habilita desde Standard.
