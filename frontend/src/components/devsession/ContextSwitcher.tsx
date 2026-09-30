import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Bug, Code2, Database, MessageSquare, ScrollText, Send } from 'lucide-react'
import type { LiveSession, RequestRun } from '@/lib/devsession-api'
import { handoffToPanel } from '@/lib/entities/dispatch'
import { openEntity } from '@/lib/entities/router'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useDevSessionStore } from '@/stores/devSession'
import { primarySession } from '@/stores/devSessionModel'
import { openFrameInGoStudio, openRequestTab } from '@/lib/devsession/navigation'
import { basename } from './liveUi'

interface FlowItem { id: string; icon: ReactNode; title: string; detail: string; open: () => void }

/** The elements of the current development flow, not pages: code, request, data, events, logs. */
export function flowItems(session: LiveSession | null, run: RequestRun | null, openLogs: (sessionId: string) => void): FlowItem[] {
  const state = useDevSessionStore.getState()
  const items: FlowItem[] = []
  if (session) {
    const where = session.pause
    items.push({
      id: 'code', icon: where ? <Bug size={14} className="text-warning" /> : <Code2 size={14} />,
      title: session.service,
      detail: where ? `${basename(where.relativePath || where.file || '')}:${where.line} · ${where.function}()` : `Go Studio · ${session.kind === 'debug' ? 'debugging' : 'running'}${session.port ? ` · :${session.port}` : ''}`,
      open: () => void openFrameInGoStudio(session),
    })
  }
  if (run) {
    items.push({ id: 'request', icon: <Send size={14} className="text-accent" />, title: `${run.method} ${pathOf(run.url)}`, detail: run.state === 'paused' ? 'paused at breakpoint' : run.status ? `${run.status} · ${run.durationMs} ms` : 'in flight', open: () => openRequestTab(run.tabId) })
    const query = state.queries.filter((q) => q.requestRunId === run.id).slice(-1)[0]
    if (query) {
      items.push({
        id: 'db', icon: <Database size={14} />, title: query.sql.split(/\s+/).slice(0, 4).join(' '), detail: query.datasource || 'SQL of this request',
        open: () => handoffToPanel('database', { kind: 'table', id: `sql:${query.id}`, label: `${run.method} ${pathOf(run.url)}`, attrs: {} }, 'sql', { sql: query.sql, back: { label: 'Open request', run: () => openRequestTab(run.tabId) } }),
      })
    }
    const message = state.messages.filter((m) => m.requestRunId === run.id).slice(-1)[0]
    if (message) {
      items.push({
        id: 'kafka', icon: <MessageSquare size={14} />, title: message.topic, detail: `partition ${message.partition} · offset ${message.offset}`,
        open: () => void openEntity({ kind: 'topic', id: `topic:${message.topic}`, label: message.topic, attrs: { broker: 'kafka', partition: String(message.partition), offset: String(message.offset) } }),
      })
    }
  }
  if (session) items.push({ id: 'logs', icon: <ScrollText size={14} />, title: 'Logs', detail: run ? `request ${run.correlationId}` : `${session.service} output`, open: () => openLogs(session.id) })
  return items
}

const pathOf = (url: string) => {
  try { const parsed = new URL(url); return parsed.pathname + parsed.search } catch { return url }
}

/** Ctrl+Tab: hold Ctrl, press Tab to move, release to jump. Like Alt+Tab, inside one development flow. */
export function ContextSwitcher({ onOpenLogs }: { onOpenLogs: (sessionId: string) => void }) {
  const [items, setItems] = useState<FlowItem[] | null>(null)
  const [index, setIndex] = useState(0)
  const indexRef = useRef(0)
  indexRef.current = index
  const itemsRef = useRef<FlowItem[] | null>(null)
  itemsRef.current = items

  useEffect(() => {
    const close = (activate: boolean) => {
      const current = itemsRef.current
      setItems(null)
      if (activate && current?.[indexRef.current]) current[indexRef.current].open()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault()
        if (!itemsRef.current) {
          const state = useDevSessionStore.getState()
          const session = primarySession(state, state.focusedSessionId)
          const run = session ? latestRun(state, session.id) : null
          const next = flowItems(session, run, onOpenLogs)
          if (next.length === 0) return
          const current = currentItem(next)
          setItems(next)
          setIndex((current + 1) % next.length)
          return
        }
        const length = itemsRef.current.length
        setIndex((value) => (value + (event.shiftKey ? length - 1 : 1)) % length)
        return
      }
      if (event.key === 'Escape' && itemsRef.current) { event.preventDefault(); close(false) }
      if (event.key === 'Enter' && itemsRef.current) { event.preventDefault(); close(true) }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control' && itemsRef.current) close(true)
    }
    const onBlur = () => { if (itemsRef.current) close(false) }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [onOpenLogs])

  if (!items) return null
  return (
    <div className="fixed inset-0 z-[320] flex items-center justify-center bg-black/25" onMouseDown={() => setItems(null)}>
      <div role="listbox" aria-label="Current development context" className="w-[min(520px,calc(100vw-32px))] overflow-hidden rounded-lg border border-border-2 bg-surface-1 shadow-2xl shadow-black/50" onMouseDown={(event) => event.stopPropagation()}>
        <div className="border-b border-border-1 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-4">Current development context</div>
        <ul className="py-1">
          {items.map((item, i) => (
            <li key={item.id} role="option" aria-selected={i === index}>
              <button type="button" onMouseEnter={() => setIndex(i)} onClick={() => { setItems(null); item.open() }}
                className={cn('flex w-full items-center gap-3 px-3 py-2 text-left', i === index ? 'bg-accent/15' : 'hover:bg-surface-2')}>
                <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-md', i === index ? 'bg-accent/20 text-accent' : 'bg-surface-2 text-text-3')}>{item.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-text-1">{item.title}</span>
                  <span className="block truncate font-mono text-[11px] text-text-3">{item.detail}</span>
                </span>
                {i > 0 && <span className="text-text-4" aria-hidden="true">↔</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-border-1 px-3 py-1.5 text-[10.5px] text-text-4">Hold Ctrl · Tab to move · release to open · Esc to cancel</div>
      </div>
    </div>
  )
}

function latestRun(state: ReturnType<typeof useDevSessionStore.getState>, sessionId: string): RequestRun | null {
  for (let i = state.runOrder.length - 1; i >= 0; i--) {
    const run = state.runs[state.runOrder[i]]
    if (run?.sessionId === sessionId) return run
  }
  return null
}

/** Where the developer is now, so the first Tab moves to the next element. */
function currentItem(items: FlowItem[]): number {
  const rail = useAppStore.getState().activeRail
  const id = rail === 'goide' ? 'code' : rail === 'collections' ? 'request' : rail === 'database' ? 'db' : rail === 'broker' ? 'kafka' : ''
  return Math.max(0, items.findIndex((item) => item.id === id))
}
