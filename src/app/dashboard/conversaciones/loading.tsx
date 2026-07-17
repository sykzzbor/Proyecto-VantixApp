import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex h-[calc(100dvh-6rem)] min-h-0 overflow-hidden rounded-xl border border-border/90 bg-card md:h-[calc(100svh-7rem)] md:min-h-[34rem] lg:h-[calc(100svh-8rem)]">
        <div className="flex w-full flex-col gap-3 border-r p-3 md:w-80">
          <div className="flex items-center justify-between gap-3 py-1">
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-9 w-24" />
          </div>
          <Skeleton className="h-9 w-full" />
          <div className="flex gap-2">
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 flex-1" />
          </div>
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
        <div className="hidden flex-1 flex-col p-4 md:flex">
          <Skeleton className="h-10 w-full" />
          <div className="flex flex-1 flex-col justify-end gap-3 py-4">
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="ml-auto h-12 w-2/3" />
            <Skeleton className="h-12 w-1/2" />
          </div>
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="hidden w-60 flex-col gap-3 border-l p-4 xl:flex 2xl:w-64">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
    </div>
  );
}
