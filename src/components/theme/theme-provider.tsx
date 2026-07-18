"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { usePathname } from "next/navigation";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      enableColorScheme
      disableTransitionOnChange
      storageKey="vantix-theme"
      forcedTheme={pathname === "/" ? "dark" : undefined}
    >
      {children}
    </NextThemesProvider>
  );
}
