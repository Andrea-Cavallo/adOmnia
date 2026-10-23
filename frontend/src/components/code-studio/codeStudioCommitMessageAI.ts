import * as AIEngine from '../../../bindings/adomnia/aiengine'
import * as GoIDEBindings from '../../../bindings/adomnia/goide'
import { createAIRedactor } from '@/lib/aiRedaction'
import { ensureAIConfigured } from '@/lib/aiEngine'
import { isAICompanionAvailable } from '@/lib/aiAvailability'
import { getGoIDEAIPolicy, isLocalAIProvider, listGoIDEAIExcludedPaths } from '@/lib/code-studio-api'
import { useSettingsStore } from '@/stores/settings'
import { unifiedDiff } from './codeStudioAIActions'
import { commitFormatInstructions, DEFAULT_COMMIT_FORMAT, type CommitFormatPreference } from './codeStudioCommitFormat'

export const COMMIT_MESSAGE_MAX_TOKENS = 1200
/** Oltre questa dimensione il diff viene tagliato: il messaggio si scrive sui cambi principali. */
export const COMMIT_MESSAGE_MAX_DIFF_CHARS = 24_000
const MAX_FILES = 20
const MAX_SYMBOLS = 40
const MAX_MESSAGE_CHARS = 4_000

export interface CommitMessageFile {
  relativePath: string
  /** Diff unificato (HEAD → working copy) delle modifiche da registrare; vuoto con una nota. */
  diff: string
  /** Motivo per cui il contenuto non è nel diff: escluso dall'AI, binario, troppo grande. */
  note?: 'excluded' | 'binary' | 'tooLarge'
}

export interface CommitMessageSymbol {
  name: string
  kind: string
  change: string
  breaking?: boolean
  test?: boolean
}

export interface CommitMessageInput {
  branch: string
  files: CommitMessageFile[]
  symbols: CommitMessageSymbol[]
  /** Formato richiesto dall'utente; senza, Conventional Commits come prima (10.8). */
  format?: CommitFormatPreference
}

/** Prompt del messaggio di commit: solo ciò che verrà registrato, nel formato scelto dall'utente. */
export function buildCommitMessagePrompt(input: CommitMessageInput): { system: string; user: string } {
  const system = [
    'You write Git commit messages for the changes that are about to be committed in a software project.',
    commitFormatInstructions(input.format ?? DEFAULT_COMMIT_FORMAT),
    'Never invent changes: describe only what the diff shows. Write in the language of the existing commit history when it is visible in the diff; otherwise use English.',
    'Reply ONLY with the commit message: no markdown fences, no commentary.',
  ].join('\n')
  const files = input.files.slice(0, MAX_FILES).map((file) => {
    const note = file.note === 'excluded' ? ' (content excluded by project AI rules)'
      : file.note === 'binary' ? ' (binary file)'
      : file.note === 'tooLarge' ? ' (too large to send)'
      : ''
    return `- ${file.relativePath}${note}`
  }).join('\n')
  const symbols = input.symbols.slice(0, MAX_SYMBOLS).map((symbol) => `- ${symbol.change} ${symbol.kind} ${symbol.name}${symbol.breaking ? ' (breaking)' : ''}${symbol.test ? ' (test)' : ''}`).join('\n')
  const diffs = input.files.filter((file) => file.diff).slice(0, MAX_FILES).map((file) => `--- ${file.relativePath} ---\n${file.diff}`).join('\n\n')
  const user = [
    `Branch: ${input.branch || 'unknown'}.`,
    `Files in this commit:\n${files}`,
    symbols ? `Changed symbols (from the source):\n${symbols}` : '',
    diffs ? `Changes to record (unified diff):\n\`\`\`diff\n${diffs}\n\`\`\`` : '',
  ].filter(Boolean).join('\n\n')
  return { system, user }
}

