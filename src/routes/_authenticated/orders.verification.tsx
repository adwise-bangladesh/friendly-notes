import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatMoney } from "@/lib/currency";
import { getVerificationQueue } from "@/lib/verification";
import { ORDER_SOURCE_LABELS } from "@/types/orders";
import type { OrderSource } from "@/types/orders";
import {
  VERIFICATION_MAX_ATTEMPTS,
  VERIFICATION_METHOD_LABELS,
  VERIFICATION_METHODS,
  VERIFICATION_PRIORITY_LABELS,
  VERIFICATION_PRIORITY_TONE,
  VERIFICATION_QUEUE_STATUSES,
  VERIFICATION_STATUS_LABELS,
  VERIFICATION_STATUS_TONE,
} from "@/types/verification";
import type { VerificationMethod, VerificationStatus } from "@/types/verification";

const TITLE = "Verification Queue · Commerce Operations";
const DESCRIPTION =
  "Call, confirm and reschedule Bangladesh orders waiting for customer verification.";

export const Route = createFileRoute("/_authenticated/orders/verification")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

const SOURCES: OrderSource[] = [
  "admin",
  "web",
  "mobile",
  "facebook",
  "whatsapp",
  "phone",
  "import",
  "api",
];

function Page() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<VerificationStatus | "all">("all");
  const [method, setMethod] = useState<VerificationMethod | "all">("all");
  const [source, setSource] = useState<OrderSource | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["verification-queue", search, status, method, source, from, to],
    queryFn: () =>
      getVerificationQueue({
        search,
        status,
        method,
        source,
        ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}),
        ...(to ? { to: new Date(`${to}T23:59:59`).toISOString() } : {}),
      }),
  });

  return (
    <>
      <PageHeader title="Verification queue" description={DESCRIPTION} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order number, customer or phone"
          className="h-8 w-64 text-[13px]"
          aria-label="Search verification queue"
        />
        <Select value={status} onValueChange={(v) => setStatus(v as VerificationStatus | "all")}>
          <SelectTrigger className="h-8 w-40 text-[13px]" aria-label="Verification status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Open queue</SelectItem>
            {VERIFICATION_QUEUE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {VERIFICATION_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={method} onValueChange={(v) => setMethod(v as VerificationMethod | "all")}>
          <SelectTrigger className="h-8 w-36 text-[13px]" aria-label="Verification method">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All methods</SelectItem>
            {VERIFICATION_METHODS.map((m) => (
              <SelectItem key={m} value={m}>
                {VERIFICATION_METHOD_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={(v) => setSource(v as OrderSource | "all")}>
          <SelectTrigger className="h-8 w-32 text-[13px]" aria-label="Order source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {SOURCES.map((s) => (
              <SelectItem key={s} value={s}>
                {ORDER_SOURCE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="h-8 w-36 text-[13px]"
          aria-label="From date"
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-8 w-36 text-[13px]"
          aria-label="To date"
        />
      </div>

      <div className="rounded border border-border">
        {isLoading ? (
          <LoadingState rows={6} label="Loading verification queue" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nothing waiting for verification"
            description="Confirmed, failed and cancelled orders are not shown here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-border bg-muted/50 text-[11.5px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Order</th>
                  <th className="px-3 py-2 text-left font-medium">Customer</th>
                  <th className="px-3 py-2 text-left font-medium">Phone</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 text-left font-medium">Source</th>
                  <th className="px-3 py-2 text-left font-medium">Verification</th>
                  <th className="px-3 py-2 text-right font-medium">Attempts</th>
                  <th className="px-3 py-2 text-left font-medium">Last attempt</th>
                  <th className="px-3 py-2 text-left font-medium">Next action</th>
                  <th className="px-3 py-2 text-left font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <Link
                        to="/orders/$id"
                        params={{ id: r.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.order_number}
                      </Link>
                      <div className="mt-0.5">
                        <StatusBadge tone={VERIFICATION_PRIORITY_TONE[r.verification_priority]}>
                          {VERIFICATION_PRIORITY_LABELS[r.verification_priority]}
                        </StatusBadge>
                      </div>
                    </td>
                    <td className="px-3 py-2">{r.customer_name}</td>
                    <td className="px-3 py-2 tabular-nums">{r.customer_phone}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(Number(r.grand_total))}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {ORDER_SOURCE_LABELS[r.source]}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={VERIFICATION_STATUS_TONE[r.verification_status]}>
                        {VERIFICATION_STATUS_LABELS[r.verification_status]}
                      </StatusBadge>
                      {r.risk_level !== "none" && (
                        <span className="ml-1 text-[11.5px] text-destructive">
                          risk: {r.risk_level}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.verification_attempt_count}/{VERIFICATION_MAX_ATTEMPTS}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.verification_last_attempt_at
                        ? new Date(r.verification_last_attempt_at).toLocaleString()
                        : "—"}
                      {r.last_method ? ` · ${VERIFICATION_METHOD_LABELS[r.last_method]}` : ""}
                    </td>
                    <td className="px-3 py-2">
                      {r.verification_next_action_at ? (
                        <span className="text-foreground">
                          Callback ·{" "}
                          {new Date(r.verification_next_action_at).toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
