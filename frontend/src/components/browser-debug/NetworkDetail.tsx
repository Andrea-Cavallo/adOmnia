import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { getRequestBody, getResponseBody } from '@/lib/browser-debug-api'
import type { DebugNetworkEntry } from '@/stores/browser-debug'
import { Send, Server, Workflow } from 'lucide-react'

type DetailTab = 'headers' | 'request' | 'response' | 'actions'

interface NetworkDetailProps {
  entry: DebugNetworkEntry
  onSendToComposer?: (data: {
    method: string
    url: string
    headers: Record<string, string>
    body: string
  }) => void
  onAddAsMock?: (data: {
    url: string
    status: number
    headers: Record<string, string>
    body: string
  }) => void
  onAddToFlow?: (data: { method: string; url: string }) => void
}

const tabs: { id: DetailTab; label: string }[] = [
  { id: 'headers', label: 'Headers' },
  { id: 'request', label: 'Request' },
  { id: 'response', label: 'Response' },
  { id: 'actions', label: 'Actions' },
]

function HeadersSection({ title, headers }: { title: string; headers: Record<string, string> }) {
  const entries = Object.entries(headers)

  return (
    <div className="mb-4">
      <h4 className="text-xs font-semibold text-text-1 mb-2 uppercase tracking-wider">
        {title}
      </h4>
      {entries.length === 0 ? (
        <p className="text-xs text-text-3 italic">No headers</p>
      ) : (
        <div className="space-y-1">
          {entries.map(([key, value]) => (
            <div key={key} className="flex gap-2 text-xs font-mono">
              <span className="text-accent flex-shrink-0">{key}:</span>
              <span className="text-text-2 break-all">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BodyViewer({ body, loading }: { body: string; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-text-3 text-sm">
        Loading...
      </div>
    )
  }

  if (!body) {
    return (
      <div className="flex items-center justify-center h-32 text-text-3 text-sm">
        No body content
      </div>
    )
  }

  return (
    <pre className="text-xs font-mono text-text-2 whitespace-pre-wrap break-all p-2 bg-surface-0 rounded border border-border-1 max-h-[60vh] overflow-auto">
      {body}
    </pre>
  )
}

export function NetworkDetail({
  entry,
  onSendToComposer,
  onAddAsMock,
  onAddToFlow,
}: NetworkDetailProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('headers')
  const [requestBody, setRequestBody] = useState('')
  const [responseBody, setResponseBody] = useState('')
  const [loadingRequest, setLoadingRequest] = useState(false)
  const [loadingResponse, setLoadingResponse] = useState(false)

  useEffect(() => {
    setRequestBody('')
    setResponseBody('')
    setActiveTab('headers')
  }, [entry.id])

  useEffect(() => {
    if (activeTab === 'request' && !requestBody) {
      setLoadingRequest(true)
      getRequestBody(entry.id).then((body) => {
        setRequestBody(body)
        setLoadingRequest(false)
      })
    }
  }, [activeTab, entry.id, requestBody])

  useEffect(() => {
    if (activeTab === 'response' && !responseBody) {
      setLoadingResponse(true)
      getResponseBody(entry.id).then((body) => {
        setResponseBody(body)
        setLoadingResponse(false)
      })
    }
  }, [activeTab, entry.id, responseBody])

  const handleSendToComposer = async () => {
    const body = requestBody || (await getRequestBody(entry.id))
    onSendToComposer?.({
      method: entry.method,
      url: entry.url,
      headers: entry.requestHeaders,
      body,
    })
  }

  const handleAddAsMock = async () => {
    const body = responseBody || (await getResponseBody(entry.id))
    onAddAsMock?.({
      url: entry.url,
      status: entry.status,
      headers: entry.responseHeaders,
      body,
    })
  }

  const handleAddToFlow = () => {
    onAddToFlow?.({ method: entry.method, url: entry.url })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center h-8 border-b border-border-1 bg-surface-1 flex-shrink-0 px-2 gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-3 h-6 rounded text-xs font-medium transition-colors',
              activeTab === tab.id
                ? 'bg-surface-2 text-text-1'
                : 'text-text-3 hover:text-text-2'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'headers' && (
          <div>
            {/* General info */}
            <div className="mb-4 p-2 bg-surface-0 rounded border border-border-1">
              <div className="grid grid-cols-2 gap-1 text-xs">
                <span className="text-text-3">URL:</span>
                <span className="text-text-1 font-mono break-all">{entry.url}</span>
                <span className="text-text-3">Method:</span>
                <span className="text-text-1 font-mono">{entry.method}</span>
                <span className="text-text-3">Status:</span>
                <span className="text-text-1 font-mono">
                  {entry.status} {entry.statusText}
                </span>
                <span className="text-text-3">MIME Type:</span>
                <span className="text-text-1 font-mono">{entry.mimeType}</span>
              </div>
            </div>

            <HeadersSection title="Request Headers" headers={entry.requestHeaders} />
            <HeadersSection title="Response Headers" headers={entry.responseHeaders} />
          </div>
        )}

        {activeTab === 'request' && (
          <BodyViewer body={requestBody} loading={loadingRequest} />
        )}

        {activeTab === 'response' && (
          <BodyViewer body={responseBody} loading={loadingResponse} />
        )}

        {activeTab === 'actions' && (
          <div className="space-y-3">
            <p className="text-xs text-text-3 mb-4">
              Use captured request data in other parts of the application.
            </p>

            <button
              onClick={handleSendToComposer}
              className="flex items-center gap-2 w-full px-3 py-2 rounded bg-surface-0 border border-border-1 text-sm text-text-1 hover:bg-surface-2 transition-colors"
            >
              <Send size={14} className="text-accent" />
              <div className="text-left">
                <div className="font-medium">Send to Composer</div>
                <div className="text-xs text-text-3">
                  Open this request in the HTTP composer with method, URL, headers, and body
                </div>
              </div>
            </button>

            <button
              onClick={handleAddAsMock}
              className="flex items-center gap-2 w-full px-3 py-2 rounded bg-surface-0 border border-border-1 text-sm text-text-1 hover:bg-surface-2 transition-colors"
            >
              <Server size={14} className="text-accent" />
              <div className="text-left">
                <div className="font-medium">Add as Mock</div>
                <div className="text-xs text-text-3">
                  Create a mock endpoint from this response with URL, status, headers, and body
                </div>
              </div>
            </button>

            <button
              onClick={handleAddToFlow}
              className="flex items-center gap-2 w-full px-3 py-2 rounded bg-surface-0 border border-border-1 text-sm text-text-1 hover:bg-surface-2 transition-colors"
            >
              <Workflow size={14} className="text-accent" />
              <div className="text-left">
                <div className="font-medium">Add to Flow</div>
                <div className="text-xs text-text-3">
                  Add this request as a step in the flow builder
                </div>
              </div>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
