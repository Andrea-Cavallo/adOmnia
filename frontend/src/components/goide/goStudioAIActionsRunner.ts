import { monaco } from '@/lib/monacoSetup'
import { getGoIDEAIPolicy, listGoIDEAIExcludedPaths } from '@/lib/goide-api'
import { requestLocations } from '@/lib/goide-lsp-api'
import { getGoIDEFileAtRevision } from '@/lib/goide-vcs-api'
import { createAIRedactor } from '@/lib/aiRedaction'
import { useCopilotStore } from '@/stores/copilot'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { useGoIDETestsStore } from '@/stores/goideTests'
import { useGoStudioAssistantStore } from '@/stores/goStudioAssistant'
import { useMilkStore } from '@/stores/milk'
import { documentForModel } from './goStudioLanguageFeatures'
import { architectureFor, cachedArchitecture } from '@/lib/goide/architectureCache'
import {
  GO_STUDIO_AI_ACTIONS, architectureBrief, buildAIActionPrompt, enclosingTopLevelBlock, unifiedDiff,
  type GoStudioAIAction, type GoStudioAIBrief, type GoStudioAIContext,
} from './goStudioAIActions'

const MAX_REFERENCES = 25
const MAX_FAILING_TESTS = 5

function notify(message: string | null): void {
  useGoIDELspStore.setState({ message })
}

/** La chat già aperta vince; altrimenti quella pronta, milk prima di Copilot. */
function targetAssistant(): 'milk' | 'copilot' {
  const pane = useGoStudioAssistantStore.getState().pane
  if (pane === 'milk' || pane === 'copilot') return pane
  if (useMilkStore.getState().status?.state === 'ready') return 'milk'
  if (useCopilotStore.getState().status?.state === 'ready') return 'copilot'
  return useCopilotStore.getState().settings?.enabled && !useMilkStore.getState().settings?.enabled ? 'copilot' : 'milk'
}

function focusOf(editor: monaco.editor.ICodeEditor, model: monaco.editor.ITextModel): GoStudioAIContext['focus'] {
  const selection = editor.getSelection()
  if (selection && !selection.isEmpty()) {
    return { startLine: selection.startLineNumber, endLine: selection.endLineNumber, code: model.getValueInRange(selection), kind: 'selection' }
  }
  const lines = model.getLinesContent()
  const block = enclosingTopLevelBlock(lines, editor.getPosition()?.lineNumber ?? 1)
  if (block) return { ...block, code: lines.slice(block.startLine - 1, block.endLine).join('\n'), kind: 'function' }
  return { startLine: 1, endLine: lines.length, code: model.getValue(), kind: 'file' }
}

async function referencesAt(editor: monaco.editor.ICodeEditor, sessionId: string, documentId: string): Promise<{ symbol?: string; references: string[] }> {
  const model = editor.getModel()
  const position = editor.getPosition()
  const symbol = model && position ? model.getWordAtPosition(position)?.word : undefined
  if (!symbol || !position || useGoIDELspStore.getState().status[sessionId]?.state !== 'ready') return { references: [] }
  try {
    const locations = await requestLocations(sessionId, documentId, 'references', position.lineNumber, position.column)
    const references = locations.filter((location) => !location.external).slice(0, MAX_REFERENCES)
      .map((location) => `${location.relativePath ?? location.path}:${location.range.startLine}${location.preview ? ` ${location.preview.trim()}` : ''}`)
    return { symbol, references }
  } catch {
    return { symbol, references: [] }
  }
}

/** Ultima esecuzione dei test: test falliti e coverage del file, se c'è. */
function testContext(sessionId: string, relativePath: string): Pick<GoStudioAIContext, 'failingTests' | 'coverage'> {
  const runs = useGoIDETestsStore.getState().runs[sessionId] ?? []
  const latest = runs[runs.length - 1]
  const failingTests = (latest?.results ?? [])
    .filter((result) => result.status === 'fail' && result.name)
    .slice(0, MAX_FAILING_TESTS)
    .map((result) => ({ name: `${result.package}.${result.name}`, output: result.output ?? '' }))
  const covered = [...runs].reverse().find((run) => run.coverage)?.coverage?.files.find((file) => file.relativePath === relativePath)
  const coverage = covered ? { percent: covered.percent, uncovered: covered.functions.filter((fn) => fn.percent < 100).map((fn) => `${fn.name} (${fn.percent.toFixed(0)}%)`).slice(0, 20) } : undefined
  return { failingTests, coverage }
}

