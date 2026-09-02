import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { CURRENCY_SYMBOL, formatMoney, parseMoney } from "@/lib/currency";
import {
  cancelCampaign,
  deleteCampaign,
  listCampaigns,
  saveCampaign,
  type CampaignInput,
} from "@/lib/group-buy";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { GROUP_BUY_STATUSES, GROUP_BUY_STATUS_LABELS } from "@/types/commerce";
import type { GroupBuyCampaign, GroupBuyStatus } from "@/types/commerce";
import type { StatusTone } from "@/components/shared/StatusBadge";

const TONE: Record<GroupBuyStatus, StatusTone> = {
  draft: "neutral",
  scheduled: "info",
  active: "success",
  closed: "neutral",
  target_met: "success",
  target_not_met: "warning",
  procurement: "info",
  fulfillment: "info",
  completed: "success",
  cancelled: "danger",
};

const toLocalInput = (iso: string) => new Date(iso).toISOString().slice(0, 16);

const emptyForm = (): CampaignInput => ({
  title: "",
  status: "draft",
  starts_at: "",
  ends_at: "",
  minimum_quantity: 1,
  target_quantity: null,
  expected_delivery_start: null,
  expected_delivery_end: null,
  campaign_price: null,
});

interface Props {
  productId?: string;
}

export function GroupBuyCampaigns({ productId }: Props) {
  const queryClient = useQueryClient();
  const { canManage } = useCommercePermissions();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CampaignInput | null>(null);

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["group-buy-campaigns", productId],
    queryFn: () => listCampaigns(productId!),
    enabled: !!productId,
  });

  const mutation = useMutation({
    mutationFn: (input: CampaignInput) =>
      saveCampaign(productId!, input, editingId ?? undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group-buy-campaigns", productId] });
      setForm(null);
      setEditingId(null);
      toast.success("Campaign saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save campaign"),
  });

  const cancelMutation = useMutation({
    mutationFn: cancelCampaign,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group-buy-campaigns", productId] });
      toast.success("Campaign cancelled");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCampaign,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group-buy-campaigns", productId] });
      toast.success("Campaign deleted");
    },
  });

  if (!productId) {
    return (
      <p className="text-[12px] text-muted-foreground">
        Save the product first, then add Group Buy campaigns.
      </p>
    );
  }

  const startEdit = (c: GroupBuyCampaign) => {
    setEditingId(c.id);
    setForm({
      title: c.title,
      status: c.status,
      starts_at: toLocalInput(c.starts_at),
      ends_at: toLocalInput(c.ends_at),
      minimum_quantity: c.minimum_quantity,
      target_quantity: c.target_quantity,
      expected_delivery_start: c.expected_delivery_start,
      expected_delivery_end: c.expected_delivery_end,
      campaign_price: c.campaign_price,
    });
  };

  const patch = (p: Partial<CampaignInput>) => setForm((f) => (f ? { ...f, ...p } : f));

  return (
    <div className="space-y-3">
      {isLoading && <p className="text-[12px] text-muted-foreground">Loading campaigns…</p>}

      {!isLoading && campaigns.length === 0 && !form && (
        <p className="text-[11.5px] text-muted-foreground">
          No campaigns yet. A Group Buy campaign collects orders over a window, then the products
          are procured in bulk and delivered around the expected date.
        </p>
      )}

      {campaigns.map((c) => (
        <div key={c.id} className="rounded border border-border bg-muted/30 p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{c.title}</span>
            <StatusBadge tone={TONE[c.status]}>{GROUP_BUY_STATUS_LABELS[c.status]}</StatusBadge>
            {canManage && (
              <div className="flex items-center">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Edit campaign"
                  onClick={() => startEdit(c)}
                  className="h-7 w-7 text-muted-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {c.status !== "cancelled" && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Cancel campaign"
                    onClick={() => cancelMutation.mutate(c.id)}
                    className="h-7 w-7 text-muted-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Delete campaign"
                  onClick={() => deleteMutation.mutate(c.id)}
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
          <dl className="mt-1.5 grid gap-x-4 gap-y-0.5 text-[11.5px] text-muted-foreground sm:grid-cols-2">
            <div>
              Opens {new Date(c.starts_at).toLocaleDateString()} · Closes{" "}
              {new Date(c.ends_at).toLocaleDateString()}
            </div>
            <div>
              Expected delivery{" "}
              {c.expected_delivery_start
                ? `${c.expected_delivery_start}${
                    c.expected_delivery_end && c.expected_delivery_end !== c.expected_delivery_start
                      ? ` – ${c.expected_delivery_end}`
                      : ""
                  }`
                : "—"}
            </div>
            <div>
              Confirmed {c.current_quantity} / min {c.minimum_quantity}
              {c.target_quantity ? ` · target ${c.target_quantity}` : ""}
            </div>
            <div>Campaign price {formatMoney(c.campaign_price)}</div>
          </dl>
        </div>
      ))}

      {form && (
        <div className="space-y-2.5 rounded border border-primary/40 bg-card p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[12px]">Campaign Title *</Label>
              <Input
                value={form.title}
                onChange={(e) => patch({ title: e.target.value })}
                className="h-8 text-[12.5px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => patch({ status: v as GroupBuyStatus })}
              >
                <SelectTrigger className="h-8 text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_BUY_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {GROUP_BUY_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">Opens *</Label>
              <Input
                type="datetime-local"
                value={form.starts_at}
                onChange={(e) => patch({ starts_at: e.target.value })}
                className="h-8 text-[12.5px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">Closes *</Label>
              <Input
                type="datetime-local"
                value={form.ends_at}
                onChange={(e) => patch({ ends_at: e.target.value })}
                className="h-8 text-[12.5px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">Expected Delivery Start</Label>
              <Input
                type="date"
                value={form.expected_delivery_start ?? ""}
                onChange={(e) => patch({ expected_delivery_start: e.target.value || null })}
                className="h-8 text-[12.5px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">Expected Delivery End</Label>
              <Input
                type="date"
                value={form.expected_delivery_end ?? ""}
                onChange={(e) => patch({ expected_delivery_end: e.target.value || null })}
                className="h-8 text-[12.5px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">Minimum Quantity</Label>
              <Input
                value={form.minimum_quantity}
                inputMode="numeric"
                onChange={(e) =>
                  patch({
                    minimum_quantity: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1),
                  })
                }
                className="h-8 text-[12.5px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">Target Quantity</Label>
              <Input
                value={form.target_quantity ?? ""}
                inputMode="numeric"
                placeholder="Optional"
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/\D/g, ""));
                  patch({ target_quantity: n > 0 ? n : null });
                }}
                className="h-8 text-[12.5px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">Campaign Price</Label>
              <Input
                value={form.campaign_price ?? ""}
                inputMode="decimal"
                placeholder={`${CURRENCY_SYMBOL} optional`}
                onChange={(e) => patch({ campaign_price: parseMoney(e.target.value) })}
                className="h-8 text-[12.5px]"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(form)}
            >
              {mutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {editingId ? "Save Campaign" : "Create Campaign"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setForm(null);
                setEditingId(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {canManage && !form && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setEditingId(null);
            setForm(emptyForm());
          }}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          New Campaign
        </Button>
      )}
    </div>
  );
}
