import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Loader2, Maximize2, GitBranch, GitCompare, Sparkles, X, ShieldCheck, ShieldAlert, ShieldOff, AlertTriangle, Check, XCircle, FileText, FileCode, FileJson, Search, ChevronUp, ChevronDown } from 'lucide-react'
import type { ResponseData, ContractValidationResult, AssertionResult, ScriptRunResult } from '@/lib/types'
import { cn } from '@/lib/utils'
import { prettyJson } from '@/lib/prettyJson'
import { JsonGraph } from '@/components/ui/JsonGraph'
import { validateContract, exportContractReportMarkdown, exportContractReportHtml, exportContractReportJson } from '@/lib/contractValidator'
import { evaluateAssertions } from '@/lib/assertionEngine'
import { DiffModal, DiffPickerModal } from '@/components/response/DiffView'
import { useTabsStore, type ResponseBodyView, type ResponseSection } from '@/stores/tabs'
import { useSettingsStore } from '@/stores/settings'
import { useAppStore } from '@/stores/app'

interface ResponsePanelProps {
  tabId: string
  response: ResponseData | null
  loading?: boolean
  oaSpec?: string
  oaPath?: string
  oaMethod?: string
  assertions?: import('@/lib/types').RequestAssertion[]
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(2)} MB`
}

function statusClass(status: number): string {
  if (status >= 500) return 'bg-error/20 text-error'
  if (status >= 300) return 'bg-warning/20 text-warning'
  if (status >= 200 && status < 300) return 'bg-success/20 text-success'
  return 'bg-surface-3 text-text-3'
}

function responseBytes(response: ResponseData): Uint8Array {
  if (response.bodyBase64) {
    const binary = atob(response.bodyBase64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  return Uint8Array.from(response.body, (c) => c.charCodeAt(0) & 0xff)
}

type Token = { type: 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct' | 'ws'; value: string }

function tokenizeJSON(text: string): Token[] {
  const tokens: Token[] = []
  const re = /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],:]|(\s+)/g
  let lastIdx = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) tokens.push({ type: 'ws', value: text.slice(lastIdx, m.index) })
    const val = m[0]
    let type: Token['type'] = 'punct'
    if (val.startsWith('"')) {
      type = /:$/.test(text.slice(m.index + val.length).match(/^\s*/)![0] + text[m.index + val.length + (text.slice(m.index + val.length).match(/^\s*/)![0].length)]) || /"(?:\\.|[^"\\])*"\s*:/.test(text.slice(m.index, m.index + val.length + 10))
        ? 'key' : 'string'
      // Re-check: key if followed by ':'
      const after = text.slice(m.index + val.length).trimStart()
      type = after.startsWith(':') ? 'key' : 'string'
    } else if (val === 'true' || val === 'false') {
      type = 'boolean'
    } else if (val === 'null') {
      type = 'null'
    } else if (/^-?\d/.test(val)) {
      type = 'number'
    } else if (/^\s+$/.test(val)) {
      type = 'ws'
    }
    tokens.push({ type, value: val })
    lastIdx = m.index + val.length
  }
  if (lastIdx < text.length) tokens.push({ type: 'ws', value: text.slice(lastIdx) })
  return tokens
}

const TOKEN_COLORS: Record<string, string> = {
  key: 'text-json-key',
  string: 'text-json-string',
  number: 'text-json-number',
  boolean: 'text-json-bool',
  null: 'text-json-null',
  punct: 'text-text-3',
  ws: '',
}

/** Split `value` into alternating non-match / match segments for a given search term. */
function splitOnMatches(value: string, term: string): Array<{ text: string; match: boolean }> {
  if (!term) return [{ text: value, match: false }]
  const parts: Array<{ text: string; match: boolean }> = []
  const lower = value.toLowerCase()
  const lowerTerm = term.toLowerCase()
  let pos = 0
  let found: number
  while ((found = lower.indexOf(lowerTerm, pos)) !== -1) {
    if (found > pos) parts.push({ text: value.slice(pos, found), match: false })
    parts.push({ text: value.slice(found, found + term.length), match: true })
    pos = found + term.length
  }
  if (pos < value.length) parts.push({ text: value.slice(pos), match: false })
  return parts
}

function JsonHighlight({ text, searchTerm = '' }: { text: string; searchTerm?: string }) {
  const renderTokens = (value: string) => tokenizeJSON(value).map((tok, i) => (
    <span key={i} className={TOKEN_COLORS[tok.type]}>{tok.value}</span>
  ))
  if (!searchTerm) return <>{renderTokens(text)}</>

  const parts = splitOnMatches(text, searchTerm)
  return (
    <>
      {parts.map((part, i) =>
        part.match
          ? <mark key={i} className="bg-warning/40 text-current rounded-[2px]">{renderTokens(part.text)}</mark>
          : <span key={i}>{renderTokens(part.text)}</span>
      )}
    </>
  )
}

function TextHighlight({ text, searchTerm = '' }: { text: string; searchTerm?: string }) {
  if (!searchTerm) return <span className="text-text-1">{text}</span>
  const parts = splitOnMatches(text, searchTerm)
  return (
    <>
      {parts.map((p, i) =>
        p.match
          ? <mark key={i} className="bg-warning/40 text-current rounded-[2px]">{p.text}</mark>
          : <span key={i} className="text-text-1">{p.text}</span>
      )}
    </>
  )
}

function formatXmlLike(text: string): string {
  const normalized = text.replace(/>\s*</g, '><').replace(/(>)(<)(\/*)/g, '$1\n$2$3')
  let depth = 0
  return normalized.split('\n').map((line) => {
    const trimmed = line.trim()
    if (!trimmed) return ''
    if (/^<\//.test(trimmed)) depth = Math.max(0, depth - 1)
    const out = `${'  '.repeat(depth)}${trimmed}`
    if (/^<[^!?/][^>]*[^/]?>$/.test(trimmed) && !trimmed.includes('</')) depth += 1
    return out
  }).join('\n')
}

// DiffModal and DiffPickerModal are imported from DiffView.tsx

function FullscreenBodyModal({
  body,
  contentType,
  onClose,
}: {
  body: string
  contentType: string
  onClose: () => void
}) {
  const isJson = contentType.includes('json') || body.trim().match(/^[\[{]/) != null
  let display = body
  if (isJson) {
    try { display = prettyJson(body) } catch { /* keep raw */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="w-full h-full max-w-[95vw] max-h-[95vh] bg-surface-1 border border-border-1 rounded-lg shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-1">
          <span className="text-sm font-semibold text-text-1 flex-1">Response Body</span>
          <button onClick={() => navigator.clipboard.writeText(body)} className="px-2 py-1 text-xs text-accent hover:text-accent-light">Copy</button>
          <button onClick={onClose} title="Close" className="text-text-4 hover:text-text-1"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-xs font-mono whitespace-pre-wrap break-all">
            {isJson ? <JsonHighlight text={display} /> : <span className="text-text-1">{display}</span>}
          </pre>
        </div>
      </div>
    </div>
  )
}

export function ResponsePanel({ tabId, response, loading, oaSpec, oaPath, oaMethod, assertions }: ResponsePanelProps) {
  const initialViewState = useTabsStore.getState().getViewState(tabId)
  const updateViewState = useTabsStore((s) => s.updateViewState)
  const [tab, setTab] = useState<ResponseSection>(initialViewState.responseSection)
  const [view, setView] = useState<ResponseBodyView>(initialViewState.responseBodyView)
  const [beautifiedBody, setBeautifiedBody] = useState<string | null>(null)
  // Lifted expansion state — survives graph↔pretty toggles and re-sends (P2-02)
  const [graphExpanded, setGraphExpanded] = useState<Set<string>>(
    () => new Set(initialViewState.responseGraphExpanded),
  )
  const [showFullscreen, setShowFullscreen] = useState(false)
  // Ctrl+wheel zoom for the response body — shares the editor font px with the request body.
  const [respFontPx, setRespFontPx] = useState(() => {
    const n = Number(localStorage.getItem('adomnia.editor.bodyFontPx'))
    return n >= 9 && n <= 28 ? n : 12
  })
  const [copiedBody, setCopiedBody] = useState(false)
  const copyBody = () => {
    if (!response) return
    navigator.clipboard.writeText(response.body)
    setCopiedBody(true)
    setTimeout(() => setCopiedBody(false), 1200)
  }
  const [showDiff, setShowDiff] = useState(false)
  const [diffRightBody, setDiffRightBody] = useState('')
  const [diffRightLabel, setDiffRightLabel] = useState('')
  const [showDiffPicker, setShowDiffPicker] = useState(false)

  // ── Find-in-response ──────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')   // raw typed value
  const [searchQuery, setSearchQuery] = useState('')   // debounced 150 ms
  const [matchIndex, setMatchIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop =
        useTabsStore.getState().getViewState(tabId).responseScrollTop[tab] ?? 0
    }
  }, [tabId, tab, view])

  // Ctrl/Cmd+wheel zooms the response body font (up = bigger), persisted.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      setRespFontPx((px) => {
        const next = Math.min(28, Math.max(9, px + (e.deltaY < 0 ? 1 : -1)))
        localStorage.setItem('adomnia.editor.bodyFontPx', String(next))
        return next
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Debounce search input → query so we don't re-render on every keystroke
  useEffect(() => {
    const t = setTimeout(() => { setSearchQuery(searchInput); setMatchIndex(0) }, 150)
    return () => clearTimeout(t)
  }, [searchInput])

  // Reset search state whenever a new response arrives
  useEffect(() => {
    setBeautifiedBody(null)
    setSearchInput('')
    setSearchQuery('')
    setMatchIndex(0)
    setSearchOpen(false)
  }, [response?.body])

  // Keyboard: Ctrl/Cmd+F → open find bar; Escape → close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        if (tab === 'body' && view !== 'graph') {
          e.preventDefault()
          setSearchOpen(true)
          setTimeout(() => searchRef.current?.focus(), 30)
        }
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
        setSearchInput('')
        setSearchQuery('')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [tab, view, searchOpen])

  const autoValidateSchema = useSettingsStore((s) => s.settings.requests.autoValidateSchema ?? true)
  const formatResponseAuto = useSettingsStore((s) => s.settings.editor.formatResponseAuto ?? true)
  const responseMaxRenderSizeKB = useSettingsStore((s) => s.settings.editor.responseMaxRenderSizeKB ?? 2048)

  // Auto-format: when a new structured response arrives, default to the pretty view.
  useEffect(() => {
    if (!response || !formatResponseAuto) return
    const looksStructured =
      response.contentType.includes('json') ||
      response.contentType.includes('xml') ||
      /^\s*[[{<]/.test(response.body)
    if (looksStructured) {
      setView('pretty')
      updateViewState(tabId, { responseBodyView: 'pretty' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response?.body, formatResponseAuto])
  const contractResult = useMemo(() => {
    if (!response || !autoValidateSchema) return null
    return validateContract(oaSpec, oaPath, oaMethod, response)
  }, [response, oaSpec, oaPath, oaMethod, autoValidateSchema])

  const assertionResults = useMemo(() => {
    if (!response) return []
    return evaluateAssertions(assertions, response)
  }, [response, assertions])
  const scriptRuns = response?.scripts?.runs ?? []
  const scriptTests = scriptRuns.flatMap((run) => run.tests)
  const testResultCount = assertionResults.length + scriptTests.length + scriptRuns.filter((run) => run.error).length
  const testPassCount = assertionResults.filter((r) => r.passed).length + scriptTests.filter((r) => r.passed).length
  const allTestsPassed = assertionResults.every((r) => r.passed) && scriptRuns.every((run) => run.passed)

  const displayBody = response ? (beautifiedBody ?? response.body) : ''
  // Cap heavy syntax highlighting / pretty-printing for very large payloads.
  const bodySizeKB = displayBody.length / 1024
  const tooLargeToRender = bodySizeKB > responseMaxRenderSizeKB
  const isJson = response ? (response.contentType.includes('json') || displayBody.trim().match(/^[\[{]/) != null) : false
  let validationBadge: string | null = null
  if (response && isJson && !tooLargeToRender) {
    try { JSON.parse(displayBody); validationBadge = 'valid' } catch { validationBadge = 'invalid' }
  }

  // Pretty-printed body used for both display and match counting
  let prettyBody = displayBody
  if (isJson && view === 'pretty' && !tooLargeToRender) {
    try { prettyBody = prettyJson(displayBody) } catch { /* keep raw */ }
  }

  // Count total matches in the displayed text
  const matchCount = useMemo(() => {
    if (!searchQuery || !searchOpen) return 0
    const term = searchQuery.toLowerCase()
    const body = prettyBody.toLowerCase()
    let count = 0
    let pos = 0
    let idx: number
    while ((idx = body.indexOf(term, pos)) !== -1) { count++; pos = idx + term.length }
    return count
  }, [prettyBody, searchQuery, searchOpen])

  // Scroll the current match into view after each render
  useEffect(() => {
    if (!bodyRef.current || !searchQuery || !matchCount) return
    const marks = bodyRef.current.querySelectorAll<HTMLElement>('mark')
    marks.forEach((m) => { m.style.outline = '' })
    const safeIdx = ((matchIndex % matchCount) + matchCount) % matchCount
    const target = marks[safeIdx]
    if (target) {
      target.style.outline = '2px solid var(--color-accent, #7c3aed)'
      target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [matchIndex, matchCount, searchQuery])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-accent" />
          <span className="text-xs text-text-3">Sending request…</span>
        </div>
      </div>
    )
  }

  if (!response) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-3xl text-text-4 mb-2">↘</div>
          <p className="text-sm text-text-3">Hit Send to run the request</p>
          <p className="text-xs text-text-4 mt-1">
            or press <kbd className="px-1 py-0.5 bg-surface-3 rounded text-[10px]">Ctrl</kbd>
            <kbd className="px-1 py-0.5 bg-surface-3 rounded text-[10px] ml-0.5">Enter</kbd>
          </p>
        </div>
      </div>
    )
  }

  if (response.error) {
    const { code, message } = response.error
    const hint: Record<string, string> = {
      CONN_ERR:    'Make sure the target server is running and the URL is reachable from this machine.',
      TIMEOUT:     'Increase the timeout in request settings or check server responsiveness.',
      NO_URL:      'Enter a URL in the address bar and try again.',
      INVALID_URL: 'Check the URL syntax — it must start with http:// or https://',
      AUTH_ERR:    'Check your authentication settings (token, credentials, or OAuth2 config).',
      SCRIPT_ERR:  'Fix the pre-request script and run the request again.',
      READ_ERR:    'The server started responding but the connection dropped before the body was fully received.',
      PARSE_ERR:   'Internal request encoding error. Try refreshing the request and sending again.',
    }
    const humanCode: Record<string, string> = {
      CONN_ERR:    'Connection refused',
      TIMEOUT:     'Request timeout',
      NO_URL:      'No URL',
      INVALID_URL: 'Invalid URL',
      AUTH_ERR:    'Auth error',
      SCRIPT_ERR:  'Script error',
      READ_ERR:    'Read error',
      PARSE_ERR:   'Parse error',
      ERR:         'Request error',
    }
    // Detect connection-refused patterns in raw ERR messages for better display
    const effectiveCode = code === 'ERR' && (
      message.toLowerCase().includes('connection refused') ||
      message.toLowerCase().includes('dial tcp') ||
      message.toLowerCase().includes('no such host') ||
      message.toLowerCase().includes('network unreachable')
    ) ? 'CONN_ERR' : code
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-1">
          <span className="text-xs font-medium text-text-2">Response</span>
          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-error/20 text-error">
            {humanCode[effectiveCode] ?? effectiveCode}
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center max-w-sm w-full">
            <div className="text-3xl mb-3 text-error/40">⚠</div>
            <p className="text-sm font-medium text-text-1 mb-2">{humanCode[effectiveCode] ?? 'Request failed'}</p>
            <p className="text-xs text-text-3 font-mono break-all mb-3 px-3 py-2 bg-surface-2 rounded border border-border-1 text-left">{message}</p>
            {hint[effectiveCode] && (
              <p className="text-xs text-text-4 leading-relaxed border-t border-border-1 pt-3">{hint[effectiveCode]}</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  let graphData: unknown = null
  if (isJson) {
    try { graphData = JSON.parse(displayBody) } catch { /* not valid */ }
  }

  return (
    <>
      <div className="flex-1 flex flex-col min-h-0">
        {/* Status bar with validation badge */}
        <div className="flex items-center gap-3 px-3 py-2 border-b border-border-1">
          <span className="text-xs font-medium text-text-2">Response</span>
          <span className={cn('px-2 py-0.5 rounded text-[10px] font-medium', statusClass(response.status))}>
            {response.status} {response.statusText}
          </span>
          {validationBadge && (
            <span className={cn(
              'px-2 py-0.5 rounded text-[10px] font-medium',
              validationBadge === 'valid' ? 'bg-success/20 text-success' : 'bg-error/20 text-error'
            )}>
              {validationBadge === 'valid' ? '✓ valid JSON' : '✗ invalid JSON'}
            </span>
          )}
          <div className="flex items-center gap-3 ml-auto text-[10px] text-text-3">
            <span>
              <span className="text-text-4">time </span>
              <span className="text-text-2">{response.ms} ms</span>
            </span>
            <span>
              <span className="text-text-4">size </span>
              <span className="text-text-2">{formatBytes(response.size)}</span>
            </span>
          </div>
        </div>

        {/* Tabs with action buttons */}
        <div className="flex items-center gap-0.5 px-3 border-b border-border-1">
          <button
            onClick={() => { setTab('body'); updateViewState(tabId, { responseSection: 'body' }) }}
            className={cn('px-3 py-2 text-xs relative', tab === 'body' ? 'text-text-1' : 'text-text-3 hover:text-text-2')}
          >
            Body
            {tab === 'body' && <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent rounded-t" />}
          </button>
          <button
            onClick={() => { setTab('headers'); updateViewState(tabId, { responseSection: 'headers' }) }}
            className={cn('px-3 py-2 text-xs relative', tab === 'headers' ? 'text-text-1' : 'text-text-3 hover:text-text-2')}
          >
            Headers
            <span className="ml-1 px-1 py-0.5 text-[9px] rounded bg-surface-3 text-text-3">
              {Object.keys(response.headers).length}
            </span>
            {tab === 'headers' && <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent rounded-t" />}
          </button>

          {contractResult?.hasSpec && (
            <button
              onClick={() => { setTab('contract'); updateViewState(tabId, { responseSection: 'contract' }) }}
              className={cn('px-3 py-2 text-xs relative', tab === 'contract' ? 'text-text-1' : 'text-text-3 hover:text-text-2')}
            >
              Contract
              {contractResult.valid ? (
                <span className="ml-1 px-1 py-0.5 text-[9px] rounded bg-success/20 text-success">
                  <Check size={10} className="inline" /> pass
                </span>
              ) : (
                <span className="ml-1 px-1 py-0.5 text-[9px] rounded bg-error/20 text-error">
                  <XCircle size={10} className="inline" /> {contractResult.errors.length}
                </span>
              )}
              {tab === 'contract' && <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent rounded-t" />}
            </button>
          )}

          {!contractResult?.hasSpec && oaSpec && (
            <button
              onClick={() => { setTab('contract'); updateViewState(tabId, { responseSection: 'contract' }) }}
              className={cn('px-3 py-2 text-xs relative', tab === 'contract' ? 'text-text-1' : 'text-text-3 hover:text-text-2')}
            >
              Contract
              <span className="ml-1 px-1 py-0.5 text-[9px] rounded bg-warning/20 text-warning">
                <ShieldOff size={10} className="inline" /> no spec
              </span>
              {tab === 'contract' && <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent rounded-t" />}
            </button>
          )}

          {testResultCount > 0 && (
            <button
              onClick={() => { setTab('assertions'); updateViewState(tabId, { responseSection: 'assertions' }) }}
              className={cn('px-3 py-2 text-xs relative', tab === 'assertions' ? 'text-text-1' : 'text-text-3 hover:text-text-2')}
            >
              Tests
              <span className={cn(
                'ml-1 px-1 py-0.5 text-[9px] rounded',
                allTestsPassed
                  ? 'bg-success/20 text-success'
                  : 'bg-error/20 text-error'
              )}>
                {testPassCount}/{testResultCount}
              </span>
              {tab === 'assertions' && <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent rounded-t" />}
            </button>
          )}

          {tab === 'body' && (
            <div className="flex items-center gap-1 ml-auto">
              {view !== 'graph' && (
                <button
                  onClick={() => {
                    setSearchOpen((o) => !o)
                    setTimeout(() => searchRef.current?.focus(), 30)
                  }}
                  className={cn('p-1 rounded hover:bg-surface-2', searchOpen ? 'text-accent' : 'text-text-4 hover:text-text-2')}
                  title="Find in response (Ctrl+F)"
                >
                  <Search size={12} />
                </button>
              )}
              {/* Action buttons */}
              <button
                onClick={() => setShowFullscreen(true)}
                className="p-1 text-text-4 hover:text-text-2 rounded hover:bg-surface-2"
                title="Expand"
              >
                <Maximize2 size={12} />
              </button>
              <button
                onClick={() => {
                  if (!graphData) return
                  const nextView = view === 'graph' ? 'pretty' : 'graph'
                  setView(nextView)
                  updateViewState(tabId, { responseBodyView: nextView })
                  if (nextView === 'graph') {
                    setSearchOpen(false)
                    setSearchInput('')
                    setSearchQuery('')
                  }
                }}
                className={cn('p-1 rounded hover:bg-surface-2', view === 'graph' ? 'text-accent' : 'text-text-4 hover:text-text-2')}
                title="Graph"
              >
                <GitBranch size={12} />
              </button>
              <button
                onClick={() => setShowDiffPicker(true)}
                className="p-1 text-text-4 hover:text-text-2 rounded hover:bg-surface-2"
                title="Compare with another response"
              >
                <GitCompare size={12} />
              </button>
              <button
                onClick={() => {
                  if (isJson) {
                    try {
                      setBeautifiedBody(prettyJson(displayBody))
                      setView('pretty')
                      updateViewState(tabId, { responseBodyView: 'pretty' })
                    } catch { /* invalid JSON notice is shown in the body view */ }
                    return
                  }
                  const trimmed = displayBody.trim()
                  if (response.contentType.includes('xml') || response.contentType.includes('html') || trimmed.startsWith('<')) {
                    setBeautifiedBody(formatXmlLike(displayBody))
                    setView('pretty')
                    updateViewState(tabId, { responseBodyView: 'pretty' })
                  }
                }}
                className="p-1 text-text-4 hover:text-text-2 rounded hover:bg-surface-2"
                title="Beautify response body"
              >
                <Sparkles size={12} />
              </button>

              {/* Pretty/Raw toggle */}
              <span className="text-text-4 text-[9px] mx-1">|</span>
              <button
                onClick={() => { setView('pretty'); updateViewState(tabId, { responseBodyView: 'pretty' }) }}
                className={cn('px-2 py-0.5 text-[10px] rounded', view === 'pretty' ? 'bg-surface-3 text-text-1' : 'text-text-4')}
              >
                Pretty
              </button>
              <button
                onClick={() => { setView('raw'); updateViewState(tabId, { responseBodyView: 'raw' }) }}
                className={cn('px-2 py-0.5 text-[10px] rounded', view === 'raw' ? 'bg-surface-3 text-text-1' : 'text-text-4')}
              >
                Raw
              </button>
              <button
                onClick={copyBody}
                className={cn('ml-1 p-1 rounded', copiedBody ? 'text-success' : 'text-text-4 hover:text-text-2')}
                title={copiedBody ? 'Copied!' : 'Copy response body'}
              >
                {copiedBody ? <Check size={12} /> : <Copy size={12} />}
              </button>
              {response.contentType.includes('pdf') && (
                <button
                  onClick={() => {
                    const bytes = responseBytes(response)
                    useAppStore.getState().queueFileImport({ kind: 'pdf', name: 'response.pdf', bytes })
                    useAppStore.getState().setActiveRail('pdfeditor')
                  }}
                  className="ml-0.5 p-1 text-text-4 hover:text-accent rounded"
                  title="Open in PDF Editor"
                >
                  <FileText size={12} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Find bar — shown only on the Body tab when open */}
        {tab === 'body' && view !== 'graph' && searchOpen && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border-1 bg-surface-2">
            <Search size={11} className="text-text-4 shrink-0" />
            <input
              ref={searchRef}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (e.shiftKey) setMatchIndex((i) => i - 1)
                  else setMatchIndex((i) => i + 1)
                }
                if (e.key === 'Escape') {
                  setSearchOpen(false)
                  setSearchInput('')
                  setSearchQuery('')
                }
              }}
              placeholder="Find in response…"
              className="flex-1 bg-transparent text-[11px] text-text-1 placeholder:text-text-4 outline-none min-w-0"
              spellCheck={false}
            />
            {searchQuery && (
              <span className={cn(
                'text-[10px] shrink-0 tabular-nums',
                matchCount === 0 ? 'text-error' : 'text-text-3'
              )}>
                {matchCount === 0 ? 'no matches' : `${((matchIndex % matchCount) + matchCount) % matchCount + 1} / ${matchCount}`}
              </span>
            )}
            <button
              onClick={() => setMatchIndex((i) => i - 1)}
              disabled={matchCount === 0}
              className="p-0.5 rounded text-text-4 hover:text-text-2 disabled:opacity-30 hover:bg-surface-3"
              title="Previous match (Shift+Enter)"
            >
              <ChevronUp size={12} />
            </button>
            <button
              onClick={() => setMatchIndex((i) => i + 1)}
              disabled={matchCount === 0}
              className="p-0.5 rounded text-text-4 hover:text-text-2 disabled:opacity-30 hover:bg-surface-3"
              title="Next match (Enter)"
            >
              <ChevronDown size={12} />
            </button>
            <button
              onClick={() => { setSearchOpen(false); setSearchInput(''); setSearchQuery('') }}
              className="p-0.5 rounded text-text-4 hover:text-text-2 hover:bg-surface-3"
              title="Close (Escape)"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Content */}
        <div
          ref={bodyRef}
          onScroll={(e) => {
            const viewState = useTabsStore.getState().getViewState(tabId)
            updateViewState(tabId, {
              responseScrollTop: {
                ...viewState.responseScrollTop,
                [tab]: e.currentTarget.scrollTop,
              },
            })
          }}
          className="flex-1 overflow-auto p-3"
        >
          {tab === 'body' && (
            view === 'graph' && graphData ? (
              <JsonGraph
                json={displayBody}
                className="h-full min-h-[260px]"
                expandedPaths={graphExpanded}
                onExpandedPathsChange={(next) => {
                  setGraphExpanded(next)
                  updateViewState(tabId, { responseGraphExpanded: Array.from(next) })
                }}
              />
            ) : (
              <>
                {validationBadge === 'invalid' && view === 'pretty' && (
                  <div className="mb-2 flex items-center gap-2 rounded border border-warning/20 bg-warning/10 px-3 py-2 text-[11px] text-warning">
                    <AlertTriangle size={12} />
                    <span>Response is not valid JSON - showing raw body.</span>
                  </div>
                )}
                {tooLargeToRender ? (
                  <>
                    <div className="mb-2 flex items-center gap-2 rounded border border-warning/20 bg-warning/10 px-3 py-2 text-[11px] text-warning">
                      <AlertTriangle size={12} />
                      <span>
                        Response is {Math.round(bodySizeKB)} KB — syntax highlighting disabled for performance
                        (limit {responseMaxRenderSizeKB} KB, change it in Settings → Editor).
                      </span>
                    </div>
                    <pre className="text-xs font-mono whitespace-pre-wrap break-all text-text-2" style={{ fontSize: respFontPx }}>
                      {prettyBody.slice(0, responseMaxRenderSizeKB * 1024)}
                      {displayBody.length > responseMaxRenderSizeKB * 1024 && '\n… truncated'}
                    </pre>
                  </>
                ) : (
                  <pre className="text-xs font-mono whitespace-pre-wrap break-all" style={{ fontSize: respFontPx }}>
                    {isJson && view === 'pretty' && validationBadge === 'valid'
                      ? <JsonHighlight text={prettyBody} searchTerm={searchQuery} />
                      : <TextHighlight text={prettyBody} searchTerm={searchQuery} />
                    }
                  </pre>
                )}
              </>
            )
          )}
          {tab === 'headers' && (
            <div className="flex flex-col gap-0.5">
              {Object.entries(response.headers).map(([k, v]) => (
                <div key={k} className="flex gap-2 text-xs font-mono">
                  <span className="text-accent-light shrink-0">{k}</span>
                  <span className="text-text-2 break-all">{v}</span>
                </div>
              ))}
            </div>
          )}
          {tab === 'contract' && contractResult && (
            <ContractResultView result={contractResult} />
          )}
          {tab === 'contract' && !contractResult && (
            <NoContractView />
          )}
          {tab === 'assertions' && testResultCount > 0 && (
            <AssertionsView results={assertionResults} scriptRuns={scriptRuns} />
          )}
        </div>
      </div>

      {showFullscreen && (
        <FullscreenBodyModal
          body={response.body}
          contentType={response.contentType}
          onClose={() => setShowFullscreen(false)}
        />
      )}

      {showDiff && (
        <DiffModal
          leftLabel="Current"
          rightLabel={diffRightLabel}
          leftBody={response.body}
          rightBody={diffRightBody}
          onClose={() => setShowDiff(false)}
        />
      )}

      {showDiffPicker && (
        <DiffPickerModal
          currentTabId={tabId}
          onConfirm={(body, label) => {
            setDiffRightBody(body)
            setDiffRightLabel(label)
            setShowDiffPicker(false)
            setShowDiff(true)
          }}
          onCancel={() => setShowDiffPicker(false)}
        />
      )}
    </>
  )
}

function ContractResultView({ result }: { result: ContractValidationResult }) {
  const bodyErrors = result.errors.filter((e) => e.category === 'body')
  const statusErrors = result.errors.filter((e) => e.category === 'status')
  const ctErrors = result.errors.filter((e) => e.category === 'contentType')
  const headerErrors = result.errors.filter((e) => e.category === 'header')

  return (
    <div className="flex flex-col gap-3">
      {/* Summary */}
      <div className="flex items-center gap-3 p-3 rounded-md bg-surface-2 border border-border-1">
        {result.valid ? (
          <>
            <ShieldCheck size={20} className="text-success" />
            <div>
              <p className="text-xs font-medium text-success">Contract valid</p>
              <p className="text-[10px] text-text-4">Response satisfies all OpenAPI constraints</p>
            </div>
          </>
        ) : (
          <>
            <ShieldAlert size={20} className="text-error" />
            <div>
              <p className="text-xs font-medium text-error">Contract violations found</p>
              <p className="text-[10px] text-text-4">
                {result.errors.length} error{result.errors.length !== 1 ? 's' : ''}
                {result.warnings.length > 0 && `, ${result.warnings.length} warning${result.warnings.length !== 1 ? 's' : ''}`}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Export buttons */}
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-text-4 uppercase tracking-wider">Export</span>
        <button
          onClick={() => downloadBlob(exportContractReportMarkdown(result), 'contract-report.md', 'text/markdown')}
          className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-surface-2 border border-border-1 text-text-3 hover:text-text-1 hover:border-border-2 transition-colors"
          title="Download Markdown report"
        >
          <FileText size={10} /> MD
        </button>
        <button
          onClick={() => downloadBlob(exportContractReportHtml(result), 'contract-report.html', 'text/html')}
          className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-surface-2 border border-border-1 text-text-3 hover:text-text-1 hover:border-border-2 transition-colors"
          title="Download HTML report"
        >
          <FileCode size={10} /> HTML
        </button>
        <button
          onClick={() => downloadBlob(exportContractReportJson(result), 'contract-report.json', 'application/json')}
          className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-surface-2 border border-border-1 text-text-3 hover:text-text-1 hover:border-border-2 transition-colors"
          title="Download JSON report"
        >
          <FileJson size={10} /> JSON
        </button>
      </div>
      {statusErrors.length > 0 && (
        <ErrorCategory label="Status Code" icon={AlertTriangle} errors={statusErrors} />
      )}

      {/* Content-Type Errors */}
      {ctErrors.length > 0 && (
        <ErrorCategory label="Content-Type" icon={AlertTriangle} errors={ctErrors} />
      )}

      {/* Header Errors */}
      {headerErrors.length > 0 && (
        <ErrorCategory label="Headers" icon={AlertTriangle} errors={headerErrors} />
      )}

      {/* Body Errors */}
      {bodyErrors.length > 0 && (
        <ErrorCategory label="Response Body" icon={AlertTriangle} errors={bodyErrors} />
      )}

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={13} className="text-warning" />
            <span className="text-[10px] font-medium text-warning uppercase tracking-wider">Warnings</span>
          </div>
          {result.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-2 rounded bg-warning/5 border border-warning/10">
              <span className="mt-0.5 w-1 h-1 rounded-full bg-warning flex-shrink-0" />
              <span className="text-[11px] text-text-2">{w.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Empty body */}
      {bodyErrors.length === 0 && statusErrors.length === 0 && ctErrors.length === 0 && headerErrors.length === 0 && result.warnings.length === 0 && result.valid && (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <ShieldCheck size={32} className="text-success" />
          <p className="text-xs text-text-3">All contract checks passed</p>
        </div>
      )}
    </div>
  )
}

function ErrorCategory({ label, icon: Icon, errors }: { label: string; icon: React.ElementType; errors: Array<{ message: string; detail?: string }> }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Icon size={13} className="text-error" />
        <span className="text-[10px] font-medium text-error uppercase tracking-wider">{label}</span>
        <span className="text-[9px] text-text-4">({errors.length})</span>
      </div>
      {errors.map((e, i) => (
        <div key={i} className="flex flex-col gap-0.5 px-3 py-2 rounded bg-error/5 border border-error/10">
          <span className="text-[11px] text-error font-mono">{e.message}</span>
          {e.detail && (
            <span className="text-[10px] text-text-4">{e.detail}</span>
          )}
        </div>
      ))}
    </div>
  )
}

function NoContractView() {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3">
      <ShieldOff size={32} className="text-text-4" />
      <div className="text-center">
        <p className="text-xs text-text-3">No OpenAPI contract linked</p>
        <p className="text-[10px] text-text-4 mt-1 max-w-[280px]">
          This request was not imported from an OpenAPI spec. To enable contract testing, import a collection from an OpenAPI/Swagger file.
        </p>
      </div>
    </div>
  )
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function AssertionsView({ results, scriptRuns }: { results: AssertionResult[]; scriptRuns: ScriptRunResult[] }) {
  const scriptTests = scriptRuns.flatMap((run) => run.tests.map((test) => ({ ...test, phase: run.phase })))
  const scriptErrors = scriptRuns.filter((run) => run.error)
  const total = results.length + scriptTests.length + scriptErrors.length
  const passed = results.filter((r) => r.passed).length + scriptTests.filter((r) => r.passed).length

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 p-2 rounded-md bg-surface-2 border border-border-1">
        <span className={cn('text-xs font-medium', passed === total ? 'text-success' : 'text-error')}>
          {passed}/{total} passed
        </span>
        {passed === total ? (
          <Check size={14} className="text-success" />
        ) : (
          <X className="text-error" size={14} />
        )}
      </div>
      {scriptRuns.length > 0 && (
        <div className="flex flex-col gap-1">
          {scriptRuns.map((run, idx) => (
            <div key={`${run.phase}-${idx}`} className="flex items-center gap-2 px-3 py-1.5 rounded bg-surface-2 border border-border-1 text-[10px]">
              <span className={cn('font-medium uppercase', run.passed ? 'text-success' : 'text-error')}>{run.phase}</span>
              <span className="text-text-4">{run.durationMs} ms</span>
              {run.logs.length > 0 && <span className="text-text-4 truncate">logs: {run.logs.join(' | ')}</span>}
              {run.error && <span className="text-error truncate">{run.error}</span>}
            </div>
          ))}
        </div>
      )}
      {results.map((r) => (
        <div
          key={r.assertionId}
          className={cn(
            'flex items-start gap-2 px-3 py-2 rounded border text-[11px] font-mono',
            r.passed
              ? 'bg-success/5 border-success/10 text-success'
              : 'bg-error/5 border-error/10 text-error'
          )}
        >
          {r.passed ? <Check size={12} className="mt-0.5 flex-shrink-0" /> : <X size={12} className="mt-0.5 flex-shrink-0" />}
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-text-2">{r.label}</span>
            <span className="text-[10px] text-text-4">
              actual: {r.actual} {r.passed ? '' : `| expected: ${r.expected}`}
            </span>
          </div>
        </div>
      ))}
      {scriptTests.map((r, i) => (
        <div
          key={`${r.phase}-${r.name}-${i}`}
          className={cn(
            'flex items-start gap-2 px-3 py-2 rounded border text-[11px] font-mono',
            r.passed
              ? 'bg-success/5 border-success/10 text-success'
              : 'bg-error/5 border-error/10 text-error'
          )}
        >
          {r.passed ? <Check size={12} className="mt-0.5 flex-shrink-0" /> : <X size={12} className="mt-0.5 flex-shrink-0" />}
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-text-2">{r.name}</span>
            <span className="text-[10px] text-text-4">
              script: {r.phase}{r.error ? ` | ${r.error}` : ''}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
