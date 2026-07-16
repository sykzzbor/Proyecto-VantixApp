import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton } from "@/components/dashboard/table-skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <div className="grid overflow-hidden rounded-xl border border-border sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 border-b p-4 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0">
            <Skeleton className="size-9 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-10 w-full rounded-lg sm:w-64" />
      <Skeleton className="h-[460px] rounded-xl" />
    </div>
  );
}
