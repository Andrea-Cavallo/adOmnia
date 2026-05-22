import { useState, useMemo } from 'react'
import { Copy, Loader2, Maximize2, GitBranch, GitCompare, Sparkles, X, ShieldCheck, ShieldAlert, ShieldOff, AlertTriangle, Check, XCircle, FileText, FileCode, FileJson } from 'lucide-react'
import type { ResponseData, ContractValidationResult, AssertionResult, ScriptRunResult } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Prompt } from '@/components/ui/prompt'
import { JsonGraph } from '@/components/ui/JsonGraph'
import { validateContract, exportContractReportMarkdown, exportContractReportHtml, exportContractReportJson } from '@/lib/contractValidator'
import { evaluateAssertions } from '@/lib/assertionEngine'

interface ResponsePanelProps {
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
  key: 'text-blue-400',
  string: 'text-green-400',
  number: 'text-yellow-300',
  boolean: 'text-purple-400',
  null: 'text-gray-400',
  punct: 'text-text-3',
  ws: '',
}

function JsonHighlight({ text }: { text: string }) {
  const tokens = tokenizeJSON(text)
  return (
    <>
      {tokens.map((tok, i) => (
        <span key={i} className={TOKEN_COLORS[tok.type]}>{tok.value}</span>
      ))}
    </>
  )
}

type ViewTab = 'body' | 'headers' | 'contract' | 'assertions'

