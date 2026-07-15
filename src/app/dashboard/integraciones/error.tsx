"use client";

import { CircleAlert, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function IntegrationsError({ reset }: { reset: () => void }) {
  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <CircleAlert className="size-5" aria-hidden />
          </span>
          <div className="space-y-1">
            <CardTitle>No pudimos cargar las integraciones</CardTitle>
            <CardDescription>
              La configuración no fue modificada. Podés volver a intentar de
              forma segura.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="outline" onClick={reset}>
          <RefreshCcw aria-hidden />
          Reintentar
        </Button>
      </CardContent>
    </Card>
  );
}
