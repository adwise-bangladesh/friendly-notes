import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface StatRow {
  label: string;
  value: string;
  hint?: string;
}

interface Props {
  title: string;
  description?: string;
  rows: StatRow[];
}

export function StatList({ title, description, rows }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent className="space-y-1.5">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data in this period.</p>
        ) : (
          rows.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-4 text-sm">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="font-medium tabular-nums">{r.value}</span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
