/**
 * Classe `main` di una configurazione Java ricavata dagli argomenti del comando: la proposta "Main Class"
 * esegue `exec:java -Dexec.mainClass=…`, e quella è anche la classe da debuggare. Vuoto se non c'è.
 */
export function javaMainClassOf(programArguments: readonly string[]): string {
  const prefix = '-Dexec.mainClass='
  const argument = programArguments.find((item) => item.startsWith(prefix))
  const name = argument ? argument.slice(prefix.length) : ''
  return /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(name) ? name : ''
}

interface JavaDebugConfiguration {
  kind: string
  language?: string
  workingDirectory?: string
  programArguments?: readonly string[] | null
  environment?: ReadonlyArray<{ key: string; value?: string; secret?: boolean }> | null
  languageOptions?: unknown
}

export interface JavaDebugTarget {
  mainClass?: string
  attachHost?: string
  attachPort?: number
  buildArguments?: string[]
  workingDirectory: string
  programArguments?: string[]
  vmArguments?: string[]
  environment?: Record<string, string>
}

const BUILD_DEBUGGABLE = /^(spring-boot:run|test|verify|integration-test|bootRun|run)$/

const optionsOf = (config: JavaDebugConfiguration): Record<string, unknown> =>
  config.languageOptions && typeof config.languageOptions === 'object' ? (config.languageOptions as Record<string, unknown>) : {}

/**
 * Cosa debuggare per una configurazione Run Java: una classe `main` (kind main o la vecchia proposta exec:java),
 * una JVM remota (kind attach) oppure un build Maven/Gradle di test o Spring Boot con la porta JDWP aperta dall'host.
 */
export function javaDebugTargetOf(config: JavaDebugConfiguration): JavaDebugTarget | null {
  if (config.language !== 'java') return null
  const workingDirectory = config.workingDirectory ?? ''
  const options = optionsOf(config)
  if (config.kind === 'attach') {
    const attachPort = Number(options.port ?? 5005)
    if (!Number.isInteger(attachPort) || attachPort < 1 || attachPort > 65535) return null
    return { attachHost: String(options.host ?? '127.0.0.1').trim() || '127.0.0.1', attachPort, workingDirectory }
  }
  const programArguments = [...(config.programArguments ?? [])]
  if (config.kind === 'main') {
    const mainClass = String(options.mainClass ?? '').trim()
    if (!mainClass) return null
    const environment = Object.fromEntries((config.environment ?? []).filter((entry) => entry.key && !entry.secret).map((entry) => [entry.key, entry.value ?? '']))
    const vmArguments = Array.isArray(options.vmOptions) ? options.vmOptions.map(String) : []
    return { mainClass, workingDirectory, programArguments, vmArguments, environment }
  }
  const legacyClass = javaMainClassOf(programArguments)
  if (legacyClass) return { mainClass: legacyClass, workingDirectory }
  if (programArguments.some((argument) => BUILD_DEBUGGABLE.test(argument))) return { buildArguments: programArguments, workingDirectory }
  return null
}
