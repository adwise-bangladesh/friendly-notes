import { Link } from "@tanstack/react-router";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { AI_SEVERITY_LABELS, AI_SEVERITY_TONE, type SystemSignal } from "@/types/ai";

/**
 * Deterministic signals from the authoritative attention feed.
 * Always labelled "System Analysis" so operators can tell rule-based output
 * apart from AI-generated observations.
 */
export function SystemAnalysisPanel({
  signals,
  isLoading,
}: {
  signals: SystemSignal[];
  isLoading?: boolean;
}) {
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading system analysis…</p>;
  if (signals.length === 0) {
    return <EmptyState title="Nothing needs attention" description="No operational signals right now." compact />;
  }

  return (
    <div className="space-y-1.5">
      {signals.map((signal) => (
        <Link
          key={signal.id}
          to={signal.href}
          className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2 transition-colors hover:bg-accent/50"
        >
          <div className="flex items-center gap-2">
            <StatusBadge tone={AI_SEVERITY_TONE[signal.severity]}>
              {AI_SEVERITY_LABELS[signal.severity]}
            </StatusBadge>
            <span className="text-[13px] font-medium">{signal.label}</span>
          </div>
          <span className="text-[12px] text-muted-foreground">{signal.detail}</span>
        </Link>
      ))}
    </div>
  );
}
