import { goModules } from '@/lib/goide/goProject'
import * as AIEngine from '../../../bindings/adomnia/aiengine'
import { closeGoIDEDocument, getGoIDEAIPolicy, isLocalAIProvider, listGoIDEAIExcludedPaths, listGoIDEDirectory, openGoIDEDocument } from '@/lib/goide-api'
import { createAIRedactor } from '@/lib/aiRedaction'
import type { GoIDEFileChange, GoIDEWorkspaceChange } from '@/lib/goide-lsp-api'
import { isAICompanionAvailable } from '@/lib/aiAvailability'
import { ensureAIConfigured } from '@/lib/aiEngine'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { useSettingsStore } from '@/stores/settings'
import {
  MAX_AI_FIX_FILE_CHARS, MAX_AI_FIX_RELATED_FILES, buildAIFixPrompt, lineEditsFor, localPackageDirForProblem, parseAIFixResponse,
  type AIFixFile, type AIFixProblem,
} from './goStudioAIFix'

const AI_FIX_MAX_TOKENS = 8192

/** Vero se nelle Settings c'è un provider AI attivo e verificato: solo allora compare "Fix with AI". */
export function goStudioAIFixAvailable(): boolean {
  return isAICompanionAvailable(useSettingsStore.getState().settings.ai)
}

interface SourceFile extends AIFixFile {
  uri: string
  path: string
  documentId?: string
}

/** Legge i file .go del package (non i test) senza lasciarli aperti se non lo erano già. */
async function readPackageFiles(sessionId: string, directory: string, exclude: string): Promise<SourceFile[]> {
  const entries = await listGoIDEDirectory(sessionId, directory)
  const files: SourceFile[] = []
  for (const entry of entries) {
    if (files.length >= MAX_AI_FIX_RELATED_FILES) break
    if (entry.directory || !entry.name.endsWith('.go') || entry.name.endsWith('_test.go') || entry.relativePath === exclude) continue
    const open = useGoIDEStore.getState().documents.find((item) => item.document.sessionId === sessionId && item.document.relativePath === entry.relativePath)
    if (open) {
      if (open.buffer.length <= MAX_AI_FIX_FILE_CHARS) files.push({ relativePath: entry.relativePath, content: open.buffer, uri: open.document.uri, path: open.document.path, documentId: open.document.id })
      continue
    }
    const opened = await openGoIDEDocument(sessionId, entry.relativePath)
    void closeGoIDEDocument(sessionId, opened.document.id).catch(() => undefined)
    if (opened.content.length <= MAX_AI_FIX_FILE_CHARS) files.push({ relativePath: entry.relativePath, content: opened.content, uri: opened.document.uri, path: opened.document.path })
  }
  return files
}

function notify(message: string | null): void {
  useGoIDELspStore.setState({ message })
}

