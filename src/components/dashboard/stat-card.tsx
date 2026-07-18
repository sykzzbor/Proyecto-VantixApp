import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

type StatCardProps = {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
};

export function StatCard({ icon: Icon, label, value, hint }: StatCardProps) {
  return (
    <Card className="relative transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-primary/30">
      <span className="absolute inset-y-5 left-0 w-0.5 rounded-r-full bg-primary/70" aria-hidden />
      <CardContent className="flex items-start justify-between gap-3 pl-6">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground">{label}</p>
          <p className="text-3xl font-semibold tracking-[-0.04em] tabular-nums">{value}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10">
          <Icon className="size-4.5 text-primary" aria-hidden />
        </div>
      </CardContent>
    </Card>
  );
}
