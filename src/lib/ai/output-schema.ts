import { z } from "zod";

/**
 * Structured AI output contract.
 *
 * Provider responses are never trusted: every field is validated here before
 * anything is stored, and the stored rows can still only become insights and
 * recommendations — never an executable command.
 */

const severity = z.enum(["info", "low", "medium", "high", "critical"]);
const category = z.enum([
  "operations",
  "order",
  "customer",
  "inventory",
  "delivery",
  "courier",
  "procurement",
  "financial",
  "verification",
  "general",
]);
const priority = z.enum(["low", "medium", "high", "urgent"]);

/** Suggested actions are an allow-list: anything else is downgraded to "review". */
export const SUPPORTED_SUGGESTED_ACTIONS = [
  "review_order",
  "review_verification",
  "increase_verification_priority",
  "manual_review",
  "review_inventory",
  "investigate_shipment",
  "review_return",
  "review_supplier",
  "review_customer",
  "create_operational_assignment",
  "no_action",
] as const;

export type SupportedSuggestedAction = (typeof SUPPORTED_SUGGESTED_ACTIONS)[number];

const evidenceItem = z.object({
  label: z.string().min(1).max(80),
  value: z.string().min(1).max(200),
});

const insightSchema = z.object({
  key: z.string().min(1).max(60),
  category,
  severity,
  title: z.string().min(3).max(200),
  summary: z.string().min(3).max(2000),
  confidence: z.number().min(0).max(1),
  entity_id: z.string().max(100).nullable(),
  evidence: z.array(evidenceItem).max(10),
});

const recommendationSchema = z.object({
  insight_key: z.string().max(60).nullable(),
  recommendation_type: z.string().min(1).max(120),
  priority,
  title: z.string().min(3).max(200),
  description: z.string().min(3).max(2000),
  suggested_action: z.string().max(400).nullable(),
  action_target: z.string().max(300).nullable(),
  confidence: z.number().min(0).max(1),
  entity_id: z.string().max(100).nullable(),
});

export const aiResultSchema = z.object({
  summary: z.string().min(3).max(2000),
  insights: z.array(insightSchema).max(12),
  recommendations: z.array(recommendationSchema).max(12),
});

export type AIResult = z.infer<typeof aiResultSchema>;

/** JSON Schema sent to the provider — strict, single object root, no defaults. */
export const AI_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "insights", "recommendations"],
  properties: {
    summary: { type: "string" },
    insights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "category", "severity", "title", "summary", "confidence", "entity_id", "evidence"],
        properties: {
          key: { type: "string" },
          category: {
            type: "string",
            enum: [
              "operations",
              "order",
              "customer",
              "inventory",
              "delivery",
              "courier",
              "procurement",
              "financial",
              "verification",
              "general",
            ],
          },
          severity: { type: "string", enum: ["info", "low", "medium", "high", "critical"] },
          title: { type: "string" },
          summary: { type: "string" },
          confidence: { type: "number" },
          entity_id: { type: ["string", "null"] },
          evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "value"],
              properties: { label: { type: "string" }, value: { type: "string" } },
            },
          },
        },
      },
    },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "insight_key",
          "recommendation_type",
          "priority",
          "title",
          "description",
          "suggested_action",
          "action_target",
          "confidence",
          "entity_id",
        ],
        properties: {
          insight_key: { type: ["string", "null"] },
          recommendation_type: { type: "string" },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
          title: { type: "string" },
          description: { type: "string" },
          suggested_action: {
            type: ["string", "null"],
            enum: [...SUPPORTED_SUGGESTED_ACTIONS, null],
          },
          action_target: { type: ["string", "null"] },
          confidence: { type: "number" },
          entity_id: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

export interface NormalizedPayload {
  summary: string;
  insights: {
    key: string;
    entity_type: string;
    entity_id: string | null;
    category: string;
    severity: string;
    title: string;
    summary: string;
    confidence: number;
    evidence: Record<string, unknown>;
  }[];
  recommendations: {
    insight_key: string | null;
    entity_type: string;
    entity_id: string | null;
    recommendation_type: string;
    priority: string;
    title: string;
    description: string;
    suggested_action: string | null;
    action_target: string | null;
    confidence: number;
  }[];
}

/**
 * Validates and normalizes provider output into the payload the controlled
 * database function accepts. Unknown suggested actions and dangling insight
 * references are neutralised instead of being stored as malformed data.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Providers often echo a human reference instead of an id; only real ids are kept. */
function safeEntityId(value: string | null, fallback: string | null): string | null {
  return value && UUID.test(value) ? value : fallback;
}

export function normalizeAiResult(
  raw: unknown,
  fallbackEntityType: string,
  fallbackEntityId: string | null,
): NormalizedPayload {
  const parsed = aiResultSchema.parse(raw);
  const keys = new Set(parsed.insights.map((insight) => insight.key));

  return {
    summary: parsed.summary,
    insights: parsed.insights.map((insight) => ({
      key: insight.key,
      entity_type: fallbackEntityType,
      entity_id: safeEntityId(insight.entity_id, fallbackEntityId),
      category: insight.category,
      severity: insight.severity,
      title: insight.title,
      summary: insight.summary,
      confidence: insight.confidence,
      evidence: insight.evidence.length
        ? { references: insight.evidence }
        : ({} as Record<string, unknown>),
    })),
    recommendations: parsed.recommendations.map((rec) => {
      const action = (SUPPORTED_SUGGESTED_ACTIONS as readonly string[]).includes(
        rec.suggested_action ?? "",
      )
        ? rec.suggested_action
        : null;
      return {
        insight_key: rec.insight_key && keys.has(rec.insight_key) ? rec.insight_key : null,
        entity_type: fallbackEntityType,
        entity_id: safeEntityId(rec.entity_id, fallbackEntityId),
        recommendation_type: rec.recommendation_type,
        priority: rec.priority,
        title: rec.title,
        description: rec.description,
        suggested_action: action,
        action_target: rec.action_target,
        confidence: rec.confidence,
      };
    }),
  };
}
