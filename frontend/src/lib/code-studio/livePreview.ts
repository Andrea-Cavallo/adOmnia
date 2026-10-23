import type { LivePreview, LivePreviewConfig, LivePreviewReport, LivePreviewRequest, LivePreviewTarget } from '../livepreview-api'

/** Dove vive la Live Preview nell'IDE. */
export type LivePreviewPlacement = 'panel' | 'split' | 'tab' | 'window'

export type DeviceId = 'desktop' | 'tablet' | 'mobile' | 'custom'

export interface DevicePreset {
  id: DeviceId
  label: string
  /** null = occupa tutta la larghezza disponibile. */
  width: number | null
  height: number | null
}

export const DEVICES: ReadonlyArray<DevicePreset> = [
  { id: 'desktop', label: 'Desktop', width: null, height: null },
  { id: 'tablet', label: 'Tablet · 768 × 1024', width: 768, height: 1024 },
  { id: 'mobile', label: 'Mobile · 390 × 844', width: 390, height: 844 },
  { id: 'custom', label: 'Custom width', width: 600, height: null },
]

export const MIN_VIEWPORT = 240
export const MAX_VIEWPORT = 4000

export const DEFAULT_PLACEMENT: LivePreviewPlacement = 'split'

export function isPlacement(value: string | undefined): value is LivePreviewPlacement {
  return value === 'panel' || value === 'split' || value === 'tab' || value === 'window'
}

export function clampViewport(value: number): number {
  return Math.min(MAX_VIEWPORT, Math.max(MIN_VIEWPORT, Math.round(value) || MIN_VIEWPORT))
}

/** Dimensioni della viewport per il dispositivo scelto; null = tutta la larghezza disponibile. */
export function viewportFor(device: DeviceId, customWidth: number, customHeight: number): { width: number | null; height: number | null } {
  if (device === 'desktop') return { width: null, height: null }
  const preset = DEVICES.find((item) => item.id === device)
  if (device === 'custom') return { width: clampViewport(customWidth || preset?.width || 600), height: customHeight ? clampViewport(customHeight) : null }
  return { width: preset?.width ?? null, height: preset?.height ?? null }
}

export type PreviewPhase = 'idle' | 'starting' | 'ready' | 'stopping' | 'failed'

export function phaseOf(preview: LivePreview | null | undefined): PreviewPhase {
  switch (preview?.state as string | undefined) {
    case 'starting': return 'starting'
    case 'ready': return 'ready'
    case 'stopping': return 'stopping'
    case 'failed': return 'failed'
    default: return 'idle'
  }
}

export function isRunning(preview: LivePreview | null | undefined): boolean {
  const phase = phaseOf(preview)
  return phase === 'starting' || phase === 'ready' || phase === 'stopping'
}

/** Indirizzo della pagina da mostrare: URL base più la pagina di ingresso del sito statico. */
export function pageUrl(preview: LivePreview, path = ''): string {
  const base = (preview.url ?? '').replace(/(?<!\/)\/+$/, '')
  const target = (path || preview.entry || '').replace(/^\/+/, '')
  return target ? `${base}/${target}` : `${base}/`
}

/** Anteprima da mostrare: quella attiva se c'è, altrimenti l'ultima avviata. */
export function currentPreview(previews: ReadonlyArray<LivePreview>, activeId: string | null): LivePreview | null {
  if (!previews.length) return null
  return previews.find((preview) => preview.id === activeId)
    ?? previews.find((preview) => isRunning(preview))
    ?? [...previews].sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)))[0]
}

export function upsertPreview(previews: ReadonlyArray<LivePreview>, next: LivePreview): LivePreview[] {
  const index = previews.findIndex((preview) => preview.id === next.id)
  if (index < 0) return [...previews, next]
  return previews.map((preview, at) => (at === index ? next : preview))
}

/** Una scelta proponibile all'utente: cosa avviare e come chiamarlo. */
export interface PreviewChoice {
  key: string
  label: string
  detail: string
  request: LivePreviewRequest
}

function devChoice(target: LivePreviewTarget): PreviewChoice {
  const name = target.relative === '.' ? target.name || 'project' : target.relative
  const tool = target.tool ? ` · ${target.tool}` : ''
  return {
    key: `dev:${target.relative}:${target.devScript}`,
    label: `${name} · ${target.packageManager} run ${target.devScript}`,
    detail: `${target.framework || 'Node.js'}${tool}`,
    request: { mode: 'devserver', dir: target.relative, script: target.devScript },
  }
}

