import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useQuery } from "@tanstack/react-query";
import { getActiveStores } from "@/lib/stores";
import { DATE_PRESETS, type DatePresetId } from "@/lib/analytics";
import type { AnalyticsGrain } from "@/types/analytics";

const SOURCES = [
  "admin",
  "web",
  "mobile",
  "facebook",
  "whatsapp",
  "phone",
  "import",
  "api",
] as const;

interface Props {
  preset: DatePresetId;
  onPresetChange: (value: DatePresetId) => void;
  grain?: AnalyticsGrain;
  onGrainChange?: (value: AnalyticsGrain) => void;
  source?: string | null;
  onSourceChange?: (value: string | null) => void;
  storeId?: string | null;
  onStoreChange?: (value: string | null) => void;
}

/** Shared date/grain/source filter used by every analytics page. */
export function AnalyticsFilters({
  preset,
  onPresetChange,
  grain,
  onGrainChange,
  source,
  onSourceChange,
  storeId,
  onStoreChange,
}: Props) {
  const stores = useQuery({
    queryKey: ["analytics", "store-options"],
    queryFn: getActiveStores,
    enabled: Boolean(onStoreChange),
    staleTime: 5 * 60_000,
  });

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Period</Label>
        <Select value={preset} onValueChange={(v) => onPresetChange(v as DatePresetId)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {grain && onGrainChange ? (
        <div className="space-y-1">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Group by
          </Label>
          <Select value={grain} onValueChange={(v) => onGrainChange(v as AnalyticsGrain)}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Day</SelectItem>
              <SelectItem value="week">Week</SelectItem>
              <SelectItem value="month">Month</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {onStoreChange ? (
        <div className="space-y-1">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Store</Label>
          <Select
            value={storeId ?? "all"}
            onValueChange={(v) => onStoreChange(v === "all" ? null : v)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stores</SelectItem>
              {(stores.data ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {onSourceChange ? (
        <div className="space-y-1">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Order source
          </Label>
          <Select
            value={source ?? "all"}
            onValueChange={(v) => onSourceChange(v === "all" ? null : v)}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );
}
