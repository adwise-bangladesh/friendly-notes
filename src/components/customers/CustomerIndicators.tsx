import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CustomerIndicator } from "@/types/customers";

/**
 * Indicators are always explainable: hovering shows the exact records the
 * indicator came from, and manual flags are labelled as manual so they are
 * never mistaken for a calculated result.
 */
export function CustomerIndicators({
  indicators,
  className,
}: {
  indicators: CustomerIndicator[];
  className?: string;
}) {
  if (indicators.length === 0) return null;
  return (
    <TooltipProvider delayDuration={150}>
      <div className={className ?? "flex flex-wrap items-center gap-1.5"}>
      {indicators.map((indicator) => (
        <Tooltip key={indicator.key}>
          <TooltipTrigger asChild>
            <span>
              <StatusBadge tone={indicator.tone}>
                {indicator.kind === "manual" ? `⚑ ${indicator.label}` : indicator.label}
              </StatusBadge>
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-[12px]">
            <p className="font-medium">
              {indicator.kind === "manual"
                ? "Manual flag"
                : indicator.kind === "status"
                  ? "Account status"
                  : "Calculated from order history"}
            </p>
            <p className="mt-1 text-muted-foreground">{indicator.basis}</p>
          </TooltipContent>
        </Tooltip>
      ))}
      </div>
    </TooltipProvider>
  );
}
