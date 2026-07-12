import Link from "next/link";

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-svh flex-1 flex-col bg-muted/40">
      <header className="px-6 py-5">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight text-foreground"
        >
          Vantix
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-8 pb-16 sm:items-center sm:pt-4">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
