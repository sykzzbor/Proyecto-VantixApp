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
    <Badge variant="outline" className="gap-1.5 font-normal">
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
