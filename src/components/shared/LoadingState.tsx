import { Skeleton } from "@/components/ui/skeleton";

export function LoadingState({ rows = 4, label }: { rows?: number; label?: string }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label={label ?? "Loading"}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}
