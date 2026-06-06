import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import type { RunEntry } from '@/lib/flowRunner'
import { cn } from '@/lib/utils'

interface FlowRunLogProps {
  entries: RunEntry[]
  onClear: () => void
}

export function FlowRunLog({ entries, onClear }: FlowRunLogProps) {
  const [collapsed, setCollapsed] = useState(false)

  if (entries.length === 0) return null

  return (
    <div
      className={cn(
        'border-t border-border-1 bg-surface-0 flex-shrink-0 transition-all',
        collapsed ? 'h-8' : 'h-[140px]',
      )}
    >
      {/* Log toolbar */}
      <div className="flex items-center gap-2 px-3 h-8 border-b border-border-1 bg-surface-1">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-1 text-[10px] text-text-3 hover:text-text-1 transition-colors"
        >
          {collapsed ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          Run Log
        </button>
        <span className="text-[10px] text-text-4">({entries.length} steps)</span>
        <div className="flex-1" />
        <button
          onClick={onClear}
          className="text-[10px] text-text-4 hover:text-text-1 transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Log entries */}
      {!collapsed && (
        <div className="overflow-y-auto h-[calc(100%-2rem)] font-mono text-[10px]">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={cn(
                'flex items-center gap-3 px-3 py-1 border-b border-border-1/30',
                entry.status === 'failed' ? 'bg-error/5' : '',
              )}
            >
              <span className={cn(
                'w-14 shrink-0 font-semibold',
                entry.status === 'success' ? 'text-success' : '',
                entry.status === 'failed' ? 'text-error' : '',
                entry.status === 'running' ? 'text-accent' : '',
                entry.status === 'skipped' ? 'text-warning' : '',
                entry.status === 'pending' ? 'text-text-4' : '',
              )}>
                {entry.status}
              </span>
              <span className="text-text-3 shrink-0 w-32 truncate">{entry.nodeLabel}</span>
              {entry.httpStatus !== undefined && (
                <span className={cn(
                  'shrink-0',
                  entry.httpStatus >= 200 && entry.httpStatus < 300 ? 'text-success' : 'text-error',
                )}>
                  HTTP {entry.httpStatus}
                </span>
              )}
              <span className="text-text-4 shrink-0">{Math.round(entry.durationMs)}ms</span>
              {entry.error && (
                <span className="text-error truncate">{entry.error}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
