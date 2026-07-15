import { Skeleton } from "@/components/ui/skeleton";

export default function IntegrationsLoading() {
  return (
    <div className="space-y-6" aria-label="Cargando integraciones">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-5 w-full max-w-xl" />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        {[0, 1].map((item) => (
          <Skeleton key={item} className="h-[32rem] w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
