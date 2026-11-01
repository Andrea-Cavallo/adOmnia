import type { GoIDENativeDebugRequest } from '@/lib/code-studio-debug-api'

interface NativeDebugConfiguration {
  kind: string
  language?: string
  workingDirectory?: string
  programArguments?: readonly string[] | null
  environment?: ReadonlyArray<{ key: string; value?: string; secret?: boolean }> | null
  languageOptions?: unknown
}

/** Languages whose `executable` run configurations debug with CodeLLDB (`internal/languages/declared`). */
export const NATIVE_DEBUG_LANGUAGES: readonly string[] = ['cpp', 'objective-c', 'zig', 'swift']

export type NativeDebugTarget = Omit<GoIDENativeDebugRequest, 'sessionId'>

/** The executable of a native run configuration, with its arguments and environment (secrets left out). */
export function nativeDebugTargetOf(config: NativeDebugConfiguration): NativeDebugTarget | null {
  if (!config.language || !NATIVE_DEBUG_LANGUAGES.includes(config.language) || config.kind !== 'executable') return null
  const options = config.languageOptions && typeof config.languageOptions === 'object' ? (config.languageOptions as Record<string, unknown>) : {}
  const program = String(options.program ?? '').trim()
  if (!program) return null
  const environment = Object.fromEntries((config.environment ?? []).filter((entry) => entry.key && !entry.secret).map((entry) => [entry.key, entry.value ?? '']))
  return {
    language: config.language,
    program,
    workingDirectory: config.workingDirectory ?? '',
    ...(config.programArguments?.length ? { programArguments: [...config.programArguments] } : {}),
    ...(Object.keys(environment).length ? { environment } : {}),
  }
}
