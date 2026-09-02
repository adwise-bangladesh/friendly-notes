import { AI_RESULT_JSON_SCHEMA } from "./output-schema";

/**
 * Provider-neutral AI boundary (server only).
 *
 * The rest of the application talks to `AIProvider`, never to a vendor SDK.
 * Credentials are read from the server environment inside the call and are
 * never returned, logged or persisted. When no provider is configured the
 * boundary reports "unavailable" — it never invents a result.
 */

export interface AIProviderStatusResult {
  connected: boolean;
  provider: string | null;
  model: string | null;
  message: string;
}

export interface AIAnalyzeRequest {
  instructions: string;
  context: Record<string, unknown>;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  healthCheck(): AIProviderStatusResult;
  /** Returns provider output already parsed as JSON — still unvalidated. */
  generateStructuredOutput(request: AIAnalyzeRequest): Promise<unknown>;
  /** Convenience alias used by analysis flows. */
  analyze(request: AIAnalyzeRequest): Promise<unknown>;
}

export class AIProviderUnavailableError extends Error {
  constructor(message = "No AI provider is currently configured") {
    super(message);
    this.name = "AIProviderUnavailableError";
  }
}

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/responses";
const PROVIDER_NAME = "lovable-ai-gateway";
const MODEL = "openai/gpt-5.6-sol";

class LovableGatewayProvider implements AIProvider {
  readonly name = PROVIDER_NAME;
  readonly model = MODEL;

  healthCheck(): AIProviderStatusResult {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) {
      return {
        connected: false,
        provider: null,
        model: null,
        message: "No AI provider is currently configured",
      };
    }
    return {
      connected: true,
      provider: this.name,
      model: this.model,
      message: "AI provider configured (server-side credentials)",
    };
  }

  async analyze(request: AIAnalyzeRequest): Promise<unknown> {
    return this.generateStructuredOutput(request);
  }

  async generateStructuredOutput(request: AIAnalyzeRequest): Promise<unknown> {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new AIProviderUnavailableError();

    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        reasoning: { effort: "low", summary: "auto" },
        instructions: request.instructions,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Operational context (json):\n${JSON.stringify(request.context)}`,
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "commerce_ai_result",
            strict: true,
            schema: AI_RESULT_JSON_SCHEMA,
          },
        },
      }),
    });

    if (!response.ok) {
      // Statuses are mapped to operator-safe sentences; provider bodies are
      // never surfaced to the browser or stored.
      if (response.status === 429) throw new Error("AI provider is rate limited. Try again shortly.");
      if (response.status === 402)
        throw new Error("AI credits are exhausted for this workspace.");
      if (response.status === 403) throw new Error("AI access is blocked by workspace policy.");
      if (response.status === 401)
        throw new AIProviderUnavailableError("AI provider credentials are invalid");
      throw new Error(`AI provider request failed (status ${response.status})`);
    }

    const text = await readOutputText(response);
    if (!text.trim()) throw new Error("AI provider returned an empty result");
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("AI provider returned output that is not valid structured JSON");
    }
  }
}

/** Accumulates `response.output_text.delta` events from the SSE stream. */
async function readOutputText(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload) as { type?: string; delta?: string; response?: { output_text?: string } };
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          out += event.delta;
        } else if (event.type === "response.completed" && !out && event.response?.output_text) {
          out = event.response.output_text;
        }
      } catch {
        // Ignore keep-alive or non-JSON frames.
      }
    }
  }
  return out;
}

let provider: AIProvider | null = null;

/** Single place the application resolves a provider from. */
export function getAIProvider(): AIProvider {
  provider ??= new LovableGatewayProvider();
  return provider;
}
