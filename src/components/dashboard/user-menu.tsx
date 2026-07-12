"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronUp, LogOut, Settings } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function UserMenu({
  name,
  email,
  roleLabel,
  placement = "header",
}: {
  name: string;
  email: string;
  roleLabel?: string;
  placement?: "header" | "sidebar";
}) {
  const router = useRouter();
  const inSidebar = placement === "sidebar";

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "gap-2 px-2",
            inSidebar &&
              "h-auto w-full justify-start rounded-lg border border-sidebar-border bg-sidebar-accent/35 px-2.5 py-2 text-left hover:bg-sidebar-accent"
          )}
          aria-label="Abrir menú de usuario"
        >
          <Avatar className={cn("size-7", inSidebar && "size-8")}>
            <AvatarFallback className="border border-primary/20 bg-primary/10 text-xs font-semibold text-[#9cb7ff]">
              {initials(name) || "U"}
            </AvatarFallback>
          </Avatar>
          {inSidebar ? (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-sidebar-foreground">
                {name}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {roleLabel ?? email}
              </span>
            </span>
          ) : (
            <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">
              {name}
            </span>
          )}
          {inSidebar && (
            <ChevronUp
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={inSidebar ? "start" : "end"}
        side={inSidebar ? "right" : "bottom"}
        sideOffset={inSidebar ? 8 : 4}
        className="w-60"
      >
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/configuracion">
            <Settings className="size-4" />
            Configuración
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={handleSignOut}>
          <LogOut className="size-4" />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
