/**
 * Correlation identifiers.
 *
 *   request / schedule → correlation id → worker run → diagnostics → courier logs
 *
 * A correlation id is a short, opaque, non-authorising token. It is only used
 * to stitch telemetry rows together. It never grants access, never carries
 * customer data and is always length-limited, so an untrusted inbound value
 * cannot be used to smuggle payloads into the diagnostics tables.
 */

const SAFE = /^[A-Za-z0-9._:-]{8,64}$/;

const CORRELATION_HEADERS = [
  "x-correlation-id",
  "x-request-id",
  "traceparent",
] as const;

/** Generate a fresh correlation id. */
export function newCorrelationId(prefix = "op"): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
  return `${prefix}_${random}`.slice(0, 64);
}

/** Accept an inbound correlation id only when it is short and safe. */
export function sanitizeCorrelationId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return SAFE.test(trimmed) ? trimmed : null;
}

/**
 * Correlation id for an inbound request: reuse a safe caller-supplied value,
 * otherwise mint one. The value is never treated as authentication.
 */
export function correlationFromRequest(request: Request, prefix = "req"): string {
  for (const header of CORRELATION_HEADERS) {
    const candidate = sanitizeCorrelationId(request.headers.get(header));
    if (candidate) return candidate;
  }
  return newCorrelationId(prefix);
}
