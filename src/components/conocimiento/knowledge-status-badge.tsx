import { CircleCheckBig, Clock, EyeOff, Loader2, TriangleAlert } from "lucide-react";
import type { KnowledgeDocumentStatus } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<
  KnowledgeDocumentStatus,
  {
    label: string;
    className: string;
    icon: React.ComponentType<{ className?: string }>;
    spin?: boolean;
  }
> = {
  UPLOADED: {
    label: "En cola",
    className: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    icon: Clock,
  },
  PROCESSING: {
    label: "Procesando",
    className: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    icon: Loader2,
    spin: true,
  },
  READY: {
    label: "Listo",
    className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    icon: CircleCheckBig,
  },
  FAILED: {
    label: "Error",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    icon: TriangleAlert,
  },
  DISABLED: {
    label: "Desactivado",
    className: "bg-muted/50 text-muted-foreground",
    icon: EyeOff,
  },
};

export function KnowledgeStatusBadge({
  status,
}: {
  status: KnowledgeDocumentStatus;
}) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-medium", config.className)}
    >
      <Icon className={cn("size-3", config.spin && "animate-spin")} aria-hidden />
      {config.label}
    </Badge>
  );
}
