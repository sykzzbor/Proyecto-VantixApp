export const SUBSCRIPTION_SAFE_DASHBOARD_PATHS = [
  "/dashboard/planes",
  "/dashboard/configuracion",
  "/dashboard/perfil",
  "/dashboard/ayuda",
] as const;

export function isSubscriptionSafeDashboardPath(pathname: string): boolean {
  return SUBSCRIPTION_SAFE_DASHBOARD_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}
