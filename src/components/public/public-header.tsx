import Link from "next/link";
import { VantixLogo } from "@/components/brand/vantix-logo";
import { ThemeSwitcher } from "@/components/theme/theme-switcher";
import { Button } from "@/components/ui/button";

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/90 backdrop-blur-xl supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/login" aria-label="Ir a VantixApp" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <VantixLogo priority className="w-28 invert dark:invert-0" />
        </Link>
        <nav className="ml-auto flex items-center gap-1 sm:gap-2" aria-label="Navegación pública">
          <Button asChild variant="ghost" size="sm">
            <Link href="/privacidad">Privacidad</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/soporte">Soporte</Link>
          </Button>
          <ThemeSwitcher />
        </nav>
      </div>
    </header>
  );
}