function staticChoice(target: LivePreviewTarget): PreviewChoice {
  const name = target.relative === '.' ? 'project folder' : target.relative
  return {
    key: `static:${target.relative}`,
    label: `${name} · static site`,
    detail: 'Served by adOmnia with live reload',
    request: { mode: 'static', dir: target.relative, entry: target.entryHtml || '' },
  }
}

/** Tutto ciò che il progetto può avviare: dev server degli script `dev`/`start` e siti statici. */
export function previewChoices(report: LivePreviewReport | null): PreviewChoice[] {
  if (!report) return []
  const choices: PreviewChoice[] = []
  for (const target of report.targets) {
    if (target.kind === 'node' && target.devScript) choices.push(devChoice(target))
  }
  for (const target of report.targets) {
    if (target.entryHtml) choices.push(staticChoice(target))
  }
  return choices
}

function sameRequest(config: LivePreviewConfig, choice: PreviewChoice): boolean {
  return config.mode === choice.request.mode && config.dir === choice.request.dir && (config.mode !== 'devserver' || !config.script || config.script === choice.request.script)
}

/** Cosa avviare con "Go Live": l'ultima configurazione se è ancora valida, l'unica scelta possibile, altrimenti null (si chiede). */
export function pickChoice(report: LivePreviewReport | null): PreviewChoice | null {
  const choices = previewChoices(report)
  const saved = report?.config
  if (saved?.mode) {
    const match = choices.find((choice) => sameRequest(saved, choice))
    if (match) return { ...match, request: { ...match.request, entry: saved.entry || match.request.entry, spa: saved.spa } }
  }
  // Senza scelte salvate: un solo dev server vince sul sito statico (un progetto Vite ha anche un index.html).
  const servers = choices.filter((choice) => choice.request.mode === 'devserver')
  if (servers.length) return servers.length === 1 ? servers[0] : null
  return choices.length === 1 ? choices[0] : null
}

/** Richiesta di un sito statico per un file HTML aperto: radice = progetto se ha un index.html, altrimenti la cartella del file. */
export function staticRequestForFile(relativePath: string, projectHasIndex: boolean): LivePreviewRequest {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (projectHasIndex) return { mode: 'static', dir: '.', entry: normalized }
  const slash = normalized.lastIndexOf('/')
  return slash < 0 ? { mode: 'static', dir: '.', entry: normalized } : { mode: 'static', dir: normalized.slice(0, slash), entry: normalized.slice(slash + 1) }
}

const WEB_UNIT_LANGUAGES = ['typescript', 'html', 'css', 'json']

/** Il progetto ha solo unità web (nessun modulo Go): ▶ Run significa Go Live. */
export function isWebOnlyProject(project: { units?: ReadonlyArray<{ language: string }> | null }): boolean {
  const units = project.units ?? []
  return units.length > 0 && units.every((unit) => WEB_UNIT_LANGUAGES.includes(unit.language))
}

export function isHtmlPath(relativePath: string): boolean {
  return /\.html?$/i.test(relativePath)
}

/** Messaggio dal bridge nella pagina (live.js) verso l'IDE. */
export type BridgeMessage =
  | { type: 'ready'; url: string; title: string }
  | { type: 'navigated'; url: string; title: string }
  | { type: 'console'; level: 'log' | 'info' | 'warn' | 'error' | 'debug'; text: string }
  | { type: 'error'; message: string; source?: string; line?: number; column?: number; stack?: string }
  | { type: 'asset-error'; tag: string; url: string }
  | { type: 'network'; method: string; url: string; status: number; ok: boolean; ms: number; error?: string }
  | { type: 'reloading' }
  | { type: 'css-updated' }
  | { type: 'change-ignored' }

const LEVELS = new Set(['log', 'info', 'warn', 'error', 'debug'])

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

