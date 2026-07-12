"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import type { MemberRole } from "@/generated/prisma/enums";
import { NAV_ITEMS, isNavItemActive } from "@/lib/navigation";
import { ROLE_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
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
    <nav className="flex flex-col gap-1.5" aria-label="Navegación principal">
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
              "relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-[color,background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--sidebar-primary)]"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            )}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
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

  return (
    <div className="flex min-h-svh w-full bg-background">
      {/* Sidebar de escritorio */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-16 items-center border-b border-sidebar-border px-5">
          <Link
            href="/dashboard"
            className="text-[1.05rem] font-semibold tracking-[-0.03em] text-sidebar-foreground transition-colors hover:text-white"
          >
            Vantix<span className="text-primary">App</span>
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto p-3.5">
          <NavLinks pathname={pathname} />
        </div>
        <div className="border-t border-sidebar-border bg-black/10 p-4">
          <p className="truncate text-sm font-semibold text-sidebar-foreground">{orgName}</p>
          <Badge variant="outline" className="mt-2 border-primary/20 bg-primary/10 text-[#9cb7ff]">
            {ROLE_LABELS[role]}
          </Badge>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-border/80 bg-background/92 px-4 backdrop-blur-md md:px-6">
          {/* Menú móvil */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Abrir menú de navegación"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetHeader className="border-b border-sidebar-border px-5 py-4 text-left">
                <SheetTitle className="text-base font-semibold tracking-tight">
                  Vantix<span className="text-primary">App</span>
                </SheetTitle>
                <p className="truncate text-sm text-muted-foreground">
                  {orgName}
                </p>
              </SheetHeader>
              <div className="p-3.5">
                <NavLinks
                  pathname={pathname}
                  onNavigate={() => setMobileOpen(false)}
                />
              </div>
            </SheetContent>
          </Sheet>

          <h1 className="truncate text-sm font-semibold tracking-tight text-foreground md:text-base">
            {currentItem?.label ?? "Panel"}
          </h1>

          <div className="ml-auto">
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
