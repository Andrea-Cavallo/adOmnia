import { useState, useEffect, useRef } from 'react'
import { Send, RefreshCw, ChevronRight, Zap, Wifi, Save, Upload } from 'lucide-react'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { cn } from '@/lib/utils'

const PRESETS_KEY = 'adomnia.grpc.presets'

interface GrpcPreset {
  id: string
  name: string
  address: string
  useTls: boolean
}

function loadPresets(): GrpcPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY)
    if (raw) return JSON.parse(raw) as GrpcPreset[]
  } catch {}
  return []
}

function savePresets(presets: GrpcPreset[]) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets))
}

async function parseProtoFromBackend(port: number | null, source: string): Promise<ServiceInfo[]> {
  if (!port) throw new Error('Backend not ready')
  const url = serverUrl(port, '/grpc/parse-proto')
  const res = await sidecarFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  })
  const data = await res.json()
  if (!res.ok) {
    const msg = typeof data === 'object' && data !== null && 'error' in data
      ? String((data as Record<string, unknown>).error)
      : `Parse failed (${res.status})`
    throw new Error(msg)
  }
  return (data as { services: ServiceInfo[] }).services ?? []
}

interface ServiceInfo {
  name: string
  methods: Array<{
    name: string
    input_type: string
    output_type: string
    client_streaming: boolean
    server_streaming: boolean
  }>
}

interface MetadataRow {
  id: string
  key: string
  value: string
}

let metaId = 0
const newMetaRow = (): MetadataRow => ({ id: String(++metaId), key: '', value: '' })

