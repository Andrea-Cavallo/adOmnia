import * as AIEngine from '../../../bindings/adomnia/aiengine'
import { closeGoIDEDocument, listGoIDEDirectory, openGoIDEDocument } from '@/lib/goide-api'
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
  const store = useGoIDEStore.getState()
  const sessionId = store.activeSessionId
  const session = store.sessions.find((item) => item.id === sessionId)
  if (!sessionId || !session) return
  const document = await store.ensureDocumentLoaded(relativePath)
  if (!document) return
  if (document.buffer.length > MAX_AI_FIX_FILE_CHARS) {
    notify(`Fix with AI: ${relativePath} is too large to send (limit ${MAX_AI_FIX_FILE_CHARS / 1000}k characters).`)
    return
  }
  const provider = useSettingsStore.getState().settings.ai.provider
  notify(`Fix with AI: asking ${provider} about "${problem.message}"…`)
  try {
    const target: SourceFile = { relativePath, content: document.buffer, uri: document.document.uri, path: document.document.path, documentId: document.document.id }
    const packageDir = localPackageDirForProblem(problem.message, document.buffer, session.project.modules ?? [])
    const related = packageDir === null ? [] : await readPackageFiles(sessionId, packageDir, relativePath)
    const prompt = buildAIFixPrompt(target, problem, otherProblems, related)
    await ensureAIConfigured()
    const response = await AIEngine.Complete(prompt.system, prompt.user, AI_FIX_MAX_TOKENS)
    const sources = new Map([target, ...related].map((file) => [file.relativePath, file]))
    const files: GoIDEFileChange[] = parseAIFixResponse(response, [...sources.keys()]).flatMap((proposal) => {
      const source = sources.get(proposal.relativePath)!
      const { edits, newContent } = lineEditsFor(source.content, proposal.content)
      if (edits.length === 0) return []
      return [{ uri: source.uri, path: source.path, relativePath: source.relativePath, documentId: source.documentId, edits, newContent, originalContent: source.content.replace(/\r\n/g, '\n') } as GoIDEFileChange]
    })
    if (files.length === 0) {
      notify('Fix with AI: the AI did not propose a usable change for this problem.')
      return
    }
    notify(null)
    // Sempre in anteprima, anche per un solo file: una proposta dell'AI va letta prima di applicarla.
    useGoIDELspStore.setState({ pendingChange: { label: `Fix with AI · ${problem.message}`, files } as GoIDEWorkspaceChange })
  } catch (error) {
    notify(`Fix with AI failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
