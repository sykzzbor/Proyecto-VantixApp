import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { TeamView } from "@/components/equipo/team-view";
import { can } from "@/lib/permissions";
import { requireOrgContext } from "@/server/context";
import { getPendingInvitations, getTeamMembers } from "@/server/queries";

export const metadata: Metadata = {
  title: "Equipo",
};

export default async function EquipoPage() {
  const { user, org, role } = await requireOrgContext();
  const canManage = can(role, "team.manage");

  const [members, invitations] = await Promise.all([
    getTeamMembers(org.id),
    canManage ? getPendingInvitations(org.id) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Equipo"
        description="Las personas que tienen acceso al panel de tu negocio y sus roles."
      />
      <TeamView
        members={members}
        invitations={invitations}
        currentUserId={user.id}
        currentRole={role}
        canManage={canManage}
      />
    </div>
  );
}
