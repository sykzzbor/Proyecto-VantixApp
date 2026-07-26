const BILLING_DISPLAY_TIME_ZONE = "America/Argentina/Buenos_Aires";

export function formatBillingDate(value: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: BILLING_DISPLAY_TIME_ZONE,
  }).format(new Date(value));
}

export function formatBillingDeadline(value: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: BILLING_DISPLAY_TIME_ZONE,
  }).format(new Date(value));
}
