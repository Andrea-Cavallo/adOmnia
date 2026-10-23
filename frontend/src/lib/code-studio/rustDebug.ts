import type { GoIDERustDebugRequest } from '@/lib/code-studio-debug-api'

interface RustDebugConfiguration {
  kind: string
  language?: string
  workingDirectory?: string
  programArguments?: readonly string[] | null
  environment?: ReadonlyArray<{ key: string; value?: string; secret?: boolean }> | null
  languageOptions?: unknown
}

/** La parte di `GoIDERustDebugRequest` che viene dalla configurazione Run. */
export type RustDebugTarget = Omit<GoIDERustDebugRequest, 'sessionId'>

const optionsOf = (config: RustDebugConfiguration): Record<string, unknown> =>
  config.languageOptions && typeof config.languageOptions === 'object' ? (config.languageOptions as Record<string, unknown>) : {}

const text = (value: unknown): string => String(value ?? '').trim()

/**
 * Cosa debuggare per una configurazione Run Rust: il `bin` o l'`example` della Run, con le stesse
 * opzioni di build (package, features, profilo, target), working directory, argomenti e ambiente
 * (segreti esclusi). Null per i kind che non producono un eseguibile da debuggare.
 */
export function rustDebugTargetOf(config: RustDebugConfiguration): RustDebugTarget | null {
  if (config.language !== 'rust' || (config.kind !== 'bin' && config.kind !== 'example')) return null
  const options = optionsOf(config)
  const bin = config.kind === 'bin' ? text(options.bin) : ''
  const example = config.kind === 'example' ? text(options.example) : ''
  const source = config.kind === 'bin' ? text(options.source) : ''
  if (!bin && !example && !source) return null
  const pkg = text(options.package)
  const features = Array.isArray(options.features) ? options.features.map(text).filter(Boolean) : []
  const environment = Object.fromEntries((config.environment ?? []).filter((entry) => entry.key && !entry.secret).map((entry) => [entry.key, entry.value ?? '']))
  const profile = text(options.profile)
  const target = text(options.target)
  const toolchain = text(options.toolchain)
  return {
    ...(pkg ? { package: pkg } : {}),
    ...(bin ? { bin } : {}),
    ...(example ? { example } : {}),
    ...(source ? { source } : {}),
    ...(features.length ? { features } : {}),
    ...(options.allFeatures === true ? { allFeatures: true } : {}),
    ...(options.noDefaultFeatures === true ? { noDefaultFeatures: true } : {}),
    ...(profile ? { profile } : {}),
    ...(target ? { target } : {}),
    ...(toolchain ? { toolchain } : {}),
    workingDirectory: config.workingDirectory ?? '',
    ...(config.programArguments?.length ? { programArguments: [...config.programArguments] } : {}),
    ...(Object.keys(environment).length ? { environment } : {}),
  }
}
