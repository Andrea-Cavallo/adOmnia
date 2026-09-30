import type { GoIDEDebugVariable } from '@/lib/goide-debug-api'

const CONTEXT_FIELDS = /^(?:key|val|value|deadline|done|err|cause|Context|parent|cancelCtx)$/

/** Campi pertinenti esposti dal DAP per le implementazioni standard di context.Context. */
export function goStudioContextFields(variables: readonly GoIDEDebugVariable[]): GoIDEDebugVariable[] {
  return variables.filter((variable) => CONTEXT_FIELDS.test(variable.name)).slice(0, 8)
}
