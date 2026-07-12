type PageHeaderProps = {
  title: string;
  description?: string;
  children?: React.ReactNode;
};

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-[-0.035em] text-foreground md:text-[1.75rem]">
          {title}
        </h2>
        {description && (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children && <div className="flex min-h-10 shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}
