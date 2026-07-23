import Link from "next/link";

export const SUPPORT_EMAIL = "vantixdigitalweb@gmail.com";
export const SUPPORT_PHONE = "+54 9 3525 61-7652";
export const SUPPORT_WHATSAPP_URL = "https://wa.me/5493525617652";

export function PublicFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer className="border-t border-border/70 bg-muted/20">
      <div className={`mx-auto flex w-full items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:px-6 ${compact ? "max-w-3xl py-4" : "max-w-6xl py-6 lg:px-8"}`}>
        <p className="hidden sm:block">© 2026 VantixApp</p>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Información legal y soporte">
          <Link className="underline-offset-4 hover:text-foreground hover:underline" href="/privacidad">Privacidad</Link>
          <Link className="underline-offset-4 hover:text-foreground hover:underline" href="/soporte">Soporte</Link>
          {!compact && (
            <a
              className="underline-offset-4 hover:text-foreground hover:underline"
              href={SUPPORT_WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp
            </a>
          )}
        </nav>
      </div>
    </footer>
  );
}
