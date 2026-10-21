import type { GoIDEPythonDebugRequest } from '@/lib/code-studio-debug-api'

interface PythonDebugConfiguration {
  kind: string
  language?: string
  workingDirectory?: string
  programArguments?: readonly string[] | null
  environment?: ReadonlyArray<{ key: string; value?: string; secret?: boolean }> | null
  languageOptions?: unknown
}

/** La parte di `GoIDEPythonDebugRequest` che viene dalla configurazione Run. */
export type PythonDebugTarget = Omit<GoIDEPythonDebugRequest, 'sessionId'>

const optionsOf = (config: PythonDebugConfiguration): Record<string, unknown> =>
  config.languageOptions && typeof config.languageOptions === 'object' ? (config.languageOptions as Record<string, unknown>) : {}

/**
 * Cosa debuggare per una configurazione Run Python: lo script o il modulo della Run (le stesse
 * chiavi di languageOptions del backend, `script` e `module`), con la stessa working directory,
 * gli stessi argomenti e lo stesso ambiente. Null per le altre configurazioni.
 */
export function pythonDebugTargetOf(config: PythonDebugConfiguration): PythonDebugTarget | null {
  if (config.language !== 'python') return null
  const kind = config.kind === 'script' || config.kind === 'module' ? config.kind : ''
  if (!kind) return null
  const options = optionsOf(config)
  const value = String(options[kind] ?? '').trim()
  if (!value) return null
  const environment = Object.fromEntries((config.environment ?? []).filter((entry) => entry.key && !entry.secret).map((entry) => [entry.key, entry.value ?? '']))
  const interpreter = String(options.interpreter ?? '').trim()
  return {
    ...(kind === 'script' ? { kind, script: value } : { kind, module: value }),
    workingDirectory: config.workingDirectory ?? '',
    ...(config.programArguments?.length ? { programArguments: [...config.programArguments] } : {}),
    ...(Object.keys(environment).length ? { environment } : {}),
    ...(interpreter ? { interpreter } : {}),
  }
}
