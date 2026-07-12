import Image from "next/image";
import { cn } from "@/lib/utils";

type VantixLogoProps = {
  className?: string;
  priority?: boolean;
};

export function VantixLogo({ className, priority = false }: VantixLogoProps) {
  return (
    <Image
      src="/brand/vantix-wordmark-dark.png"
      alt="Vantix"
      width={496}
      height={128}
      preload={priority}
      className={cn("h-auto w-28 object-contain", className)}
    />
  );
}
