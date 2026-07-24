import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton } from "@/components/dashboard/table-skeleton";

export default function Loading() {
  return (
    <div className="space-y-7">
      <PageHeaderSkeleton />
      {/* Barra de período */}
      <Skeleton className="h-20 rounded-xl" />
      {/* Indicadores del período */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-24 rounded-xl" />
      {/* Plan, integraciones y agenda */}
      <div className="grid gap-5 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-64 rounded-xl" />
        ))}
      </div>
      {/* Pedidos y actividad */}
      <div className="grid gap-5 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <Skeleton key={index} className="h-56 rounded-xl" />
        ))}
      </div>
      {/* Accesos rápidos */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-9 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
