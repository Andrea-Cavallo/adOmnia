import { useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import {
  evalJS,
  getConsoleLogs,
  clearConsoleLogs,
  type ConsoleEntry,
} from '@/lib/browser-debug-api'
import {
  Terminal,
  Trash2,
  AlertCircle,
  AlertTriangle,
  Info,
  ChevronRight,
} from 'lucide-react'

export type { ConsoleEntry }

const TYPE_ICON_MAP: Record<
  ConsoleEntry['type'],
  { icon: typeof Terminal; className: string }
> = {
  log: { icon: Terminal, className: 'text-text-2' },
  error: { icon: AlertCircle, className: 'text-red-400' },
  warn: { icon: AlertTriangle, className: 'text-yellow-400' },
  info: { icon: Info, className: 'text-blue-400' },
  result: { icon: ChevronRight, className: 'text-accent' },
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts)
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function ConsolePanel() {
  const [logs, setLogs] = useState<ConsoleEntry[]>([])
  const [input, setInput] = useState('')
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)

  const logEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const scrollToBottom = useCallback(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // Poll for console logs every 1s
  useEffect(() => {
    const poll = async () => {
      const entries = await getConsoleLogs()
      if (entries.length > 0) {
        setLogs(entries)
      }
    }
    poll()
    pollRef.current = setInterval(poll, 1000)

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [])

  // Auto-scroll on new logs
  useEffect(() => {
    scrollToBottom()
  }, [logs, scrollToBottom])

  const handleEval = useCallback(async () => {
    const expression = input.trim()
    if (!expression) return

    setCommandHistory((prev) => [...prev, expression])
    setHistoryIndex(-1)
    setInput('')

    const result = await evalJS(expression)
    if (result) {
      setLogs((prev) => [...prev, result])
    }
  }, [input])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleEval()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (commandHistory.length === 0) return
        const newIndex =
          historyIndex === -1
            ? commandHistory.length - 1
            : Math.max(0, historyIndex - 1)
        setHistoryIndex(newIndex)
        setInput(commandHistory[newIndex])
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (historyIndex === -1) return
        const newIndex = historyIndex + 1
        if (newIndex >= commandHistory.length) {
          setHistoryIndex(-1)
          setInput('')
        } else {
          setHistoryIndex(newIndex)
          setInput(commandHistory[newIndex])
        }
      }
    },
    [handleEval, commandHistory, historyIndex]
  )

  const handleClear = useCallback(async () => {
    await clearConsoleLogs()
    setLogs([])
  }, [])

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-1">
      {/* Mini toolbar */}
      <div className="flex items-center h-8 px-3 gap-2 border-b border-border-1 bg-surface-0 flex-shrink-0">
        <Terminal size={12} className="text-text-3" />
        <span className="text-[10px] font-medium text-text-2 uppercase tracking-wide">
          Console
        </span>
        <div className="flex-1" />
        <button
          onClick={handleClear}
          title="Clear console"
          className="h-6 px-2 rounded text-[10px] text-text-3 hover:text-text-1 hover:bg-surface-2 transition-colors flex items-center gap-1"
        >
          <Trash2 size={10} />
          Clear
        </button>
      </div>

      {/* Log area */}
      <div className="flex-1 overflow-y-auto px-3 py-1 font-mono text-xs">
        {logs.length === 0 && (
          <div className="flex items-center justify-center h-full text-text-3 text-xs">
            Console output will appear here
          </div>
        )}
        {logs.map((entry) => {
          const { icon: Icon, className: iconClass } =
            TYPE_ICON_MAP[entry.type]
          return (
            <div
              key={entry.id}
              className={cn(
                'flex items-start gap-2 py-0.5 border-b border-border-1/50',
                entry.type === 'error' && 'bg-red-500/5',
                entry.type === 'warn' && 'bg-yellow-500/5'
              )}
            >
              <Icon size={12} className={cn('mt-0.5 flex-shrink-0', iconClass)} />
              <span className="text-text-3 flex-shrink-0 text-[10px] mt-px">
                {formatTimestamp(entry.timestamp)}
              </span>
              <span
                className={cn(
                  'flex-1 break-all whitespace-pre-wrap',
                  entry.type === 'error' && 'text-red-400',
                  entry.type === 'warn' && 'text-yellow-400',
                  entry.type === 'info' && 'text-blue-400',
                  entry.type === 'result' && 'text-accent',
                  entry.type === 'log' && 'text-text-1'
                )}
              >
                {entry.text}
              </span>
            </div>
          )
        })}
        <div ref={logEndRef} />
      </div>

      {/* Input area */}
      <div className="flex items-center h-8 px-3 gap-2 border-t border-border-1 bg-surface-0 flex-shrink-0">
        <ChevronRight size={12} className="text-accent flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Evaluate JavaScript expression..."
          className="flex-1 h-6 bg-transparent text-xs text-text-1 font-mono placeholder:text-text-3 focus:outline-none"
        />
      </div>
    </div>
  )
}
