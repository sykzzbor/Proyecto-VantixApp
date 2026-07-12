import { z } from "zod";

const assignableRoleSchema = z.enum(["ADMIN", "AGENT", "VIEWER"], {
  error: "Elegí un rol válido.",
});

export const inviteMemberSchema = z.object({
  email: z.email("Ingresá un email válido."),
  role: assignableRoleSchema,
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const updateMemberRoleSchema = z.object({
  memberId: z.string().min(1),
  role: assignableRoleSchema,
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
