"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, CircleHelp, Menu, Sparkles } from "lucide-react";
import type { MemberRole } from "@/generated/prisma/enums";
import { NAV_ITEMS, isNavItemActive } from "@/lib/navigation";
import { ROLE_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { VantixLogo } from "@/components/brand/vantix-logo";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { UserMenu } from "@/components/dashboard/user-menu";

type DashboardShellProps = {
  orgName: string;
  user: { name: string; email: string };
  role: MemberRole;
  children: React.ReactNode;
};

function NavLinks({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Navegación principal">
      {NAV_ITEMS.map((item) => {
        const active = isNavItemActive(item, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-[color,background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--sidebar-primary)]"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function PendingLink({
  label,
  icon: Icon,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  return (
    <div
      className="flex min-h-9 items-center gap-3 rounded-lg px-3 text-[13px] text-muted-foreground/75"
      aria-label={`${label}. Próximamente`}
      title="Próximamente"
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="rounded border border-sidebar-border bg-black/15 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
        Pronto
      </span>
    </div>
  );
}

function SidebarFooter({
  orgName,
  user,
  role,
}: Pick<DashboardShellProps, "orgName" | "user" | "role">) {
  return (
    <div className="space-y-3 border-t border-sidebar-border bg-black/10 p-3">
      <div className="space-y-0.5" aria-label="Recursos">
        <PendingLink label="Centro de ayuda" icon={CircleHelp} />
        <PendingLink label="Novedades" icon={Sparkles} />
      </div>
      <div className="space-y-2 border-t border-sidebar-border pt-3">
        <p className="truncate px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {orgName}
        </p>
        <UserMenu
          name={user.name}
          email={user.email}
          roleLabel={ROLE_LABELS[role]}
          placement="sidebar"
        />
      </div>
    </div>
  );
}

export function DashboardShell({
  orgName,
  user,
  role,
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const currentItem = [...NAV_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => isNavItemActive(item, pathname));
  const showCurrentSection = currentItem?.href !== "/dashboard";

  return (
    <div className="flex min-h-svh w-full bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-16 items-center border-b border-sidebar-border bg-[#05060c] px-5">
          <Link href="/dashboard" aria-label="Ir al dashboard de Vantix">
            <VantixLogo priority className="w-[7.75rem]" />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <NavLinks pathname={pathname} />
        </div>
        <SidebarFooter orgName={orgName} user={user} role={role} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-border/80 bg-background/95 px-4 backdrop-blur-md md:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Abrir menú de navegación"
              >
                <Menu className="size-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-72 flex-col p-0">
              <SheetHeader className="border-b border-sidebar-border bg-[#05060c] px-5 py-4 text-left">
                <SheetTitle>
                  <VantixLogo className="w-28" />
                  <span className="sr-only">Vantix</span>
                </SheetTitle>
                <p className="truncate text-xs text-muted-foreground">{orgName}</p>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <NavLinks
                  pathname={pathname}
                  onNavigate={() => setMobileOpen(false)}
                />
              </div>
              <SidebarFooter orgName={orgName} user={user} role={role} />
            </SheetContent>
          </Sheet>

          <nav
            className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
            aria-label="Ruta de navegación"
          >
            <Link
              href="/dashboard"
              className="hidden transition-colors hover:text-foreground sm:inline"
            >
              VantixApp
            </Link>
            <ChevronRight className="hidden size-3.5 sm:block" aria-hidden />
            <Link
              href="/dashboard"
              className={cn(
                "shrink-0 transition-colors hover:text-foreground",
                !showCurrentSection && "font-medium text-foreground"
              )}
              aria-current={!showCurrentSection ? "page" : undefined}
            >
              Dashboard
            </Link>
            {showCurrentSection && (
              <>
                <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                <span
                  className="truncate font-medium text-foreground"
                  aria-current="page"
                >
                  {currentItem?.label ?? "Panel"}
                </span>
              </>
            )}
          </nav>

          <p className="ml-auto hidden max-w-48 truncate text-xs text-muted-foreground lg:block">
            {orgName}
          </p>
          <div className="ml-auto lg:hidden">
            <UserMenu name={user.name} email={user.email} />
          </div>
        </header>

        <main className="flex-1 bg-background p-4 sm:p-5 md:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
