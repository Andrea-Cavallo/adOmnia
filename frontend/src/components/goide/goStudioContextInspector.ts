import type { GoIDEDebugVariable } from '@/lib/goide-debug-api'

const CONTEXT_FIELDS = /^(?:key|val|value|deadline|done|err|cause|Context|parent|cancelCtx)$/

/** Campi pertinenti esposti dal DAP per le implementazioni standard di context.Context. */
export function goStudioContextFields(variables: readonly GoIDEDebugVariable[]): GoIDEDebugVariable[] {
  return variables.filter((variable) => CONTEXT_FIELDS.test(variable.name)).slice(0, 8)
}

const TRACE_KEY = /trace[-_ ]?id|request[-_ ]?id|correlation[-_ ]?id|span[-_ ]?id/i

/** Valore di un context.WithValue con chiave trace/request id (es. `string "abc"` da Delve), per cercarlo nei log. */
export function goStudioContextTraceId(fields: readonly GoIDEDebugVariable[]): string | null {
  const key = fields.find((field) => field.name === 'key')?.value ?? ''
  const value = fields.find((field) => field.name === 'val' || field.name === 'value')?.value ?? ''
  if (!TRACE_KEY.test(key)) return null
  return /"([^"]+)"\s*$/.exec(value)?.[1] ?? null
}
