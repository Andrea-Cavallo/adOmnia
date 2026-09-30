import type { GoIDEDebugFrame, GoIDEDebugVariable } from '@/lib/goide-debug-api'

export interface GoStudioPanicSnapshot {
  reason: string
  runtimeFrame: GoIDEDebugFrame | null
  originFrame: GoIDEDebugFrame | null
}

const PANIC_FRAME = /(?:^|\.)runtime\.(?:gopanic|throw|fatalpanic)(?:$|\.)/

/** Identifica una pausa causata dal panic senza scambiare un breakpoint normale per un errore. */
export function panicSnapshot(stopReason: string | undefined, frames: readonly GoIDEDebugFrame[]): GoStudioPanicSnapshot | null {
  const runtimeFrame = frames.find((frame) => PANIC_FRAME.test(frame.name)) ?? null
  const looksLikePanic = /panic|exception/i.test(stopReason ?? '') || runtimeFrame !== null
  if (!looksLikePanic) return null
  return {
    reason: stopReason || 'panic',
    runtimeFrame,
    originFrame: frames.find((frame) => !PANIC_FRAME.test(frame.name) && !!frame.relativePath) ?? frames.find((frame) => !PANIC_FRAME.test(frame.name)) ?? null,
  }
}

/** Il parametro di runtime.gopanic si chiama normalmente e; si accettano i fallback dei diversi adapter. */
export function panicValueFromVariables(variables: readonly GoIDEDebugVariable[]): GoIDEDebugVariable | null {
  return variables.find((variable) => /^(?:e|panic|value|err)$/i.test(variable.name)) ?? null
}
