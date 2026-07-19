import assert from "node:assert/strict";
import test from "node:test";
import {
  getGoogleSocialProviderConfig,
  GOOGLE_ACCOUNT_LINKING,
  GOOGLE_AUTH_LOCAL_CALLBACK,
  GOOGLE_AUTH_PRODUCTION_CALLBACK,
  GOOGLE_IDENTITY_SCOPES,
  mapGoogleIdentityProfile,
} from "./google-auth";
import { buildGoogleAuthRequest } from "./google-auth-request";
import { GOOGLE_CALENDAR_SCOPES } from "@/server/integrations/google-calendar/config";

const GOOGLE_PROFILE = {
  aud: "client",
  azp: "client",
  email: "ana@example.com",
  email_verified: true,
  exp: 1,
  family_name: "García",
  given_name: "Ana",
  iat: 1,
  iss: "https://accounts.google.com",
  name: "  Ana García  ",
  picture: "https://lh3.googleusercontent.com/photo.jpg",
  sub: "google-user",
} as const;

test("Google social queda deshabilitado sin las dos credenciales", () => {
  assert.equal(getGoogleSocialProviderConfig({}), null);
  assert.equal(
    getGoogleSocialProviderConfig({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "" }),
    null
  );
});

test("Google social usa identidad básica y nunca scopes de Calendar", () => {
  const config = getGoogleSocialProviderConfig({
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret",
  });

  assert.ok(config);
  assert.deepEqual(config.scope, ["openid", "email", "profile"]);
  assert.equal(config.disableDefaultScope, true);
  assert.equal(config.accessType, "online");
  assert.deepEqual(
    GOOGLE_IDENTITY_SCOPES.filter((scope) =>
      GOOGLE_CALENDAR_SCOPES.includes(scope as (typeof GOOGLE_CALENDAR_SCOPES)[number])
    ),
    []
  );
});

test("prioriza un OAuth Client dedicado y no mezcla una configuración parcial", () => {
  const dedicated = getGoogleSocialProviderConfig({
    GOOGLE_AUTH_CLIENT_ID: "auth-client",
    GOOGLE_AUTH_CLIENT_SECRET: "auth-secret",
    GOOGLE_CLIENT_ID: "calendar-client",
    GOOGLE_CLIENT_SECRET: "calendar-secret",
  });
  assert.equal(dedicated?.clientId, "auth-client");
  assert.equal(dedicated?.clientSecret, "auth-secret");

  assert.equal(
    getGoogleSocialProviderConfig({
      GOOGLE_AUTH_CLIENT_ID: "auth-client",
      GOOGLE_CLIENT_ID: "calendar-client",
      GOOGLE_CLIENT_SECRET: "calendar-secret",
    }),
    null
  );
});

test("login y registro producen redirecciones internas diferentes y seguras", () => {
  assert.deepEqual(
    buildGoogleAuthRequest({ mode: "login", callbackURL: "/dashboard" }),
    {
      provider: "google",
      callbackURL: "/dashboard",
      newUserCallbackURL: "/dashboard",
      errorCallbackURL: "/login",
      requestSignUp: false,
    }
  );
  assert.deepEqual(buildGoogleAuthRequest({ mode: "register" }), {
    provider: "google",
    callbackURL: "/dashboard",
    newUserCallbackURL: "/onboarding",
    errorCallbackURL: "/registro",
    requestSignUp: true,
  });
  assert.equal(
    buildGoogleAuthRequest({ mode: "login", callbackURL: "https://evil.test" })
      .callbackURL,
    "/dashboard"
  );
});

test("registro por invitación conserva el destino sin aceptar rutas arbitrarias", () => {
  const request = buildGoogleAuthRequest({
    mode: "register",
    invitationToken: "invitation/token",
  });
  assert.equal(request.callbackURL, "/invitacion/invitation%2Ftoken");
  assert.equal(request.newUserCallbackURL, request.callbackURL);
});

test("nombre y foto de Google se mapean sin aceptar imágenes inseguras", () => {
  assert.deepEqual(mapGoogleIdentityProfile(GOOGLE_PROFILE), {
    name: "Ana García",
    image: "https://lh3.googleusercontent.com/photo.jpg",
  });
  assert.deepEqual(
    mapGoogleIdentityProfile({ ...GOOGLE_PROFILE, picture: "javascript:alert(1)" }),
    { name: "Ana García" }
  );
});

test("la vinculación evita correos distintos y exige verificar la cuenta local", () => {
  assert.equal(GOOGLE_ACCOUNT_LINKING.enabled, true);
  assert.equal(GOOGLE_ACCOUNT_LINKING.allowDifferentEmails, false);
  assert.equal(GOOGLE_ACCOUNT_LINKING.requireLocalEmailVerified, true);
  assert.equal("trustedProviders" in GOOGLE_ACCOUNT_LINKING, false);
});

test("los callbacks documentados son los callbacks propios de Better Auth", () => {
  assert.equal(
    GOOGLE_AUTH_PRODUCTION_CALLBACK,
    "https://proyecto-vantix-app.vercel.app/api/auth/callback/google"
  );
  assert.equal(
    GOOGLE_AUTH_LOCAL_CALLBACK,
    "http://localhost:3000/api/auth/callback/google"
  );
});