/** Chiede una correzione per un file: restituisce le modifiche proposte o il motivo per cui non ce ne sono. */
async function proposeFix(relativePath: string, problem: AIFixProblem, otherProblems: AIFixProblem[]): Promise<GoIDEFileChange[] | string> {
  const store = useGoIDEStore.getState()
  const sessionId = store.activeSessionId
  const session = store.sessions.find((item) => item.id === sessionId)
  if (!sessionId || !session) return 'no project is open'
  const document = await store.ensureDocumentLoaded(relativePath)
  if (!document) return `${relativePath} could not be opened`
  if (document.buffer.length > MAX_AI_FIX_FILE_CHARS) return `${relativePath} is too large to send (limit ${MAX_AI_FIX_FILE_CHARS / 1000}k characters)`
  const target: SourceFile = { relativePath, content: document.buffer, uri: document.document.uri, path: document.document.path, documentId: document.document.id }
  const packageDir = localPackageDirForProblem(problem.message, document.buffer, goModules(session.project))
  const candidates = packageDir === null ? [] : await readPackageFiles(sessionId, packageDir, relativePath)
  // .adomnia/aiignore e i file segreti noti non lasciano mai la macchina, nemmeno come contesto.
  const local = isLocalAIProvider(useSettingsStore.getState().settings.ai)
  const excluded = new Set(await listGoIDEAIExcludedPaths(sessionId, [relativePath, ...candidates.map((file) => file.relativePath)], local))
  if (excluded.has(relativePath)) {
    const policy = await getGoIDEAIPolicy(sessionId).catch(() => 'allowed')
    if (policy === 'off') return 'AI is turned off for this project (.adomnia/ai-policy.json)'
    if (policy === 'local-only' && !local) return 'this project allows only local AI models (.adomnia/ai-policy.json): use Ollama or a localhost endpoint'
    return `${relativePath} is excluded from AI by .adomnia/aiignore`
  }
  const related = candidates.filter((file) => !excluded.has(file.relativePath))
  // I segreti nel codice diventano segnaposto e tornano al loro posto nella risposta.
  const redactor = createAIRedactor()
  const hidden = (file: SourceFile): AIFixFile => ({ relativePath: file.relativePath, content: redactor.redact(file.content) })
  const prompt = buildAIFixPrompt(hidden(target), { ...problem, message: redactor.redact(problem.message) }, otherProblems.map((item) => ({ ...item, message: redactor.redact(item.message) })), related.map(hidden))
  await ensureAIConfigured()
  const response = redactor.restore(await AIEngine.Complete(prompt.system, prompt.user, AI_FIX_MAX_TOKENS))
  const sources = new Map([target, ...related].map((file) => [file.relativePath, file]))
  const files = parseAIFixResponse(response, [...sources.keys()]).flatMap((proposal) => {
    const source = sources.get(proposal.relativePath)!
    const { edits, newContent } = lineEditsFor(source.content, proposal.content)
    if (edits.length === 0) return []
    return [{ uri: source.uri, path: source.path, relativePath: source.relativePath, documentId: source.documentId, edits, newContent, originalContent: source.content.replace(/\r\n/g, '\n') } as GoIDEFileChange]
  })
  return files.length > 0 ? files : 'the AI did not propose a usable change'
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Chiede all'AI configurata in adOmnia una correzione per il problema indicato e la mostra
 * nell'anteprima delle modifiche: nulla viene scritto senza conferma, e il risultato resta
 * annullabile. Il file (e, per `undefined: pkg.X`, il package locale) viene inviato al provider AI
 * scelto dall'utente nelle Settings.
 */
export async function fixGoStudioProblemWithAI(relativePath: string, problem: AIFixProblem, otherProblems: AIFixProblem[] = []): Promise<void> {
  if (!goStudioAIFixAvailable()) {
    notify('Fix with AI needs an AI provider: enable and test one in Settings → AI.')
    return
  }
  const provider = useSettingsStore.getState().settings.ai.provider
  notify(`Fix with AI: asking ${provider} about "${problem.message}"…`)
  try {
    const result = await proposeFix(relativePath, problem, otherProblems)
    if (typeof result === 'string') {
      notify(`Fix with AI: ${result}.`)
      return
    }
    notify(null)
    // Sempre in anteprima, anche per un solo file: una proposta dell'AI va letta prima di applicarla.
    useGoIDELspStore.setState({ pendingChange: { label: `Fix with AI · ${problem.message}`, files: result } as GoIDEWorkspaceChange })
  } catch (error) {
    notify(`Fix with AI failed: ${errorText(error)}`)
  }
}

export interface AIFixTarget {
  relativePath: string
  /** Problemi del file, il più grave per primo. */
  problems: AIFixProblem[]
}

/** Oltre questo numero di file la richiesta si ferma: ogni file è una chiamata al provider. */
export const MAX_RESOLVE_ALL_FILES = 10

/**
 * Resolve all with AI: una richiesta per file con tutti i suoi problemi, poi un'unica anteprima
 * con tutte le modifiche da confermare. Se due proposte toccano lo stesso file vale la prima.
 */
export async function resolveAllGoStudioProblemsWithAI(targets: readonly AIFixTarget[]): Promise<void> {
  if (!goStudioAIFixAvailable()) {
    notify('Resolve all with AI needs an AI provider: enable and test one in Settings → AI.')
    return
  }
  const queue = targets.filter((target) => target.problems.length > 0).slice(0, MAX_RESOLVE_ALL_FILES)
  const changes = new Map<string, GoIDEFileChange>()
  const skipped: string[] = []
  for (const [index, target] of queue.entries()) {
    notify(`Resolve all with AI: ${target.relativePath} (${index + 1}/${queue.length})…`)
    try {
      const [first, ...others] = target.problems
      const result = await proposeFix(target.relativePath, first, others)
      if (typeof result === 'string') skipped.push(`${target.relativePath}: ${result}`)
      else for (const file of result) if (!changes.has(file.relativePath)) changes.set(file.relativePath, file)
    } catch (error) {
      skipped.push(`${target.relativePath}: ${errorText(error)}`)
    }
  }
  const limited = targets.length > queue.length ? ` Only the first ${MAX_RESOLVE_ALL_FILES} files were sent.` : ''
  if (changes.size === 0) {
    notify(`Resolve all with AI: no usable change.${skipped.length ? ` ${skipped.join('; ')}` : ''}${limited}`)
    return
  }
  notify(skipped.length || limited ? `Resolve all with AI: review the proposed changes.${skipped.length ? ` Skipped ${skipped.join('; ')}.` : ''}${limited}` : null)
  useGoIDELspStore.setState({ pendingChange: { label: `Resolve all with AI · ${changes.size} file${changes.size === 1 ? '' : 's'}`, files: [...changes.values()] } as GoIDEWorkspaceChange })
}
