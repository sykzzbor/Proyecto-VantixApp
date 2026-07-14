"use client";

import { useState } from "react";
import { FlaskConical, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AutomationTestMode } from "@/lib/validations/automation";

const TEST_MODES: { value: AutomationTestMode; label: string; hint: string }[] = [
  { value: "success", label: "Ejecución exitosa", hint: "Completa el evento inmediatamente con el proveedor mock." },
  { value: "temporary_error", label: "Error temporal", hint: "Simula un fallo recuperable y programa un nuevo intento." },
  { value: "permanent_error", label: "Error permanente", hint: "Simula un fallo definitivo sin llamadas externas." },
  { value: "callback", label: "Espera de callback", hint: "Deja la ejecución iniciada para validar ese recorrido." },
];

export function TestEventDialog({
  onCreated,
}: {
  onCreated: (eventId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AutomationTestMode>("success");
  const [submitting, setSubmitting] = useState(false);
  const selected = TEST_MODES.find((option) => option.value === mode)!;

  async function submit() {
    setSubmitting(true);
    try {
      const response = await fetch("/api/automation/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mock: mode }),
      });
      const body = (await response.json()) as {
        eventId?: string;
        message?: string;
      };
      if (!response.ok || !body.eventId) {
        throw new Error(body.message ?? "No se pudo crear el evento de prueba.");
      }
      toast.success("Evento de prueba creado");
      setOpen(false);
      onCreated(body.eventId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear el evento.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <FlaskConical />
          Probar evento
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Probar infraestructura</DialogTitle>
          <DialogDescription>
            Genera un evento real de esta organización usando únicamente el proveedor mock.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="automation-test-mode">Resultado simulado</Label>
          <Select value={mode} onValueChange={(value) => setMode(value as AutomationTestMode)}>
            <SelectTrigger id="automation-test-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TEST_MODES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs leading-relaxed text-muted-foreground">{selected.hint}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? <LoaderCircle className="animate-spin" /> : <FlaskConical />}
            Ejecutar prueba
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
