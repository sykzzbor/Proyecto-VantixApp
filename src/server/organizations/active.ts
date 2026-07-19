export type MembershipChoice<T> = T & {
  organizationId: string;
  createdAt: Date;
};

export function selectActiveMembership<T>(
  memberships: Array<MembershipChoice<T>>,
  selectedOrganizationId: string | null
): MembershipChoice<T> | null {
  if (memberships.length === 0) return null;
  if (selectedOrganizationId) {
    const selected = memberships.find(
      (membership) => membership.organizationId === selectedOrganizationId
    );
    if (selected) return selected;
  }
  return [...memberships].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
  )[0] ?? null;
}
