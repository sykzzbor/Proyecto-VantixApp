import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton } from "@/components/dashboard/table-skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-[30rem] rounded-xl" />
      </div>
    </div>
  );
}
