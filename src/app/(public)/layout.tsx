import { PublicFooter } from "@/components/public/public-footer";
import { PublicHeader } from "@/components/public/public-header";

export default function PublicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <PublicHeader />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}
