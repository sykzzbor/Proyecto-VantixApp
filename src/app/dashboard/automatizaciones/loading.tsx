import { PageHeader } from "@/components/dashboard/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Automatizaciones"
        description="Supervisá eventos, ejecuciones y el estado operativo de la infraestructura de tu organización."
      />
      <div className="flex justify-between gap-3">
        <Skeleton className="h-9 w-52" />
        <Skeleton className="h-9 w-56" />
      </div>
      <Skeleton className="h-48 rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}
