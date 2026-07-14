"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <Card className="mx-auto max-w-xl">
      <CardContent className="flex flex-col items-center py-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-destructive/10">
          <TriangleAlert className="size-6 text-destructive" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">No pudimos cargar las automatizaciones</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          La información operativa no está disponible en este momento. No se realizó ningún cambio.
        </p>
        <Button className="mt-5" onClick={reset}>Intentar nuevamente</Button>
      </CardContent>
    </Card>
  );
}
