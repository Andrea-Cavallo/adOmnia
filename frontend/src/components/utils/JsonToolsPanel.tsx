import { useState, useEffect } from 'react'
import {
  Braces, Search, GitCompare, Eye, Copy, ArrowRight,
  Network, ChevronRight, ChevronDown,
} from 'lucide-react'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { cn } from '@/lib/utils'

type Tab = 'query' | 'set' | 'diff' | 'graph' | 'human' | 'stream' | 'mime'

const TABS: { key: Tab; icon: React.ElementType; label: string }[] = [
  { key: 'query', icon: Search,     label: 'Query'    },
  { key: 'set',   icon: ArrowRight, label: 'Set'      },
  { key: 'diff',  icon: GitCompare, label: 'Diff'     },
  { key: 'graph', icon: Network,    label: 'Tree'     },
  { key: 'human', icon: Eye,        label: 'Humanize' },
  { key: 'stream',icon: Braces,     label: 'Stream'   },
  { key: 'mime',  icon: Search,     label: 'MIME'     },
]

// ── Diff helpers ──────────────────────────────────────────────────────────────

type DiffEntry = { type: 'unchanged' | 'removed' | 'added'; line: string }

function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
  return dp
}

function computeDiff(a: string[], b: string[]): DiffEntry[] {
  const dp = lcsTable(a, b)
  const result: DiffEntry[] = []
  let i = a.length, j = b.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: 'unchanged', line: a[i - 1] }); i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', line: b[j - 1] }); j--
    } else {
      result.unshift({ type: 'removed', line: a[i - 1] }); i--
    }
  }
  return result
}

function tryPretty(s: string): string {
  try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s }
}

type SideBySideRow = { left: string; right: string; leftType: string; rightType: string }

function toSideBySide(diff: DiffEntry[]): SideBySideRow[] {
  const rows: SideBySideRow[] = []
  let i = 0
  while (i < diff.length) {
    if (diff[i].type === 'unchanged') {
      rows.push({ left: diff[i].line, right: diff[i].line, leftType: 'unchanged', rightType: 'unchanged' })
      i++
    } else {
      const removes: string[] = [], adds: string[] = []
      while (i < diff.length && diff[i].type !== 'unchanged') {
        if (diff[i].type === 'removed') removes.push(diff[i].line)
        else adds.push(diff[i].line)
        i++
      }
      const maxLen = Math.max(removes.length, adds.length)
      for (let j = 0; j < maxLen; j++) {
        rows.push({
          left:      removes[j] ?? '',
          right:     adds[j]    ?? '',
          leftType:  removes[j] !== undefined ? 'removed' : 'empty',
          rightType: adds[j]    !== undefined ? 'added'   : 'empty',
        })
      }
    }
  }
  return rows
}

const LINE_CLS: Record<string, string> = {
  unchanged: 'text-text-3',
  removed:   'bg-error/10 text-error border-l-2 border-error/40',
  added:     'bg-success/10 text-success border-l-2 border-success/40',
  empty:     'bg-surface-2/20',
}

// ── DiffView ──────────────────────────────────────────────────────────────────

