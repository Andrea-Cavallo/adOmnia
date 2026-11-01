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

/** Script languages whose `script` run configurations debug with a DAP adapter on PATH (php-debug-adapter, dart debug_adapter). */
export const SCRIPT_DEBUG_LANGUAGES: readonly string[] = ['php', 'dart']

/** .NET languages: the `dotnet` run configuration builds the project in Debug and debugs it with netcoredbg. */
export const DOTNET_LANGUAGES: readonly string[] = ['csharp', 'fsharp']

export type NativeDebugTarget = Omit<GoIDENativeDebugRequest, 'sessionId'>

/**
 * The executable, script or .NET project of a declared-language run configuration, with its arguments
 * and environment (secrets left out). A .NET project may be empty: the backend picks the working directory's one.
 */
export function nativeDebugTargetOf(config: NativeDebugConfiguration): NativeDebugTarget | null {
  const native = !!config.language && NATIVE_DEBUG_LANGUAGES.includes(config.language) && config.kind === 'executable'
  const script = !!config.language && SCRIPT_DEBUG_LANGUAGES.includes(config.language) && config.kind === 'script'
  const dotnet = !!config.language && DOTNET_LANGUAGES.includes(config.language) && config.kind === 'dotnet'
  if (!config.language || (!native && !script && !dotnet)) return null
  const options = config.languageOptions && typeof config.languageOptions === 'object' ? (config.languageOptions as Record<string, unknown>) : {}
  const program = String((native ? options.program : script ? options.script : options.project) ?? '').trim()
  if (!program && !dotnet) return null
  const environment = Object.fromEntries((config.environment ?? []).filter((entry) => entry.key && !entry.secret).map((entry) => [entry.key, entry.value ?? '']))
  return {
    language: config.language,
    program,
    workingDirectory: config.workingDirectory ?? '',
    ...(config.programArguments?.length ? { programArguments: [...config.programArguments] } : {}),
    ...(Object.keys(environment).length ? { environment } : {}),
  }
}