function DiffModal({
  left,
  right,
  onClose,
}: {
  left: string
  right: string
  onClose: () => void
}) {
  const leftLines = left.split('\n')
  const rightLines = right.split('\n')
  const maxLen = Math.max(leftLines.length, rightLines.length)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-[900px] h-[600px] bg-surface-1 border border-border-1 rounded-lg shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-1">
          <span className="text-sm font-semibold text-text-1 flex-1">Response Diff</span>
          <button onClick={onClose} className="text-text-4 hover:text-text-1"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-auto p-2">
          <div className="grid grid-cols-2 gap-0 font-mono text-[10px]">
            <div className="flex flex-col">
              {Array.from({ length: maxLen }).map((_, i) => {
                const line = leftLines[i] ?? ''
                const diff = line !== (rightLines[i] ?? '')
                return (
                  <div key={i} className={cn('px-2 py-0.5', diff && 'bg-error/10 border-l-2 border-error')}>
                    <span className="text-text-4 w-8 inline-block text-right mr-2">{i + 1}</span>
                    <span className={diff ? 'text-error' : 'text-text-2'}>{line}</span>
                  </div>
                )
              })}
            </div>
            <div className="flex flex-col border-l border-border-1">
              {Array.from({ length: maxLen }).map((_, i) => {
                const line = rightLines[i] ?? ''
                const diff = line !== (leftLines[i] ?? '')
                return (
                  <div key={i} className={cn('px-2 py-0.5', diff && 'bg-success/10 border-l-2 border-success')}>
                    <span className="text-text-4 w-8 inline-block text-right mr-2">{i + 1}</span>
                    <span className={diff ? 'text-success' : 'text-text-2'}>{line}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

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
    try { display = JSON.stringify(JSON.parse(body), null, 2) } catch { /* keep raw */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="w-full h-full max-w-[95vw] max-h-[95vh] bg-surface-1 border border-border-1 rounded-lg shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-1">
          <span className="text-sm font-semibold text-text-1 flex-1">Response Body</span>
          <button onClick={() => navigator.clipboard.writeText(body)} className="px-2 py-1 text-xs text-accent hover:text-accent-light">Copy</button>
          <button onClick={onClose} className="text-text-4 hover:text-text-1"><X size={16} /></button>
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

export function ResponsePanel({ response, loading, oaSpec, oaPath, oaMethod, assertions }: ResponsePanelProps) {
  const [tab, setTab] = useState<ViewTab>('body')
  const [view, setView] = useState<'pretty' | 'raw' | 'graph'>('pretty')
  const [showFullscreen, setShowFullscreen] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [diffOther, setDiffOther] = useState('')
  const [showDiffPrompt, setShowDiffPrompt] = useState(false)

  const contractResult = useMemo(() => {
    if (!response) return null
    return validateContract(oaSpec, oaPath, oaMethod, response)
  }, [response, oaSpec, oaPath, oaMethod])

  const assertionResults = useMemo(() => {
    if (!response) return []
    return evaluateAssertions(assertions, response)
  }, [response, assertions])
  const scriptRuns = response?.scripts?.runs ?? []
  const scriptTests = scriptRuns.flatMap((run) => run.tests)
  const testResultCount = assertionResults.length + scriptTests.length + scriptRuns.filter((run) => run.error).length
  const testPassCount = assertionResults.filter((r) => r.passed).length + scriptTests.filter((r) => r.passed).length
  const allTestsPassed = assertionResults.every((r) => r.passed) && scriptRuns.every((run) => run.passed)

  const isJson = response ? (response.contentType.includes('json') || response.body.trim().match(/^[\[{]/) != null) : false
  let validationBadge: string | null = null
  if (response && isJson) {
    try { JSON.parse(response.body); validationBadge = 'valid' } catch { validationBadge = 'invalid' }
  }

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
    }
    const humanCode: Record<string, string> = {
      CONN_ERR:    'Connection refused',
      TIMEOUT:     'Request timeout',
      NO_URL:      'No URL',
      INVALID_URL: 'Invalid URL',
      AUTH_ERR:    'Auth error',
      SCRIPT_ERR:  'Script error',
      ERR:         'Request error',
    }
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-1">
          <span className="text-xs font-medium text-text-2">Response</span>
          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-error/20 text-error">
            {humanCode[code] ?? code}
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <div className="text-3xl mb-3 text-error/40">⚠</div>
            <p className="text-sm font-medium text-text-1 mb-1">{humanCode[code] ?? 'Request failed'}</p>
            <p className="text-xs text-text-3 font-mono break-all mb-3">{message}</p>
            {hint[code] && (
              <p className="text-xs text-text-4 leading-relaxed">{hint[code]}</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  let prettyBody = response.body
  if (isJson && view === 'pretty') {
    try { prettyBody = JSON.stringify(JSON.parse(response.body), null, 2) } catch { /* keep raw */ }
  }

  let graphData: unknown = null
  if (isJson) {
    try { graphData = JSON.parse(response.body) } catch { /* not valid */ }
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
            onClick={() => setTab('body')}
            className={cn('px-3 py-2 text-xs relative', tab === 'body' ? 'text-text-1' : 'text-text-3 hover:text-text-2')}
          >
            Body
            {tab === 'body' && <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent rounded-t" />}
          </button>
          <button
            onClick={() => setTab('headers')}
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
              onClick={() => setTab('contract')}
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
              onClick={() => setTab('contract')}
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
              onClick={() => setTab('assertions')}
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
                  if (graphData) setView(view === 'graph' ? 'pretty' : 'graph')
                }}
                className={cn('p-1 rounded hover:bg-surface-2', view === 'graph' ? 'text-accent' : 'text-text-4 hover:text-text-2')}
                title="Graph"
              >
                <GitBranch size={12} />
              </button>
              <button
                onClick={() => setShowDiffPrompt(true)}
                className="p-1 text-text-4 hover:text-text-2 rounded hover:bg-surface-2"
                title="Diff"
              >
                <GitCompare size={12} />
              </button>
              <button
                onClick={() => {
                  if (isJson) {
                    try { const p = JSON.stringify(JSON.parse(response.body), null, 2); navigator.clipboard.writeText(p).then(() => setView('pretty')) } catch { /* ignore */ }
                  } else {
                    navigator.clipboard.writeText(response.body)
                  }
                }}
                className="p-1 text-text-4 hover:text-text-2 rounded hover:bg-surface-2"
                title="Beautify / Copy formatted"
              >
                <Sparkles size={12} />
              </button>

              {/* Pretty/Raw toggle */}
              <span className="text-text-4 text-[9px] mx-1">|</span>
              <button
                onClick={() => setView('pretty')}
                className={cn('px-2 py-0.5 text-[10px] rounded', view === 'pretty' ? 'bg-surface-3 text-text-1' : 'text-text-4')}
              >
                Pretty
              </button>
              <button
                onClick={() => setView('raw')}
                className={cn('px-2 py-0.5 text-[10px] rounded', view === 'raw' ? 'bg-surface-3 text-text-1' : 'text-text-4')}
              >
                Raw
              </button>
              <button
                onClick={() => navigator.clipboard.writeText(response.body)}
                className="ml-1 p-1 text-text-4 hover:text-text-2 rounded"
                title="Copy response body"
              >
                <Copy size={12} />
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-3">
          {tab === 'body' && (
            view === 'graph' && graphData ? (
              <JsonGraph json={response.body} className="h-full min-h-[260px]" />
            ) : (
              <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                {isJson && view === 'pretty'
                  ? <JsonHighlight text={prettyBody} />
                  : <span className="text-text-1">{prettyBody}</span>
                }
              </pre>
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
          left={response.body}
          right={diffOther}
          onClose={() => setShowDiff(false)}
        />
      )}

      <Prompt
        open={showDiffPrompt}
        title="Diff Response"
        placeholder="Paste the other response body to compare…"
        confirmLabel="Compare"
        multiline
        onConfirm={(body) => {
          setDiffOther(body)
          setShowDiffPrompt(false)
          setShowDiff(true)
        }}
        onCancel={() => setShowDiffPrompt(false)}
      />
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
