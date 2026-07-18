import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ActiveBadgeProps = {
  active: boolean;
  activeLabel?: string;
  inactiveLabel?: string;
};

export function ActiveBadge({
  active,
  activeLabel = "Activo",
  inactiveLabel = "Inactivo",
}: ActiveBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-medium",
        active
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "bg-muted/50 text-muted-foreground"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          active ? "bg-emerald-500" : "bg-muted-foreground/40"
        )}
      />
      {active ? activeLabel : inactiveLabel}
    </Badge>
  );
}
