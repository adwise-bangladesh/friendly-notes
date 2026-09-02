import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Props {
  label: string;
  value: string;
  /** Percentage change vs the previous period of the same length. */
  change?: number | null;
  /** Lower is better (failure rates, costs). */
  invert?: boolean;
  hint?: string;
  badge?: string;
}

export function MetricCard({ label, value, change, invert, hint, badge }: Props) {
  const positive = change === null || change === undefined ? null : invert ? change < 0 : change > 0;
  const Icon =
    change === null || change === undefined || change === 0
      ? Minus
      : change > 0
        ? ArrowUpRight
        : ArrowDownRight;

  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
          {badge ? (
            <Badge variant="outline" className="text-[10px]">
              {badge}
            </Badge>
          ) : null}
        </div>
        <p className="text-xl font-semibold tabular-nums">{value}</p>
        {change !== undefined ? (
          <p
            className={`flex items-center gap-1 text-xs ${
              positive === null
                ? "text-muted-foreground"
                : positive
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-destructive"
            }`}
          >
            <Icon className="h-3 w-3" />
            {change === null || change === undefined
              ? "No comparison data"
              : `${change > 0 ? "+" : ""}${change}% vs previous period`}
          </p>
        ) : null}
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
