"use client";

import { CircleAlert, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <div className="flex min-h-[28rem] items-center justify-center rounded-xl border border-dashed border-border bg-card/45 px-5 py-12 text-center">
      <div className="max-w-md">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl border border-destructive/25 bg-destructive/10">
          <CircleAlert className="size-6 text-destructive" aria-hidden />
        </div>
        <h2 className="mt-4 text-lg font-semibold tracking-tight">
          No pudimos cargar esta sección
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Tus datos no se modificaron. Reintentá la carga y, si el problema
          continúa, volvé al panel más tarde.
        </p>
        <Button type="button" variant="outline" className="mt-5" onClick={reset}>
          <RotateCw className="size-4" aria-hidden />
          Reintentar
        </Button>
      </div>
    </div>
  );
}
