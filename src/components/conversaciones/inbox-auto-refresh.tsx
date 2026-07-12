"use client";

import { useCallback, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const REFRESH_INTERVAL_MS = 5_000;

export function InboxAutoRefresh() {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && !isRefreshing) refresh();
    }, REFRESH_INTERVAL_MS);

    const refreshOnReturn = () => {
      if (document.visibilityState === "visible" && !isRefreshing) refresh();
    };
    document.addEventListener("visibilitychange", refreshOnReturn);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [isRefreshing, refresh]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={refresh}
      disabled={isRefreshing}
      title="La bandeja se actualiza automáticamente cada 5 segundos"
    >
      <RefreshCw
        className={cn("size-3.5", isRefreshing && "animate-spin")}
        aria-hidden
      />
      <span className="hidden sm:inline">
        {isRefreshing ? "Actualizando" : "Actualiza cada 5 s"}
      </span>
      <span className="sm:hidden">Actualizar</span>
    </Button>
  );
}
