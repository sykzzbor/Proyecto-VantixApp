import { LockKeyhole } from "lucide-react";
import { cn } from "@/lib/utils";

export function ReadOnlyNotice({
  message = "Tu rol permite consultar esta información, pero no modificarla.",
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-border/80 bg-muted/35 px-3.5 py-3 text-sm text-muted-foreground",
        className
      )}
      role="status"
    >
      <LockKeyhole className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <p>{message}</p>
    </div>
  );
}
