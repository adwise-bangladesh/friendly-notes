import type { ReactNode } from "react";

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border pb-4 last:border-0 last:pb-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {description && (
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">{description}</p>
      )}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}
