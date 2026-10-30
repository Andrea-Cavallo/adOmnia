import { useCodeStudioStore } from '@/stores/codeStudio'
import { GO_LANGUAGE_ID } from '@/lib/code-studio/goLanguage'
import { ideLanguageForEditor } from '@/components/ide/languages'

const RESTART_DELAY_MS = 300
const timers = new Map<string, number>()

/** File appena salvato: percorso relativo al progetto e ID Monaco del suo linguaggio. */
export interface SavedFile {
  relativePath: string
  editorLanguage: string
}

type RestartState = Pick<ReturnType<typeof useCodeStudioStore.getState>, 'executions' | 'configByRun' | 'runConfigsBySession'>
type RestartConfig = { language?: string; workingDirectory?: string; target?: string; programArguments?: string[] }

const slash = (path: string) => path.replace(/\\/g, '/').replace(/^\.\/?/, '').replace(/(^|[^/])\/+$/, '$1')

// Cartelle di output e dipendenze: salvarvi un file non è una modifica al sorgente e farebbe ripartire il servizio in loop.
const GENERATED_PATH = /(^|\/)(node_modules|target|build|dist|out|vendor|\.git|\.gradle|\.next|\.idea)(\/|$)/
const NATIVE_WATCHERS = new Set(['air', 'nodemon', 'vite', 'next', 'nuxt', 'ng', 'webpack-dev-server', 'ts-node-dev', 'tsx', 'reflex'])
const NATIVE_SCRIPTS = new Set(['dev', 'serve', 'watch'])

/** Il comando ricarica già da solo (Vite, air, nodemon, `npm run dev`…): riavviarlo dal processo sarebbe un doppio riavvio. */
export function reloadsByItself(config: RestartConfig): boolean {
  const tool = (config.target ?? '').split(/[/]/).pop()?.replace(/\.(cmd|exe)$/i, '') ?? ''
  return NATIVE_WATCHERS.has(tool) || (config.programArguments ?? []).some((argument) => NATIVE_SCRIPTS.has(argument))
}

/** Il file salvato appartiene al linguaggio della configurazione ed è dentro la sua working directory. */
function affectsConfiguration(config: RestartConfig, saved: SavedFile): boolean {
  if (GENERATED_PATH.test(slash(saved.relativePath))) return false
  // Come il backend: una configurazione senza linguaggio è Go.
  const configLanguage = config.language || GO_LANGUAGE_ID
  if (ideLanguageForEditor(saved.editorLanguage)?.id !== configLanguage) return false
  const directory = slash(config.workingDirectory ?? '')
  const file = slash(saved.relativePath)
  return directory === '' || file === directory || file.startsWith(`${directory}/`)
}

/**
 * Esecuzioni da riavviare: in corso, avviate da una configurazione con "Restart on save" attivo.
 * Con `saved` si riavviano solo quelle toccate dal file (stesso linguaggio, dentro la loro cartella):
 * in un workspace misto salvare un .go non deve far ripartire il servizio Node.
 */
export function runsToRestart(state: RestartState, sessionId: string, saved?: SavedFile): string[] {
  const configs = state.runConfigsBySession[sessionId] ?? []
  return state.executions
    .filter((execution) => execution.sessionId === sessionId && execution.status === 'running')
    .filter((execution) => configs.some((config) => config.id === state.configByRun[execution.id] && config.restartOnSave && !reloadsByItself(config) && (!saved || affectsConfiguration(config, saved))))
    .map((execution) => execution.id)
}

/**
 * Hot restart: dopo il salvataggio di un sorgente di un linguaggio dell'IDE riparte ogni esecuzione
 * con "Restart on save" che lo riguarda. Più salvataggi ravvicinati (Save All) producono un riavvio per esecuzione.
 */
export function restartRunsOnSave(sessionId: string, saved: SavedFile): void {
  if (!ideLanguageForEditor(saved.editorLanguage)) return
  const key = `${sessionId}|${saved.editorLanguage}|${saved.relativePath.split(/[\\/]/)[0]}`
  window.clearTimeout(timers.get(key))
  timers.set(key, window.setTimeout(() => {
    timers.delete(key)
    const state = useCodeStudioStore.getState()
    for (const runId of runsToRestart(state, sessionId, saved)) void state.restartRun(runId)
  }, RESTART_DELAY_MS))
}
