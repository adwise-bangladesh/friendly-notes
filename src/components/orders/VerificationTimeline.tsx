import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  ATTEMPT_OUTCOME_LABELS,
  ATTEMPT_OUTCOME_TONE,
  VERIFICATION_EVENT_LABELS,
  VERIFICATION_METHOD_LABELS,
  VERIFICATION_STATUS_LABELS,
  VERIFICATION_STATUS_TONE,
} from "@/types/verification";
import type { VerificationAttempt, VerificationEvent } from "@/types/verification";

interface Props {
  createdAt: string;
  attempts: VerificationAttempt[];
  events: (VerificationEvent & { author: { id: string; full_name: string | null } | null })[];
}

/**
 * One chronological operations trail. Events carry the narrative; the matching
 * attempt row adds the contact detail so nothing is repeated twice.
 */
export function VerificationTimeline({ createdAt, attempts, events }: Props) {
  const byId = new Map(attempts.map((a) => [a.id, a]));

  return (
    <ol className="relative space-y-0 border-l border-border pl-4">
      <li className="relative py-2">
        <Dot />
        <p className="text-[13px] font-medium text-foreground">Order created</p>
        <p className="text-[11.5px] text-muted-foreground">
          {new Date(createdAt).toLocaleString()}
        </p>
      </li>

      {events.length === 0 && (
        <li className="relative py-2">
          <Dot />
          <p className="text-[13px] text-muted-foreground">
            No verification activity recorded yet.
          </p>
        </li>
      )}

      {events.map((e) => {
        const attempt = e.attempt_id ? byId.get(e.attempt_id) : undefined;
        return (
          <li key={e.id} className="relative py-2">
            <Dot />
            <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
              <StatusBadge tone={e.to_status ? VERIFICATION_STATUS_TONE[e.to_status] : "neutral"}>
                {VERIFICATION_EVENT_LABELS[e.event_type]}
              </StatusBadge>
              {e.from_status && e.to_status && e.from_status !== e.to_status && (
                <span className="text-[11.5px] text-muted-foreground">
                  {VERIFICATION_STATUS_LABELS[e.from_status]} →{" "}
                  {VERIFICATION_STATUS_LABELS[e.to_status]}
                </span>
              )}
              {attempt && (
                <StatusBadge tone={ATTEMPT_OUTCOME_TONE[attempt.outcome]}>
                  Attempt {attempt.attempt_number} · {ATTEMPT_OUTCOME_LABELS[attempt.outcome]}
                </StatusBadge>
              )}
            </div>
            <p className="text-[13px] text-foreground">{e.message}</p>
            {attempt && (
              <p className="text-[11.5px] text-muted-foreground">
                {VERIFICATION_METHOD_LABELS[attempt.method]}
                {attempt.duration_seconds !== null ? ` · ${attempt.duration_seconds}s` : ""}
                {attempt.notes ? ` · ${attempt.notes}` : ""}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              {new Date(e.created_at).toLocaleString()}
              {e.author?.full_name ? ` · ${e.author.full_name}` : ""}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function Dot() {
  return (
    <span className="absolute -left-[21px] top-3 h-2 w-2 rounded-full border border-border bg-background" />
  );
}
