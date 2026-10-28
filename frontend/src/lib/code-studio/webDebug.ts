import type { GoIDEWebDebugRequest } from '@/lib/code-studio-debug-api'

interface WebDebugConfiguration {
  kind: string
  language?: string
  target?: string
  workingDirectory?: string
  programArguments?: readonly string[] | null
  environment?: ReadonlyArray<{ key: string; value?: string; secret?: boolean }> | null
  languageOptions?: unknown
}

/** La parte di `GoIDEWebDebugRequest` che viene dalla configurazione Run. */
export type WebDebugTarget = Omit<GoIDEWebDebugRequest, 'sessionId'>

/**
 * Cosa debuggare per una configurazione Run JS/TS: lo script del package manager (`npm run dev`,
 * `node server.js`…) con la stessa working directory, gli stessi argomenti e l'ambiente senza
 * segreti. Null per i kind che non avviano un processo Node (build, formati statici).
 */
export function webDebugTargetOf(config: WebDebugConfiguration): WebDebugTarget | null {
  if (config.language !== 'typescript' || config.kind !== 'command') return null
  const executable = String(config.target ?? '').trim()
  if (!executable) return null
  const args = (config.programArguments ?? []).map((argument) => String(argument)).filter(Boolean)
  const environment = Object.fromEntries((config.environment ?? []).filter((entry) => entry.key && !entry.secret).map((entry) => [entry.key, entry.value ?? '']))
  return {
    kind: 'command',
    runtimeExecutable: executable,
    ...(args.length ? { runtimeArgs: args } : {}),
    workingDirectory: config.workingDirectory ?? '',
    ...(Object.keys(environment).length ? { environment } : {}),
  }
}

/** Richiesta di debug per un file JS/TS aperto nell'editor. */
export function webDebugScriptRequest(sessionId: string, relativePath: string, workingDirectory = ''): GoIDEWebDebugRequest {
  return { sessionId, kind: 'script', program: relativePath, workingDirectory }
}
