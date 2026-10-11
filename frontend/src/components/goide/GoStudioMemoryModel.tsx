import { useState } from 'react'
import { Crosshair, Loader2, MessageSquare } from 'lucide-react'
import * as GoIDE from '../../../bindings/adomnia/goide'
import type { MemoryModelReport } from '../../../bindings/adomnia/internal/goide/models'
import { caretFor } from '@/lib/goide/goStudioCaretMemory'
import { activeGoIDEDocument, useGoIDEStore } from '@/stores/goide'
import { isChatPane, useGoStudioAssistantStore } from '@/stores/goStudioAssistant'

const KIND_TONE: Record<string, string> = { channel: 'text-accent', mutex: 'text-warning', rwmutex: 'text-warning', atomic: 'text-info', waitgroup: 'text-success', once: 'text-success', goroutine: 'text-text-1' }

/** Go Memory Model helper: the happens-before edges of the function under the cursor. */
export function GoStudioMemoryModel({ sessionId }: { sessionId: string }) {
  const [report, setReport] = useState<MemoryModelReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const analyze = async () => {
    const document = activeGoIDEDocument(useGoIDEStore.getState())
    if (!document || document.document.sessionId !== sessionId || !document.document.relativePath.endsWith('.go')) {
      setError('Open a Go file and place the cursor inside a function.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const path = document.document.relativePath
      setReport(await GoIDE.MemoryModelAt(sessionId, path, caretFor(sessionId, path)?.line ?? 1))
    } catch (problem) { setReport(null); setError(problem instanceof Error ? problem.message : String(problem)) } finally { setBusy(false) }
  }
  const explain = () => {
    if (!report) return
    const assistant = useGoStudioAssistantStore.getState()
    assistant.openWithDraft(isChatPane(assistant.pane) ? assistant.pane : 'claude', `Explain the Go memory model for this code: which goroutines run concurrently, which happens-before edges make each shared write visible, and whether any shared state is accessed without one (a data race). Suggest the smallest fix for each warning.\n\n${report.text}`)
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border-1 px-2 py-1 text-text-3">
        <button type="button" onClick={() => void analyze()} disabled={busy} className="flex h-6 items-center gap-1 rounded px-1.5 hover:bg-surface-3 disabled:opacity-50">{busy ? <Loader2 size={11} className="animate-spin" /> : <Crosshair size={11} />}At cursor</button>
        {report && <span className="font-mono text-text-2">{report.function}</span>}
        {report && <button type="button" onClick={explain} className="ml-auto flex h-6 items-center gap-1 rounded px-1.5 text-accent hover:bg-accent/10"><MessageSquare size={11} />Explain with AI</button>}
      </div>
      {error && <p className="shrink-0 border-b border-border-1 px-2 py-1 text-text-3">{error}</p>}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {!report && !error && <p className="text-text-4">Place the cursor in a function and press At cursor: its channels, mutexes, WaitGroups, Once and atomics, the other places of the package that use them, and the happens-before edges the Go memory model guarantees between those goroutines.</p>}
        {report?.groups.map((group) => (
          <section key={group.target} aria-label={`${group.kind} ${group.target}`} className="mb-3 rounded-md border border-border-1 p-2">
            <h4 className="mb-1 flex items-center gap-2"><span className={`text-[10px] font-semibold uppercase ${KIND_TONE[group.kind] ?? 'text-text-3'}`}>{group.kind}</span><span className="font-mono text-text-1">{group.target}</span></h4>
            <ul className="mb-1">
              {group.ops.map((op, index) => (
                <li key={`${op.site.relativePath}:${op.site.line}:${index}`}>
                  <button type="button" onClick={() => void useGoIDEStore.getState().openLocation(op.site.relativePath, op.site.line)} className="flex w-full gap-2 rounded px-1 text-left font-mono text-[11px] hover:bg-surface-3">
                    <span className="w-16 shrink-0 text-text-4">{op.kind}</span>
                    <span className="min-w-0 flex-1 truncate text-text-2">{op.function}</span>
                    <span className="shrink-0 text-text-4">{op.site.relativePath}:{op.site.line}</span>
                  </button>
                </li>
              ))}
            </ul>
            {group.edges.map((edge) => <p key={edge} className="text-[11px] text-text-3">→ {edge}</p>)}
            {group.warnings.map((warning) => <p key={warning} className="text-[11px] text-warning">⚠ {warning}</p>)}
          </section>
        ))}
      </div>
    </div>
  )
}
