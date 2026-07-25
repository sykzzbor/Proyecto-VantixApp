import Link from "next/link";
import { ArrowUpRight, Check, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type ChecklistItem = {
  label: string;
  description: string;
  count: number;
  href: string;
};

/**
 * Lista de recursos de un paso con su cantidad real.
 *
 * Los números salen de la base, así que el paso no se marca hecho por haber
 * entrado a la pantalla: hay que haber cargado algo.
 */
export function ResourceChecklist({ items }: { items: readonly ChecklistItem[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => {
        const loaded = item.count > 0;
        return (
          <Card
            key={item.label}
            className={cn(
              "transition-colors",
              loaded ? "border-primary/40 bg-primary/[0.03]" : undefined
            )}
          >
            <CardContent className="flex h-full flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                    {item.label}
                    {loaded && (
                      <span className="flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-2.5" aria-hidden />
                      </span>
                    )}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums",
                    loaded
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  )}
                  aria-label={`${item.count} cargados`}
                >
                  {item.count}
                </span>
              </div>
              <Link
                href={item.href}
                className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                {loaded ? (
                  <>
                    Administrar
                    <ArrowUpRight className="size-3" aria-hidden />
                  </>
                ) : (
                  <>
                    <Plus className="size-3" aria-hidden />
                    Agregar
                  </>
                )}
              </Link>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
