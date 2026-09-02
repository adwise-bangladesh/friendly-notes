import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { requestAIAnalysis } from "@/lib/ai.functions";
import { getAnalysisDefinition } from "@/lib/ai/registry";
import type { AIAnalysisType } from "@/types/ai";

/**
 * Requests one analysis. The server function does the permission re-check,
 * builds the context under RLS and stores results through controlled
 * functions — this button only asks.
 */
export function RunAnalysisButton({
  analysisType,
  entityId = null,
  label,
  size = "sm",
  variant = "outline",
  disabled,
  invalidateKeys,
}: {
  analysisType: AIAnalysisType;
  entityId?: string | null;
  label?: string;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "ghost";
  disabled?: boolean;
  invalidateKeys?: unknown[][];
}) {
  const queryClient = useQueryClient();
  const run = useServerFn(requestAIAnalysis);
  const [busy, setBusy] = useState(false);
  const definition = getAnalysisDefinition(analysisType);

  const mutation = useMutation({
    mutationFn: async () => run({ data: { analysisType, entityId } }),
    onMutate: () => setBusy(true),
    onSettled: () => setBusy(false),
    onSuccess: (result) => {
      if (result.ok) toast.success(result.message);
      else if (result.status === "unavailable") toast.warning(result.message);
      else toast.error(result.message);
      for (const key of invalidateKeys ?? [
        ["ai-overview"],
        ["ai-insights"],
        ["ai-recommendations"],
        ["ai-runs"],
        ["ai-events"],
      ]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onError: (error: Error) => toast.error(error.message || "Could not run the analysis"),
  });

  return (
    <Button
      size={size}
      variant={variant}
      disabled={disabled || busy || !definition?.enabled}
      onClick={() => mutation.mutate()}
    >
      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
      {busy ? "Analysing…" : (label ?? `Run ${definition?.label ?? "analysis"}`)}
    </Button>
  );
}
