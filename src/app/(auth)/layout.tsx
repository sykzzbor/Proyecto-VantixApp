import Link from "next/link";
import { Bot, CalendarDays, MessageCircleMore, UsersRound } from "lucide-react";
import { VantixLogo } from "@/components/brand/vantix-logo";
import { ThemeSwitcher } from "@/components/theme/theme-switcher";

const PRODUCT_BENEFITS = [
  { label: "Atención inteligente con IA", icon: Bot },
  { label: "CRM y conversaciones en un lugar", icon: UsersRound },
  { label: "WhatsApp conectado a tu operación", icon: MessageCircleMore },
  { label: "Agenda integrada con Google Calendar", icon: CalendarDays },
] as const;

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-svh flex-1 bg-background text-foreground">
      <aside className="relative hidden w-[40%] max-w-[38rem] shrink-0 flex-col justify-between overflow-hidden border-r border-border bg-muted/35 p-10 lg:flex xl:p-14">
        <Link href="/" className="w-fit" aria-label="Ir al inicio de Vantix">
          <VantixLogo priority className="w-36 invert dark:invert-0" />
        </Link>
        <div className="max-w-md space-y-8">
          <div className="space-y-4">
            <div className="h-1 w-12 rounded-full bg-primary" aria-hidden />
            <p className="text-3xl font-semibold leading-tight tracking-[-0.045em] xl:text-4xl">
              Una operación conectada para atender mejor.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Vantix reúne las conversaciones, el conocimiento y las acciones de tu equipo en un espacio claro.
            </p>
          </div>
          <ul className="grid gap-3" aria-label="Funciones principales de Vantix">
            {PRODUCT_BENEFITS.map((benefit) => {
              const Icon = benefit.icon;
              return (
                <li
                  key={benefit.label}
                  className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/70 px-3.5 py-3 text-sm"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  {benefit.label}
                </li>
              );
            })}
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">VantixApp · Atención, gestión y automatización.</p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center border-b border-border/60 bg-background px-5 sm:px-8">
          <Link href="/" aria-label="Ir al inicio de Vantix" className="rounded-md lg:hidden">
            <VantixLogo priority className="w-24 invert dark:invert-0" />
          </Link>
          <div className="ml-auto"><ThemeSwitcher /></div>
        </header>
        <main className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-4 py-6 sm:items-center sm:px-8 sm:py-10">
          <div className="w-full max-w-[31rem]">{children}</div>
        </main>
      </div>
    </div>
  );
}
