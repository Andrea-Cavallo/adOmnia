import { useEffect, useRef, useState, useCallback } from 'react'
import { useDevLogsStore, type LogLevel, type LogSource } from '@/stores/devLogs'
import { clearBackendDevLogs } from '@/lib/devlogs-api'
import { cn } from '@/lib/utils'

const LEVEL_COLORS: Record<LogLevel, string> = {
  log: 'text-text-2',
  warn: 'text-warning',
  error: 'text-error',
  info: 'text-info',
  debug: 'text-text-4',
}

const LEVEL_BG: Record<LogLevel, string> = {
  log: 'bg-text-4/10',
  warn: 'bg-warning/10',
  error: 'bg-error/10',
  info: 'bg-info/10',
  debug: 'bg-text-4/5',
}

const LEVEL_LABEL: Record<LogLevel, string> = {
  log: 'LOG',
  warn: 'WARN',
  error: 'ERR',
  info: 'INFO',
  debug: 'DBG',
}

export function DevLogOverlay({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const entries = useDevLogsStore((s) => s.entries)
  const clear = useDevLogsStore((s) => s.clear)
  const scrollRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState<LogLevel | 'all'>('all')
  const [sourceFilter, setSourceFilter] = useState<LogSource | 'all'>('all')
  const [collapsed, setCollapsed] = useState(false)
  const [poppedOut, setPoppedOut] = useState(false)
  const popupRef = useRef<Window | null>(null)

  // Drag state
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef({ startX: 0, startY: 0, startLeft: 0, startTop: 0 })

  const filtered = entries.filter((entry) =>
    (filter === 'all' || entry.level === filter)
    && (sourceFilter === 'all' || entry.source === sourceFilter)
  )
  const errorCount = entries.filter((e) => e.level === 'error').length
  const warnCount = entries.filter((e) => e.level === 'warn').length
  const frontendCount = entries.filter((e) => e.source === 'frontend').length
  const backendCount = entries.filter((e) => e.source === 'backend').length
  const totalCount = entries.length

  useEffect(() => {
    if (scrollRef.current && visible) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries.length, visible])

  // Close popup when component unmounts
  useEffect(() => {
    return () => {
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.close()
      }
    }
  }, [])

  // Sync position with popup
  useEffect(() => {
    if (poppedOut && popupRef.current && !popupRef.current.closed) {
      const sendEntries = () => {
        popupRef.current?.postMessage({ type: 'devlogs-entries', entries: useDevLogsStore.getState().entries }, '*')
      }
      sendEntries()
      const unsub = useDevLogsStore.subscribe(() => sendEntries())
      return () => unsub()
    }
  }, [poppedOut])

  const levelCounts = {
    error: errorCount,
    warn: warnCount,
    log: entries.filter((e) => e.level === 'log').length,
    info: entries.filter((e) => e.level === 'info').length,
    debug: entries.filter((e) => e.level === 'debug').length,
  }

  const formatTime = useCallback((ts: number) => {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
  }, [])

  const clearAll = useCallback(() => {
    clear()
    void clearBackendDevLogs().catch(() => undefined)
  }, [clear])

  const formatEntryMessage = useCallback((entry: typeof entries[number]) => {
    const scope = entry.scope ? `[${entry.scope}] ` : ''
    const data = entry.data && Object.keys(entry.data).length > 0
      ? ` ${JSON.stringify(entry.data)}`
      : ''
    return `${scope}${entry.message}${data}`
  }, [])

  const isSessionStart = useCallback((message: string) => message.includes('SESSION START'), [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!headerRef.current?.contains(e.target as Node)) return
    setDragging(true)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: pos.x,
      startTop: pos.y,
    }
  }, [pos])

  useEffect(() => {
    if (!dragging) return
    const handleMove = (e: MouseEvent) => {
      const dx = e.clientX - dragRef.current.startX
      const dy = e.clientY - dragRef.current.startY
      setPos({
        x: dragRef.current.startLeft + dx,
        y: dragRef.current.startTop + dy,
      })
    }
    const handleUp = () => setDragging(false)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragging])

  const handlePopOut = useCallback(() => {
    if (poppedOut) {
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.close()
      }
      setPoppedOut(false)
      return
    }

    const w = 750
    const h = 550
    const left = window.screenX + 100
    const top = window.screenY + 100

    const popup = window.open('', 'adomnia-devlogs', `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=no`)
    if (!popup) return
    popupRef.current = popup

    popup.document.title = 'adOmnia — Dev Logs'
    popup.document.write(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'JetBrains Mono','Consolas',monospace;font-size:11px;background:#0B0D14;color:#F8FAFC;overflow:hidden;height:100vh;display:flex;flex-direction:column}
#header{display:flex;align-items:center;gap:8px;padding:6px 12px;background:#111;border-bottom:1px solid #1A1E2C;user-select:none}
#header span.title{font-size:11px;font-weight:600;color:#9CA3AF}
#header span.count{font-size:10px;color:#6B7280}
#header .spacer{flex:1}
#header button{font-size:9px;padding:2px 6px;border:1px solid #1A1E2C;border-radius:4px;background:transparent;color:#6B7280;cursor:pointer}
#header button:hover{color:#F8FAFC;border-color:#4B5563}
#header button.err{color:oklch(0.70 0.18 25);border-color:oklch(0.70 0.18 25 / 0.3)}
#header button.err:hover{background:oklch(0.70 0.18 25 / 0.1)}
#header button.accent{color:oklch(0.58 0.25 290);border-color:oklch(0.58 0.25 290 / 0.3)}
#header button.accent:hover{background:oklch(0.58 0.25 290 / 0.1)}
#log{flex:1;overflow-y:auto;padding:4px}
.line{display:flex;gap:8px;padding:2px 6px;border-radius:2px;line-height:1.5;white-space:pre-wrap;word-break:break-all}
.line:hover{background:rgba(255,255,255,0.02)}
.line .time{color:#4B5563;flex-shrink:0}
.line .lvl{flex-shrink:0;width:32px;font-weight:600}
.line .msg{color:#9CA3AF}
.LOG .lvl{color:#9CA3AF}
.WARN .lvl{color:oklch(0.80 0.14 85)} .WARN{background:oklch(0.80 0.14 85 / 0.05)}
.ERR .lvl{color:oklch(0.70 0.18 25)} .ERR{background:oklch(0.70 0.18 25 / 0.05)}
.INFO .lvl{color:oklch(0.65 0.12 250)} .INFO{background:oklch(0.65 0.12 250 / 0.05)}
.DBG .lvl{color:#4B5563} .DBG{background:rgba(75,85,99,0.05)}
::-webkit-scrollbar{width:6px} ::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#1F2333;border-radius:3px}
</style></head><body>
<div id="header">
<span class="title">ADOMNIA DEV LOGS</span><span class="count" id="count"></span>
<button onclick="setSource('all')" id="src-all">all</button>
<button onclick="setSource('frontend')" id="src-frontend">frontend</button>
<button onclick="setSource('backend')" id="src-backend">backend</button>
<button onclick="window.opener?.postMessage('devlogs-clear','*')">clear</button>
<button onclick="window.close()">close</button>
</div>
<div id="log"></div>
<script>
const logEl=document.getElementById('log')
const countEl=document.getElementById('count')
let all=[]
let source='all'
function fmt(ts){const d=new Date(ts);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+':'+String(d.getSeconds()).padStart(2,'0')+'.'+String(d.getMilliseconds()).padStart(3,'0')}
function setSource(next){source=next;render(all)}
function render(entries){
  all=entries
  const visible=source==='all'?entries:entries.filter(e=>e.source===source)
  countEl.textContent='('+visible.length+'/'+entries.length+')'
  let html=''
  let prev=''
  for(const e of visible){
    const t=fmt(e.timestamp)
    const cl='line '+e.level.toUpperCase()
    const lbl={log:'LOG',warn:'WARN',error:'ERR',info:'INFO',debug:'DBG'}[e.level]||e.level.toUpperCase()
    const src=(e.source||'frontend').toUpperCase()
    const scope=e.scope?'['+esc(e.scope)+'] ':''
    const data=e.data&&Object.keys(e.data).length?' '+esc(JSON.stringify(e.data)):''
    html+='<div class="'+cl+'"><span class="time">'+t+'</span><span class="lvl">'+lbl+'</span><span class="time">'+src+'</span><span class="msg">'+scope+esc(e.message)+data+'</span></div>'
  }
  logEl.innerHTML=html
  logEl.scrollTop=logEl.scrollHeight
}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
window.addEventListener('message',(e)=>{
  if(e.data?.type==='devlogs-entries') render(e.data.entries)
  else if(e.data==='devlogs-clear') window.opener?.postMessage('devlogs-clear','*')
})
window.opener?.postMessage('devlogs-ready','*')
</script></body></html>`)
    popup.document.close()

    // Forward entries to popup
    const send = () => {
      if (popup.closed) {
        setPoppedOut(false)
        return
      }
      popup.postMessage({ type: 'devlogs-entries', entries: useDevLogsStore.getState().entries }, '*')
    }
    send()
    const unsub = useDevLogsStore.subscribe(() => send())

    // Listen for clear from popup
    const handler = (e: MessageEvent) => {
      if (e.data === 'devlogs-clear') clearAll()
      if (e.data === 'devlogs-ready') send()
    }
    window.addEventListener('message', handler)

    // Cleanup on popup close
    const check = setInterval(() => {
      if (popup.closed) {
        unsub()
        window.removeEventListener('message', handler)
        clearInterval(check)
        setPoppedOut(false)
      }
    }, 500)

    setPoppedOut(true)
  }, [poppedOut, clearAll])

  return (
    <>
      {/* Compact badge — always visible when there are entries and not popped out */}
      {!visible && !poppedOut && totalCount > 0 && (
        <button
          onClick={onClose}
          className={cn(
            'fixed bottom-4 right-4 z-[9998] flex items-center gap-1.5 px-2 py-1 rounded-full border shadow-lg transition-all',
            'bg-surface-1 border-border-2 hover:border-accent/50 hover:scale-105 cursor-pointer',
            errorCount > 0 && 'border-error/30',
          )}
          title={`${totalCount} log entries — click to open (Ctrl+Shift+D)`}
        >
          <span className={cn(
            'w-2 h-2 rounded-full',
            errorCount > 0 ? 'bg-error animate-pulse' : warnCount > 0 ? 'bg-warning' : 'bg-success',
          )} />
          <span className="text-[10px] font-mono text-text-3 tabular-nums">{totalCount}</span>
          {errorCount > 0 && (
            <span className="text-[10px] font-mono text-error tabular-nums">{errorCount} err</span>
          )}
        </button>
      )}

      {/* Full overlay — draggable */}
      {visible && !poppedOut && (
        <div
          ref={panelRef}
          onMouseDown={handleMouseDown}
          className={cn(
            'fixed z-[9999] bg-surface-1 border border-border-2 rounded-lg shadow-2xl',
            'animate-in fade-in select-none',
            dragging && 'opacity-90',
          )}
          style={{
            width: '700px',
            maxHeight: '500px',
            left: pos.x ? `${pos.x}px` : undefined,
            bottom: pos.y ? undefined : '16px',
            top: pos.y ? `${pos.y}px` : undefined,
            right: pos.x ? undefined : '16px',
            cursor: dragging ? 'grabbing' : 'default',
          }}
        >
          {/* Header — drag handle */}
          <div
            ref={headerRef}
            className="flex items-center justify-between px-3 py-2 border-b border-border-1 cursor-grab active:cursor-grabbing"
          >
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={() => setCollapsed(!collapsed)}
                className="text-text-3 hover:text-text-2 transition-colors"
              >
                {collapsed ? '\u25B6' : '\u25BC'}
              </button>
              <span className="font-semibold text-text-2 tracking-wide">DEV LOGS</span>
              <span className="text-text-4 tabular-nums">({totalCount})</span>
              <span className="text-text-4 tabular-nums">FE {frontendCount}</span>
              <span className="text-text-4 tabular-nums">BE {backendCount}</span>
            </div>
            <div className="flex items-center gap-1">
              {(['all', 'frontend', 'backend'] as Array<LogSource | 'all'>).map((src) => (
                <button
                  key={src}
                  onClick={(e) => { e.stopPropagation(); setSourceFilter(src) }}
                  className={cn(
                    'px-1.5 py-0.5 text-[10px] rounded-sm font-mono transition-colors cursor-pointer uppercase',
                    sourceFilter === src ? 'bg-accent/15 text-accent-light' : 'text-text-4 hover:text-text-2',
                  )}
                >
                  {src === 'frontend' ? 'FE' : src === 'backend' ? 'BE' : 'ALL'}
                </button>
              ))}
              {(['error', 'warn', 'log', 'info', 'debug'] as LogLevel[]).map((lvl) => (
                <button
                  key={lvl}
                  onClick={(e) => { e.stopPropagation(); setFilter(filter === lvl ? 'all' : lvl) }}
                  className={cn(
                    'px-1.5 py-0.5 text-[10px] rounded-sm font-mono transition-colors cursor-pointer',
                    filter === lvl || filter === 'all'
                      ? LEVEL_BG[lvl] + ' ' + LEVEL_COLORS[lvl]
                      : 'text-text-4 opacity-40 hover:opacity-70',
                  )}
                >
                  {LEVEL_LABEL[lvl]}
                  {levelCounts[lvl] > 0 && (
                    <span className="ml-1 opacity-60">{levelCounts[lvl]}</span>
                  )}
                </button>
              ))}
              {filter !== 'all' && (
                <button
                  onClick={(e) => { e.stopPropagation(); setFilter('all') }}
                  className="text-[10px] text-accent hover:text-accent-hover ml-1 cursor-pointer"
                >
                  clear filter
                </button>
              )}
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={(e) => { e.stopPropagation(); handlePopOut() }}
                className="px-1.5 py-0.5 text-[10px] text-accent hover:text-accent-hover transition-colors cursor-pointer"
                title="Pop out as separate window"
              >
                {'\u2B08'} pop out
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); clearAll() }}
                className="px-1.5 py-0.5 text-[10px] text-text-4 hover:text-error transition-colors cursor-pointer"
                title="Clear all logs"
              >
                clear
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onClose() }}
                className="px-1.5 py-0.5 text-[11px] text-text-4 hover:text-error transition-colors ml-1 cursor-pointer"
                title="Minimize dev log"
              >
                {'\u2715'}
              </button>
            </div>
          </div>

          {/* Log entries */}
          {!collapsed && (
            <div
              ref={scrollRef}
              className="overflow-y-auto font-mono text-[11px] leading-relaxed p-1 select-text"
              style={{ maxHeight: '440px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
            >
              {filtered.length === 0 ? (
                <div className="text-text-4 text-center py-6 select-none">
                  {totalCount === 0 ? 'No logs captured yet' : 'No entries match current filter'}
                </div>
              ) : (
                filtered.map((entry) => (
                  <div
                    key={entry.id}
                    className={cn(
                      'px-2 py-0.5 rounded-sm hover:bg-surface-3/50 transition-colors flex gap-2',
                      LEVEL_BG[entry.level],
                      isSessionStart(entry.message) && 'my-1 justify-center border-y border-accent/30 bg-accent/8 text-accent-light',
                    )}
                  >
                    {isSessionStart(entry.message) ? (
                      <span className="text-[10px] font-semibold tracking-wider">{entry.message}</span>
                    ) : (
                      <>
                        <span className="text-text-4 shrink-0 select-none">
                          {formatTime(entry.timestamp)}
                        </span>
                        <span className={cn('shrink-0 font-semibold w-8', LEVEL_COLORS[entry.level])}>
                          {LEVEL_LABEL[entry.level]}
                        </span>
                        <span className="text-text-4 shrink-0 uppercase w-7">{entry.source === 'backend' ? 'BE' : 'FE'}</span>
                        <span className="text-text-2">{formatEntryMessage(entry)}</span>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Pop-out indicator when popped out */}
      {poppedOut && !visible && totalCount > 0 && (
        <button
          onClick={() => {
            if (popupRef.current && !popupRef.current.closed) {
              popupRef.current.focus()
            } else {
              setPoppedOut(false)
            }
          }}
          className="fixed bottom-4 right-4 z-[9998] flex items-center gap-1.5 px-2 py-1 rounded-full border shadow-lg transition-all bg-accent/10 border-accent/30 hover:bg-accent/20 cursor-pointer"
          title="Dev logs open in separate window"
        >
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="text-[10px] font-mono text-accent tabular-nums">{totalCount}</span>
          <span className="text-[10px] text-accent/70">popup</span>
        </button>
      )}
    </>
  )
}