/** Valida un postMessage del bridge: scarta tutto ciò che non ha la forma attesa. */
export function parseBridgeMessage(data: unknown): BridgeMessage | null {
  if (!data || typeof data !== 'object') return null
  const message = data as { source?: unknown; type?: unknown; detail?: unknown }
  if (message.source !== 'adomnia-preview' || typeof message.type !== 'string') return null
  const detail = (message.detail && typeof message.detail === 'object' ? message.detail : {}) as Record<string, unknown>
  switch (message.type) {
    case 'ready':
    case 'navigated': return { type: message.type, url: text(detail.url), title: text(detail.title) } as BridgeMessage
    case 'console': return { type: 'console', level: LEVELS.has(text(detail.level)) ? (text(detail.level) as 'log') : 'log', text: text(detail.text) }
    case 'error': return { type: 'error', message: text(detail.message) || 'Script error', source: text(detail.source) || undefined, line: num(detail.line) || undefined, column: num(detail.column) || undefined, stack: text(detail.stack) || undefined }
    case 'asset-error': return { type: 'asset-error', tag: text(detail.tag), url: text(detail.url) }
    case 'network': return { type: 'network', method: text(detail.method) || 'GET', url: text(detail.url), status: num(detail.status), ok: detail.ok === true, ms: num(detail.ms), error: text(detail.error) || undefined }
    case 'reloading':
    case 'css-updated':
    case 'change-ignored': return { type: message.type } as BridgeMessage
    default: return null
  }
}

/** Voce del registro console/network della preview. */
export interface BridgeLogEntry {
  id: number
  at: number
  message: Exclude<BridgeMessage, { type: 'ready' | 'navigated' | 'reloading' | 'css-updated' | 'change-ignored' }>
}

export const MAX_BRIDGE_LOG = 400

/** Un errore di compilazione o runtime con posizione nel sorgente. */
export interface BuildProblem {
  path: string
  line: number
  column: number
  message: string
}

const LOCATION = /(?<![^\s:()'"`<>|])((?:[A-Za-z]:)?[^\s:()'"`<>|]+\.(?:[cm]?[jt]sx?|css|scss|less|vue|svelte|html?|json)):(\d+)(?::(\d+))?|(?<![^\s:()'"`<>|])((?:[A-Za-z]:)?[^\s:()'"`<>|]+\.(?:[cm]?[jt]sx?|vue|svelte))\((\d+),(\d+)\)/
const ERROR_WORD = /(?<![a-z])(error|failed|cannot|unexpected|expected|syntaxerror|typeerror|referenceerror|not defined|is not|ts\d{4})(?![a-z])/i

/** Righe che il dev server stampa sopra la posizione (Vite/oxc: "[PARSE_ERROR] …" poi "╭─[ file:riga:col ]"). */
const MESSAGE_WINDOW = 6

/** Estrae dall'output di un dev server le righe che indicano un errore in un file (per aprirlo alla riga giusta). */
export function extractBuildProblems(output: string, limit = 20): BuildProblem[] {
  const problems: BuildProblem[] = []
  const seen = new Set<string>()
  let lastMessage = ''
  let sinceMessage = Infinity
  for (const raw of output.split('\n')) {
    const line = raw.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').trim()
    sinceMessage += 1
    if (!line) continue
    const isError = ERROR_WORD.test(line)
    const match = LOCATION.exec(line)
    if (isError && !match) {
      lastMessage = line
      sinceMessage = 0
      continue
    }
    if (!match) continue
    // La riga di posizione senza parole d'errore appartiene al messaggio appena sopra.
    const message = isError ? line : sinceMessage <= MESSAGE_WINDOW ? lastMessage : ''
    if (!message) continue
    const path = (match[1] ?? match[4]).replace(/^file:\/\/\/?/, '')
    const at = Number(match[2] ?? match[5])
    const column = Number(match[3] ?? match[6] ?? 1)
    if (path.includes('node_modules') || !at) continue
    const key = `${path}:${at}:${column}`
    if (seen.has(key)) continue
    seen.add(key)
    problems.push({ path, line: at, column, message: message.length > 220 ? `${message.slice(0, 217)}…` : message })
    if (problems.length >= limit) break
  }
  return problems
}

/** Percorso di un problema rispetto alla radice del progetto, se sta dentro la cartella di lavoro. */
export function problemRelativePath(problemPath: string, workingDirectory: string, projectRelativeDir: string): string {
  const slashes = problemPath.replace(/\\/g, '/')
  const cwd = workingDirectory.replace(/\\/g, '/').replace(/(?<!\/)\/+$/, '')
  if (cwd && slashes.toLowerCase().startsWith(`${cwd.toLowerCase()}/`)) return joinRelative(projectRelativeDir, slashes.slice(cwd.length + 1))
  if (/^([A-Za-z]:)?\//.test(slashes)) return joinRelative(projectRelativeDir, slashes.replace(/^\/+/, ''))
  return joinRelative(projectRelativeDir, slashes.replace(/^\.\//, ''))
}

function joinRelative(directory: string, file: string): string {
  const base = directory === '.' || directory === '' ? '' : `${directory.replace(/(?<!\/)\/+$/, '')}/`
  return `${base}${file}`
}
