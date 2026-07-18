"use client";

import { useEffect, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const THEMES = [
  {
    value: "light",
    label: "Claro",
    description: "Superficies luminosas y contraste suave.",
    icon: Sun,
  },
  {
    value: "dark",
    label: "Oscuro",
    description: "Menos brillo para trabajar de noche.",
    icon: Moon,
  },
  {
    value: "system",
    label: "Sistema",
    description: "Sigue automáticamente la preferencia del dispositivo.",
    icon: Monitor,
  },
] as const;

function useMounted() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return mounted;
}

export function ThemeSwitcher() {
  const mounted = useMounted();
  const { theme, resolvedTheme, setTheme } = useTheme();

  if (!mounted) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled
        aria-label="Cargando selector de tema"
      >
        <Monitor className="size-4" aria-hidden />
      </Button>
    );
  }

  const ActiveIcon = resolvedTheme === "dark" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Cambiar apariencia"
          title="Apariencia"
        >
          <ActiveIcon className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Apariencia</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          {THEMES.map((option) => {
            const Icon = option.icon;
            return (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                className="gap-2.5 px-2 py-2"
              >
                <Icon className="size-4 text-muted-foreground" aria-hidden />
                {option.label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThemeSettings() {
  const mounted = useMounted();
  const { theme, setTheme } = useTheme();

  return (
    <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Tema de la aplicación">
      {THEMES.map((option) => {
        const Icon = option.icon;
        const selected = mounted && theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={!mounted}
            onClick={() => setTheme(option.value)}
            className={cn(
              "group relative min-h-36 rounded-xl border bg-card p-4 text-left transition-[border-color,background-color,box-shadow,transform] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/25 disabled:opacity-60",
              selected
                ? "border-primary/60 bg-primary/[0.055] shadow-[0_12px_30px_-24px_var(--primary)]"
                : "border-border hover:-translate-y-0.5 hover:border-primary/30 hover:bg-accent/35"
            )}
          >
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-lg border",
                selected
                  ? "border-primary/25 bg-primary/12 text-primary"
                  : "border-border bg-muted text-muted-foreground"
              )}
            >
              <Icon className="size-4.5" aria-hidden />
            </span>
            <span className="mt-4 block text-sm font-semibold text-foreground">
              {option.label}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {option.description}
            </span>
            {selected && (
              <span className="absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="size-3" aria-hidden />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
