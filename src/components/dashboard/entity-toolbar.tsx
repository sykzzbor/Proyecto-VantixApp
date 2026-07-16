import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type EntityToolbarProps = {
  searchLabel: string;
  searchPlaceholder: string;
  defaultSearch: string;
  onSearchChange: (value: string) => void;
  summary?: string;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

/** Toolbar compacta compartida por listados administrativos. */
export function EntityToolbar({
  searchLabel,
  searchPlaceholder,
  defaultSearch,
  onSearchChange,
  summary,
  filters,
  actions,
  className,
}: EntityToolbarProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/80 bg-card/55 p-3 shadow-[0_16px_40px_-34px_rgba(0,0,0,0.9)]",
        className
      )}
    >
      <div className="grid gap-2 lg:flex lg:items-center">
        <div className="relative min-w-0 lg:w-72">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            placeholder={searchPlaceholder}
            className="pl-9"
            defaultValue={defaultSearch}
            onChange={(event) => onSearchChange(event.target.value)}
            aria-label={searchLabel}
          />
        </div>
        {filters && (
          <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap">
            {filters}
          </div>
        )}
        {actions && (
          <div className="grid gap-2 sm:grid-cols-2 lg:ml-auto lg:flex lg:items-center">
            {actions}
          </div>
        )}
      </div>
      {summary && (
        <p className="mt-2 px-1 text-xs text-muted-foreground" aria-live="polite">
          {summary}
        </p>
      )}
    </div>
  );
}
