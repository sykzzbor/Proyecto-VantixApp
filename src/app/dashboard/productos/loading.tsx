import {
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/components/dashboard/table-skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <TableSkeleton rows={6} />
    </div>
  );
}
