import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";

export const metadata: Metadata = { title: "Novedades" };

export default function UpdatesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Novedades"
        description="Cambios relevantes del producto, explicados sin ruido técnico."
      />
      <EmptyState
        icon={Sparkles}
        title="No hay novedades publicadas"
        description="Cuando haya una mejora disponible para tu espacio de trabajo, la vas a encontrar acá."
      />
    </div>
  );
}
