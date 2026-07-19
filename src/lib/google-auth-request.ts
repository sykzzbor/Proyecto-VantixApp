import { safeCallbackUrl } from "@/lib/auth-errors";

export type GoogleAuthMode = "login" | "register";

export function buildGoogleAuthRequest({
  mode,
  callbackURL,
  invitationToken,
}: {
  mode: GoogleAuthMode;
  callbackURL?: string;
  invitationToken?: string;
}) {
  const invitationURL = invitationToken
    ? `/invitacion/${encodeURIComponent(invitationToken.slice(0, 512))}`
    : null;
  const successURL = invitationURL ?? safeCallbackUrl(callbackURL);

  return {
    provider: "google" as const,
    callbackURL: successURL,
    newUserCallbackURL:
      invitationURL ?? (mode === "register" ? "/onboarding" : successURL),
    errorCallbackURL: mode === "register" ? "/registro" : "/login",
    requestSignUp: mode === "register",
  };
}
