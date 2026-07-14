import { PageHeader } from "@/components/dashboard/page-header";
import { TableSkeleton } from "@/components/dashboard/table-skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Centro de conocimiento"
        description="Subí documentos para que el agente responda con información confirmada de tu negocio. Procesamos PDF con texto, DOCX y TXT."
      />
      <TableSkeleton rows={5} />
    </div>
  );
}
