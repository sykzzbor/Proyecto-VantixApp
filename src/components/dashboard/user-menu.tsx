"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronUp,
  CreditCard,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Settings,
  Sun,
  UserRound,
} from "lucide-react";
import { useTheme } from "next-themes";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  image,
  roleLabel,
  placement = "header",
}: {
  name: string;
  email: string;
  image?: string | null;
  roleLabel?: string;
  placement?: "header" | "sidebar";
}) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const inSidebar = placement === "sidebar";

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  const avatar = (
    <Avatar className={cn("size-7", inSidebar && "size-9")}>
      {image && <AvatarImage src={image} alt={`Foto de ${name}`} />}
      <AvatarFallback className="border border-primary/20 bg-primary/10 text-xs font-semibold text-primary">
        {initials(name) || "U"}
      </AvatarFallback>
    </Avatar>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "gap-2 px-2",
            inSidebar &&
              "h-auto w-full justify-start rounded-xl border border-sidebar-border bg-sidebar-accent/45 px-2.5 py-2.5 text-left hover:bg-sidebar-accent"
          )}
          aria-label="Abrir menú de usuario"
        >
          {avatar}
          {inSidebar ? (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-sidebar-foreground">
                {name}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {email}
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
        side={inSidebar ? "top" : "bottom"}
        sideOffset={inSidebar ? 6 : 4}
        className="w-64"
      >
        <DropdownMenuLabel className="font-normal">
          <div className="flex items-center gap-2.5">
            {avatar}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{name}</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
              {roleLabel && (
                <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                  {roleLabel}
                </p>
              )}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/perfil">
            <UserRound className="size-4" />
            Ver perfil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/dashboard/configuracion">
            <Settings className="size-4" />
            Configuración
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette className="size-4" />
            Apariencia
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="light">
                <Sun className="size-4" />
                Claro
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <Moon className="size-4" />
                Oscuro
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <Monitor className="size-4" />
                Sistema
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem asChild>
          <Link href="/dashboard/planes">
            <CreditCard className="size-4" />
            Plan y facturación
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
