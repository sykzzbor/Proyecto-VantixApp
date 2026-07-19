import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquareText, UserRound, UsersRound } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { requireOrgContext } from "@/server/context";

export const metadata: Metadata = { title: "Clientes" };
export const dynamic = "force-dynamic";

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "C";
}

export default async function CustomersPage() {
  const { org } = await requireOrgContext();
  const customers = await prisma.customer.findMany({
    where: { organizationId: org.id },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      updatedAt: true,
      _count: { select: { conversations: true, appointments: true } },
      conversations: {
        orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        take: 1,
        select: { id: true, status: true },
      },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes"
        description="Contactos vinculados a conversaciones y turnos de esta organización."
      />

      {customers.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="Todavía no hay clientes"
          description="Los contactos se crean al vincular sus datos desde una conversación."
        >
          <Button asChild size="sm">
            <Link href="/dashboard/conversaciones">Abrir conversaciones</Link>
          </Button>
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {customers.map((customer) => {
              const conversation = customer.conversations[0];
              return (
                <article key={customer.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start gap-3">
                    <Avatar className="size-10">
                      <AvatarFallback className="bg-primary/10 font-semibold text-primary">
                        {initial(customer.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{customer.name}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {customer.phone ?? customer.email ?? "Sin datos de contacto"}
                      </p>
                    </div>
                    <Badge variant="secondary">{customer._count.conversations} chats</Badge>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/70 pt-3">
                    <span className="text-xs text-muted-foreground">
                      {customer._count.appointments} turnos · {formatDateTime(customer.updatedAt)}
                    </span>
                    {conversation && (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/dashboard/conversaciones?conversacion=${conversation.id}`}>
                          Abrir chat
                        </Link>
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Contacto</TableHead>
                  <TableHead>Actividad</TableHead>
                  <TableHead>Turnos</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) => {
                  const conversation = customer.conversations[0];
                  return (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="size-8">
                            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                              {initial(customer.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{customer.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm">{customer.phone ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{customer.email ?? "Sin email"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm">{customer._count.conversations} conversaciones</p>
                        <p className="text-xs text-muted-foreground">{formatDateTime(customer.updatedAt)}</p>
                      </TableCell>
                      <TableCell>{customer._count.appointments}</TableCell>
                      <TableCell className="text-right">
                        {conversation ? (
                          <Button asChild size="sm" variant="ghost">
                            <Link href={`/dashboard/conversaciones?conversacion=${conversation.id}`}>
                              <MessageSquareText className="size-4" aria-hidden />
                              Abrir chat
                            </Link>
                          </Button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <UserRound className="size-3.5" aria-hidden />
                            Sin conversación
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
