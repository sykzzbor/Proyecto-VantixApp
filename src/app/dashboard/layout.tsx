import { DashboardShell } from "@/components/dashboard/shell";
import { requireOrgContext } from "@/server/context";
import { getOrganizationEntitlement } from "@/server/billing/entitlement";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user, org, role } = await requireOrgContext();
  const entitlement = await getOrganizationEntitlement(org.id);

  return (
    <DashboardShell
      orgName={org.name}
      user={{ name: user.name, email: user.email, image: user.image }}
      role={role}
      entitlement={entitlement}
    >
      {children}
    </DashboardShell>
  );
}
