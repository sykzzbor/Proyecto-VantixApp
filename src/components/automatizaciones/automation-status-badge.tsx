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
  PENDING: { label: "Pendiente", icon: Clock3, className: "border-amber-400/20 bg-amber-400/10 text-amber-300" },
  PROCESSING: { label: "Procesando", icon: LoaderCircle, className: "border-blue-400/20 bg-blue-400/10 text-blue-300" },
  SUCCEEDED: { label: "Exitosa", icon: CheckCircle2, className: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" },
  FAILED: { label: "Fallida", icon: XCircle, className: "border-red-400/20 bg-red-400/10 text-red-300" },
  DEAD_LETTER: { label: "Sin reintentos", icon: TriangleAlert, className: "border-orange-400/20 bg-orange-400/10 text-orange-300" },
  CANCELLED: { label: "Cancelada", icon: Ban, className: "border-slate-400/20 bg-slate-400/10 text-slate-300" },
  STARTED: { label: "Iniciada", icon: CircleDashed, className: "border-blue-400/20 bg-blue-400/10 text-blue-300" },
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
