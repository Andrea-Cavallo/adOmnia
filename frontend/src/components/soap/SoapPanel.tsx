import { useState, useCallback } from 'react'
import { Upload, Globe, Send, Copy, RefreshCw, ChevronRight, BookmarkPlus, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  parseWsdl,
  generateEnvelopeWithSchema,
  addWsSecurityUsernameToken,
  sendSoapRequest,
  soapXmlToJson,
  validateSoapXml,
  exportSoapCurl,
  generateSoapClientCode,
  addSoapHistoryEntry,
  loadSoapHistory,
  type WsdlDocument,
  type SoapHistoryEntry,

} from '@/lib/soapClient'
import { useCollectionsStore } from '@/stores/collections'
import { blankRequest, uid } from '@/lib/types'

export function SoapPanel() {
  const [wsdl, setWsdl] = useState<WsdlDocument | null>(null)
  const [wsdlText, setWsdlText] = useState('')
  const [wsdlUrl, setWsdlUrl] = useState('')
  const [loadingWsdl, setLoadingWsdl] = useState(false)
  const [wsdlError, setWsdlError] = useState('')
  const [selectedService, setSelectedService] = useState('')
  const [selectedPort, setSelectedPort] = useState('')
  const [selectedOp, setSelectedOp] = useState('')
  const [soapVersion, setSoapVersion] = useState<'1.1' | '1.2'>('1.1')
  const [envelope, setEnvelope] = useState('')
  const [wsSecurity, setWsSecurity] = useState(false)
  const [wsUser, setWsUser] = useState('')
  const [wsPass, setWsPass] = useState('')
  const [sending, setSending] = useState(false)
  const [response, setResponse] = useState('')
  const [responseInfo, setResponseInfo] = useState<{ status: number; ms: number; size: number } | null>(null)
  const [responseJson, setResponseJson] = useState<unknown>(null)
  const [viewMode, setViewMode] = useState<'xml' | 'json'>('xml')
  const [xmlValid, setXmlValid] = useState<boolean | null>(null)
  const [history, setHistory] = useState<SoapHistoryEntry[]>(() => loadSoapHistory())
  const [showCodeGen, setShowCodeGen] = useState(false)
  const [customHeaders, setCustomHeaders] = useState<{ id: string; key: string; value: string }[]>([])
  const [showCustomHeaders, setShowCustomHeaders] = useState(false)

  // Current endpoint URL
  const currentPort = wsdl?.services
    .find((s) => s.name === selectedService)
    ?.ports.find((p) => p.name === selectedPort)

  const currentOp = wsdl?.portTypes.flatMap((p) => p.operations).find((o) => o.name === selectedOp)

  const loadWsdlFromText = useCallback(() => {
    if (!wsdlText.trim()) return
    try {
      const parsed = parseWsdl(wsdlText)
      setWsdl(parsed)
      setWsdlError('')
      if (parsed.services.length > 0) {
        setSelectedService(parsed.services[0].name)
        if (parsed.services[0].ports.length > 0) {
          setSelectedPort(parsed.services[0].ports[0].name)
        }
      }
      if (parsed.portTypes.length > 0 && parsed.portTypes[0].operations.length > 0) {
        setSelectedOp(parsed.portTypes[0].operations[0].name)
      }
    } catch (e) {
      setWsdlError(e instanceof Error ? e.message : 'Failed to parse WSDL')
    }
  }, [wsdlText])

  const loadWsdlFromUrl = useCallback(async () => {
    if (!wsdlUrl.trim()) return
    setLoadingWsdl(true)
    setWsdlError('')
    try {
      const res = await fetch(wsdlUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      setWsdlText(text)
      const parsed = parseWsdl(text)
      setWsdl(parsed)
      if (parsed.services.length > 0) {
        setSelectedService(parsed.services[0].name)
        if (parsed.services[0].ports.length > 0) {
          setSelectedPort(parsed.services[0].ports[0].name)
        }
      }
      if (parsed.portTypes.length > 0 && parsed.portTypes[0].operations.length > 0) {
        setSelectedOp(parsed.portTypes[0].operations[0].name)
      }
    } catch (e) {
      setWsdlError(e instanceof Error ? e.message : 'Failed to load WSDL')
    } finally {
      setLoadingWsdl(false)
    }
  }, [wsdlUrl])

  const genEnvelope = useCallback(() => {
    if (!wsdl || !selectedOp) return
    const env = generateEnvelopeWithSchema(
      selectedOp,
      wsdl.schemaElements,
      wsdl.targetNamespace,
      soapVersion,
    )
    setEnvelope(wsSecurity ? addWsSecurityUsernameToken(env, wsUser, wsPass, soapVersion) : env)
  }, [wsdl, selectedOp, soapVersion, wsSecurity, wsUser, wsPass])

  const sendRequest = useCallback(async () => {
    if (!currentPort || !currentOp || !envelope.trim()) return
    setSending(true)
    setResponse('')
    setResponseInfo(null)
    setResponseJson(null)

    const activeHeaders: Record<string, string> = {}
    for (const h of customHeaders) {
      if (h.key.trim()) activeHeaders[h.key.trim()] = h.value
    }

    const res = await sendSoapRequest({
      url: currentPort.location,
      soapAction: currentOp.soapAction,
      envelope,
      soapVersion,
      customHeaders: Object.keys(activeHeaders).length > 0 ? activeHeaders : undefined,
    })
    setResponse(res.body)
    setResponseInfo({ status: res.status, ms: res.ms, size: res.size })
    setResponseJson(soapXmlToJson(res.body))
    setXmlValid(null)
    const h = addSoapHistoryEntry({
      timestamp: Date.now(),
      operation: currentOp.name,
      url: currentPort.location,
      envelope,
      response: res.body,
      status: res.status,
      durationMs: res.ms,
    })
    setHistory(h)
    setSending(false)
  }, [currentPort, currentOp, envelope, soapVersion])

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setWsdlText(reader.result as string)
      try {
        const parsed = parseWsdl(reader.result as string)
        setWsdl(parsed)
        setWsdlError('')
        if (parsed.services.length > 0) {
          setSelectedService(parsed.services[0].name)
          if (parsed.services[0].ports.length > 0) setSelectedPort(parsed.services[0].ports[0].name)
        }
        if (parsed.portTypes.length > 0 && parsed.portTypes[0].operations.length > 0) {
          setSelectedOp(parsed.portTypes[0].operations[0].name)
        }
      } catch (e) {
        setWsdlError(e instanceof Error ? e.message : 'Parse error')
      }
    }
    reader.readAsText(file)
  }, [])

  if (!wsdl) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
        <img src="/icon95.png" alt="" className="h-10 w-10 object-contain" />
        <div className="text-center max-w-md">
          <p className="text-xs text-text-3">SOAP / WSDL Studio</p>
          <p className="text-[10px] text-text-4 mt-1">Import a WSDL file or URL to get started.</p>
        </div>

        {wsdlError && (
          <div className="px-3 py-2 bg-error/10 border border-error/20 rounded text-[10px] text-error">{wsdlError}</div>
        )}

        <div className="flex flex-col gap-3 w-full max-w-sm">
          <label className="flex items-center gap-2 px-3 py-2 bg-surface-2 border border-border-1 rounded cursor-pointer hover:border-border-2">
            <Upload size={14} className="text-text-4" />
            <span className="text-xs text-text-2">Import WSDL file</span>
            <input type="file" accept=".wsdl,.xml" onChange={handleFile} className="hidden" />
          </label>

          <div className="flex items-center gap-1">
            <input
              value={wsdlUrl}
              onChange={(e) => setWsdlUrl(e.target.value)}
              placeholder="https://example.com/service?wsdl"
              className="flex-1 h-8 px-2 text-xs bg-surface-2 border border-border-1 rounded text-text-1 outline-none focus:border-border-2 placeholder-text-4"
              onKeyDown={(e) => e.key === 'Enter' && loadWsdlFromUrl()}
            />
            <button
              onClick={loadWsdlFromUrl}
              disabled={loadingWsdl}
              className="px-3 py-1.5 text-xs rounded bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-50"
            >
              {loadingWsdl ? '...' : 'Fetch'}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-border-1" />
            <span className="text-[10px] text-text-4">or paste WSDL</span>
            <div className="h-px flex-1 bg-border-1" />
          </div>

          <textarea
            value={wsdlText}
            onChange={(e) => setWsdlText(e.target.value)}
            placeholder="<definitions xmlns=...>"
            className="h-32 p-2 text-[10px] font-mono bg-surface-2 border border-border-1 rounded resize-none outline-none focus:border-border-2 text-text-2 placeholder-text-4"
          />
          <button
            onClick={loadWsdlFromText}
            disabled={!wsdlText.trim()}
            className="px-3 py-1.5 text-xs rounded bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-50"
          >
            Parse WSDL
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar: Services / Ports / Operations */}
      <div className="w-60 flex-shrink-0 border-r border-border-1 flex flex-col overflow-auto">
        <div className="px-3 py-2 border-b border-border-1 flex items-center gap-1">
          <button onClick={() => setWsdl(null)} className="text-[10px] text-accent hover:text-accent-light">New WSDL</button>
          <span className="text-text-4 text-[10px]">|</span>
          <span className="text-[10px] text-text-4 truncate">{wsdl.targetNamespace || 'WSDL'}</span>
        </div>

        {wsdl.services.length === 0 && (
          <div className="px-3 py-2 text-[10px] text-text-4">No services found</div>
        )}

        {wsdl.services.map((svc) => (
          <div key={svc.name}>
            <div className="px-3 py-1.5 text-[11px] font-medium text-text-2 bg-surface-2">{svc.name}</div>
            {svc.ports.map((port) => {
              const pt = wsdl.portTypes.find((p) => p.name === wsdl.bindings.find((b) => b.name === port.bindingName)?.portTypeName)
              return (
                <div key={port.name} className="border-b border-border-1/50">
                  <button
                    onClick={() => { setSelectedService(svc.name); setSelectedPort(port.name) }}
                    className={cn(
                      'w-full text-left px-3 py-2 text-[11px] hover:bg-surface-2 transition-colors',
                      selectedService === svc.name && selectedPort === port.name ? 'text-accent bg-accent/5' : 'text-text-3'
                    )}
                  >
                    <div className="flex items-center gap-1">
                      <Globe size={10} className="flex-shrink-0" />
                      <span className="truncate">{port.name}</span>
                    </div>
                    <div className="text-[9px] text-text-4 truncate mt-0.5">{port.location}</div>
                  </button>

                  {pt && selectedService === svc.name && selectedPort === port.name && (
                    <div className="pl-2">
                      {pt.operations.map((op) => (
                        <button
                          key={op.name}
                          onClick={() => {
                            setSelectedService(svc.name)
                            setSelectedPort(port.name)
                            setSelectedOp(op.name)
                          }}
                          className={cn(
                            'w-full text-left flex items-center gap-2 px-3 py-1.5 text-[10px] hover:bg-surface-2 transition-colors',
                            selectedOp === op.name ? 'text-accent bg-accent/5' : 'text-text-3'
                          )}
                        >
                          <ChevronRight size={8} />
                          <span className={cn(
                            'px-1 py-0.5 rounded text-[9px] font-medium flex-shrink-0',
                            op.soapAction ? 'bg-blue-500/10 text-blue-400' : 'bg-surface-3 text-text-4'
                          )}>POST</span>
                          <span className="truncate">{op.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Main area: Envelope editor + Response */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Config bar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-1 bg-surface-1">
          <span className="text-[10px] font-medium text-text-3 uppercase">SOAP</span>
          <select
            value={soapVersion}
            onChange={(e) => setSoapVersion(e.target.value as '1.1' | '1.2')}
            className="h-6 px-1.5 text-[10px] bg-surface-2 border border-border-1 rounded text-text-1"
          >
            <option value="1.1">SOAP 1.1</option>
            <option value="1.2">SOAP 1.2</option>
          </select>

          <label className="flex items-center gap-1 text-[10px] text-text-3 cursor-pointer">
            <input
              type="checkbox"
              checked={wsSecurity}
              onChange={(e) => setWsSecurity(e.target.checked)}
              className="w-3 h-3"
            />
            WS-Security
          </label>

          {wsSecurity && (
            <>
              <input
                value={wsUser}
                onChange={(e) => setWsUser(e.target.value)}
                placeholder="username"
                className="w-24 h-6 px-1.5 text-[10px] bg-surface-2 border border-border-1 rounded text-text-1"
              />
              <input
                value={wsPass}
                onChange={(e) => setWsPass(e.target.value)}
                type="password"
                placeholder="password"
                className="w-24 h-6 px-1.5 text-[10px] bg-surface-2 border border-border-1 rounded text-text-1"
              />
            </>
          )}

          {showCustomHeaders && (
            <div className="flex flex-col gap-1 px-3 py-2 border-b border-border-1 bg-surface-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-text-3 uppercase">Custom SOAP Headers</span>
                <button
                  onClick={() => setCustomHeaders((h) => [...h, { id: uid(), key: '', value: '' }])}
                  className="text-[10px] text-accent hover:text-accent-light"
                >
                  <Plus size={10} className="inline" /> Add
                </button>
              </div>
              {customHeaders.map((h, i) => (
                <div key={h.id} className="flex items-center gap-1">
                  <input
                    value={h.key}
                    onChange={(e) => setCustomHeaders((hs) => hs.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
                    placeholder="Header name"
                    className="flex-1 h-6 px-1.5 text-[10px] bg-surface-2 border border-border-1 rounded text-text-1 outline-none placeholder:text-text-4"
                  />
                  <input
                    value={h.value}
                    onChange={(e) => setCustomHeaders((hs) => hs.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                    placeholder="Value"
                    className="flex-1 h-6 px-1.5 text-[10px] bg-surface-2 border border-border-1 rounded text-text-1 outline-none placeholder:text-text-4"
                  />
                  <button
                    onClick={() => setCustomHeaders((hs) => hs.filter((_, j) => j !== i))}
                    className="text-text-4 hover:text-error"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={genEnvelope}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-surface-2 border border-border-1 text-text-2 hover:text-text-1"
          >
            <RefreshCw size={10} /> Generate
          </button>

          <button
            onClick={() => setShowCustomHeaders((v) => !v)}
            className={cn('flex items-center gap-1 px-2 py-1 text-[10px] rounded border transition-colors',
              showCustomHeaders ? 'bg-surface-3 border-border-2 text-text-1' : 'bg-surface-2 border-border-1 text-text-3 hover:text-text-2'
            )}
          >
            Headers{customHeaders.filter((h) => h.key.trim()).length > 0 ? ` (${customHeaders.filter((h) => h.key.trim()).length})` : ''}
          </button>

          <button
            onClick={() => {
              const colStore = useCollectionsStore.getState()
              if (colStore.collections.length === 0) {
                colStore.importCollection({ id: 'col-soap', name: 'SOAP Studio', children: [] })
              }
              const target = colStore.collections[0]
              const req = blankRequest('SOAP', currentOp?.name ?? 'SOAP Request')
              req.url = currentPort?.location ?? ''
              req.headers = [
                { id: uid(), key: 'Content-Type', value: 'text/xml; charset=utf-8', enabled: true },
                { id: uid(), key: 'SOAPAction', value: currentOp?.soapAction ?? '', enabled: true },
                ...customHeaders.filter((h) => h.key.trim()).map((h) => ({ id: uid(), key: h.key.trim(), value: h.value, enabled: true })),
              ]
              if (req.bodies[0]) {
                req.bodies[0].type = 'raw'
                req.bodies[0].lang = 'xml'
                req.bodies[0].raw = envelope
                req.bodies[0].name = envelope ? 'SOAP Envelope' : 'Body 1'
              }
              colStore.addRequest(target.id, null, req)
              colStore.save()
            }}
            disabled={!currentOp || !currentPort}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20 disabled:opacity-40 transition-colors"
            title="Save operation to collection"
          >
            <BookmarkPlus size={10} /> Save
          </button>

          <button
            onClick={sendRequest}
            disabled={sending || !currentPort?.location || !envelope}
            className="flex items-center gap-1 px-3 py-1 text-[10px] rounded bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-50 ml-auto"
          >
            <Send size={10} /> {sending ? 'Sending...' : 'Send'}
          </button>
        </div>

        {/* Envelope editor + Response */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-3 py-1.5 border-b border-border-1 flex items-center gap-3">
            <span className="text-[10px] font-medium text-text-3">Request Envelope</span>
            {currentPort && (
              <span className="text-[9px] text-text-4 truncate">{currentPort.location}</span>
            )}
            {currentOp?.soapAction && (
              <span className="text-[9px] text-accent truncate">SOAPAction: {currentOp.soapAction}</span>
            )}
          </div>
          <textarea
            value={envelope}
            onChange={(e) => setEnvelope(e.target.value)}
            placeholder="Click Generate to create SOAP envelope..."
            className="flex-1 p-3 text-[11px] font-mono bg-surface-1 resize-none outline-none text-text-2 placeholder-text-4 border-b border-border-1"
            spellCheck={false}
          />

          {/* Response section */}
          {responseInfo && (
            <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border-1 bg-surface-2">
              <span className={cn(
                'px-2 py-0.5 rounded text-[10px] font-medium',
                responseInfo.status >= 500 ? 'bg-error/20 text-error' :
                responseInfo.status >= 400 ? 'bg-warning/20 text-warning' :
                responseInfo.status >= 200 ? 'bg-success/20 text-success' : 'bg-surface-3 text-text-3'
              )}>
                {responseInfo.status}
              </span>
              <span className="text-[10px] text-text-4">{responseInfo.ms} ms</span>
              <span className="text-[10px] text-text-4">{responseInfo.size} B</span>
              <div className="flex items-center gap-1 ml-auto">
                <button
                  onClick={() => setViewMode('xml')}
                  className={cn('px-2 py-0.5 text-[10px] rounded', viewMode === 'xml' ? 'bg-surface-3 text-text-1' : 'text-text-4')}
                >
                  XML
                </button>
                <button
                  onClick={() => setViewMode('json')}
                  className={cn('px-2 py-0.5 text-[10px] rounded', viewMode === 'json' ? 'bg-surface-3 text-text-1' : 'text-text-4')}
                >
                  JSON
                </button>
                <button
                  onClick={() => navigator.clipboard.writeText(response)}
                  className="px-2 py-0.5 text-[10px] text-text-4 hover:text-text-1"
                >
                  <Copy size={10} />
                </button>

                <span className="text-text-4 text-[9px]">|</span>

                <button
                  onClick={() => {
                    const v = validateSoapXml(response)
                    setXmlValid(v.valid)
                  }}
                  className="px-2 py-0.5 text-[10px] text-text-4 hover:text-text-1"
                >
                  Validate
                </button>

                {xmlValid !== null && (
                  <span className={cn(
                    'px-2 py-0.5 rounded text-[10px] font-medium',
                    xmlValid ? 'bg-success/20 text-success' : 'bg-error/20 text-error'
                  )}>
                    {xmlValid ? '✓ Valid' : '✗ Invalid'}
                  </span>
                )}

                <button
                  onClick={() => {
                    if (!currentPort?.location) return
                    const curl = exportSoapCurl({
                      url: currentPort.location,
                      soapAction: currentOp?.soapAction ?? '',
                      envelope,
                      soapVersion,
                    })
                    navigator.clipboard.writeText(curl)
                  }}
                  className="px-2 py-0.5 text-[10px] text-text-4 hover:text-text-2"
                  title="Copy cURL"
                >
                  cURL
                </button>

                <button
                  onClick={() => setShowCodeGen(true)}
                  className="px-2 py-0.5 text-[10px] text-text-4 hover:text-text-2"
                  title="Generate client code"
                >
                  Code
                </button>
              </div>
            </div>
          )}
          {response && (
            <div className="flex-1 overflow-auto p-3">
              <pre className="text-xs font-mono whitespace-pre-wrap break-all text-text-2">
                {viewMode === 'json' && responseJson
                  ? JSON.stringify(responseJson, null, 2)
                  : response}
              </pre>
            </div>
          )}
          {!response && !sending && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-xs text-text-4">Response will appear here</p>
            </div>
          )}
          {sending && !response && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-xs text-text-4">Sending request...</p>
            </div>
          )}
        </div>

        {/* Documentation */}
        {currentOp?.documentation && (
          <div className="border-t border-border-1 p-2 text-[10px] text-text-3 italic max-h-16 overflow-auto">
            {currentOp.documentation}
          </div>
        )}
      </div>

      {/* Code Gen Modal */}
      {showCodeGen && currentOp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCodeGen(false)}>
          <div className="w-[600px] max-h-[80vh] bg-surface-1 border border-border-1 rounded-lg shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border-1">
              <span className="text-xs font-semibold text-text-1">Client Code — {currentOp.name}</span>
              <button onClick={() => setShowCodeGen(false)} className="ml-auto text-text-4 hover:text-text-1">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-3 flex flex-col gap-3">
              {(() => {
                const { python, node } = generateSoapClientCode(
                  currentOp.name,
                  currentPort?.location ?? '',
                  currentOp.soapAction,
                  soapVersion,
                )
                return (
                  <>
                    <div>
                      <div className="text-[10px] font-medium text-text-3 mb-1">Python</div>
                      <pre className="text-[10px] font-mono bg-surface-2 p-2 rounded text-text-2 overflow-auto max-h-48">{python}</pre>
                    </div>
                    <div>
                      <div className="text-[10px] font-medium text-text-3 mb-1">Node.js</div>
                      <pre className="text-[10px] font-mono bg-surface-2 p-2 rounded text-text-2 overflow-auto max-h-48">{node}</pre>
                    </div>
                  </>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {/* History panel */}
      {history.length > 0 && (
        <div className="border-t border-border-1 max-h-32 overflow-auto">
          <div className="px-3 py-1.5 text-[10px] font-medium text-text-4 bg-surface-2">History</div>
          {history.slice(0, 10).map((h, i) => (
            <button
              key={i}
              onClick={() => {
                setResponse(h.response)
                setResponseInfo({ status: h.status, ms: h.durationMs, size: new Blob([h.response]).size })
                setResponseJson(soapXmlToJson(h.response))
                setEnvelope(h.envelope)
              }}
              className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-[10px] hover:bg-surface-2 border-b border-border-1/50"
            >
              <span className={cn('px-1 py-0.5 rounded text-[9px]',
                h.status >= 200 && h.status < 300 ? 'bg-success/20 text-success' :
                h.status >= 400 ? 'bg-error/20 text-error' : 'bg-surface-3 text-text-3'
              )}>{h.status}</span>
              <span className="text-text-2 truncate flex-1">{h.operation}</span>
              <span className="text-text-4">{h.durationMs}ms</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
