import { useState } from 'react'
import { cn } from '@/lib/utils'
import { McpConnectionForm } from './McpConnectionForm'
import { McpHistoryPanel } from './McpHistoryPanel'
import { McpServerGenPanel } from './McpServerGenPanel'
import { McpToolInspector } from './McpToolInspector'

type McpView = 'debugger' | 'generator'

export function McpPanel() {
  const [view, setView] = useState<McpView>('debugger')

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface-0">
      <div className="flex shrink-0 items-center gap-1 border-b border-border-1 px-3">
        <button
          type="button"
          onClick={() => setView('debugger')}
          className={cn(
            'border-b-2 px-3 py-2 text-[11px] font-medium transition-colors',
            view === 'debugger' ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text-1',
          )}
        >
          Debugger
        </button>
        <button
          type="button"
          onClick={() => setView('generator')}
          className={cn(
            'border-b-2 px-3 py-2 text-[11px] font-medium transition-colors',
            view === 'generator' ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text-1',
          )}
        >
          Generate Server
        </button>
      </div>

      {view === 'debugger' ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <McpConnectionForm />
          <McpToolInspector />
          <McpHistoryPanel />
        </div>
      ) : (
        <McpServerGenPanel />
      )}
    </div>
  )
}
