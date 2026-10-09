// W3C trace context for live requests: the trace id is derived from the run's correlation id,
// so the request timeline can find the service's OpenTelemetry spans without storing anything.

const hexOf = (text: string) => text.toLowerCase().replace(/[^0-9a-f]/g, '')

/** 32 hex chars, never all zero (an all-zero trace id is invalid and would be dropped). */
export function traceIdFor(correlationId: string): string {
  const hex = hexOf(correlationId).slice(-31)
  return `a${hex.padStart(31, '0')}`
}

export function traceparentFor(correlationId: string): string {
  const span = `b${hexOf(correlationId).slice(-15).padStart(15, '0')}`
  return `00-${traceIdFor(correlationId)}-${span}-01`
}
