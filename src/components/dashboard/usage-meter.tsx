import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

type UsageMeterBarProps = {
  label: string;
  used: number;
  limit: number;
  remaining: number;
  percent: number;
};

/** Barra de consumo del plan. El color avisa antes de llegar al tope. */
export function UsageMeterBar({
  label,
  used,
  limit,
  remaining,
  percent,
}: UsageMeterBarProps) {
  const tone =
    percent >= 100
      ? "bg-destructive"
      : percent >= 80
        ? "bg-amber-500"
        : "bg-primary";

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-sm font-medium tabular-nums">
          {formatNumber(used)}
          <span className="text-muted-foreground"> / {formatNumber(limit)}</span>
        </p>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn("h-full rounded-full transition-[width]", tone)}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {remaining > 0
          ? `Quedan ${formatNumber(remaining)}`
          : "Sin cupo disponible este mes"}
      </p>
    </div>
  );
}
