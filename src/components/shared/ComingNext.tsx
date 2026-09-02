import { Construction } from "lucide-react";
import { EmptyState } from "./EmptyState";

export function ComingNext({ module, note }: { module: string; note?: string }) {
  return (
    <div className="rounded-md border border-border bg-card">
      <EmptyState
        icon={Construction}
        title={`${module} — coming next`}
        description={
          note ??
          "This module is not built yet. The foundation, navigation and access control are ready; data and workflows arrive in a later step."
        }
      />
    </div>
  );
}
