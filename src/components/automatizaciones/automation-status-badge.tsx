import {
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock3,
  LoaderCircle,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_META = {
  PENDING: { label: "Pendiente", icon: Clock3, className: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  PROCESSING: { label: "Procesando", icon: LoaderCircle, className: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  SUCCEEDED: { label: "Exitosa", icon: CheckCircle2, className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  FAILED: { label: "Fallida", icon: XCircle, className: "border-destructive/25 bg-destructive/10 text-destructive" },
  DEAD_LETTER: { label: "Sin reintentos", icon: TriangleAlert, className: "border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300" },
  CANCELLED: { label: "Cancelada", icon: Ban, className: "border-border bg-muted text-muted-foreground" },
  STARTED: { label: "Iniciada", icon: CircleDashed, className: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300" },
} as const;

export function AutomationStatusBadge({ status }: { status: keyof typeof STATUS_META }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn("gap-1.5", meta.className)}>
      <Icon className={cn(status === "PROCESSING" && "animate-spin")} aria-hidden />
      {meta.label}
    </Badge>
  );
}
