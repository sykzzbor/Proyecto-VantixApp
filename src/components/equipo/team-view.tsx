"use client";

import { useState, useTransition } from "react";
import { Copy, MoreHorizontal, UserPlus } from "lucide-react";
import { toast } from "sonner";
import type { MemberRole } from "@/generated/prisma/enums";
import { ROLE_LABELS, assignableRoles } from "@/lib/permissions";
import {
  removeMember,
  revokeInvitation,
  updateMemberRole,
} from "@/server/actions/team";
import type { InvitationRow, MemberRow } from "@/server/queries";
import { ConfirmDeleteDialog } from "@/components/dashboard/confirm-delete-dialog";
import { InviteMemberDialog } from "@/components/equipo/invite-member-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type TeamViewProps = {
  members: MemberRow[];
  invitations: InvitationRow[];
  currentUserId: string;
  currentRole: MemberRole;
  canManage: boolean;
};

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function TeamView({
  members,
  invitations,
  currentUserId,
  currentRole,
  canManage,
}: TeamViewProps) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const [revoking, setRevoking] = useState<InvitationRow | null>(null);
  const [isPending, startTransition] = useTransition();

  const editableRoles = assignableRoles(currentRole);

  function canEditMember(member: MemberRow): boolean {
    return (
      canManage &&
      member.userId !== currentUserId &&
      member.role !== "OWNER" &&
      editableRoles.includes(member.role)
    );
  }

  function handleRoleChange(member: MemberRow, role: string) {
    startTransition(async () => {
      const result = await updateMemberRole({
        memberId: member.id,
        role: role as "ADMIN" | "AGENT" | "VIEWER",
      });
      if (result.ok) {
        toast.success(`Rol de ${member.name} actualizado.`);
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleRemove() {
    if (!removing) return;
    startTransition(async () => {
      const result = await removeMember(removing.id);
      if (result.ok) {
        toast.success(`${removing.name} fue eliminado del equipo.`);
        setRemoving(null);
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleRevoke() {
    if (!revoking) return;
    startTransition(async () => {
      const result = await revokeInvitation(revoking.id);
      if (result.ok) {
        toast.success("Invitación revocada.");
        setRevoking(null);
      } else {
        toast.error(result.error);
      }
    });
  }

  async function copyInvitationLink(invitation: InvitationRow) {
    const url = `${window.location.origin}/invitacion/${invitation.token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Enlace de invitación copiado.");
    } catch {
      toast.error("No se pudo copiar el enlace.");
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Miembros</CardTitle>
          <CardDescription>
            {members.length === 1
              ? "1 persona tiene acceso al panel."
              : `${members.length} personas tienen acceso al panel.`}
          </CardDescription>
          {canManage && (
            <CardAction>
              <Button onClick={() => setInviteOpen(true)}>
                <UserPlus className="size-4" />
                Invitar
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Miembro</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead className="hidden sm:table-cell">
                    Se unió
                  </TableHead>
                  {canManage && (
                    <TableHead className="w-12">
                      <span className="sr-only">Acciones</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const editable = canEditMember(member);
                  return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="size-8">
                            <AvatarFallback className="text-xs">
                              {initials(member.name) || "U"}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {member.name}
                              {member.userId === currentUserId && (
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                  (vos)
                                </span>
                              )}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {member.email}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {editable ? (
                          <Select
                            value={member.role}
                            disabled={isPending}
                            onValueChange={(value) =>
                              handleRoleChange(member, value)
                            }
                          >
                            <SelectTrigger
                              className="w-40"
                              aria-label={`Rol de ${member.name}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {editableRoles.map((role) => (
                                <SelectItem key={role} value={role}>
                                  {ROLE_LABELS[role]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="outline" className="font-normal">
                            {ROLE_LABELS[member.role]}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {member.joinedLabel}
                      </TableCell>
                      {canManage && (
                        <TableCell>
                          {editable && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Acciones para ${member.name}`}
                                >
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() => setRemoving(member)}
                                >
                                  Quitar del equipo
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invitaciones pendientes</CardTitle>
            <CardDescription>
              Compartí el enlace de invitación con la persona invitada. Todavía
              no hay envío de emails: el enlace se copia desde acá.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {invitations.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No hay invitaciones pendientes.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Rol</TableHead>
                      <TableHead className="hidden sm:table-cell">
                        Vence
                      </TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invitations.map((invitation) => (
                      <TableRow key={invitation.id}>
                        <TableCell className="font-medium">
                          {invitation.email}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-normal">
                            {ROLE_LABELS[invitation.role]}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {invitation.expired ? (
                            <span className="text-destructive">Vencida</span>
                          ) : (
                            <span className="text-muted-foreground">
                              {invitation.expiresLabel}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyInvitationLink(invitation)}
                            >
                              <Copy className="size-4" />
                              Copiar enlace
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setRevoking(invitation)}
                            >
                              Revocar
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        roles={editableRoles}
      />

      <ConfirmDeleteDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Quitar del equipo"
        description={
          removing
            ? `${removing.name} (${removing.email}) va a perder el acceso al panel. Podés volver a invitarlo más adelante.`
            : ""
        }
        confirmLabel="Quitar"
        pending={isPending}
        onConfirm={handleRemove}
      />

      <ConfirmDeleteDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revocar invitación"
        description={
          revoking
            ? `La invitación enviada a ${revoking.email} va a dejar de ser válida.`
            : ""
        }
        confirmLabel="Revocar"
        pending={isPending}
        onConfirm={handleRevoke}
      />
    </div>
  );
}
