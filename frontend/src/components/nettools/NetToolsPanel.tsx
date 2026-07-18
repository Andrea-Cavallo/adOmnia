import { useEffect, useState } from 'react'
import { Search, Radio, Shield, Copy, ArrowRight, Database, Trash2, GitBranch, Network, RefreshCw } from 'lucide-react'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { cn } from '@/lib/utils'

type Tab = 'dns' | 'trace' | 'compare' | 'cache' | 'portscan' | 'ports' | 'cors'

interface ListeningPort {
  protocol: string
  address: string
  port: number
  pid: number
  process: string
}

const DNS_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'SRV', 'PTR']

const TABS: { key: Tab; icon: React.ElementType; label: string }[] = [
  { key: 'dns', icon: Search, label: 'DNS Lookup' },
  { key: 'trace', icon: GitBranch, label: 'DNS Trace' },
  { key: 'compare', icon: ArrowRight, label: 'DNS Compare' },
  { key: 'cache', icon: Database, label: 'DNS Cache' },
  { key: 'portscan', icon: Radio, label: 'Port Scan' },
  { key: 'ports', icon: Network, label: 'Open Ports' },
  { key: 'cors', icon: Shield, label: 'CORS Test' },
]

export function NetToolsPanel() {
  const port = useServerPort()
  const [tab, setTab] = useState<Tab>('dns')

  // Command-palette deep links select a sub-tab via this event (see commandPalette.ts).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tab?: Tab; handled?: boolean }
      if (detail?.tab && TABS.some((t) => t.key === detail.tab)) {
        setTab(detail.tab)
        detail.handled = true
      }
    }
    document.addEventListener('adomnia:nettools-tab', handler)
    return () => document.removeEventListener('adomnia:nettools-tab', handler)
  }, [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // DNS Lookup
  const [dnsHost, setDnsHost] = useState('')
  const [dnsType, setDnsType] = useState('A')
  const [dnsServer, setDnsServer] = useState('')
  const [dnsResult, setDnsResult] = useState<object | null>(null)

  // DNS Trace
  const [traceHost, setTraceHost] = useState('')
  const [traceType, setTraceType] = useState('A')
  const [traceResult, setTraceResult] = useState<object | null>(null)

  // DNS Compare
  const [cmpHost, setCmpHost] = useState('')
  const [cmpType, setCmpType] = useState('A')
  const [cmpServer1, setCmpServer1] = useState('8.8.8.8')
  const [cmpServer2, setCmpServer2] = useState('1.1.1.1')
  const [cmpResult, setCmpResult] = useState<object | null>(null)

  // DNS Cache
  const [cacheData, setCacheData] = useState<Record<string, unknown> | null>(null)
  const [cacheLoading, setCacheLoading] = useState(false)

  // Port Scan
  const [scanHost, setScanHost] = useState('')
  const [scanPorts, setScanPorts] = useState('common')
  const [scanResult, setScanResult] = useState<object | null>(null)

  // Open Ports (local listening sockets + owning process)
  const [portsData, setPortsData] = useState<{ os: string; source: string; entries: ListeningPort[] } | null>(null)
  const [portsLoading, setPortsLoading] = useState(false)
  const [portsFilter, setPortsFilter] = useState('')

  // CORS
  const [corsUrl, setCorsUrl] = useState('')
  const [corsOrigin, setCorsOrigin] = useState('')
  const [corsMethod, setCorsMethod] = useState('GET')
  const [corsResult, setCorsResult] = useState<object | null>(null)

  const post = async (path: string, body: unknown, setResult: (v: object) => void) => {
    const url = serverUrl(port, path)
    if (!url) { setError('Backend not ready'); return }
    setLoading(true)
    setError('')
    try {
      const res = await sidecarFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setResult(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const getCache = async () => {
    setCacheLoading(true)
    setError('')
    try {
      const url = serverUrl(port, '/dns/cache')
      if (!url) { setError('Backend not ready'); setCacheLoading(false); return }
      const res = await sidecarFetch(url)
      const data = await res.json()
      setCacheData(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setCacheLoading(false)
    }
  }

  const clearCache = async () => {
    setCacheLoading(true)
    try {
      const url = serverUrl(port, '/dns/cache/clear')
      if (!url) return
      await sidecarFetch(url, { method: 'POST' })
      setCacheData(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setCacheLoading(false)
    }
  }

  const getListeningPorts = async () => {
    const url = serverUrl(port, '/ports/listening')
    if (!url) { setError('Backend not ready'); return }
    setPortsLoading(true)
    setError('')
    try {
      const res = await sidecarFetch(url)
      setPortsData(await res.json())
    } catch (e) {
      setError(String(e))
    } finally {
      setPortsLoading(false)
    }
  }

  // Auto-load listening ports the first time the tab is opened.
  useEffect(() => {
    if (tab === 'ports' && !portsData && port) void getListeningPorts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, port])

  const renderJsonResult = (data: object | null, title: string) => {
    if (!data) return null
    return (
      <div className="bg-surface-1 border border-border-1 rounded-md overflow-hidden">
        <div className="px-3 py-1.5 border-b border-border-1 text-[10px] text-text-4 uppercase tracking-wider flex items-center justify-between">
          {title}
          <button
            onClick={() => navigator.clipboard.writeText(JSON.stringify(data, null, 2))}
            className="flex items-center gap-1 text-accent hover:text-accent-light"
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
        <div className="flex gap-0.5 border-b border-border-1 flex-wrap">
          {TABS.map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => { setTab(key); setError('') }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
                tab === key ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text-2',
              )}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="px-3 py-2.5 bg-error/10 border border-error/30 rounded-md text-xs text-error font-mono">{error}</div>
        )}

        {/* DNS Lookup */}
        {tab === 'dns' && (
          <div className="flex flex-col gap-3">
            <div className="bg-surface-1 border border-border-1 rounded-md p-3">
              <div className="flex gap-2 flex-wrap">
                <input value={dnsHost} onChange={(e) => setDnsHost(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') post('/dns/lookup', { host: dnsHost, type: dnsType, server: dnsServer }, setDnsResult) }}
                  placeholder="your-domain.com" className="flex-1 h-8 px-2.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent placeholder:text-text-4 min-w-[200px]" />
                <select value={dnsType} onChange={(e) => setDnsType(e.target.value)} className="h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent">
                  {DNS_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
                <input value={dnsServer} onChange={(e) => setDnsServer(e.target.value)} placeholder="8.8.8.8"
                  className="w-36 h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent placeholder:text-text-4" />
                <button onClick={() => post('/dns/lookup', { host: dnsHost, type: dnsType, server: dnsServer }, setDnsResult)}
                  disabled={loading || !dnsHost} className="px-4 py-1.5 bg-accent text-white rounded text-xs font-medium disabled:opacity-40 hover:bg-accent-hover">
                  {loading ? '…' : 'Lookup'}
                </button>
              </div>
            </div>
            {renderJsonResult(dnsResult, 'DNS Results')}
          </div>
        )}

        {/* DNS Trace */}
        {tab === 'trace' && (
          <div className="flex flex-col gap-3">
            <div className="bg-surface-1 border border-border-1 rounded-md p-3">
              <div className="flex gap-2">
                <input value={traceHost} onChange={(e) => setTraceHost(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') post('/dns/trace', { host: traceHost, type: traceType }, setTraceResult) }}
                  placeholder="your-domain.com" className="flex-1 h-8 px-2.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent placeholder:text-text-4" />
                <select value={traceType} onChange={(e) => setTraceType(e.target.value)} className="h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent">
                  {DNS_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
                <button onClick={() => post('/dns/trace', { host: traceHost, type: traceType }, setTraceResult)}
                  disabled={loading || !traceHost} className="px-4 py-1.5 bg-accent text-white rounded text-xs font-medium disabled:opacity-40 hover:bg-accent-hover">
                  Trace
                </button>
              </div>
            </div>
            {traceResult && (() => {
              const r = traceResult as { chain?: Array<{ server: string; response: unknown }> }
              if (r.chain) {
                return (
                  <div className="flex flex-col gap-2">
                    {r.chain.map((step, i) => (
                      <div key={i} className="bg-surface-1 border border-border-1 rounded-md p-3">
                        <div className="text-[10px] text-text-4 mb-1">Step {i + 1}: {step.server}</div>
                        <pre className="text-xs text-text-2 font-mono whitespace-pre-wrap">{JSON.stringify(step.response, null, 2)}</pre>
                      </div>
                    ))}
                  </div>
                )
              }
              return renderJsonResult(traceResult, 'DNS Trace Result')
            })()}
          </div>
        )}

        {/* DNS Compare */}
        {tab === 'compare' && (
          <div className="flex flex-col gap-3">
            <div className="bg-surface-1 border border-border-1 rounded-md p-3 flex flex-col gap-2">
              <div className="flex gap-2">
                <input value={cmpHost} onChange={(e) => setCmpHost(e.target.value)} placeholder="your-domain.com"
                  className="flex-1 h-8 px-2.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent placeholder:text-text-4" />
                <select value={cmpType} onChange={(e) => setCmpType(e.target.value)} className="h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent">
                  {DNS_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <input value={cmpServer1} onChange={(e) => setCmpServer1(e.target.value)} placeholder="8.8.8.8"
                  className="flex-1 h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent placeholder:text-text-4" />
                <span className="text-text-4 self-center">vs</span>
                <input value={cmpServer2} onChange={(e) => setCmpServer2(e.target.value)} placeholder="1.1.1.1"
                  className="flex-1 h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent placeholder:text-text-4" />
                <button onClick={() => post('/dns/compare', { host: cmpHost, type: cmpType, servers: [cmpServer1, cmpServer2] }, setCmpResult)}
                  disabled={loading || !cmpHost} className="px-4 py-1.5 bg-accent text-white rounded text-xs font-medium disabled:opacity-40 hover:bg-accent-hover">
                  Compare
                </button>
              </div>
            </div>
            {cmpResult && renderJsonResult(cmpResult, 'DNS Compare')}
          </div>
        )}

        {/* DNS Cache */}
        {tab === 'cache' && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2 items-center">
              <button onClick={getCache} disabled={cacheLoading} className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium disabled:opacity-40 hover:bg-accent-hover">
                {cacheLoading ? 'Loading…' : 'View Cache'}
              </button>
              <button onClick={clearCache} className="px-3 py-1.5 border border-border-2 rounded text-xs text-text-3 hover:text-error flex items-center gap-1">
                <Trash2 size={11} /> Clear
              </button>
            </div>
            {cacheData && (
              <div className="bg-surface-1 border border-border-1 rounded-md overflow-hidden">
                <div className="px-3 py-1.5 border-b border-border-1 text-[10px] text-text-4 uppercase tracking-wider flex items-center justify-between">
                  DNS Cache
                  <button onClick={() => navigator.clipboard.writeText(JSON.stringify(cacheData, null, 2))}
                    className="flex items-center gap-1 text-accent hover:text-accent-light"><Copy size={10} /> Copy</button>
                </div>
                {Object.keys(cacheData).length === 0 ? (
                  <div className="px-3 py-4 text-xs text-text-4 text-center">Cache is empty</div>
                ) : (
                  <div className="divide-y divide-border-1/30">
                    {Object.entries(cacheData).map(([host, records]) => (
                      <div key={host} className="px-3 py-2">
                        <div className="text-xs font-mono text-text-1 mb-1">{host}</div>
                        <pre className="text-[10px] text-text-3 font-mono">{JSON.stringify(records, null, 2)}</pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Port Scan */}
        {tab === 'portscan' && (
          <div className="flex flex-col gap-3">
            <div className="bg-surface-1 border border-border-1 rounded-md p-3">
              <div className="flex gap-2">
                <input value={scanHost} onChange={(e) => setScanHost(e.target.value)} placeholder="192.168.1.1"
                  className="flex-1 h-8 px-2.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent placeholder:text-text-4" />
                <input value={scanPorts} onChange={(e) => setScanPorts(e.target.value)} placeholder="common | 80,443 | 1-1000"
                  className="w-48 h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent placeholder:text-text-4" />
                <button onClick={() => post('/portscan', { host: scanHost, ports: scanPorts }, setScanResult)}
                  disabled={loading || !scanHost} className="px-4 py-1.5 bg-accent text-white rounded text-xs font-medium disabled:opacity-40 hover:bg-accent-hover">
                  Scan
                </button>
              </div>
            </div>
            {scanResult && (() => {
              const r = scanResult as { results?: Array<{ port: number; open: boolean; service: string }>; time_ms?: number }
              if (!r.results) return renderJsonResult(scanResult, 'Scan Results')
              const open = r.results.filter((x) => x.open)
              const closed = r.results.filter((x) => !x.open)
              return (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-4 text-xs text-text-3">
                    <span className="text-success font-medium">{open.length} open</span>
                    <span className="text-text-4">{closed.length} closed</span>
                    {r.time_ms != null && <span className="text-text-4">{r.time_ms}ms</span>}
                  </div>
                  {open.length > 0 && (
                    <div className="bg-surface-1 border border-border-1 rounded-md overflow-hidden">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b border-border-1/40 text-[10px] text-text-4">
                          <th className="px-3 py-1.5 text-left font-medium">Port</th>
                          <th className="px-3 py-1.5 text-left font-medium">Status</th>
                          <th className="px-3 py-1.5 text-left font-medium">Service</th>
                        </tr></thead>
                        <tbody className="divide-y divide-border-1/30">
                          {open.map((p) => (
                            <tr key={p.port} className="hover:bg-surface-2/30">
                              <td className="px-3 py-1.5 font-mono text-text-1">{p.port}</td>
                              <td className="px-3 py-1.5"><span className="px-1.5 py-0.5 text-[10px] font-medium bg-success/15 text-success rounded">OPEN</span></td>
                              <td className="px-3 py-1.5 text-text-3 font-mono">{p.service}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        )}

        {/* Open Ports — local listening sockets and the process that owns each */}
        {tab === 'ports' && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2 items-center flex-wrap">
              <button onClick={getListeningPorts} disabled={portsLoading}
                className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium disabled:opacity-40 hover:bg-accent-hover flex items-center gap-1.5">
                <RefreshCw size={11} className={portsLoading ? 'animate-spin' : ''} />
                {portsLoading ? 'Scanning…' : 'Refresh'}
              </button>
              <input value={portsFilter} onChange={(e) => setPortsFilter(e.target.value)} placeholder="filter by port or process…"
                className="flex-1 h-8 px-2.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent placeholder:text-text-4 min-w-[180px]" />
              {portsData && (
                <span className="text-[10px] text-text-4 font-mono">{portsData.os} · {portsData.source}</span>
              )}
            </div>
            {portsData && (() => {
              const f = portsFilter.trim().toLowerCase()
              const rows = portsData.entries.filter((e) =>
                !f || String(e.port).includes(f) || e.process.toLowerCase().includes(f) || e.address.toLowerCase().includes(f))
              if (rows.length === 0) {
                return <div className="text-xs text-text-4 px-1">{portsData.entries.length === 0 ? 'No listening ports found.' : 'No matches.'}</div>
              }
              return (
                <div className="bg-surface-1 border border-border-1 rounded-md overflow-hidden">
                  <div className="px-3 py-1.5 border-b border-border-1 text-[10px] text-text-4 uppercase tracking-wider flex items-center justify-between">
                    {rows.length} listening
                    <button onClick={() => navigator.clipboard.writeText(JSON.stringify(portsData.entries, null, 2))}
                      className="flex items-center gap-1 text-accent hover:text-accent-light"><Copy size={10} /> Copy</button>
                  </div>
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-border-1/40 text-[10px] text-text-4">
                      <th className="px-3 py-1.5 text-left font-medium">Port</th>
                      <th className="px-3 py-1.5 text-left font-medium">Address</th>
                      <th className="px-3 py-1.5 text-left font-medium">PID</th>
                      <th className="px-3 py-1.5 text-left font-medium">Process</th>
                    </tr></thead>
                    <tbody className="divide-y divide-border-1/30">
                      {rows.map((e, i) => (
                        <tr key={`${e.port}-${e.pid}-${i}`} className="hover:bg-surface-2/30">
                          <td className="px-3 py-1.5 font-mono text-accent">{e.port}</td>
                          <td className="px-3 py-1.5 font-mono text-text-3">{e.address}</td>
                          <td className="px-3 py-1.5 font-mono text-text-3">{e.pid || '—'}</td>
                          <td className="px-3 py-1.5 font-mono text-text-1">{e.process || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })()}
            {!portsData && !portsLoading && (
              <div className="text-xs text-text-4 px-1">Click Refresh to list local listening ports and their owning processes.</div>
            )}
          </div>
        )}

        {/* CORS Test */}
        {tab === 'cors' && (
          <div className="flex flex-col gap-3">
            <div className="bg-surface-1 border border-border-1 rounded-md p-3 flex flex-col gap-2">
              <input value={corsUrl} onChange={(e) => setCorsUrl(e.target.value)}               placeholder="https://api.your-domain.com/v1/endpoint"
                className="w-full h-8 px-2.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent placeholder:text-text-4" />
              <div className="flex gap-2">
                <input value={corsOrigin} onChange={(e) => setCorsOrigin(e.target.value)}                 placeholder="https://api.your-domain.com"
                  className="flex-1 h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent placeholder:text-text-4" />
                <select value={corsMethod} onChange={(e) => setCorsMethod(e.target.value)} className="h-8 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent">
                  {['GET', 'QUERY', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => <option key={m}>{m}</option>)}
                </select>
                <button onClick={() => post('/cors', { url: corsUrl, origin: corsOrigin, method: corsMethod }, setCorsResult)}
                  disabled={loading || !corsUrl || !corsOrigin} className="px-4 py-1.5 bg-accent text-white rounded text-xs font-medium disabled:opacity-40 hover:bg-accent-hover">
                  Test CORS
                </button>
              </div>
            </div>
            {corsResult && (() => {
              const r = corsResult as { allowed?: boolean; issues?: string[]; preflight?: { status: number; headers: Record<string, string> }; response?: { status: number; headers: Record<string, string> } }
              return (
                <div className="flex flex-col gap-3">
                  <div className={cn('px-3 py-2 rounded-md text-xs font-medium border', r.allowed ? 'bg-success/10 text-success border-success/30' : 'bg-error/10 text-error border-error/30')}>
                    {r.allowed ? 'CORS Allowed' : 'CORS Blocked'}
                  </div>
                  {r.issues && r.issues.length > 0 && (
                    <div className="bg-surface-1 border border-border-1 rounded-md p-3">
                      <div className="text-[10px] text-text-4 uppercase tracking-wider mb-2">Issues</div>
                      <ul className="flex flex-col gap-1">{r.issues.map((issue, i) => <li key={i} className="text-xs text-error">• {issue}</li>)}</ul>
                    </div>
                  )}
                  {r.preflight && (
                    <div className="bg-surface-1 border border-border-1 rounded-md overflow-hidden">
                      <div className="px-3 py-1.5 border-b border-border-1 text-[10px] text-text-4 uppercase tracking-wider">Preflight ({r.preflight.status})</div>
                      <div className="p-3">{Object.entries(r.preflight.headers).map(([k, v]) => <div key={k} className="flex gap-2 text-xs py-0.5"><span className="text-text-4 font-mono shrink-0">{k}:</span><span className="text-text-2 font-mono break-all">{v}</span></div>)}</div>
                    </div>
                  )}
                  {r.response && (
                    <div className="bg-surface-1 border border-border-1 rounded-md overflow-hidden">
                      <div className="px-3 py-1.5 border-b border-border-1 text-[10px] text-text-4 uppercase tracking-wider">Response Headers ({r.response.status})</div>
                      <div className="p-3">{Object.entries(r.response.headers).map(([k, v]) => <div key={k} className="flex gap-2 text-xs py-0.5"><span className="text-text-4 font-mono shrink-0">{k}:</span><span className="text-text-2 font-mono break-all">{v}</span></div>)}</div>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}
