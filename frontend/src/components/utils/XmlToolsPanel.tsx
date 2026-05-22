import { useState, useEffect } from 'react'
import { FileCode, GitCompare, Code, Search, Copy, AlignLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

type Tab = 'format' | 'diff' | 'entities' | 'xpath'

const TABS: { key: Tab; icon: React.ElementType; label: string }[] = [
  { key: 'format',   icon: AlignLeft,   label: 'Format'   },
  { key: 'diff',     icon: GitCompare,  label: 'Diff'     },
  { key: 'entities', icon: Code,        label: 'Entities' },
  { key: 'xpath',    icon: Search,      label: 'XPath'    },
]

// ── XML utilities ─────────────────────────────────────────────────────────────

function serializeXml(node: Element, depth: number): string {
  const INDENT = '  '
  const pad    = INDENT.repeat(depth)
  const tag    = node.tagName
  const attrs  = Array.from(node.attributes).map(a => ` ${a.name}="${a.value}"`).join('')

  const elementChildren = Array.from(node.childNodes).filter(
    n => n.nodeType === Node.ELEMENT_NODE,
  ) as Element[]
  const textContent = Array.from(node.childNodes)
    .filter(n => n.nodeType === Node.TEXT_NODE)
    .map(n => n.textContent?.trim())
    .filter(Boolean)
    .join('')

  if (elementChildren.length === 0 && !textContent) return `${pad}<${tag}${attrs}/>`
  if (elementChildren.length === 0 && textContent)   return `${pad}<${tag}${attrs}>${textContent}</${tag}>`
  const children = elementChildren.map(el => serializeXml(el, depth + 1)).join('\n')
  return `${pad}<${tag}${attrs}>\n${children}\n${pad}</${tag}>`
}

function formatXml(raw: string): string {
  try {
    const parser = new DOMParser()
    const doc    = parser.parseFromString(raw.trim(), 'application/xml')
    const err    = doc.querySelector('parsererror')
    if (err) return raw
    return serializeXml(doc.documentElement, 0)
  } catch { return raw }
}

function encodeEntities(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g,       (_, n: string) => String.fromCharCode(parseInt(n,  10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
}

function evalXPath(xmlStr: string, xpath: string): { nodes: string[]; type: string } {
  const parser  = new DOMParser()
  const doc     = parser.parseFromString(xmlStr, 'application/xml')
  const parseErr = doc.querySelector('parsererror')
  if (parseErr) throw new Error('Invalid XML')

  const result = doc.evaluate(xpath, doc, null, XPathResult.ANY_TYPE, null)
  switch (result.resultType) {
    case XPathResult.STRING_TYPE:  return { nodes: [result.stringValue],  type: 'string'  }
    case XPathResult.NUMBER_TYPE:  return { nodes: [String(result.numberValue)], type: 'number' }
    case XPathResult.BOOLEAN_TYPE: return { nodes: [String(result.booleanValue)], type: 'boolean' }
    default: {
      const nodes: string[] = []
      let node = result.iterateNext()
      while (node) {
        const serializer = new XMLSerializer()
        const s = node.nodeType === Node.ELEMENT_NODE
          ? serializer.serializeToString(node)
          : (node.textContent ?? '')
        nodes.push(s)
        node = result.iterateNext()
      }
      return { nodes, type: `nodeset (${nodes.length})` }
    }
  }
}

// ── Diff helpers (same LCS approach as JsonToolsPanel) ───────────────────────

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
  removed:   'bg-red-500/10 text-red-400 border-l-2 border-red-500/40',
  added:     'bg-emerald-500/10 text-emerald-400 border-l-2 border-emerald-500/40',
  empty:     'bg-surface-2/20',
}

function XmlDiffView({ left, right }: { left: string; right: string }) {
  if (!left.trim() && !right.trim()) {
    return <div className="text-center py-12 text-text-4 text-xs">Paste XML on both sides to compare</div>
  }
  const lLines = formatXml(left).split('\n')
  const rLines = formatXml(right).split('\n')
  const diff   = computeDiff(lLines, rLines)
  const rows   = toSideBySide(diff)
  const equal  = diff.every(d => d.type === 'unchanged')

  return (
    <div className="border border-border-1 rounded-md overflow-hidden text-xs font-mono">
      {equal && (
        <div className="px-3 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-400 text-[10px] font-medium tracking-wide">
          ✓ No differences
        </div>
      )}
      <div className="grid grid-cols-2 divide-x divide-border-1 overflow-auto max-h-[55vh]">
        {(['left', 'right'] as const).map(side => (
          <div key={side}>
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-text-4 bg-surface-1 border-b border-border-1 sticky top-0 z-10">
              {side === 'left' ? 'Left (original)' : 'Right (modified)'}
            </div>
            {rows.map((row, idx) => {
              const cls  = side === 'left' ? row.leftType  : row.rightType
              const text = side === 'left' ? row.left      : row.right
              return (
                <div key={idx} className={cn('px-3 py-[2px] whitespace-pre leading-5 min-h-[21px]', LINE_CLS[cls])}>
                  {text || ' '}
                </div>
              )
            })}
          </div>
        ))}
      </div>
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

const TA  = 'px-3 py-2 bg-surface-2 border border-border-2 rounded-md text-xs text-text-1 font-mono outline-none focus:border-accent resize-y w-full'
const LBL = 'text-[10px] text-text-4 uppercase tracking-wider'
const BTN = 'px-4 py-1.5 bg-accent text-white rounded text-xs font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed'

// ── Panel ─────────────────────────────────────────────────────────────────────

const SAMPLE_XML = `<root>
  <user id="1">
    <name>Alice</name>
    <email>alice@example.com</email>
  </user>
</root>`

export function XmlToolsPanel({ initialTab }: { initialTab?: Tab } = {}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'format')

  // Format
  const [fmtInput, setFmtInput]   = useState(SAMPLE_XML)
  const [fmtOutput, setFmtOutput] = useState('')
  const [fmtError,  setFmtError ] = useState('')

  useEffect(() => {
    if (!fmtInput.trim()) { setFmtOutput(''); setFmtError(''); return }
    const timer = setTimeout(() => {
      try {
        const parser = new DOMParser()
        const doc    = parser.parseFromString(fmtInput.trim(), 'application/xml')
        const err    = doc.querySelector('parsererror')
        if (err) { setFmtError(err.textContent ?? 'Parse error'); setFmtOutput(''); return }
        setFmtOutput(serializeXml(doc.documentElement, 0))
        setFmtError('')
      } catch (e) { setFmtError(String(e)); setFmtOutput('') }
    }, 200)
    return () => clearTimeout(timer)
  }, [fmtInput])

  // Diff
  const [diffLeft,  setDiffLeft ] = useState('<root><a>1</a><b>hello</b></root>')
  const [diffRight, setDiffRight] = useState('<root><a>2</a><b>hello</b><c>new</c></root>')

  // Entities
  const [entInput,  setEntInput ] = useState('<greeting>Hello & "World" in <b>XML</b></greeting>')
  const [entOutput, setEntOutput] = useState('')
  const [entMode,   setEntMode  ] = useState<'encode' | 'decode'>('encode')

  useEffect(() => {
    if (!entInput) { setEntOutput(''); return }
    setEntOutput(entMode === 'encode' ? encodeEntities(entInput) : decodeEntities(entInput))
  }, [entInput, entMode])

  // XPath
  const [xpathXml,   setXpathXml  ] = useState(SAMPLE_XML)
  const [xpathQuery, setXpathQuery] = useState('//user/name')
  const [xpathResult, setXpathResult] = useState<{ nodes: string[]; type: string } | null>(null)
  const [xpathError,  setXpathError ] = useState('')

  const runXPath = () => {
    setXpathError('')
    setXpathResult(null)
    try {
      const res = evalXPath(xpathXml, xpathQuery)
      setXpathResult(res)
    } catch (e) { setXpathError(String(e)) }
  }

  const changeTab = (k: Tab) => {
    setTab(k)
    setFmtError('')
    setXpathError('')
    setXpathResult(null)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-1">
        <FileCode size={16} className="text-accent" />
        <h2 className="text-sm font-semibold text-text-1">XML Tools</h2>
      </div>

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

        {/* ── Format ── */}
        {tab === 'format' && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className={LBL}>XML Input <span className="normal-case opacity-60">(drop file)</span></label>
                <textarea
                  value={fmtInput} onChange={e => setFmtInput(e.target.value)}
                  rows={14} className={TA} spellCheck={false}
                  {...makeDropHandlers(setFmtInput)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className={LBL}>Formatted output</label>
                  {fmtOutput && (
                    <button
                      onClick={() => navigator.clipboard.writeText(fmtOutput)}
                      className="flex items-center gap-1 text-[10px] text-accent hover:text-accent-hover"
                    >
                      <Copy size={10} /> Copy
                    </button>
                  )}
                </div>
                {fmtError ? (
                  <div className="px-3 py-2.5 bg-error/10 border border-error/30 rounded-md text-xs text-error font-mono flex-1">
                    {fmtError}
                  </div>
                ) : (
                  <pre className={cn(TA, 'whitespace-pre overflow-auto flex-1 min-h-[14rem] text-text-2')}>
                    {fmtOutput || <span className="text-text-4 italic">formatted XML will appear here…</span>}
                  </pre>
                )}
              </div>
            </div>
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
            <XmlDiffView left={diffLeft} right={diffRight} />
          </div>
        )}

        {/* ── Entities ── */}
        {tab === 'entities' && (
          <div className="flex flex-col gap-3">
            {/* Mode toggle */}
            <div className="flex items-center gap-1 p-1 bg-surface-2 rounded-lg w-fit border border-border-2">
              {(['encode', 'decode'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setEntMode(mode)}
                  className={cn(
                    'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                    entMode === mode
                      ? 'bg-accent text-white shadow-sm'
                      : 'text-text-3 hover:text-text-2',
                  )}
                >
                  {mode === 'encode' ? 'Encode →' : '← Decode'}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className={LBL}>
                  {entMode === 'encode' ? 'Raw XML / text' : 'XML with entities'}
                  <span className="normal-case opacity-60 ml-1">(drop file)</span>
                </label>
                <textarea
                  value={entInput} onChange={e => setEntInput(e.target.value)}
                  rows={10} className={TA} spellCheck={false}
                  {...makeDropHandlers(setEntInput)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className={LBL}>
                    {entMode === 'encode' ? 'Encoded output' : 'Decoded output'}
                  </label>
                  {entOutput && (
                    <button
                      onClick={() => navigator.clipboard.writeText(entOutput)}
                      className="flex items-center gap-1 text-[10px] text-accent hover:text-accent-hover"
                    >
                      <Copy size={10} /> Copy
                    </button>
                  )}
                </div>
                <pre className={cn(TA, 'whitespace-pre-wrap overflow-auto flex-1 min-h-[10rem] text-text-2')}>
                  {entOutput || <span className="text-text-4 italic">output will appear here…</span>}
                </pre>
              </div>
            </div>

            <div className="px-3 py-2 bg-surface-2 border border-border-2 rounded text-[10px] text-text-4 font-mono leading-relaxed">
              <span className="text-text-3 font-semibold">Encode:</span>
              &nbsp;&amp; → &amp;amp; &nbsp; &lt; → &amp;lt; &nbsp; &gt; → &amp;gt; &nbsp; " → &amp;quot; &nbsp; ' → &amp;apos;
            </div>
          </div>
        )}

        {/* ── XPath ── */}
        {tab === 'xpath' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className={LBL}>XML Document <span className="normal-case opacity-60">(drop file)</span></label>
              <textarea
                value={xpathXml} onChange={e => setXpathXml(e.target.value)}
                rows={8} className={TA} spellCheck={false}
                {...makeDropHandlers(setXpathXml)}
              />
            </div>
            <div className="flex gap-2">
              <div className="flex flex-col gap-1 flex-1">
                <label className={LBL}>XPath Expression</label>
                <input
                  value={xpathQuery} onChange={e => setXpathQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') runXPath() }}
                  placeholder="//user/name or count(//user)"
                  className="h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent"
                />
              </div>
              <button onClick={runXPath} className={cn(BTN, 'self-end')}>
                Evaluate
              </button>
            </div>

            {xpathError && (
              <div className="px-3 py-2.5 bg-error/10 border border-error/30 rounded-md text-xs text-error font-mono">
                {xpathError}
              </div>
            )}

            {xpathResult && (
              <div className="bg-surface-1 border border-border-1 rounded-md overflow-hidden">
                <div className="px-3 py-1.5 border-b border-border-1 text-[10px] text-text-4 uppercase tracking-wider flex items-center justify-between">
                  <span>Result — {xpathResult.type}</span>
                  {xpathResult.nodes.length > 0 && (
                    <button
                      onClick={() => navigator.clipboard.writeText(xpathResult.nodes.join('\n'))}
                      className="flex items-center gap-1 text-accent hover:text-accent-hover"
                    >
                      <Copy size={10} /> Copy all
                    </button>
                  )}
                </div>
                {xpathResult.nodes.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-text-4 italic">No nodes matched</div>
                ) : (
                  <div className="divide-y divide-border-2 max-h-72 overflow-auto">
                    {xpathResult.nodes.map((node, idx) => (
                      <div key={idx} className="group relative px-3 py-2 text-xs text-text-2 font-mono whitespace-pre-wrap hover:bg-surface-2 transition-colors">
                        <span className="text-text-4 mr-2 select-none">{idx + 1}.</span>
                        {node}
                        <button
                          onClick={() => navigator.clipboard.writeText(node)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[10px] text-accent px-1.5 py-0.5 bg-surface-1 rounded border border-border-2"
                        >
                          <Copy size={9} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
