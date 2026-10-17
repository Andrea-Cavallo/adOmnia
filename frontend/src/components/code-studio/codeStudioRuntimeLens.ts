import { currentActivityPhase, pollingDelay, useActivityStore } from '@/stores/activity'
import { monaco } from '@/lib/monacoSetup'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { getServerPort } from '@/lib/useServerPort'
import { getOtlpLens, type OtlpLensStat } from '@/lib/otlp-api'
import { relativeToRoots } from '@/lib/sourcePaths'
import { fileCounts, lensPollDelayMs, lensTitle, lensTooltip } from '@/lib/code-studio/runtimeLens'
import { documentForModel } from './codeStudioLanguageFeatures'
import { useCodeStudioRuntimeProfile } from '@/stores/codeStudioRuntimeProfile'
import { formatProfileValue } from './codeStudioProfiles'

// Runtime Lens: above the code that started OpenTelemetry spans, how it behaved at runtime.
// Data comes only from the local OTLP receiver; polling stops while the lens is off.
const LANGUAGE = 'go'
const COMMAND = 'codeStudio.runtimeLensInfo'
const STORAGE_KEY = 'adomnia.codeStudio.runtimeLens'

let registered = false
let timer: number | null = null
let snapshot = ''
let emptyPolls = 0
let activityBound = false
let generation = 0
let inFlight: Promise<OtlpLensStat[]> | null = null
let byFile = new Map<string, OtlpLensStat[]>() // sessionId \u0000 relativePath → stats
const changed = new monaco.Emitter<monaco.languages.CodeLensProvider>()

export function runtimeLensEnabled(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== 'off' } catch { return true }
}

async function poll(): Promise<OtlpLensStat[]> {
  const port = await getServerPort()
  return port ? getOtlpLens(port).catch(() => [] as OtlpLensStat[]) : []
}

function applyStats(stats: OtlpLensStat[], provider: monaco.languages.CodeLensProvider): void {
  const key = JSON.stringify(stats)
  if (key !== snapshot) {
    snapshot = key
    const roots = useCodeStudioStore.getState().sessions.map((session) => ({ id: session.id, root: session.project.rootPath }))
    const next = new Map<string, OtlpLensStat[]>()
    for (const stat of stats) {
      const match = relativeToRoots(stat.file, roots)
      if (!match) continue
      const fileKey = `${match.sessionId}\u0000${match.relativePath}`
      next.set(fileKey, [...(next.get(fileKey) ?? []), stat])
    }
    byFile = next
    changed.fire(provider)
  }
}

function schedule(provider: monaco.languages.CodeLensProvider): void {
  const epoch = ++generation
  if (timer !== null) window.clearTimeout(timer)
  timer = null
  if (!runtimeLensEnabled()) {
    byFile = new Map(); snapshot = ''; emptyPolls = 0; changed.fire(provider)
    return
  }
  if (!activityBound) {
    activityBound = true
    useActivityStore.subscribe((state, previous) => {
      if (state.phase !== previous.phase || state.scopes !== previous.scopes) schedule(provider)
    })
  }
  const delay = () => pollingDelay(lensPollDelayMs(emptyPolls), currentActivityPhase('codestudio'))
  const run = async (): Promise<void> => {
    if (epoch !== generation || delay() === null) return
    inFlight ??= poll().catch(() => [] as OtlpLensStat[]).finally(() => { inFlight = null })
    const stats = await inFlight
    if (epoch !== generation || delay() === null) return
    applyStats(stats, provider)
    emptyPolls = stats.length ? 0 : emptyPolls + 1
    const ms = delay()
    if (ms !== null) timer = window.setTimeout(() => void run(), ms)
  }
  void run()
}

let providerRef: monaco.languages.CodeLensProvider | null = null

/** Turns the Runtime Lens on or off (remembered locally). */
export function setRuntimeLensEnabled(enabled: boolean): void {
  try { localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off') } catch { /* private mode: session only */ }
  if (providerRef) schedule(providerRef)
}

export function registerCodeStudioRuntimeLens(): void {
  if (registered) return
  registered = true
  monaco.editor.registerCommand(COMMAND, () => undefined) // the numbers are the information; details are in the tooltip
  const provider: monaco.languages.CodeLensProvider = {
    onDidChange: changed.event,
    provideCodeLenses: (model) => {
      const document = documentForModel(model)
      const stats = document ? byFile.get(`${document.document.sessionId}\u0000${document.document.relativePath}`) : undefined
      const costs = document && runtimeLensEnabled() ? (useCodeStudioRuntimeProfile.getState().costs[document.document.sessionId] ?? []).filter(cost=>cost.file===document.document.relativePath) : []
      if (!stats?.length && !costs.length) return { lenses: [], dispose: () => undefined }
      const counts = fileCounts(stats ?? [])
      const now = Date.now()
      return {
        lenses: [...(stats ?? []).map((stat) => ({
          range: { startLineNumber: stat.line, startColumn: 1, endLineNumber: stat.line, endColumn: 1 },
          command: { id: COMMAND, title: lensTitle(stat, counts, now), tooltip: lensTooltip(stat) },
        })),...costs.map(cost=>({range:{startLineNumber:cost.line,startColumn:1,endLineNumber:cost.line,endColumn:1},command:{id:COMMAND,title:`sampled ${cost.function?'function ':''}${cost.metric==='cpu'?'CPU':cost.metric==='alloc_space'?'allocations':'allocated objects'}: ${formatProfileValue(cost.value,cost.unit)}`,tooltip:`${cost.function ?? cost.file}:${cost.line} · ${cost.profile} · ${cost.at}. Sampled profile estimate; not exact per-call cost.`}}))],
        dispose: () => undefined,
      }
    },
  }
  providerRef = provider
  useCodeStudioRuntimeProfile.subscribe(()=>changed.fire(provider))
  monaco.languages.registerCodeLensProvider(LANGUAGE, provider)
  schedule(provider)
}

/** Runtime Lens stats of one file (last poll), for the Context pane. */
export function runtimeLensStats(sessionId: string, relativePath: string): OtlpLensStat[] {
  return byFile.get(`${sessionId}\u0000${relativePath}`) ?? []
}
