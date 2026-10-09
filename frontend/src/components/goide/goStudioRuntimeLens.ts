import { monaco } from '@/lib/monacoSetup'
import { useGoIDEStore } from '@/stores/goide'
import { getServerPort } from '@/lib/useServerPort'
import { getOtlpLens, type OtlpLensStat } from '@/lib/otlp-api'
import { relativeToRoots } from '@/lib/sourcePaths'
import { lensTitle, lensTooltip } from '@/lib/goide/runtimeLens'
import { documentForModel } from './goStudioLanguageFeatures'

// Runtime Lens: above the code that started OpenTelemetry spans, how it behaved at runtime.
// Data comes only from the local OTLP receiver; polling stops while the lens is off.
const LANGUAGE = 'go'
const COMMAND = 'goStudio.runtimeLensInfo'
const STORAGE_KEY = 'adomnia.goStudio.runtimeLens'
const POLL_MS = 3000

let registered = false
let timer: number | null = null
let snapshot = ''
let byFile = new Map<string, OtlpLensStat[]>() // sessionId \u0000 relativePath → stats
const changed = new monaco.Emitter<monaco.languages.CodeLensProvider>()

export function runtimeLensEnabled(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== 'off' } catch { return true }
}

async function poll(provider: monaco.languages.CodeLensProvider): Promise<void> {
  const port = await getServerPort()
  if (!port) return
  const stats = await getOtlpLens(port).catch(() => [] as OtlpLensStat[])
  const key = JSON.stringify(stats)
  if (key === snapshot) return
  snapshot = key
  const roots = useGoIDEStore.getState().sessions.map((session) => ({ id: session.id, root: session.project.rootPath }))
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

function schedule(provider: monaco.languages.CodeLensProvider): void {
  if (timer !== null) window.clearInterval(timer)
  timer = null
  if (!runtimeLensEnabled()) {
    byFile = new Map()
    snapshot = ''
    changed.fire(provider)
    return
  }
  void poll(provider)
  timer = window.setInterval(() => void poll(provider), POLL_MS)
}

let providerRef: monaco.languages.CodeLensProvider | null = null

/** Turns the Runtime Lens on or off (remembered locally). */
export function setRuntimeLensEnabled(enabled: boolean): void {
  try { localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off') } catch { /* private mode: session only */ }
  if (providerRef) schedule(providerRef)
}

export function registerGoStudioRuntimeLens(): void {
  if (registered) return
  registered = true
  monaco.editor.registerCommand(COMMAND, () => undefined) // the numbers are the information; details are in the tooltip
  const provider: monaco.languages.CodeLensProvider = {
    onDidChange: changed.event,
    provideCodeLenses: (model) => {
      const document = documentForModel(model)
      const stats = document ? byFile.get(`${document.document.sessionId}\u0000${document.document.relativePath}`) : undefined
      if (!stats?.length) return { lenses: [], dispose: () => undefined }
      const maxCount = Math.max(...stats.map((stat) => stat.count))
      const now = Date.now()
      return {
        lenses: stats.map((stat) => ({
          range: { startLineNumber: stat.line, startColumn: 1, endLineNumber: stat.line, endColumn: 1 },
          command: { id: COMMAND, title: lensTitle(stat, maxCount, now), tooltip: lensTooltip(stat) },
        })),
        dispose: () => undefined,
      }
    },
  }
  providerRef = provider
  monaco.languages.registerCodeLensProvider(LANGUAGE, provider)
  schedule(provider)
}
