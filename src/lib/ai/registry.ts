import type { AIAnalysisType } from "@/types/ai";

/**
 * Analysis registry.
 *
 * Small on purpose: an analysis type declares what it targets and which
 * context builder feeds it. Adding a type never widens permissions — the
 * controlled database function still validates the caller and the entity.
 */
export interface AIAnalysisDefinition {
  type: AIAnalysisType;
  label: string;
  description: string;
  /** Authoritative record kind the analysis is about. */
  entityType: "operations" | "order" | "customer" | "inventory";
  /** Whether an entity id is required for this analysis. */
  requiresEntity: boolean;
  /** Context builder key, resolved server-side only. */
  contextBuilder: "operations" | "order" | "customer" | "inventory";
  /** Implemented in Step 14 (others are registered for later steps). */
  enabled: boolean;
}

export const AI_ANALYSIS_REGISTRY: Record<AIAnalysisType, AIAnalysisDefinition> = {
  operations_summary: {
    type: "operations_summary",
    label: "Operations Summary",
    description: "Patterns and priorities across the current operational attention data.",
    entityType: "operations",
    requiresEntity: false,
    contextBuilder: "operations",
    enabled: true,
  },
  order_review: {
    type: "order_review",
    label: "Order Review",
    description: "Risk and completeness review of a single order.",
    entityType: "order",
    requiresEntity: true,
    contextBuilder: "order",
    enabled: true,
  },
  customer_review: {
    type: "customer_review",
    label: "Customer Review",
    description: "Behavioural review of one customer's operational history.",
    entityType: "customer",
    requiresEntity: true,
    contextBuilder: "customer",
    enabled: true,
  },
  inventory_review: {
    type: "inventory_review",
    label: "Inventory Review",
    description: "Stock health review using existing authoritative inventory signals.",
    entityType: "inventory",
    requiresEntity: false,
    contextBuilder: "inventory",
    enabled: true,
  },
  delivery_review: {
    type: "delivery_review",
    label: "Delivery Review",
    description: "Reserved for a later step.",
    entityType: "operations",
    requiresEntity: false,
    contextBuilder: "operations",
    enabled: false,
  },
  courier_review: {
    type: "courier_review",
    label: "Courier Review",
    description: "Reserved for a later step.",
    entityType: "operations",
    requiresEntity: false,
    contextBuilder: "operations",
    enabled: false,
  },
  procurement_review: {
    type: "procurement_review",
    label: "Procurement Review",
    description: "Reserved for a later step.",
    entityType: "operations",
    requiresEntity: false,
    contextBuilder: "operations",
    enabled: false,
  },
  financial_review: {
    type: "financial_review",
    label: "Financial Review",
    description: "Reserved for a later step.",
    entityType: "operations",
    requiresEntity: false,
    contextBuilder: "operations",
    enabled: false,
  },
};

export const ENABLED_ANALYSES: AIAnalysisDefinition[] = Object.values(AI_ANALYSIS_REGISTRY).filter(
  (definition) => definition.enabled,
);

export function getAnalysisDefinition(type: string): AIAnalysisDefinition | null {
  return AI_ANALYSIS_REGISTRY[type as AIAnalysisType] ?? null;
}