/**
 * Messaggio dalla risposta del modello: recinti markdown tolti, testo ripulito. Una risposta vuota
 * è un errore: il messaggio di commit non viene inventato dal client.
 */
export function parseCommitMessage(raw: string): string {
  const text = raw.replace(/\r\n/g, '\n')
  // Fence located with indexOf: the regex form needs an unbounded scan for the
  // opening line, which backtracks quadratically on a long answer with no fence.
  const opening = text.indexOf('```')
  const headerEnd = opening >= 0 ? text.indexOf('\n', opening) : -1
  const closing = headerEnd >= 0 ? text.indexOf('```', headerEnd + 1) : -1
  const body = (closing >= 0 ? text.slice(headerEnd + 1, closing) : text).replace(/^\n+/, '').trimEnd()
  if (!body) throw new Error('the AI did not return a commit message')
  return body.length > MAX_MESSAGE_CHARS ? body.slice(0, MAX_MESSAGE_CHARS) : body
}

/**
 * Bozza del messaggio di commit per i file selezionati: invia all'AI il diff HEAD → working copy
 * di ciò che `git commit` registrerà. Segreti redatti; `.adomnia/aiignore` e la policy del progetto
 * valgono come per le altre funzioni AI. La risposta NON ripristina i segreti: un messaggio di
 * commit non deve rimetterli in chiaro nello storico Git.
 */
export async function draftCodeStudioCommitMessage(sessionId: string, relativePaths: readonly string[], symbols: readonly CommitMessageSymbol[] = [], branch = '', format: CommitFormatPreference = DEFAULT_COMMIT_FORMAT): Promise<string> {
  if (relativePaths.length === 0) throw new Error('select at least one file to commit')
  const ai = useSettingsStore.getState().settings.ai
  if (!isAICompanionAvailable(ai)) throw new Error('no AI provider is configured: enable and test one in Settings → AI')
  const local = isLocalAIProvider(ai)
  const policy = await getGoIDEAIPolicy(sessionId).catch(() => 'allowed')
  if (policy === 'off') throw new Error('AI is turned off for this project (.adomnia/ai-policy.json)')
  if (policy === 'local-only' && !local) throw new Error('this project allows only local AI models (.adomnia/ai-policy.json): use Ollama or a localhost endpoint')
  const excluded = new Set(await listGoIDEAIExcludedPaths(sessionId, [...relativePaths], local))
  const files: CommitMessageFile[] = []
  let budget = COMMIT_MESSAGE_MAX_DIFF_CHARS
  for (const relativePath of relativePaths.slice(0, MAX_FILES)) {
    if (excluded.has(relativePath)) {
      files.push({ relativePath, diff: '', note: 'excluded' })
      continue
    }
    let diff = ''
    try {
      const working = await GoIDEBindings.VCSWorkingDiff(sessionId, relativePath)
      if (working.binary) {
        files.push({ relativePath, diff: '', note: 'binary' })
        continue
      }
      if (working.tooLarge) {
        files.push({ relativePath, diff: '', note: 'tooLarge' })
        continue
      }
      diff = unifiedDiff(working.original, working.modified)
    } catch {
      continue // file non leggibile in questo momento: resta nell'elenco solo come nome
    }
    if (!diff) continue
    const clipped = diff.length > budget ? `${diff.slice(0, budget)}\n… [diff truncated]` : diff
    budget -= clipped.length
    files.push({ relativePath, diff: clipped })
    if (budget <= 0) break
  }
  if (files.every((file) => !file.diff)) throw new Error('none of the selected files has a textual change to describe')
  const prompt = buildCommitMessagePrompt({ branch, files, symbols: [...symbols], format })
  await ensureAIConfigured()
  // I segreti del diff restano sulla macchina; il messaggio li lascia come segnaposto.
  const redactor = createAIRedactor()
  return parseCommitMessage(await AIEngine.Complete(prompt.system, redactor.redact(prompt.user), COMMIT_MESSAGE_MAX_TOKENS))
}
