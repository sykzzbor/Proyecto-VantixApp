import type { Metadata } from "next";
import { HelpCenter } from "@/components/ayuda/help-center";
import { PageHeader } from "@/components/dashboard/page-header";

export const metadata: Metadata = { title: "Centro de ayuda" };

export default function HelpPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Centro de ayuda"
        description="Guías rápidas para configurar y operar las funciones que ya están disponibles en VantixApp."
      />
      <HelpCenter />
    </div>
  );
}
