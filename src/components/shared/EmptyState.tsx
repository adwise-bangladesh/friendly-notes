import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: LucideIcon | undefined;
  title: string;
  description?: string | undefined;
  action?: ReactNode | undefined;
  compact?: boolean | undefined;
}

export function EmptyState({ icon: Icon, title, description, action, compact }: EmptyStateProps) {
  return (
    <div
      className={
        compact
          ? "flex flex-col items-center justify-center px-4 py-6 text-center"
          : "flex flex-col items-center justify-center px-6 py-12 text-center"
      }
    >
      {Icon && (
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded border border-border bg-muted">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-[12.5px] text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
