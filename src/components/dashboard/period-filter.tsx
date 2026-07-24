"use client";

import { useTableFilters } from "@/components/dashboard/use-table-filters";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const PERIOD_OPTIONS = [
  { value: "hoy", label: "Hoy" },
  { value: "7d", label: "Últimos 7 días" },
  { value: "30d", label: "Últimos 30 días" },
  { value: "mes", label: "Este mes" },
  { value: "custom", label: "Rango personalizado" },
];

/**
 * Selector de período compartido por el panel y las métricas: escribe en la URL
 * para que el filtrado ocurra en el servidor y el enlace sea compartible.
 */
export function PeriodFilter({
  period,
  from,
  to,
  idPrefix,
}: {
  period: string;
  from: string;
  to: string;
  idPrefix: string;
}) {
  const { setParam } = useTableFilters();

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select
        value={period || "7d"}
        onValueChange={(value) =>
          setParam("periodo", value === "7d" ? null : value)
        }
      >
        <SelectTrigger className="w-full sm:w-52" aria-label="Período">
          <SelectValue placeholder="Período" />
        </SelectTrigger>
        <SelectContent>
          {PERIOD_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {period === "custom" && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-from`} className="text-xs">
              Desde
            </Label>
            <Input
              id={`${idPrefix}-from`}
              type="date"
              className="w-40"
              value={from}
              onChange={(event) => setParam("desde", event.target.value || null)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-to`} className="text-xs">
              Hasta
            </Label>
            <Input
              id={`${idPrefix}-to`}
              type="date"
              className="w-40"
              value={to}
              onChange={(event) => setParam("hasta", event.target.value || null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
