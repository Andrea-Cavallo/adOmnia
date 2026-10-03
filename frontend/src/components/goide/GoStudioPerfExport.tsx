import { useEffect, useState } from 'react'
import { Bot, Check, Copy, FileDown } from 'lucide-react'
import { saveMarkdownFileAs } from '@/lib/markdown-api'
import { useGoStudioAssistantStore } from '@/stores/goStudioAssistant'

/** Il backend di Copilot accetta messaggi fino a 64 KiB: il report resta sotto con margine per la domanda. */
const CHAT_LIMIT_BYTES = 56 * 1024
const FEEDBACK_MS = 1800
const CHAT_PROMPT = 'Analyse this Go performance report. Find the main bottlenecks, explain their likely cause and suggest concrete code changes with file:line references.\n\n'

type Feedback = 'copied' | 'saved' | null

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Taglia il report sulle righe per stare nel limite della chat, segnalando il taglio. */
export function fitForChat(markdown: string, limit = CHAT_LIMIT_BYTES): string {
  if (byteLength(markdown) <= limit) return markdown
  const lines = markdown.split('\n')
  const note = '\n\n_[Report truncated to fit the chat: save it as Markdown for the full version.]_\n'
  let kept = ''
  for (const line of lines) {
    if (byteLength(kept + line + '\n' + note) > limit) break
    kept += `${line}\n`
  }
  return kept + note
}

/**
 * Esporta il report di un grafico in Markdown per un assistente AI: copia, salva su file o apri Copilot
 * con il report nel campo di testo (l'utente lo rivede e lo invia, niente parte da solo).
 */
export function GoStudioPerfExport({ build, fileName, prompt = CHAT_PROMPT }: { build: () => string; fileName: string; prompt?: string }) {
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!feedback) return
    const timer = window.setTimeout(() => setFeedback(null), FEEDBACK_MS)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const run = async (action: () => Promise<void>, done: Feedback) => {
    try {
      await action()
      setError(null)
      setFeedback(done)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Export failed')
    }
  }

  const copy = () => run(async () => { await navigator.clipboard.writeText(build()) }, 'copied')
  const save = () => run(async () => { await saveMarkdownFileAs(fileName, build()) }, 'saved')
  const ask = () => {
    setError(null)
    useGoStudioAssistantStore.getState().openWithDraft('copilot', prompt + fitForChat(build(), CHAT_LIMIT_BYTES - byteLength(prompt)))
  }

  return (
    <span className="flex items-center gap-0.5" role="group" aria-label="Export for AI">
      {error && <span className="mr-1 max-w-48 truncate text-[11px] text-danger" title={error}>{error}</span>}
      <button type="button" onClick={() => void copy()} title="Copy the report as Markdown, ready for any AI assistant" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1">
        {feedback === 'copied' ? <Check size={13} className="text-success" /> : <Copy size={13} />}{feedback === 'copied' ? 'Copied' : 'Copy for AI'}
      </button>
      <button type="button" onClick={() => void save()} title={`Save the report as ${fileName}`} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1">
        {feedback === 'saved' ? <Check size={13} className="text-success" /> : <FileDown size={13} />}{feedback === 'saved' ? 'Saved' : 'Save .md'}
      </button>
      <button type="button" onClick={ask} title="Open Copilot with this report in the message box" className="inline-flex h-7 items-center gap-1 rounded-md bg-accent/10 px-2 text-[11.5px] font-medium text-accent transition-colors hover:bg-accent/20">
        <Bot size={13} />Ask Copilot
      </button>
    </span>
  )
}
