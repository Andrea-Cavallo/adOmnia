import { useMemo, useState } from 'react'
import type { ElementType } from 'react'
import { Check, Clock, Code2, Copy, CornerDownRight, FileInput, Gauge, Link, ListFilter, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { applyParsedCurl, parseCurl } from '@/lib/parseCurl'
import type { RequestItem } from '@/lib/types'

type ToolId = 'url' | 'query' | 'curl' | 'status'

interface ApiToolsBarProps {
  activeRequest: RequestItem | null
  onChangeRequest?: (request: RequestItem) => void
  onApplyRequest: (request: RequestItem) => void
  onLoadTest?: () => void
  open?: boolean
}

const HTTP_STATUS: { code: number; label: string; detail: string }[] = [
  { code: 100, label: 'Continue', detail: 'Server received headers and the client can continue.' },
  { code: 101, label: 'Switching Protocols', detail: 'Server is switching protocols as requested.' },
  { code: 200, label: 'OK', detail: 'Request completed successfully.' },
  { code: 201, label: 'Created', detail: 'Resource was created.' },
  { code: 202, label: 'Accepted', detail: 'Request accepted for async processing.' },
  { code: 204, label: 'No Content', detail: 'Success with no response body.' },
  { code: 301, label: 'Moved Permanently', detail: 'Resource moved permanently.' },
  { code: 302, label: 'Found', detail: 'Temporary redirect.' },
  { code: 304, label: 'Not Modified', detail: 'Cached copy is still valid.' },
  { code: 307, label: 'Temporary Redirect', detail: 'Temporary redirect preserving method.' },
  { code: 308, label: 'Permanent Redirect', detail: 'Permanent redirect preserving method.' },
  { code: 400, label: 'Bad Request', detail: 'Malformed request or invalid parameters.' },
  { code: 401, label: 'Unauthorized', detail: 'Authentication required or invalid.' },
  { code: 403, label: 'Forbidden', detail: 'Authenticated client has no permission.' },
  { code: 404, label: 'Not Found', detail: 'Requested resource was not found.' },
  { code: 405, label: 'Method Not Allowed', detail: 'Method is not allowed for this resource.' },
  { code: 409, label: 'Conflict', detail: 'Request conflicts with current resource state.' },
  { code: 410, label: 'Gone', detail: 'Resource was intentionally removed.' },
  { code: 415, label: 'Unsupported Media Type', detail: 'Request media type is not supported.' },
  { code: 422, label: 'Unprocessable Entity', detail: 'Body is valid syntax but semantically invalid.' },
  { code: 429, label: 'Too Many Requests', detail: 'Client hit a rate limit or quota.' },
  { code: 500, label: 'Internal Server Error', detail: 'Unexpected server-side failure.' },
  { code: 502, label: 'Bad Gateway', detail: 'Gateway received an invalid upstream response.' },
  { code: 503, label: 'Service Unavailable', detail: 'Service unavailable or overloaded.' },
  { code: 504, label: 'Gateway Timeout', detail: 'Gateway did not receive upstream response in time.' },
]

const TOOLS: { id: ToolId; label: string; icon: ElementType }[] = [
  { id: 'url', label: 'URL Encode', icon: Link },
  { id: 'query', label: 'Query String', icon: ListFilter },
  { id: 'curl', label: 'Import cURL', icon: FileInput },
  { id: 'status', label: 'HTTP Status', icon: Code2 },
]

function parseQuery(input: string) {
  const raw = input.trim()
  const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw.replace(/^\?/, '')
  const params = new URLSearchParams(query)
  const result: Record<string, string | string[]> = {}
  params.forEach((value, key) => {
    const existing = result[key]
    if (Array.isArray(existing)) result[key] = [...existing, value]
    else if (typeof existing === 'string') result[key] = [existing, value]
    else result[key] = value
  })
  return result
}

function statusClass(code: number) {
  if (code >= 500) return 'text-error'
  if (code >= 400) return 'text-warning'
  if (code >= 300) return 'text-info'
  if (code >= 200) return 'text-success'
  return 'text-text-4'
}

export function ApiToolsBar({ activeRequest, onChangeRequest, onApplyRequest, onLoadTest, open = true }: ApiToolsBarProps) {
  const [activeTool, setActiveTool] = useState<ToolId | null>(null)
  const [urlInput, setUrlInput] = useState(activeRequest?.url || 'https://api.local/v1/orders?status=open')
  const [urlOutput, setUrlOutput] = useState('')
  const [queryInput, setQueryInput] = useState(activeRequest?.url || 'https://api.local/v1/orders?status=open&limit=20')
  const [queryOutput, setQueryOutput] = useState('')
  const [curlInput, setCurlInput] = useState('curl -X GET https://api.local/v1/orders -H "Accept: application/json"')
  const [curlMessage, setCurlMessage] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [copied, setCopied] = useState('')

  const filteredStatus = useMemo(() => {
    const filter = statusFilter.toLowerCase().trim()
    if (!filter) return HTTP_STATUS
    return HTTP_STATUS.filter((s) =>
      String(s.code).includes(filter) ||
      s.label.toLowerCase().includes(filter) ||
      s.detail.toLowerCase().includes(filter)
    )
  }, [statusFilter])

  const copy = async (value: string, id: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(id)
      window.setTimeout(() => setCopied(''), 1200)
    } catch {
      setCopied('')
    }
  }

  const openTool = (id: ToolId) => {
    setActiveTool(id)
    if (activeRequest?.url) {
      setUrlInput(activeRequest.url)
      setQueryInput(activeRequest.url)
    }
    setCurlMessage('')
  }

  const importCurl = () => {
    if (!activeRequest) {
      setCurlMessage('Open a request tab before importing cURL.')
      return
    }
    const parsed = parseCurl(curlInput)
    if (!parsed) {
      setCurlMessage('That does not look like a valid cURL command.')
      return
    }
    onApplyRequest(applyParsedCurl(parsed, activeRequest))
    setCurlMessage('cURL imported into the active request.')
  }

  return (
    <>
      {open && (
      <div className="flex h-[var(--ui-toolbar-h)] items-center gap-1 overflow-x-auto border-b border-border-1 bg-surface-0/80 px-2.5 no-scrollbar">
        <span className="mr-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-text-4">API Tools</span>
        {activeRequest && onChangeRequest && (
          <>
            <button
              onClick={() => onChangeRequest({ ...activeRequest, followRedirects: !(activeRequest.followRedirects ?? true) })}
              title={activeRequest.followRedirects ?? true ? 'Follow redirects: on' : 'Follow redirects: off'}
              className={cn(
                'inline-flex h-6 shrink-0 items-center gap-1 rounded border px-2 text-[10px] transition-colors',
                (activeRequest.followRedirects ?? true)
                  ? 'border-border-1 bg-surface-1 text-text-3 hover:border-accent/40 hover:text-text-1'
                  : 'border-error/30 bg-error/10 text-error',
              )}
            >
              <CornerDownRight size={11} />
              Follow redirects
            </button>
            {onLoadTest && (
              <button
                onClick={onLoadTest}
                className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-border-1 bg-surface-1 px-2 text-[10px] text-text-3 transition-colors hover:border-accent/40 hover:text-text-1"
                title="Open load test for the active request"
              >
                <Gauge size={11} />
                Load test
              </button>
            )}
            <label className="ml-1 flex h-6 shrink-0 items-center gap-1 rounded border border-border-1 bg-surface-1 px-2 text-[10px] text-text-4">
              <Clock size={11} />
              <span>Timeout</span>
              <input
                type="number"
                min="0"
                max="300000"
                step="1000"
                value={activeRequest.timeout ?? 0}
                onChange={(e) => onChangeRequest({ ...activeRequest, timeout: Number(e.target.value) || 0 })}
                className="w-11 bg-transparent text-right font-mono text-[10px] text-text-1 outline-none"
                title="Request timeout in milliseconds. 0 = no timeout."
              />
              <span className="font-mono text-[9px] text-text-4">ms</span>
            </label>
          </>
        )}
        <span className="mx-1 h-4 w-px bg-border-1" />
        {TOOLS.map((tool) => {
          const Icon = tool.icon
          return (
            <button
              key={tool.id}
              onClick={() => openTool(tool.id)}
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-border-1 bg-surface-1 px-2 text-[10px] text-text-3 transition-colors hover:border-accent/40 hover:text-text-1"
            >
              <Icon size={11} />
              {tool.label}
            </button>
          )
        })}
      </div>
      )}

      {activeTool && (
        <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/45 backdrop-blur-sm">
          <div className="flex max-h-[78vh] w-[620px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-lg border border-border-1 bg-surface-0 shadow-2xl">
            <div className="flex h-10 items-center gap-2 border-b border-border-1 bg-surface-1 px-3">
              <span className="text-xs font-semibold text-text-1">{TOOLS.find((tool) => tool.id === activeTool)?.label}</span>
              <div className="flex-1" />
              <button onClick={() => setActiveTool(null)} title="Close" className="grid h-6 w-6 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1">
                <X size={13} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              {activeTool === 'url' && (
                <div className="flex flex-col gap-3">
                  <textarea value={urlInput} onChange={(e) => setUrlInput(e.target.value)} rows={4} className="rounded border border-border-2 bg-surface-2 px-3 py-2 font-mono text-xs text-text-1 outline-none focus:border-accent" />
                  <div className="flex gap-2">
                    <button onClick={() => setUrlOutput(encodeURIComponent(urlInput))} className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white">Encode</button>
                    <button onClick={() => { try { setUrlOutput(decodeURIComponent(urlInput)) } catch { setUrlOutput('Decode error') } }} className="rounded border border-border-2 bg-surface-2 px-3 py-1.5 text-xs text-text-2">Decode</button>
                  </div>
                  {urlOutput && <pre className="rounded border border-border-1 bg-surface-1 p-3 font-mono text-xs text-text-1 whitespace-pre-wrap break-all">{urlOutput}</pre>}
                </div>
              )}

              {activeTool === 'query' && (
                <div className="flex flex-col gap-3">
                  <textarea value={queryInput} onChange={(e) => setQueryInput(e.target.value)} rows={4} className="rounded border border-border-2 bg-surface-2 px-3 py-2 font-mono text-xs text-text-1 outline-none focus:border-accent" />
                  <button onClick={() => setQueryOutput(JSON.stringify(parseQuery(queryInput), null, 2))} className="self-start rounded bg-accent px-3 py-1.5 text-xs font-medium text-white">Parse</button>
                  {queryOutput && <pre className="rounded border border-border-1 bg-surface-1 p-3 font-mono text-xs text-text-1 whitespace-pre-wrap">{queryOutput}</pre>}
                </div>
              )}

              {activeTool === 'curl' && (
                <div className="flex flex-col gap-3">
                  <textarea value={curlInput} onChange={(e) => setCurlInput(e.target.value)} rows={7} className="rounded border border-border-2 bg-surface-2 px-3 py-2 font-mono text-xs text-text-1 outline-none focus:border-accent" />
                  <button onClick={importCurl} className="self-start rounded bg-accent px-3 py-1.5 text-xs font-medium text-white">Import into Request</button>
                  {curlMessage && (
                    <div className={cn('rounded border px-3 py-2 text-xs', curlMessage.includes('imported') ? 'border-success/30 bg-success/10 text-success' : 'border-warning/30 bg-warning/10 text-warning')}>
                      {curlMessage}
                    </div>
                  )}
                </div>
              )}

              {activeTool === 'status' && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 rounded border border-border-2 bg-surface-2 px-2">
                    <Search size={13} className="text-text-4" />
                    <input value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} placeholder="Filter by code or keyword..." className="h-8 flex-1 bg-transparent text-xs text-text-1 outline-none" />
                  </div>
                  <div className="overflow-hidden rounded border border-border-1">
                    {filteredStatus.map((s) => (
                      <button key={s.code} onClick={() => copy(String(s.code), String(s.code))} className="grid w-full grid-cols-[70px_160px_1fr_28px] items-center gap-2 border-b border-border-1/50 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-surface-1">
                        <span className={cn('font-mono font-semibold', statusClass(s.code))}>{s.code}</span>
                        <span className="font-semibold text-text-1">{s.label}</span>
                        <span className="text-text-3">{s.detail}</span>
                        {copied === String(s.code) ? <Check size={12} className="text-success" /> : <Copy size={12} className="text-text-4" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
