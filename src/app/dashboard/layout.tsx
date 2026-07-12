import { DashboardShell } from "@/components/dashboard/shell";
import { requireOrgContext } from "@/server/context";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user, org, role } = await requireOrgContext();

  return (
    <DashboardShell
      orgName={org.name}
      user={{ name: user.name, email: user.email }}
      role={role}
    >
      {children}
    </DashboardShell>
  );
}
