import { Skeleton } from "@/components/ui/skeleton";

type TableSkeletonProps = {
  rows?: number;
  withToolbar?: boolean;
};

export function TableSkeleton({
  rows = 6,
  withToolbar = true,
}: TableSkeletonProps) {
  return (
    <div className="space-y-4">
      {withToolbar && (
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-full max-w-64" />
          <Skeleton className="h-9 w-36" />
          <Skeleton className="ml-auto h-9 w-32" />
        </div>
      )}
      <div className="grid gap-3 xl:hidden">
        {Array.from({ length: Math.min(rows, 4) }).map((_, index) => (
          <div key={index} className="space-y-4 rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </div>
              <Skeleton className="size-9 rounded-lg" />
            </div>
            <div className="grid grid-cols-2 gap-3 border-t pt-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden rounded-xl border border-border bg-card xl:block">
        <div className="border-b px-4 py-3">
          <Skeleton className="h-4 w-2/3 max-w-md" />
        </div>
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className="flex items-center gap-4 border-b px-4 py-4 last:border-b-0"
          >
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="hidden h-4 w-24 sm:block" />
            <Skeleton className="hidden h-4 w-16 md:block" />
            <Skeleton className="ml-auto h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PageHeaderSkeleton() {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="h-9 w-36" />
    </div>
  );
}
