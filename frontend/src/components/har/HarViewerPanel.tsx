import { useCallback, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  BarChart2,
  Check,
  Clock,
  Copy,
  Download,
  FileInput,
  Layers,
  Package,
  RefreshCw,
  Search,
  Send,
  Server,
  Trash2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { appendMockEndpoints } from '@/lib/mockEndpointStore'
import { useAppStore } from '@/stores/app'
import { useTabsStore } from '@/stores/tabs'
import { useBrowserDebugStore } from '@/stores/browser-debug'
import { type HttpMethod, type RequestItem, uid } from '@/lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface HarHeader { name: string; value: string }

interface HarTiming {
  blocked?: number
  dns?: number
  connect?: number
  ssl?: number
  send: number
  wait: number
  receive: number
}

interface HarEntry {
  startedDateTime: string
  time: number
  request: {
    method: string
    url: string
    headers: HarHeader[]
    bodySize: number
    postData?: { mimeType: string; text?: string }
  }
  response: {
    status: number
    statusText: string
    headers: HarHeader[]
    content: { size: number; mimeType: string; text?: string }
    bodySize: number
  }
  timings: HarTiming
}

interface HarDoc {
  log: {
    version: string
    creator?: { name: string; version: string }
    entries: HarEntry[]
  }
}

interface RichEntry extends HarEntry {
  _id: number
  _startMs: number
  _domain: string
  _mimeShort: string
  _slow: boolean
  _error: boolean
  _heavy: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDomain(url: string) {
  try { return new URL(url).hostname } catch { return url.slice(0, 40) }
}

function shortMime(mime: string) {
  if (!mime) return '?'
  if (mime.includes('json')) return 'json'
  if (mime.includes('html')) return 'html'
  if (mime.includes('javascript') || mime.includes('ecmascript')) return 'js'
  if (mime.includes('css')) return 'css'
  if (mime.includes('xml')) return 'xml'
  if (mime.includes('image')) return 'img'
  if (mime.includes('font')) return 'font'
  if (mime.includes('text/plain')) return 'text'
  return (mime.split('/')[1] ?? '?').split(';')[0]
}

function fmtMs(ms: number) {
  if (ms < 0) return '-'
  if (ms < 1) return '< 1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function fmtBytes(n: number) {
  if (n <= 0) return '-'
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(2)}MB`
}

function statusCls(s: number) {
  if (!s) return 'bg-text-4/20 text-text-4'
  if (s < 300) return 'bg-success/15 text-success'
  if (s < 400) return 'bg-info/15 text-info'
  if (s < 500) return 'bg-warning/15 text-warning'
  return 'bg-error/15 text-error'
}

function methodCls(m: string) {
  switch (m?.toUpperCase()) {
    case 'GET':    return 'text-success'
    case 'POST':   return 'text-accent'
    case 'PUT':    return 'text-warning'
    case 'PATCH':  return 'text-info'
    case 'DELETE': return 'text-error'
    default:       return 'text-text-3'
  }
}

function enrich(entries: HarEntry[]): RichEntry[] {
  const t0 = entries[0] ? new Date(entries[0].startedDateTime).getTime() : 0
  return entries.map((e, i) => {
    const startMs = new Date(e.startedDateTime).getTime() - t0
    return {
      ...e,
      _id: i,
      _startMs: isNaN(startMs) ? 0 : Math.max(startMs, 0),
      _domain: parseDomain(e.request.url),
      _mimeShort: shortMime(e.response?.content?.mimeType ?? ''),
      _slow: e.time > 1000,
      _error: !e.response?.status || e.response.status >= 400,
      _heavy: (e.response?.content?.size || e.response?.bodySize || 0) > 512 * 1024,
    }
  })
}

function readHarFile(file: File): Promise<HarDoc> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = (ev) => {
      try {
        const d = JSON.parse(ev.target!.result as string) as HarDoc
        if (!d?.log?.entries) throw new Error('Invalid HAR: missing log.entries')
        resolve(d)
      } catch (e) { reject(e) }
    }
    r.onerror = () => reject(new Error('File read error'))
    r.readAsText(file)
  })
}

function headersToObject(headers: HarHeader[] = []) {
  return Object.fromEntries(headers.map((h) => [h.name, h.value]))
}

function entryToRequest(entry: HarEntry): RequestItem {
  const method = entry.request.method.toUpperCase()
  const safeMethod = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE'].includes(method)
    ? method as HttpMethod
    : 'GET'
  return {
    id: uid(),
    name: `${safeMethod} ${parseDomain(entry.request.url)}`,
    type: 'request',
    method: safeMethod,
    url: entry.request.url,
    params: [{ id: uid(), key: '', value: '', enabled: true }],
    headers: (entry.request.headers ?? []).map((h) => ({ id: uid(), key: h.name, value: h.value, enabled: true })),
    bodies: [{ id: uid(), name: 'Body 1', type: entry.request.postData?.text ? 'raw' : 'none', raw: entry.request.postData?.text ?? '', lang: 'json', form: [] }],
    activeBodyIdx: 0,
    auth: { type: 'none', token: '', username: '', password: '' },
    timeout: 0,
    followRedirects: true,
  }
}

function browserEntriesToHar(entries: ReturnType<typeof useBrowserDebugStore.getState>['entries']): HarDoc {
  return {
    log: {
      version: '1.2',
      creator: { name: 'adOmnia Browser Debug', version: '1.0' },
      entries: entries.map((entry) => ({
        startedDateTime: new Date(entry.timestamp || Date.now()).toISOString(),
        time: entry.duration || 0,
        request: {
          method: entry.method,
          url: entry.url,
          headers: Object.entries(entry.requestHeaders ?? {}).map(([name, value]) => ({ name, value })),
          bodySize: 0,
        },
        response: {
          status: entry.status,
          statusText: entry.statusText,
          headers: Object.entries(entry.responseHeaders ?? {}).map(([name, value]) => ({ name, value })),
          content: { size: entry.size || 0, mimeType: entry.mimeType || '' },
          bodySize: entry.size || 0,
        },
        timings: { send: 0, wait: entry.duration || 0, receive: 0 },
      })),
    },
  }
}

// ── Timing segments ───────────────────────────────────────────────────────────

const SEG = [
  { label: 'DNS',      color: 'bg-purple-500',  get: (t: HarTiming) => Math.max(t.dns ?? 0, 0) },
  { label: 'TCP',      color: 'bg-orange-500',  get: (t: HarTiming) => { const c = t.connect ?? 0; const s = t.ssl ?? 0; return Math.max(c > 0 ? c - Math.max(s, 0) : 0, 0) } },
  { label: 'TLS',      color: 'bg-yellow-500',  get: (t: HarTiming) => Math.max(t.ssl ?? 0, 0) },
  { label: 'Send',     color: 'bg-blue-500',    get: (t: HarTiming) => Math.max(t.send ?? 0, 0) },
  { label: 'TTFB',     color: 'bg-cyan-500',    get: (t: HarTiming) => Math.max(t.wait ?? 0, 0) },
  { label: 'Download', color: 'bg-green-500',   get: (t: HarTiming) => Math.max(t.receive ?? 0, 0) },
] as const

// ── Mini waterfall bar ────────────────────────────────────────────────────────

function MiniBar({ timings, total }: { timings: HarTiming; total: number }) {
  const t = Math.max(total, 1)
  return (
    <div className="flex h-2.5 w-20 overflow-hidden rounded-sm bg-surface-2">
      {SEG.map(({ label, color, get }) => {
        const ms = get(timings)
        if (ms <= 0) return null
        return <div key={label} className={cn('shrink-0', color)} style={{ width: `${(ms / t) * 100}%` }} />
      })}
    </div>
  )
}

// ── Full timing waterfall (detail pane) ────────────────────────────────────────

function WaterfallDetail({ entry }: { entry: RichEntry }) {
  const total = Math.max(entry.time, 1)
  return (
    <div className="py-1">
      {SEG.map(({ label, color, get }) => {
        const ms = get(entry.timings)
        return (
          <div key={label} className="mb-1.5 grid grid-cols-[64px_1fr_56px] items-center gap-2">
            <span className="text-right text-[10px] text-text-4">{label}</span>
            <div className="h-4 overflow-hidden rounded bg-surface-2">
              <div className={cn('h-full rounded', color)} style={{ width: `${Math.max((ms / total) * 100, 0)}%`, minWidth: ms > 0 ? '2px' : '0' }} />
            </div>
            <span className="font-mono text-[10px] text-text-2">{ms > 0 ? fmtMs(ms) : '-'}</span>
          </div>
        )
      })}
      <div className="mt-2 grid grid-cols-[64px_1fr_56px] items-center gap-2 border-t border-border-2 pt-2">
        <span className="text-right text-[10px] text-text-4">Total</span>
        <div />
        <span className="font-mono text-[10px] font-semibold text-text-1">{fmtMs(entry.time)}</span>
      </div>
    </div>
  )
}

// ── Header table ──────────────────────────────────────────────────────────────

function HeaderTable({ headers }: { headers: HarHeader[] }) {
  if (!headers?.length) return <p className="py-3 text-center text-[10px] text-text-4">No headers</p>
  return (
    <div>
      {headers.map((h, i) => (
        <div key={i} className="flex gap-2 border-b border-border-2 py-1 text-[10px] last:border-0">
          <span className="w-1/3 shrink-0 break-all font-mono font-semibold text-text-3">{h.name}</span>
          <span className="min-w-0 break-all font-mono text-text-2">{h.value}</span>
        </div>
      ))}
    </div>
  )
}

// ── Body preview with copy ────────────────────────────────────────────────────

function BodyPreview({ text }: { text?: string }) {
  const [copied, setCopied] = useState(false)
  if (!text) return <p className="py-3 text-center text-[10px] text-text-4">No body</p>
  const display = text.length > 3000 ? text.slice(0, 3000) + '\n…[truncated]' : text
  return (
    <div className="relative">
      <button
        onClick={() => { navigator.clipboard.writeText(text).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1200) }}
        className="absolute right-1 top-1 z-10 grid h-5 w-5 place-items-center rounded bg-surface-2 text-text-4 hover:text-text-1"
      >
        {copied ? <Check size={9} className="text-success" /> : <Copy size={9} />}
      </button>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-0 p-2 pt-5 font-mono text-[10px] leading-[1.45] text-text-2">{display}</pre>
    </div>
  )
}

// ── Entry detail pane ─────────────────────────────────────────────────────────

function EntryDetail({ entry, onClose }: { entry: RichEntry; onClose: () => void }) {
  const [tab, setTab] = useState<'timings' | 'request' | 'response'>('timings')
  const pathname = (() => { try { return new URL(entry.request.url).pathname } catch { return entry.request.url } })()

  const sendToComposer = () => {
    useTabsStore.getState().openTab(entryToRequest(entry))
    useAppStore.getState().setActiveRail('collections')
  }

  const createMock = async () => {
    let path = '/'
    try { path = new URL(entry.request.url).pathname || '/' } catch { /* keep root */ }
    const endpoint = {
      id: uid(),
      path,
      method: entry.request.method,
      description: `Created from HAR ${entry.request.url}`,
      responses: [{
        id: uid(),
        name: `Status ${entry.response.status || 200}`,
        status: entry.response.status || 200,
        headers: headersToObject(entry.response.headers ?? []),
        body: entry.response.content?.text ?? '',
        delayMs: Math.max(0, Math.round(entry.time || 0)),
        isActive: true,
      }],
      mode: 'first_active',
    }
    await appendMockEndpoints([endpoint])
    useAppStore.getState().setActiveRail('mock')
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border-1 bg-surface-1 px-3 py-2">
        <span className={cn('font-mono text-[10px] font-semibold', methodCls(entry.request.method))}>{entry.request.method}</span>
        <span className="flex-1 truncate font-mono text-[10px] text-text-2" title={entry.request.url}>{pathname}</span>
        <button onClick={sendToComposer} className="text-text-4 hover:text-accent" title="Send to Composer"><Send size={12} /></button>
        <button onClick={createMock} className="text-text-4 hover:text-success" title="Create mock endpoint"><Server size={12} /></button>
        <button onClick={onClose} className="text-text-4 hover:text-error"><X size={12} /></button>
      </div>
      <div className="flex shrink-0 border-b border-border-1 bg-surface-0">
        {(['timings', 'request', 'response'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn('-mb-px border-b-2 px-3 py-1.5 text-[10px] font-medium capitalize transition-colors', tab === t ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text-1')}>
            {t}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {tab === 'timings' && <WaterfallDetail entry={entry} />}
        {tab === 'request' && (
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-text-4">URL</p>
              <p className="break-all font-mono text-[10px] text-text-2">{entry.request.url}</p>
            </div>
            <div>
              <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-text-4">Headers ({entry.request.headers?.length ?? 0})</p>
              <HeaderTable headers={entry.request.headers ?? []} />
            </div>
            {entry.request.postData?.text && (
              <div>
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-text-4">Body</p>
                <BodyPreview text={entry.request.postData.text} />
              </div>
            )}
          </div>
        )}
        {tab === 'response' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold', statusCls(entry.response.status))}>{entry.response.status || '?'} {entry.response.statusText}</span>
              <span className="text-[10px] text-text-4">{fmtBytes(entry.response.content?.size || entry.response.bodySize)}</span>
              <span className="text-[10px] text-text-4 truncate max-w-[180px]">{entry.response.content?.mimeType}</span>
            </div>
            <div>
              <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-text-4">Headers ({entry.response.headers?.length ?? 0})</p>
              <HeaderTable headers={entry.response.headers ?? []} />
            </div>
            {entry.response.content?.text && (
              <div>
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-text-4">Body</p>
                <BodyPreview text={entry.response.content.text} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Entry row ─────────────────────────────────────────────────────────────────

function EntryRow({ entry, selected, onClick }: { entry: RichEntry; selected: boolean; onClick: () => void }) {
  const pathname = (() => { try { return new URL(entry.request.url).pathname } catch { return entry.request.url } })()
  return (
    <button
      onClick={onClick}
      className={cn('group flex w-full items-center gap-2 border-b border-border-2 px-3 py-1.5 text-left transition-colors hover:bg-surface-1', selected && 'border-l-2 border-l-accent bg-accent/5')}
    >
      <span className={cn('w-9 shrink-0 rounded px-1 py-0.5 text-center font-mono text-[9px] font-semibold', statusCls(entry.response?.status ?? 0))}>
        {entry.response?.status || '?'}
      </span>
      <span className={cn('w-10 shrink-0 font-mono text-[9px] font-semibold', methodCls(entry.request.method))}>{entry.request.method}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-2" title={entry.request.url}>{pathname}</span>
      <div className="flex shrink-0 items-center gap-0.5">
        {entry._error && <span title="Error"><AlertTriangle size={9} className="text-error" /></span>}
        {entry._slow  && <span title="Slow (> 1s)"><Clock size={9} className="text-warning" /></span>}
        {entry._heavy && <span title="Heavy (> 512 KB)"><Package size={9} className="text-info" /></span>}
      </div>
      <span className="w-8 shrink-0 text-right font-mono text-[9px] text-text-4">{entry._mimeShort}</span>
      <span className="w-14 shrink-0 text-right font-mono text-[9px] text-text-3">{fmtMs(entry.time)}</span>
      <MiniBar timings={entry.timings} total={entry.time} />
    </button>
  )
}

// ── Compare view ──────────────────────────────────────────────────────────────

type CompareMatch = { key: string; url: string; method: string; timeA: number; timeB: number; diff: number; pct: number }

function CompareView({ harA, harB }: { harA: HarDoc; harB: HarDoc }) {
  const matches = useMemo<CompareMatch[]>(() => {
    const mapB = new Map<string, RichEntry>()
    for (const e of enrich(harB.log.entries)) {
      const k = `${e.request.method}:${e.request.url}`
      if (!mapB.has(k)) mapB.set(k, e)
    }
    return enrich(harA.log.entries).flatMap((e) => {
      const k = `${e.request.method}:${e.request.url}`
      const b = mapB.get(k)
      if (!b) return []
      const diff = b.time - e.time
      return [{ key: k, url: e.request.url, method: e.request.method, timeA: e.time, timeB: b.time, diff, pct: e.time > 0 ? (diff / e.time) * 100 : 0 }]
    }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
  }, [harA, harB])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-4 border-b border-border-1 bg-surface-0 px-3 py-1 text-[10px] text-text-4">
        <span>{matches.length} matching requests</span>
        <span className="text-success">▼ Faster in B</span>
        <span className="text-error">▲ Slower in B</span>
        <span className="text-text-4">≈ Similar (±5%)</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 border-b border-border-1 bg-surface-1">
            <tr>
              {['Method', 'URL', 'HAR A', 'HAR B', 'Diff'].map((h) => (
                <th key={h} className="px-3 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wider text-text-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matches.length === 0 && (
              <tr><td colSpan={5} className="py-8 text-center text-[11px] text-text-4">No matching URLs found between the two HAR files</td></tr>
            )}
            {matches.map((m, i) => {
              const similar = Math.abs(m.pct) < 5
              const faster = m.diff < 0
              const cls = similar ? 'text-text-4' : faster ? 'text-success' : 'text-error'
              return (
                <tr key={i} className="border-b border-border-2 hover:bg-surface-1">
                  <td className={cn('px-3 py-1.5 font-mono text-[10px] font-semibold', methodCls(m.method))}>{m.method}</td>
                  <td className="max-w-xs truncate px-3 py-1.5 font-mono text-[10px] text-text-2" title={m.url}>{m.url}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-[10px] text-text-3">{fmtMs(m.timeA)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-[10px] text-text-3">{fmtMs(m.timeB)}</td>
                  <td className={cn('px-3 py-1.5 text-right font-mono text-[10px] font-semibold', cls)}>
                    {similar ? '≈' : faster ? '▼' : '▲'} {fmtMs(Math.abs(m.diff))} ({Math.abs(Math.round(m.pct))}%)
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function HarViewerPanel() {
  const port = useServerPort()
  const fileARef = useRef<HTMLInputElement | null>(null)
  const fileBRef = useRef<HTMLInputElement | null>(null)
  const [harA, setHarA] = useState<HarDoc | null>(null)
  const [nameA, setNameA] = useState('')
  const [harB, setHarB] = useState<HarDoc | null>(null)
  const [nameB, setNameB] = useState('')
  const [compare, setCompare] = useState(false)
  const [selected, setSelected] = useState<RichEntry | null>(null)
  const [filterDomain, setFilterDomain] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterMime, setFilterMime] = useState('')
  const [filterMinMs, setFilterMinMs] = useState(0)
  const [search, setSearch] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const entries  = useMemo(() => harA ? enrich(harA.log.entries) : [], [harA])
  const domains  = useMemo(() => Array.from(new Set(entries.map((e) => e._domain))).sort(), [entries])
  const mimes    = useMemo(() => Array.from(new Set(entries.map((e) => e._mimeShort))).sort(), [entries])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((e) => {
      if (filterDomain && e._domain !== filterDomain) return false
      const s = e.response?.status ?? 0
      if (filterStatus === '2xx' && (s < 200 || s >= 300)) return false
      if (filterStatus === '3xx' && (s < 300 || s >= 400)) return false
      if (filterStatus === '4xx' && (s < 400 || s >= 500)) return false
      if (filterStatus === '5xx' && s < 500) return false
      if (filterStatus === 'err' && s > 0 && s < 400) return false
      if (filterMime && e._mimeShort !== filterMime) return false
      if (filterMinMs > 0 && e.time < filterMinMs) return false
      if (q && !e.request.url.toLowerCase().includes(q)) return false
      return true
    })
  }, [entries, filterDomain, filterMime, filterMinMs, filterStatus, search])

  const stats = useMemo(() => ({
    errors: filtered.filter((e) => e._error).length,
    slow:   filtered.filter((e) => e._slow).length,
    heavy:  filtered.filter((e) => e._heavy).length,
  }), [filtered])

  const importFile = useCallback(async (file: File, slot: 'a' | 'b') => {
    setErrMsg(''); setBusy(true)
    try {
      const d = await readHarFile(file)
      if (slot === 'a') { setHarA(d); setNameA(file.name); setSelected(null) }
      else { setHarB(d); setNameB(file.name) }
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Import failed')
    } finally { setBusy(false) }
  }, [])

  const importFromProxy = useCallback(async () => {
    if (!port) return
    setErrMsg(''); setBusy(true)
    try {
      const res = await sidecarFetch(serverUrl(port, '/proxy/export'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'har', ids: [] }),
      })
      const data = await res.json() as { ok: boolean; data?: HarDoc; error?: string }
      if (!data.ok || !data.data) throw new Error(data.error ?? 'No data returned')
      if (!(data.data.log?.entries?.length)) throw new Error('Proxy has no captured traffic yet')
      setHarA(data.data); setNameA('Proxy Traffic'); setSelected(null)
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Failed to load from proxy')
    } finally { setBusy(false) }
  }, [port])

  const importFromBrowser = useCallback(() => {
    setErrMsg('')
    const browserEntries = useBrowserDebugStore.getState().entries
    if (browserEntries.length === 0) {
      setErrMsg('Browser Debug has no captured network entries yet')
      return
    }
    setHarA(browserEntriesToHar(browserEntries))
    setNameA('Browser Debug')
    setSelected(null)
  }, [])

  const exportHar = useCallback(() => {
    if (!harA) return
    const blob = new Blob([JSON.stringify(harA, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${nameA.replace(/\.har$/i, '') || 'export'}.har`; a.click()
    URL.revokeObjectURL(url)
  }, [harA, nameA])

  const clearFilters = () => { setFilterDomain(''); setFilterStatus(''); setFilterMime(''); setFilterMinMs(0); setSearch('') }
  const hasFilters = !!(filterDomain || filterStatus || filterMime || filterMinMs > 0 || search)

  return (
    <div className="flex flex-1 flex-col overflow-hidden">

      {/* ── Toolbar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-1 bg-surface-1 px-3 py-2">
        <input ref={fileARef} type="file" accept=".har,.json" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f, 'a'); e.target.value = '' }} />

        <button onClick={() => fileARef.current?.click()} disabled={busy}
          className="flex h-7 items-center gap-1.5 rounded border border-border-2 px-2.5 text-[11px] text-text-2 hover:bg-surface-2 disabled:opacity-40">
          <FileInput size={13} /> Import HAR
        </button>

        <button onClick={() => void importFromProxy()} disabled={busy || !port}
          className="flex h-7 items-center gap-1.5 rounded border border-border-2 px-2.5 text-[11px] text-text-2 hover:bg-surface-2 disabled:opacity-40">
          <RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> From Proxy
        </button>

        <button onClick={importFromBrowser} disabled={busy}
          className="flex h-7 items-center gap-1.5 rounded border border-border-2 px-2.5 text-[11px] text-text-2 hover:bg-surface-2 disabled:opacity-40">
          <RefreshCw size={12} /> From Browser
        </button>

        {harA && (
          <>
            <button onClick={exportHar}
              className="flex h-7 items-center gap-1.5 rounded border border-border-2 px-2.5 text-[11px] text-text-2 hover:bg-surface-2">
              <Download size={12} /> Export
            </button>
            <button
              onClick={() => setCompare((v) => !v)}
              className={cn('flex h-7 items-center gap-1.5 rounded border px-2.5 text-[11px]',
                compare ? 'border-accent bg-accent/10 text-accent' : 'border-border-2 text-text-2 hover:bg-surface-2')}>
              <Layers size={12} /> Compare
            </button>
            <span className="max-w-40 truncate text-[10px] text-text-4" title={nameA}>{nameA}</span>
            <button onClick={() => { setHarA(null); setHarB(null); setSelected(null); setCompare(false); clearFilters() }}
              className="ml-auto text-text-4 hover:text-error" title="Clear">
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>

      {/* ── Error bar ── */}
      {errMsg && (
        <div className="flex shrink-0 items-center gap-2 border-b border-error/30 bg-error/10 px-3 py-1.5">
          <AlertTriangle size={12} className="text-error" />
          <span className="text-[11px] text-error">{errMsg}</span>
          <button onClick={() => setErrMsg('')} className="ml-auto text-error/60 hover:text-error"><X size={11} /></button>
        </div>
      )}

      {/* ── Empty state ── */}
      {!harA && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <BarChart2 size={42} className="mx-auto mb-3 text-text-4 opacity-25" />
            <p className="text-sm font-medium text-text-2">No HAR file loaded</p>
            <p className="mt-1 text-[11px] text-text-4">Import a .har file or pull captured traffic from the Proxy panel</p>
            <div className="mt-4 flex justify-center gap-2">
              <button onClick={() => fileARef.current?.click()}
                className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-[11px] font-medium text-white">
                <FileInput size={12} /> Import HAR
              </button>
              <button onClick={() => void importFromProxy()} disabled={!port}
                className="flex items-center gap-1.5 rounded border border-border-2 px-3 py-1.5 text-[11px] text-text-2 hover:bg-surface-2 disabled:opacity-40">
                <RefreshCw size={12} /> From Proxy
              </button>
              <button onClick={importFromBrowser}
                className="flex items-center gap-1.5 rounded border border-border-2 px-3 py-1.5 text-[11px] text-text-2 hover:bg-surface-2">
                <RefreshCw size={12} /> From Browser
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Compare mode ── */}
      {harA && compare && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-2 border-b border-border-1 bg-surface-0 px-3 py-1.5 text-[10px]">
            <span className="text-text-4">A: <span className="text-accent">{nameA}</span></span>
            <span className="text-text-4">vs</span>
            <input ref={fileBRef} type="file" accept=".har,.json" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f, 'b'); e.target.value = '' }} />
            {harB ? (
              <>
                <span className="text-text-2">B: {nameB}</span>
                <button onClick={() => setHarB(null)} className="text-text-4 hover:text-error"><X size={10} /></button>
              </>
            ) : (
              <button onClick={() => fileBRef.current?.click()} className="flex items-center gap-1 text-accent hover:underline">
                <FileInput size={10} /> Load B
              </button>
            )}
          </div>
          {harB
            ? <CompareView harA={harA} harB={harB} />
            : <div className="flex flex-1 items-center justify-center text-[11px] text-text-4">Load a second HAR file to compare</div>
          }
        </div>
      )}

      {/* ── Single HAR view ── */}
      {harA && !compare && (
        <div className="flex flex-1 flex-col overflow-hidden">

          {/* Filters */}
          <div className="flex shrink-0 flex-col gap-1.5 border-b border-border-1 bg-surface-0 px-3 py-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex h-6 items-center gap-1 rounded border border-border-2 bg-surface-1 px-2">
                <Search size={10} className="shrink-0 text-text-4" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by URL"
                  className="w-32 bg-transparent text-[10px] text-text-1 outline-none" />
              </div>

              <select value={filterDomain} onChange={(e) => setFilterDomain(e.target.value)}
                className="h-6 max-w-[160px] rounded border border-border-2 bg-surface-1 px-1.5 text-[10px] text-text-2 outline-none">
                <option value="">All domains</option>
                {domains.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>

              {(['', '2xx', '3xx', '4xx', '5xx', 'err'] as const).map((s) => (
                <button key={s} onClick={() => setFilterStatus(s)}
                  className={cn('h-6 rounded px-2 text-[10px] font-medium',
                    filterStatus === s ? 'bg-accent text-white' : 'border border-border-2 bg-surface-1 text-text-3 hover:text-text-1')}>
                  {s || 'All'}
                </button>
              ))}

              <select value={filterMime} onChange={(e) => setFilterMime(e.target.value)}
                className="h-6 rounded border border-border-2 bg-surface-1 px-1.5 text-[10px] text-text-2 outline-none">
                <option value="">All types</option>
                {mimes.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>

              <label className="flex items-center gap-1 text-[10px] text-text-4">
                Min
                <input type="number" min={0} value={filterMinMs || ''}
                  onChange={(e) => setFilterMinMs(Number(e.target.value) || 0)}
                  placeholder="0"
                  className="h-6 w-14 rounded border border-border-2 bg-surface-1 px-1.5 text-text-1 outline-none" />
                ms
              </label>

              {hasFilters && (
                <button onClick={clearFilters} className="flex h-6 items-center gap-1 rounded px-1.5 text-[10px] text-text-4 hover:text-error">
                  <X size={10} /> Clear
                </button>
              )}
            </div>

            <div className="flex items-center gap-3 text-[10px] text-text-4">
              <span>{filtered.length}/{entries.length} requests</span>
              {stats.errors > 0 && <span className="text-error">{stats.errors} errors</span>}
              {stats.slow   > 0 && <span className="text-warning">{stats.slow} slow (&gt;1s)</span>}
              {stats.heavy  > 0 && <span className="text-info">{stats.heavy} heavy (&gt;512KB)</span>}
            </div>
          </div>

          {/* List + Detail split */}
          <div className={cn('grid min-h-0 flex-1 overflow-hidden', selected ? 'grid-cols-[1fr_360px]' : 'grid-cols-1')}>

            {/* Request list */}
            <div className="flex min-h-0 flex-col overflow-hidden">
              <div className="flex shrink-0 items-center gap-2 border-b border-border-1 bg-surface-1 px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-text-4">
                <span className="w-9">St</span>
                <span className="w-10">Method</span>
                <span className="flex-1">Path</span>
                <span className="w-4"></span>
                <span className="w-8 text-right">Type</span>
                <span className="w-14 text-right">Time</span>
                <span className="w-20 text-right">Timing</span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {filtered.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-[11px] text-text-4">
                    {entries.length > 0 ? 'No entries match the current filters' : 'HAR file has no entries'}
                  </div>
                ) : filtered.map((e) => (
                  <EntryRow
                    key={e._id}
                    entry={e}
                    selected={selected?._id === e._id}
                    onClick={() => setSelected(selected?._id === e._id ? null : e)}
                  />
                ))}
              </div>
            </div>

            {/* Detail pane */}
            {selected && (
              <div className="flex min-h-0 flex-col overflow-hidden border-l border-border-1">
                <EntryDetail entry={selected} onClose={() => setSelected(null)} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
