"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BriefcaseBusiness,
  FileText,
  MessageCircleQuestion,
  Package,
  Store,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { cn } from "@/lib/utils";

const KNOWLEDGE_SECTIONS = [
  {
    href: "/dashboard/conocimiento",
    label: "Documentos",
    icon: FileText,
  },
  { href: "/dashboard/negocio", label: "Negocio", icon: Store },
  { href: "/dashboard/productos", label: "Productos", icon: Package },
  {
    href: "/dashboard/servicios",
    label: "Servicios",
    icon: BriefcaseBusiness,
  },
  {
    href: "/dashboard/preguntas",
    label: "Preguntas frecuentes",
    icon: MessageCircleQuestion,
  },
] as const;

type KnowledgeModuleHeaderProps = {
  title: string;
  description: string;
};

export function KnowledgeModuleHeader({
  title,
  description,
}: KnowledgeModuleHeaderProps) {
  const pathname = usePathname();

  return (
    <div className="space-y-4">
      <PageHeader title={title} description={description} />
      <nav
        aria-label="Secciones de conocimiento"
        className="sticky top-0 z-10 -mx-1 overflow-x-auto border-y border-border/80 bg-background/95 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/85"
      >
        <div className="flex min-w-max gap-1">
          {KNOWLEDGE_SECTIONS.map((section) => {
            const Icon = section.icon;
            const active = pathname === section.href;

            return (
              <Link
                key={section.href}
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="size-4" aria-hidden />
                {section.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
