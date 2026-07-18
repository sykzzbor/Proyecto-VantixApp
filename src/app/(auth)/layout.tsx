import Link from "next/link";
import { VantixLogo } from "@/components/brand/vantix-logo";
import { ThemeSwitcher } from "@/components/theme/theme-switcher";

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-svh flex-1 bg-background">
      <aside className="relative hidden w-[34%] max-w-[31rem] shrink-0 flex-col justify-between overflow-hidden border-r border-sidebar-border bg-sidebar p-10 lg:flex xl:p-14">
        <Link href="/" className="w-fit" aria-label="Ir al inicio de Vantix">
          <VantixLogo priority className="w-36" />
        </Link>
        <div className="max-w-sm space-y-5">
          <div className="h-1 w-12 rounded-full bg-primary" aria-hidden />
          <p className="text-3xl font-semibold leading-tight tracking-[-0.045em] text-white xl:text-4xl">
            Tu operación, clara y bajo control.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Gestión, atención al cliente y automatización en un mismo espacio de trabajo.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">Diseñado para equipos que necesitan avanzar.</p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center border-b border-border/60 bg-card px-5 sm:px-8">
          <Link href="/" aria-label="Ir al inicio de Vantix" className="rounded-md bg-sidebar px-2.5 py-1.5 lg:hidden">
            <VantixLogo priority className="w-24" />
          </Link>
          <div className="ml-auto"><ThemeSwitcher /></div>
        </header>
        <main className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:px-6 sm:py-10">
          <div className="w-full max-w-md">{children}</div>
        </main>
      </div>
    </div>
  );
}
