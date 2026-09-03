import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { SettlementDiscrepancies } from "@/components/finance/SettlementDiscrepancies";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatMoney } from "@/lib/currency";
import { useCommercePermissions } from "@/hooks/use-permissions";
import {
  createCourierSettlement,
  getCourierAccountOptions,
  getCourierSettlements,
} from "@/lib/finance";
import {
  SETTLEMENT_STATUSES,
  SETTLEMENT_STATUS_LABELS,
  SETTLEMENT_STATUS_TONE,
} from "@/types/finance";
import type { SettlementStatus } from "@/types/finance";

const TITLE = "Courier Settlements · Commerce Operations";
const DESCRIPTION =
  "Courier payouts reconciled against what was collected and what the courier charged.";

export const Route = createFileRoute("/_authenticated/finance/courier-settlements")({
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

function Page() {
  const { canManage } = useCommercePermissions();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<SettlementStatus | "all">("all");
  const [accountId, setAccountId] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);

  const { data: accounts = [] } = useQuery({
    queryKey: ["courier-account-options"],
    queryFn: getCourierAccountOptions,
  });
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["courier-settlements", search, status, accountId],
    queryFn: () => getCourierSettlements({ search, status, accountId }),
  });

  return (
    <>
      <PageHeader
        title="Courier settlements"
        description="A payout may cover many orders and shipments. Amounts here are what the courier actually paid."
        actions={
          canManage && (
            <Button size="sm" className="h-8" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> New settlement
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          className="h-9 w-64"
          placeholder="Settlement reference"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {SETTLEMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {SETTLEMENT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="h-9 w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All courier accounts</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Banknote}
          title="No settlements"
          description="Create a settlement when a courier pays out, then attach the shipments it covers."
        />
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Reference</th>
                <th className="px-3 py-2 font-medium">Courier</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 text-right font-medium">Lines</th>
                <th className="px-3 py-2 text-right font-medium">Expected</th>
                <th className="px-3 py-2 text-right font-medium">Actual</th>
                <th className="px-3 py-2 text-right font-medium">Difference</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => {
                const actual = row.actual_amount === null ? null : Number(row.actual_amount);
                const diff = actual === null ? null : actual - Number(row.expected_amount);
                return (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Link
                        to="/finance/courier-settlements/$id"
                        params={{ id: row.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {row.settlement_reference}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {row.provider_name ?? "—"}
                      <div className="text-[11.5px] text-muted-foreground">
                        {row.account?.name ?? "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.settlement_date ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.item_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(Number(row.expected_amount))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {actual === null ? "—" : formatMoney(actual)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {diff === null ? "—" : formatMoney(diff)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={SETTLEMENT_STATUS_TONE[row.status]}>
                        {SETTLEMENT_STATUS_LABELS[row.status]}
                      </StatusBadge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-[15px] font-semibold">Settlement discrepancies</h2>
        <p className="mb-3 text-[12.5px] text-muted-foreground">
          Raised automatically when a courier settles a different amount than the shipment
          collected. Resolve each one so order profit reflects real money.
        </p>
        <SettlementDiscrepancies canManage={canManage} />
      </section>



      <CreateSettlementDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        accounts={accounts}
      />
    </>
  );
}

function CreateSettlementDialog({
  open,
  onOpenChange,
  accounts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: { id: string; name: string }[];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      createCourierSettlement({
        courierAccountId: accountId,
        reference: reference.trim(),
        settlementDate: date || null,
      }),
    onSuccess: (row) => {
      void queryClient.invalidateQueries({ queryKey: ["courier-settlements"] });
      toast.success("Settlement created");
      onOpenChange(false);
      void navigate({ to: "/finance/courier-settlements/$id", params: { id: row.id } });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not create"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[15px]">New courier settlement</DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Starts as a draft. Attach shipments, then record what the courier actually paid.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1">
            <Label className="text-[12px]">Courier account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select an account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[12px]">Settlement reference</Label>
            <Input
              className="h-9"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Courier payout reference"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[12px]">Settlement date</Label>
            <Input
              type="date"
              className="h-9"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" className="h-8" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8"
            disabled={!accountId || !reference.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Create settlement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
