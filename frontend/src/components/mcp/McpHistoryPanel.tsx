import { AlertCircle, CheckCircle2, Trash2 } from 'lucide-react'
import { useMcpStore } from '@/stores/mcp'
import { cn } from '@/lib/utils'

function formatJSON(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export function McpHistoryPanel() {
  const { history, selectedHistoryId, setSelectedHistory, clearHistory } = useMcpStore()
  const selected = history.find((entry) => entry.id === selectedHistoryId) ?? null

  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-l border-border-1 bg-surface-0">
      <div className="flex items-center justify-between border-b border-border-1 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-3">History</span>
        {history.length > 0 && (
          <button
            type="button"
            onClick={clearHistory}
            className="rounded p-1 text-text-4 transition-colors hover:bg-surface-2 hover:text-error"
            title="Clear history"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-border-0">
        {history.map((entry) => (
          <button
            type="button"
            key={entry.id}
            onClick={() => setSelectedHistory(selectedHistoryId === entry.id ? null : entry.id)}
            className={cn(
              'w-full px-3 py-2 text-left transition-colors',
              selectedHistoryId === entry.id ? 'bg-accent/10' : 'hover:bg-surface-1',
            )}
          >
            <div className="flex items-center gap-1.5">
              {entry.isError ? (
                <AlertCircle size={11} className="shrink-0 text-error" />
              ) : (
                <CheckCircle2 size={11} className="shrink-0 text-success" />
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-1">{entry.toolName}</span>
              <span className="shrink-0 text-[10px] text-text-4">{entry.durationMs}ms</span>
            </div>
            <div className="mt-0.5 text-[10px] text-text-4">{new Date(entry.ts).toLocaleTimeString()}</div>
          </button>
        ))}
        {history.length === 0 && (
          <p className="px-4 py-5 text-center text-[11px] text-text-4">No calls yet.</p>
        )}
      </div>

      {selected && (
        <div className="max-h-[280px] space-y-2 overflow-y-auto border-t border-border-1 p-2">
          <div className="text-[9px] uppercase tracking-wider text-text-4">Request</div>
          <pre className="overflow-auto whitespace-pre-wrap break-words rounded border border-border-1 bg-surface-1 p-2 font-mono text-[10px] text-text-2">
            {JSON.stringify(selected.args, null, 2)}
          </pre>
          <div className="text-[9px] uppercase tracking-wider text-text-4">Response</div>
          <pre className="overflow-auto whitespace-pre-wrap break-words rounded border border-border-1 bg-surface-1 p-2 font-mono text-[10px] text-text-2">
            {formatJSON(selected.result)}
          </pre>
        </div>
      )}
    </aside>
  )
}
