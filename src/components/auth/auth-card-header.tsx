import {
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function AuthCardHeader({
  eyebrow,
  title,
  description,
  icon,
}: {
  eyebrow: string;
  title: string;
  description: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <CardHeader className="gap-0">
      {icon}
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8eacff]">
        {eyebrow}
      </p>
      <CardTitle className="mt-2 text-xl tracking-[-0.025em]">{title}</CardTitle>
      <CardDescription className="mt-1.5">{description}</CardDescription>
    </CardHeader>
  );
}