async function diffAgainstHead(sessionId: string, relativePath: string, buffer: string): Promise<string | undefined> {
  try {
    return unifiedDiff(await getGoIDEFileAtRevision(sessionId, relativePath, 'HEAD'), buffer) || undefined
  } catch {
    return undefined // file nuovo o progetto senza Git
  }
}

/** Analisi dell'Architecture Explorer (in cache se già fatta); senza analisi l'azione parte col solo codice. */
async function briefFor(sessionId: string, brief: GoStudioAIBrief): Promise<string | undefined> {
  try {
    if (!cachedArchitecture(sessionId)) notify('Analysing the project architecture for the AI…')
    return architectureBrief((await architectureFor(sessionId)).report, brief) || undefined
  } catch {
    return undefined // progetto non autorizzato o go/packages non disponibile
  }
}

async function blockedByPolicy(sessionId: string, relativePath: string): Promise<string | null> {
  // ponytail: milk e Copilot sono trattati come provider remoti (milk può avere agenti cloud).
  const excluded = await listGoIDEAIExcludedPaths(sessionId, [relativePath], false)
  if (!excluded.includes(relativePath)) return null
  const policy = await getGoIDEAIPolicy(sessionId).catch(() => 'allowed')
  if (policy === 'off') return 'AI is turned off for this project (.adomnia/ai-policy.json)'
  if (policy === 'local-only') return 'this project allows only local AI models (.adomnia/ai-policy.json)'
  return `${relativePath} is excluded from AI by .adomnia/aiignore`
}

/** Raccoglie il contesto e apre la chat con il prompt pronto: niente parte senza l'invio dell'utente. */
export async function runGoStudioAIAction(editor: monaco.editor.ICodeEditor, action: GoStudioAIAction): Promise<void> {
  const model = editor.getModel()
  const document = model ? documentForModel(model) : null
  if (!model || !document) return
  const { sessionId, relativePath, id: documentId } = document.document
  const problems = monaco.editor.getModelMarkers({ resource: model.uri })
    .filter((marker) => marker.severity >= monaco.MarkerSeverity.Warning)
    .sort((a, b) => b.severity - a.severity || a.startLineNumber - b.startLineNumber)
    .map((marker) => ({ line: marker.startLineNumber, message: marker.message, source: typeof marker.source === 'string' ? marker.source : undefined }))
  if (action.id === 'explain-error' && problems.length === 0) {
    notify('Explain Error: this file has no errors or warnings.')
    return
  }
  try {
    const blocked = await blockedByPolicy(sessionId, relativePath)
    if (blocked) {
      notify(`${action.label}: ${blocked}.`)
      return
    }
    notify(`${action.label}: collecting context…`)
    const buffer = model.getValue()
    const [references, diff, architecture] = await Promise.all([
      referencesAt(editor, sessionId, documentId),
      diffAgainstHead(sessionId, relativePath, buffer),
      action.brief ? briefFor(sessionId, action.brief) : Promise.resolve(undefined),
    ])
    const context: GoStudioAIContext = { relativePath, focus: focusOf(editor, model), problems, diff, architecture, ...references, ...testContext(sessionId, relativePath) }
    // I segreti nel codice restano sulla macchina anche quando il prompt si rilegge prima dell'invio.
    const prompt = createAIRedactor().redact(buildAIActionPrompt(action, context))
    notify(null)
    useGoStudioAssistantStore.getState().openWithDraft(targetAssistant(), prompt)
  } catch (error) {
    notify(`${action.label} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Registra le azioni AI sull'editor: le principali nel menu contestuale, tutte nella palette (F1). */
export function installGoStudioAIActions(editor: monaco.editor.IStandaloneCodeEditor): void {
  GO_STUDIO_AI_ACTIONS.forEach((action, index) => {
    editor.addAction({
      id: `goStudio.ai.${action.id}`,
      label: `AI: ${action.label}`,
      contextMenuGroupId: action.contextMenu ? '9_ai' : undefined,
      contextMenuOrder: index,
      run: (target) => { void runGoStudioAIAction(target, action) },
    })
  })
}