export function GrpcPanel() {
  const port = useServerPort()
  const [address, setAddress] = useState('localhost:50051')
  const [useTls, setUseTls] = useState(false)
  const [services, setServices] = useState<ServiceInfo[]>([])
  const [selectedService, setSelectedService] = useState('')
  const [selectedMethod, setSelectedMethod] = useState('')
  const [payload, setPayload] = useState('{}')
  const [metadata, setMetadata] = useState<MetadataRow[]>([])
  const [invokeResult, setInvokeResult] = useState<object | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [presets, setPresets] = useState<GrpcPreset[]>(loadPresets)
  const [protoName, setProtoName] = useState('')
  const [serviceSource, setServiceSource] = useState<'reflection' | 'proto' | ''>('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { savePresets(presets) }, [presets])

  const post = async (path: string, body: unknown) => {
    const url = serverUrl(port, path)
    if (!url) { setError('Backend not ready'); return null }
    const res = await sidecarFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  const handleReflect = async () => {
    setLoading(true)
    setError('')
    setServices([])
    const data = await post('/grpc/reflect', { address, tls: useTls })
    if (data) {
      if (data.services) {
        setServices(data.services)
        setServiceSource('reflection')
        setProtoName('')
        if (data.services.length === 1) setSelectedService(data.services[0].name)
      } else {
        setError(data.error || 'Reflection failed')
      }
    }
    setLoading(false)
  }

  const handleProtoFile = async (file: File | undefined) => {
    if (!file) return
    setLoading(true)
    setError('')
    try {
      const parsed = await parseProtoFromBackend(port, await file.text())
      if (parsed.length === 0) {
        setError('No service/rpc definitions found in .proto file')
        return
      }
      setServices(parsed)
      setServiceSource('proto')
      setProtoName(file.name)
      setSelectedService(parsed[0].name)
      setSelectedMethod(parsed[0].methods[0]?.name ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleInvoke = async () => {
    if (!selectedService || !selectedMethod) { setError('Select a service and method'); return }
    setLoading(true)
    setError('')
    setInvokeResult(null)
    let payloadObj = {}
    try { payloadObj = JSON.parse(payload) } catch { setError('Invalid JSON payload'); setLoading(false); return }

    const metaObj: Record<string, string> = {}
    for (const m of metadata) { if (m.key) metaObj[m.key] = m.value }

    const data = await post('/grpc/invoke', {
      address,
      tls: useTls,
      service: selectedService,
      method: selectedMethod,
      payload: payloadObj,
      metadata: metaObj,
    })
    if (data) {
      if (data.error) setError(data.error)
      else setInvokeResult(data)
    }
    setLoading(false)
  }

  const currentService = services.find((s) => s.name === selectedService)
  const currentMethod = currentService?.methods.find((m) => m.name === selectedMethod)
  const unsupportedClientStreaming = Boolean(currentMethod?.client_streaming)

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-1">
        <Zap size={16} className="text-accent" />
        <h2 className="text-sm font-semibold text-text-1">gRPC Client</h2>
      </div>

      <div className="flex-1 flex flex-col p-4 gap-4 overflow-auto">
        {/* Connection bar */}
        <div className="bg-surface-1 border border-border-1 rounded-md p-3 flex flex-col gap-2">
          {presets.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-text-4">Presets:</span>
              <div className="flex flex-wrap gap-1">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setAddress(p.address); setUseTls(p.useTls) }}
                    className="px-2 py-0.5 text-[10px] rounded bg-surface-2 border border-border-2 text-text-3 hover:text-accent hover:border-accent/40"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <div className="flex-1 flex items-center gap-2">
              <Wifi size={12} className={cn('shrink-0', address ? 'text-success' : 'text-text-4')} />
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleReflect() }}
                placeholder="localhost:50051"
                className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent placeholder:text-text-4"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-text-3 cursor-pointer">
              <input
                type="checkbox"
                checked={useTls}
                onChange={(e) => setUseTls(e.target.checked)}
                className="accent-accent w-3.5 h-3.5"
              />
              TLS
            </label>
            <button
              onClick={handleReflect}
              disabled={loading || !address}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded text-xs font-medium disabled:opacity-40 hover:bg-accent-hover transition-colors"
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
              Reflect
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".proto"
              className="hidden"
              onChange={(e) => handleProtoFile(e.target.files?.[0])}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border-2 rounded text-xs text-text-3 hover:text-text-1 hover:border-accent/40 disabled:opacity-40"
              title="Load a .proto file to populate services and methods"
            >
              <Upload size={11} />
              Proto
            </button>
            <button
              onClick={() => {
                const name = address
                const id = crypto.randomUUID()
                setPresets((prev) => [...prev.filter((p) => p.address !== address), { id, name, address, useTls }])
              }}
              title="Save as preset"
              className="flex items-center gap-1 px-2 py-1.5 border border-border-2 rounded text-xs text-text-4 hover:text-text-1 hover:border-border-2"
            >
              <Save size={11} />
            </button>
          </div>
        </div>

        {error && (
          <div className="px-3 py-2.5 bg-error/10 border border-error/30 rounded-md text-xs text-error font-mono">{error}</div>
        )}

        {serviceSource === 'proto' && (
          <div className="px-3 py-2 bg-warning/10 border border-warning/30 rounded-md text-[10px] text-warning">
            Loaded {protoName}. Service selection comes from the proto file; invocation still targets the live address and uses reflection descriptors when calling.
          </div>
        )}

        {services.length > 0 && (
          <div className="flex gap-3 flex-1 min-h-0">
            {/* Service/Method tree */}
            <div className="w-56 shrink-0 bg-surface-1 border border-border-1 rounded-md overflow-y-auto">
              <div className="px-3 py-2 text-[10px] text-text-4 uppercase tracking-wider border-b border-border-1">
                Services
              </div>
              {services.map((s) => (
                <div key={s.name}>
                  <button
                    onClick={() => { setSelectedService(s.name); setSelectedMethod('') }}
                    className={cn(
                      'w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-left border-b border-border-1/30 transition-colors',
                      selectedService === s.name
                        ? 'bg-accent/10 text-text-1'
                        : 'text-text-3 hover:bg-surface-2 hover:text-text-2',
                    )}
                  >
                    <ChevronRight size={10} className={cn(
                      'transition-transform shrink-0',
                      selectedService === s.name && 'rotate-90',
                    )} />
                    <span className="font-mono text-[11px] truncate">{s.name.split('.').pop() || s.name}</span>
                    <span className="text-[9px] text-text-4 ml-auto">{s.methods.length}</span>
                  </button>
                  {selectedService === s.name && s.methods.map((m) => (
                    <button
                      key={m.name}
                      onClick={() => setSelectedMethod(m.name)}
                      className={cn(
                        'w-full flex items-center gap-2 px-4 py-1.5 text-[10px] text-left border-b border-border-1/20 transition-colors',
                        selectedMethod === m.name
                          ? 'text-accent bg-accent/5 font-medium'
                          : 'text-text-4 hover:text-text-2 hover:bg-surface-2',
                      )}
                    >
                      <span className="truncate">{m.name}</span>
                      {(m.client_streaming || m.server_streaming) && (
                        <Send size={9} className="shrink-0 text-text-4" />
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>

            {/* Invoke area */}
            <div className="flex-1 flex flex-col gap-3 min-w-0">
              {currentMethod && (
                <div className="flex items-center gap-2 text-[10px] text-text-4 font-mono bg-surface-1 border border-border-1 rounded-md px-3 py-2">
                  <span className="text-text-2">{selectedService}</span>
                  <ChevronRight size={8} />
                  <span className="text-accent">{selectedMethod}</span>
                  <span className="text-text-4">(</span>
                  <span>{currentMethod.input_type}</span>
                  <span className="text-text-4">) →</span>
                  <span>{currentMethod.output_type}</span>
                  {(currentMethod.client_streaming || currentMethod.server_streaming) && (
                    <span className="ml-auto text-accent">streaming</span>
                  )}
                </div>
              )}

              {/* Metadata */}
              <details className="flex flex-col gap-1" open={metadata.length > 0}>
                <summary className="text-[10px] text-text-4 cursor-pointer hover:text-text-2 select-none">
                  Metadata ({metadata.filter((m) => m.key).length} headers)
                </summary>
                <div className="flex flex-col gap-1 mt-1">
                  {metadata.map((m, i) => (
                    <div key={m.id} className="grid grid-cols-[1fr_1fr_20px] gap-1 items-center group">
                      <input
                        value={m.key}
                        onChange={(e) => {
                          const next = [...metadata]
                          next[i] = { ...next[i], key: e.target.value }
                          setMetadata(next)
                        }}
                        placeholder="authorization"
                        className="h-6 px-2 bg-surface-2 border border-border-2 rounded text-[10px] text-text-1 font-mono outline-none focus:border-accent"
                      />
                      <input
                        value={m.value}
                        onChange={(e) => {
                          const next = [...metadata]
                          next[i] = { ...next[i], value: e.target.value }
                          setMetadata(next)
                        }}
                        placeholder="Bearer ..."
                        className="h-6 px-2 bg-surface-2 border border-border-2 rounded text-[10px] text-text-1 font-mono outline-none focus:border-accent"
                      />
                      <button
                        onClick={() => setMetadata(metadata.filter((_, ii) => ii !== i))}
                        className="text-text-4 hover:text-error text-[10px] opacity-0 group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setMetadata([...metadata, newMetaRow()])}
                    className="text-[10px] text-accent hover:text-accent-light self-start"
                  >
                    + add header
                  </button>
                </div>
              </details>

              {/* Payload */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-text-4 uppercase tracking-wider">
                  Request payload (JSON)
                </label>
                <textarea
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                  rows={8}
                  className="px-3 py-2 bg-surface-2 border border-border-2 rounded-md text-xs text-text-1 font-mono outline-none focus:border-accent resize-y min-h-[120px]"
                  placeholder='{"key": "value"}'
                  spellCheck={false}
                />
              </div>

              {/* Actions row */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleInvoke}
                  disabled={loading || !selectedMethod || unsupportedClientStreaming}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-accent text-white rounded text-xs font-medium disabled:opacity-40 hover:bg-accent-hover"
                  title={unsupportedClientStreaming ? 'Client-streaming and bidirectional-streaming calls need an interactive stream sender and are not available yet' : undefined}
                >
                  <Send size={11} />
                  {loading ? 'Invoking…' : 'Invoke'}
                </button>
                {unsupportedClientStreaming && (
                  <span className="text-[10px] text-warning border border-warning/30 bg-warning/10 rounded px-2 py-0.5">Client/bidi streaming not available yet</span>
                )}
                {currentMethod?.server_streaming && !unsupportedClientStreaming && (
                  <span className="text-[10px] text-success border border-success/30 bg-success/10 rounded px-2 py-0.5">Server streaming supported</span>
                )}
                {false && currentMethod && (currentMethod?.client_streaming || currentMethod?.server_streaming) && (
                  <span className="text-[10px] text-warning border border-warning/30 bg-warning/10 rounded px-2 py-0.5">Streaming · unary mode only</span>
                )}
                <button
                  onClick={() => {
                    try { setPayload(JSON.stringify(JSON.parse(payload), null, 2)) } catch { /* skip */ }
                  }}
                  className="text-[10px] text-text-4 hover:text-text-2"
                >
                  Prettify
                </button>
              </div>

              {/* Response */}
              {invokeResult && (
                <div className="bg-surface-1 border border-border-1 rounded-md overflow-hidden">
                  <div className="px-3 py-1.5 border-b border-border-1 text-[10px] text-text-4 uppercase tracking-wider flex items-center gap-2">
                    Response
                    <button
                      onClick={() => navigator.clipboard.writeText(JSON.stringify(invokeResult, null, 2))}
                      className="text-accent hover:text-accent-light"
                    >
                      Copy
                    </button>
                  </div>
                  <pre className="p-3 text-xs text-text-2 font-mono whitespace-pre-wrap overflow-auto max-h-80">
                    {JSON.stringify(invokeResult, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        {services.length === 0 && !loading && !error && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 py-12 border border-dashed border-border-2 rounded-md">
            <Zap size={32} className="text-text-4" />
            <p className="text-xs text-text-4">Enter a gRPC server address and click Reflect, or load a .proto file</p>
            <p className="text-[10px] text-text-4">Reflection gives full descriptors; proto upload fills the service picker</p>
          </div>
        )}
      </div>
    </div>
  )
}