function DiffView({ left, right }: { left: string; right: string }) {
  if (!left.trim() && !right.trim()) {
    return <div className="text-center py-12 text-text-4 text-xs">Paste JSON on both sides to compare</div>
  }
  const lLines = tryPretty(left).split('\n')
  const rLines = tryPretty(right).split('\n')
  const diff   = computeDiff(lLines, rLines)
  const rows   = toSideBySide(diff)
  const equal  = diff.every(d => d.type === 'unchanged')

  return (
    <div className="border border-border-1 rounded-md overflow-hidden text-xs font-mono">
      {equal && (
        <div className="px-3 py-1.5 bg-success/10 border-b border-success/20 text-success text-[10px] font-medium tracking-wide">
          ✓ No differences
        </div>
      )}
      <div className="overflow-auto max-h-[55vh]">
        {/* Single unified header — sticky so it stays visible on scroll */}
        <div className="grid grid-cols-2 sticky top-0 z-10 border-b border-border-1 bg-surface-1">
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-text-4">
            Left (original)
          </div>
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-text-4 border-l border-border-1">
            Right (modified)
          </div>
        </div>
        {/* Each diff row is ONE grid-cols-2 container — guarantees pixel-perfect alignment */}
        {rows.map((row, idx) => (
          <div key={idx} className="grid grid-cols-2">
            <div className={cn('px-3 py-[2px] whitespace-pre leading-5 min-h-[21px]', LINE_CLS[row.leftType])}>
              {row.left || ' '}
            </div>
            <div className={cn('px-3 py-[2px] whitespace-pre leading-5 min-h-[21px] border-l border-border-1', LINE_CLS[row.rightType])}>
              {row.right || ' '}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── JSON Tree ─────────────────────────────────────────────────────────────────

function JsonNode({ value, keyName, depth }: { value: unknown; keyName?: string; depth: number }) {
  const [open, setOpen] = useState(depth < 2)
  const isArr       = Array.isArray(value)
  const isObj       = !isArr && typeof value === 'object' && value !== null
  const isContainer = isArr || isObj
  const entries: [string, unknown][] = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : isObj ? Object.entries(value as Record<string, unknown>) : []
  const brackets = isArr ? ['[', ']'] : ['{', '}']

  const valCls = (): string => {
    if (value === null) return 'text-json-null italic'
    switch (typeof value) {
      case 'string':  return 'text-json-string'
      case 'number':  return 'text-json-number'
      case 'boolean': return 'text-json-bool'
      default:        return 'text-text-2'
    }
  }

  const displayVal = (): string => {
    if (value === null)             return 'null'
    if (typeof value === 'string')  return `"${value}"`
    return String(value)
  }

  const isIndexKey = keyName !== undefined && !isNaN(+keyName)

  return (
    <div className={depth > 0 ? 'pl-4 border-l border-border-2/20' : ''}>
      <div className="flex items-center gap-0.5 min-h-[22px] group">
        {isContainer ? (
          <button
            onClick={() => setOpen(o => !o)}
            className="w-4 h-4 flex items-center justify-center text-text-4 hover:text-text-2 flex-shrink-0"
          >
            {open ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
          </button>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}
        {keyName !== undefined && (
          <span className="mr-1">
            {isIndexKey
              ? <span className="text-text-4">[{keyName}]</span>
              : <span className="text-violet-400 font-medium">{keyName}</span>
            }
            <span className="text-text-4">: </span>
          </span>
        )}
        {isContainer ? (
          <span className="text-text-3">
            <span>{brackets[0]}</span>
            {!open && (
              <>
                <span className="text-text-4 mx-1 text-[10px]">
                  {entries.length} {isArr ? 'items' : 'keys'}
                </span>
                <span>{brackets[1]}</span>
              </>
            )}
          </span>
        ) : (
          <span className={valCls()}>{displayVal()}</span>
        )}
      </div>

      {isContainer && open && (
        <>
          {entries.map(([k, v]) => (
            <JsonNode key={k} value={v} keyName={k} depth={depth + 1} />
          ))}
          <div className="flex items-center min-h-[22px]">
            <span className="w-4 flex-shrink-0 mr-0.5" />
            <span className="text-text-3">{brackets[1]}</span>
          </div>
        </>
      )}
    </div>
  )
}

// ── Drop handler ──────────────────────────────────────────────────────────────

function makeDropHandlers(setter: (v: string) => void) {
  return {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => setter((ev.target?.result as string) ?? '')
      reader.readAsText(file)
    },
  }
}

// ── Shared class shortcuts ────────────────────────────────────────────────────

const TA = 'px-3 py-2 bg-surface-2 border border-border-2 rounded-md text-xs text-text-1 font-mono outline-none focus:border-accent resize-y w-full'
const LBL = 'text-[10px] text-text-4 uppercase tracking-wider'
const BTN = 'px-4 py-1.5 bg-accent text-white rounded text-xs font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed'

// ── Panel ─────────────────────────────────────────────────────────────────────

export function JsonToolsPanel({ initialTab }: { initialTab?: Tab } = {}) {
  const port = useServerPort()
  const [tab,     setTab    ] = useState<Tab>(initialTab ?? 'query')
  const [loading, setLoading] = useState(false)
  const [error,   setError  ] = useState('')
  const [result,  setResult ] = useState<object | null>(null)

  const [queryJson,  setQueryJson ] = useState('{"data":{"items":[{"name":"alpha"},{"name":"beta"}]}}')
  const [queryPath,  setQueryPath ] = useState('data.items.0.name')
  const [setJson,    setSetJson   ] = useState('{"name":"Alice"}')
  const [setPath,    setSetPath   ] = useState('age')
  const [setValue,   setSetValue  ] = useState('30')
  const [diffLeft,   setDiffLeft  ] = useState('{\n  "name": "Alice",\n  "version": 1\n}')
  const [diffRight,  setDiffRight ] = useState('{\n  "name": "Alice",\n  "version": 2,\n  "active": true\n}')
  const [graphJson,  setGraphJson ] = useState('{"name":"Alice","age":30,"roles":["admin","user"],"address":{"city":"Rome","zip":"00100"}}')
  const [humanInput, setHumanInput] = useState('1234567890')
  const [streamInput,setStreamInput] = useState('{"a":1}\n{"b":2}\n{"c":3}')
  const [mimeInput,  setMimeInput ] = useState('{"hello":"world"}')

  // Debounced graph parse
  const [graphParsed, setGraphParsed] = useState<{ data: unknown; err: string }>({ data: null, err: '' })
  useEffect(() => {
    const t = setTimeout(() => {
      if (!graphJson.trim()) { setGraphParsed({ data: null, err: '' }); return }
      try   { setGraphParsed({ data: JSON.parse(graphJson), err: '' }) }
      catch (e) { setGraphParsed({ data: null, err: String(e) }) }
    }, 200)
    return () => clearTimeout(t)
  }, [graphJson])

  const post = async (path: string, body: unknown) => {
    const url = serverUrl(port, path)
    if (!url) { setError('Backend not ready'); return }
    setLoading(true); setError(''); setResult(null)
    try {
      const res  = await sidecarFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json() as object
      if (!res.ok) { setError((data as { error?: string; message?: string }).error ?? (data as { message?: string }).message ?? res.statusText); return }
      setResult(data)
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  const changeTab = (k: Tab) => { setTab(k); setError(''); setResult(null) }

  function ResultBox({ data }: { data: object }) {
    return (
      <div className="bg-surface-1 border border-border-1 rounded-md overflow-hidden">
        <div className="px-3 py-1.5 border-b border-border-1 text-[10px] text-text-4 uppercase tracking-wider flex items-center justify-between">
          Result
          <button
            onClick={() => navigator.clipboard.writeText(JSON.stringify(data, null, 2))}
            className="flex items-center gap-1 text-accent hover:text-accent-hover"
          >
            <Copy size={10} /> Copy
          </button>
        </div>
        <pre className="p-3 text-xs text-text-2 font-mono whitespace-pre-wrap overflow-auto max-h-72">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-auto">
        {/* Tab bar */}
        <div className="flex gap-0.5 border-b border-border-1 flex-wrap">
          {TABS.map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => changeTab(key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
                tab === key
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-3 hover:text-text-2',
              )}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="px-3 py-2.5 bg-error/10 border border-error/30 rounded-md text-xs text-error font-mono">
            {error}
          </div>
        )}

        {/* ── Query ── */}
        {tab === 'query' && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className={LBL}>JSON Input <span className="normal-case opacity-60">(drop file)</span></label>
                <textarea
                  value={queryJson} onChange={e => setQueryJson(e.target.value)}
                  rows={8} className={TA} spellCheck={false}
                  {...makeDropHandlers(setQueryJson)}
                />
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className={LBL}>GJSON Path</label>
                  <input
                    value={queryPath} onChange={e => setQueryPath(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') post('/json/query', { json: queryJson, path: queryPath }) }}
                    placeholder="data.items.0.name"
                    className="h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent"
                  />
                </div>
                <button
                  onClick={() => post('/json/query', { json: queryJson, path: queryPath })}
                  disabled={loading} className={cn(BTN, 'self-start')}
                >
                  {loading ? '…' : 'Query'}
                </button>
              </div>
            </div>
            {result && <ResultBox data={result} />}
          </div>
        )}

        {/* ── Set ── */}
        {tab === 'set' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className={LBL}>JSON Input <span className="normal-case opacity-60">(drop file)</span></label>
              <textarea
                value={setJson} onChange={e => setSetJson(e.target.value)}
                rows={6} className={TA} spellCheck={false}
                {...makeDropHandlers(setSetJson)}
              />
            </div>
            <div className="flex gap-2">
              <input value={setPath}  onChange={e => setSetPath(e.target.value)}  placeholder="path"
                className="flex-1 h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent" />
              <input value={setValue} onChange={e => setSetValue(e.target.value)} placeholder="value"
                className="flex-1 h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent" />
              <button
                onClick={() => post('/json/set', { json: setJson, path: setPath, value: setValue })}
                disabled={loading} className={BTN}
              >
                {loading ? '…' : 'Set'}
              </button>
            </div>
            {result && <ResultBox data={result} />}
          </div>
        )}

        {/* ── Diff ── */}
        {tab === 'diff' && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className={LBL}>Left <span className="normal-case opacity-60">(original · drop file)</span></label>
                <textarea
                  value={diffLeft} onChange={e => setDiffLeft(e.target.value)}
                  rows={6} className={TA} spellCheck={false}
                  {...makeDropHandlers(setDiffLeft)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className={LBL}>Right <span className="normal-case opacity-60">(modified · drop file)</span></label>
                <textarea
                  value={diffRight} onChange={e => setDiffRight(e.target.value)}
                  rows={6} className={TA} spellCheck={false}
                  {...makeDropHandlers(setDiffRight)}
                />
              </div>
            </div>
            <DiffView left={diffLeft} right={diffRight} />
          </div>
        )}

        {/* ── Graph / Tree ── */}
        {tab === 'graph' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className={LBL}>JSON Input <span className="normal-case opacity-60">(drop file)</span></label>
              <textarea
                value={graphJson} onChange={e => setGraphJson(e.target.value)}
                rows={4} className={TA} spellCheck={false}
                {...makeDropHandlers(setGraphJson)}
              />
            </div>
            {graphParsed.err && (
              <div className="px-3 py-2 bg-error/10 border border-error/30 rounded text-xs text-error font-mono">
                {graphParsed.err}
              </div>
            )}
            {graphParsed.data !== null && (
              <div className="bg-surface-1 border border-border-1 rounded-md overflow-hidden">
                <div className="px-3 py-1.5 border-b border-border-1 text-[10px] text-text-4 uppercase tracking-wider flex items-center justify-between">
                  Tree View
                  <button
                    onClick={() => navigator.clipboard.writeText(JSON.stringify(graphParsed.data, null, 2))}
                    className="flex items-center gap-1 text-accent hover:text-accent-hover"
                  >
                    <Copy size={10} /> Copy JSON
                  </button>
                </div>
                <div className="p-3 text-xs font-mono overflow-auto max-h-[55vh]">
                  <JsonNode value={graphParsed.data} depth={0} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Humanize ── */}
        {tab === 'human' && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <input
                value={humanInput} onChange={e => setHumanInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') post('/json/human', { value: humanInput }) }}
                placeholder="1234567890 (timestamp, bytes, duration…)"
                className="flex-1 h-8 px-3 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent"
              />
              <button
                onClick={() => post('/json/human', { value: humanInput })}
                disabled={loading} className={BTN}
              >
                {loading ? '…' : 'Humanize'}
              </button>
            </div>
            {result && <ResultBox data={result} />}
          </div>
        )}

        {/* ── Stream ── */}
        {tab === 'stream' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className={LBL}>NDJSON stream — one JSON per line <span className="normal-case opacity-60">(drop file)</span></label>
              <textarea
                value={streamInput} onChange={e => setStreamInput(e.target.value)}
                rows={8} className={TA} spellCheck={false}
                {...makeDropHandlers(setStreamInput)}
              />
            </div>
            <button
              onClick={() => post('/json/stream', { lines: streamInput.split('\n').filter(Boolean) })}
              disabled={loading} className={cn(BTN, 'self-start')}
            >
              {loading ? '…' : 'Validate Stream'}
            </button>
            {result && <ResultBox data={result} />}
          </div>
        )}

        {/* ── MIME Detect ── */}
        {tab === 'mime' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className={LBL}>Input — string or base64 bytes <span className="normal-case opacity-60">(drop file)</span></label>
              <textarea
                value={mimeInput} onChange={e => setMimeInput(e.target.value)}
                rows={4} className={TA} spellCheck={false}
                {...makeDropHandlers(setMimeInput)}
              />
            </div>
            <button
              onClick={() => post('/json/mimetype', { data: mimeInput })}
              disabled={loading} className={cn(BTN, 'self-start')}
            >
              {loading ? '…' : 'Detect MIME'}
            </button>
            {result && <ResultBox data={result} />}
          </div>
        )}
      </div>
    </div>
  )
}
