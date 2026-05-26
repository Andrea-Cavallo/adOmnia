import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle, Check, ChevronRight, Copy, Cpu, Database, Download,
  Loader2, Play, Radio, RefreshCw, Square, Terminal,
} from 'lucide-react'
import { useAppStore } from '@/stores/app'
import { cn } from '@/lib/utils'
import { safeSetItem } from '@/lib/safeLocalStorage'
import {
  type ContainerStatus,
  type LabInfo,
  type LabRunResult,
  generateLab,
  labDown,
  labList,
  labLogs,
  labStatus,
  labUp,
} from '@/lib/dockerlab-api'

// ─── preset definitions (local, no backend needed for the grid) ───────────────

interface Preset {
  id: string
  name: string
  icon: string
  description: string
  services: string[]
  tag: string
}

const PRESETS: Preset[] = [
  { id: 'postgres',           icon: '🐘', name: 'PostgreSQL',           tag: 'database',     services: ['PostgreSQL'],                    description: 'PostgreSQL 16 Alpine con volume persistente.' },
  { id: 'mysql',              icon: '🐬', name: 'MySQL',                tag: 'database',     services: ['MySQL'],                         description: 'MySQL 8.4 con volume persistente.' },
  { id: 'mongodb',            icon: '🍃', name: 'MongoDB',              tag: 'database',     services: ['MongoDB'],                       description: 'MongoDB 7 con volume persistente.' },
  { id: 'redis',              icon: '🔴', name: 'Redis',                tag: 'cache',        services: ['Redis'],                         description: 'Redis 7 Alpine con autenticazione e persistenza AOF.' },
  { id: 'rabbitmq',           icon: '🐰', name: 'RabbitMQ',             tag: 'messaging',    services: ['RabbitMQ', 'Management UI'],     description: 'RabbitMQ 4 con management UI sulla porta 15672.' },
  { id: 'kafka',              icon: '📨', name: 'Kafka',                tag: 'messaging',    services: ['Kafka'],                         description: 'Apache Kafka in modalità KRaft — nessun ZooKeeper.' },
  { id: 'kafka+ui',           icon: '📊', name: 'Kafka + UI',           tag: 'combo',        services: ['Kafka', 'Kafka UI'],             description: 'Kafka KRaft con Provectus Kafka UI per gestire topics.' },
  { id: 'kafka-ui',           icon: '🖥️', name: 'Kafka UI',             tag: 'ui',           services: ['Kafka UI'],                      description: 'Solo Kafka UI — da usare con un Kafka esistente.' },
  { id: 'mock-server',        icon: '🎭', name: 'Mock Server',          tag: 'api',          services: ['JSON Server'],                   description: 'JSON Server per simulare REST API da un file db.json.' },
  { id: 'rest-mock+postgres', icon: '🔄', name: 'REST Mock + Postgres', tag: 'combo',        services: ['JSON Server', 'PostgreSQL'],     description: 'Mock REST API + PostgreSQL — stack completo per test.' },
  { id: 'rest-mock+kafka',    icon: '⚡', name: 'REST Mock + Kafka',    tag: 'combo',        services: ['JSON Server', 'Kafka'],          description: 'Mock REST API + Kafka per architetture event-driven.' },
  { id: 'otel',               icon: '📡', name: 'OpenTelemetry',        tag: 'observability', services: ['OTel Collector'],              description: 'OTel Collector per trace, metriche e log in locale.' },
  { id: 'jaeger',             icon: '🔍', name: 'Jaeger',               tag: 'observability', services: ['Jaeger All-in-One'],           description: 'Jaeger per visualizzare distributed traces via OTLP.' },
  { id: 'prometheus',         icon: '🔥', name: 'Prometheus',           tag: 'observability', services: ['Prometheus'],                  description: 'Prometheus per raccogliere e analizzare metriche.' },
  { id: 'grafana',            icon: '📈', name: 'Grafana',              tag: 'observability', services: ['Grafana'],                      description: 'Grafana per dashboard di visualizzazione metriche.' },
]

type TabId = 'compose' | 'env' | 'readme' | 'status' | 'logs'

interface LabState {
  projectName: string
  ids: string[]
  dir: string
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function stateColor(state: string) {
  if (state === 'running') return 'text-success'
  if (state === 'exited' || state === 'dead') return 'text-error'
  return 'text-warning'
}

function stateDot(state: string) {
  if (state === 'running') return 'bg-success'
  if (state === 'exited' || state === 'dead') return 'bg-error'
  return 'bg-warning'
}

function friendlyDockerError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()
  if (
    lower.includes('dockerdesktoplinuxengine') ||
    lower.includes('docker desktop is not running') ||
    lower.includes('daemon is not running') ||
    lower.includes('cannot connect to the docker daemon') ||
    lower.includes('error during connect')
  ) {
    return 'Docker Desktop is not running. Start Docker Desktop and retry.'
  }
  if (lower.includes('docker cli') || lower.includes('executable file not found')) {
    return 'Docker CLI is not installed or is not available on PATH.'
  }
  if (lower.includes('docker compose is not available') || lower.includes('compose')) {
    return message
  }
  return message || 'Docker Lab could not complete the requested action.'
}

// ─── main component ───────────────────────────────────────────────────────────

export function DockerLabPanel() {
  const [selected, setSelected] = useState<Preset | null>(null)
  const [compose, setCompose] = useState('')
  const [envContent, setEnvContent] = useState('')
  const [readme, setReadme] = useState('')
  const [tab, setTab] = useState<TabId>('compose')

  const [launching, setLaunching] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [runningLab, setRunningLab] = useState<LabState | null>(null)

  const [containers, setContainers] = useState<ContainerStatus[]>([])
  const [logs, setLogs] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [runningLabs, setRunningLabs] = useState<LabInfo[]>([])

  const [copied, setCopied] = useState(false)
  const [launchError, setLaunchError] = useState('')

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Poll container status when a lab is running
  useEffect(() => {
    if (!runningLab) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    const poll = async () => {
      const s = await labStatus(runningLab.projectName)
      setContainers(s ?? [])
    }
    poll()
    pollRef.current = setInterval(poll, 3000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [runningLab])

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const selectPreset = async (preset: Preset) => {
    setSelected(preset)
    setTab('compose')
    setLaunchError('')
    const out = await generateLab([preset.id])
    setCompose(out.composeContent)
    setEnvContent(out.envContent)
    setReadme(out.readmeContent)
  }

  const handleLaunch = async (preset: Preset) => {
    setLaunchError('')
    setLaunching(true)
    try {
      const result: LabRunResult = await labUp([preset.id])
      setRunningLab({ projectName: result.projectName, ids: result.ids, dir: result.dir })
      setTab('status')
      const updated = await labList()
      setRunningLabs(updated)
    } catch (err: unknown) {
      setLaunchError(friendlyDockerError(err))
    } finally {
      setLaunching(false)
    }
  }

  const handleStop = async () => {
    if (!runningLab) return
    setStopping(true)
    try {
      await labDown(runningLab.projectName)
      setRunningLab(null)
      setContainers([])
      const updated = await labList()
      setRunningLabs(updated)
    } finally {
      setStopping(false)
    }
  }

  const refreshLogs = async () => {
    if (!runningLab) return
    setLogsLoading(true)
    const l = await labLogs(runningLab.projectName, 200)
    setLogs(l)
    setLogsLoading(false)
  }

  const handleTabChange = async (t: TabId) => {
    setTab(t)
    if (t === 'logs' && runningLab) {
      await refreshLogs()
    }
  }

  const copyCurrent = async () => {
    const content = tab === 'compose' ? compose : tab === 'env' ? envContent : readme
    try { await navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* */ }
  }

  const download = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const openDatabase = () => {
    if (!selected) return
    const hasPostgres = selected.services.includes('PostgreSQL')
    const hasMySQL = selected.services.includes('MySQL')
    const hasMongo = selected.services.includes('MongoDB')
    if (!hasPostgres && !hasMySQL && !hasMongo) return
    const pending = hasPostgres
      ? { name: `${selected.name} PostgreSQL`, driver: 'postgres', host: '127.0.0.1', port: 5432, database: 'adomnia', user: 'postgres', password: 'postgres', sslMode: 'disable' }
      : hasMySQL
        ? { name: `${selected.name} MySQL`, driver: 'mysql', host: '127.0.0.1', port: 3306, database: 'adomnia', user: 'adomnia', password: 'adomnia', sslMode: 'disable' }
        : { name: `${selected.name} MongoDB`, driver: 'mongodb', host: '127.0.0.1', port: 27017, database: 'admin', user: 'admin', password: 'admin', sslMode: 'disable' }
    safeSetItem('adomnia.database.pendingConnection', JSON.stringify(pending))
    useAppStore.getState().setActiveRail('database')
  }

  const openBroker = () => {
    if (!selected) return
    const hasKafka = selected.services.some(s => s.toLowerCase().includes('kafka'))
    const hasRabbit = selected.services.some(s => s.toLowerCase().includes('rabbit'))
    const hasRedis = selected.services.some(s => s.toLowerCase().includes('redis'))
    if (!hasKafka && !hasRabbit && !hasRedis) return
    const pending = hasKafka
      ? { protocol: 'kafka', kafka: { brokers: 'localhost:9092', topic: 'adomnia.lab.events' } }
      : hasRabbit
        ? { protocol: 'rabbitmq', rabbitmq: { url: 'amqp://guest:guest@localhost:5672/' } }
        : { protocol: 'redis', redis: { addr: 'localhost:6379' } }
    safeSetItem('adomnia.broker.pending', JSON.stringify(pending))
    useAppStore.getState().setActiveRail(hasKafka ? 'kafka' : 'broker')
  }

  const isRunning = runningLab !== null && selected !== null &&
    runningLab.ids.includes(selected.id)

  const anyRunning = containers.some(c => c.running)

  // ── Preset grid ─────────────────────────────────────────────────────────────

  if (!selected) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-border-1">
          <div className="flex items-center gap-2">
            <Cpu size={16} className="text-accent" />
            <h2 className="text-sm font-semibold text-text-1">Docker Lab</h2>
          </div>
          <p className="text-[10px] text-text-4 mt-0.5">
            Lancia stack Docker precofigurati direttamente da adOmnia — nessun terminale necessario.
          </p>
        </div>

        {runningLabs.length > 0 && (
          <div className="px-4 py-2 border-b border-border-1 bg-surface-1 flex flex-wrap gap-2">
            <span className="text-[10px] text-text-4 self-center">In esecuzione:</span>
            {runningLabs.map(l => (
              <span key={l.projectName} className="flex items-center gap-1 px-2 py-0.5 rounded bg-success/10 border border-success/20 text-[10px] text-success">
                <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
                {l.projectName.replace('adomnia-', '')}
              </span>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 gap-3 content-start">
          {PRESETS.map((preset) => (
            <div
              key={preset.id}
              className="flex flex-col p-3 rounded-lg border border-border-1 hover:border-accent/40 hover:bg-surface-1 transition-colors group"
            >
              <button
                onClick={() => selectPreset(preset)}
                className="text-left flex-1"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-lg">{preset.icon}</span>
                  <span className="text-xs font-medium text-text-1 group-hover:text-accent">{preset.name}</span>
                  <span className="ml-auto px-1.5 py-0.5 text-[9px] rounded bg-surface-3 text-text-4">{preset.tag}</span>
                </div>
                <p className="text-[10px] text-text-4 leading-relaxed mb-2">{preset.description}</p>
                <div className="flex flex-wrap gap-1">
                  {preset.services.map((s) => (
                    <span key={s} className="px-1.5 py-0.5 text-[9px] rounded bg-surface-2 text-text-3 border border-border-1">{s}</span>
                  ))}
                </div>
              </button>

              <div className="flex gap-1 mt-2 pt-2 border-t border-border-1">
                <button
                  onClick={() => selectPreset(preset)}
                  className="flex-1 text-[10px] text-text-4 hover:text-text-2 text-left"
                >
                  Vedi config
                </button>
                <button
                  onClick={() => { void selectPreset(preset) }}
                  disabled={launching}
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] rounded bg-success/15 text-success hover:bg-success/25 transition-colors border border-success/20 font-medium"
                >
                  <ChevronRight size={10} />
                  Open
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Detail view ──────────────────────────────────────────────────────────────

  const showFileTabs = tab === 'compose' || tab === 'env' || tab === 'readme'

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* breadcrumb + tab bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border-1 bg-surface-1 flex-wrap">
        <button onClick={() => setSelected(null)} className="text-[10px] text-accent hover:text-accent-light">
          All Presets
        </button>
        <ChevronRight size={10} className="text-text-4" />
        <span className="text-[11px] font-medium text-text-2">{selected.icon} {selected.name}</span>

        {isRunning && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-success/10 border border-success/20 text-[10px] text-success">
            <span className="w-1.5 h-1.5 rounded-full bg-success" />
            {anyRunning ? 'Running' : 'Starting…'}
          </span>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          {(['compose', 'env', 'readme'] as const).map(t => (
            <button
              key={t}
              onClick={() => handleTabChange(t)}
              className={cn('px-2 py-0.5 text-[10px] rounded transition-colors',
                tab === t ? 'bg-surface-3 text-text-1' : 'text-text-4 hover:text-text-2')}
            >
              {t === 'compose' ? 'compose.yml' : t === 'env' ? '.env' : 'README'}
            </button>
          ))}
          <button
            onClick={() => handleTabChange('status')}
            className={cn('px-2 py-0.5 text-[10px] rounded transition-colors flex items-center gap-1',
              tab === 'status' ? 'bg-surface-3 text-text-1' : 'text-text-4 hover:text-text-2')}
          >
            <Cpu size={10} />
            Status
            {containers.length > 0 && (
              <span className={cn('w-1.5 h-1.5 rounded-full', anyRunning ? 'bg-success' : 'bg-error')} />
            )}
          </button>
          <button
            onClick={() => handleTabChange('logs')}
            className={cn('px-2 py-0.5 text-[10px] rounded transition-colors flex items-center gap-1',
              tab === 'logs' ? 'bg-surface-3 text-text-1' : 'text-text-4 hover:text-text-2')}
          >
            <Terminal size={10} />
            Logs
          </button>
        </div>
      </div>

      {/* error banner */}
      {launchError && (
        <div className="mx-4 mt-2 flex items-start gap-2 rounded border border-error/20 bg-error/10 p-2 text-xs text-error leading-relaxed">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {launchError}
        </div>
      )}

      {/* content area */}
      <div className="flex-1 overflow-auto">
        {showFileTabs && (
          <pre className="text-[11px] font-mono text-text-2 whitespace-pre-wrap bg-surface-0 p-4 min-h-full">
            {tab === 'compose' ? compose : tab === 'env' ? envContent : readme}
          </pre>
        )}

        {tab === 'status' && (
          <div className="p-4">
            {containers.length === 0 && !isRunning && (
              <div className="text-center py-12 text-text-4 text-xs">
                Nessun container attivo — lancia il lab con il pulsante Launch.
              </div>
            )}
            {containers.length === 0 && isRunning && (
              <div className="flex items-center gap-2 justify-center py-12 text-text-4 text-xs">
                <Loader2 size={14} className="animate-spin" />
                Avvio containers in corso…
              </div>
            )}
            {containers.length > 0 && (
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border-1 text-text-4 text-left">
                    <th className="pb-2 pr-4 font-medium">Container</th>
                    <th className="pb-2 pr-4 font-medium">Image</th>
                    <th className="pb-2 pr-4 font-medium">State</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 font-medium">Ports</th>
                  </tr>
                </thead>
                <tbody>
                  {containers.map(c => (
                    <tr key={c.id} className="border-b border-border-1/50 hover:bg-surface-1">
                      <td className="py-2 pr-4 font-mono text-text-1">{c.name}</td>
                      <td className="py-2 pr-4 text-text-3 font-mono text-[10px]">{c.image}</td>
                      <td className="py-2 pr-4">
                        <span className={cn('flex items-center gap-1.5', stateColor(c.state))}>
                          <span className={cn('w-1.5 h-1.5 rounded-full', stateDot(c.state))} />
                          {c.state}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-text-3">{c.status}</td>
                      <td className="py-2 text-text-3 font-mono text-[10px] max-w-[200px] truncate">{c.ports || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'logs' && (
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border-1">
              <span className="text-[10px] text-text-4">
                {runningLab ? runningLab.projectName : 'Nessun lab attivo'}
              </span>
              <div className="flex-1" />
              <button
                onClick={refreshLogs}
                disabled={logsLoading || !runningLab}
                className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-3 hover:text-text-1 border border-border-1 rounded transition-colors disabled:opacity-40"
              >
                <RefreshCw size={10} className={logsLoading ? 'animate-spin' : ''} />
                Aggiorna
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-surface-0 p-3">
              <pre className="text-[10px] font-mono text-text-3 whitespace-pre-wrap leading-5">
                {logs || (runningLab ? 'Premi Aggiorna per caricare i log.' : 'Avvia un lab per vedere i log.')}
              </pre>
              <div ref={logsEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* bottom action bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-t border-border-1 bg-surface-1 flex-wrap">
        <div className="flex flex-wrap gap-1">
          {selected.services.map((s) => (
            <span key={s} className="px-1.5 py-0.5 text-[9px] rounded bg-surface-2 text-text-3 border border-border-1">{s}</span>
          ))}
        </div>
        <div className="flex-1" />

        {selected.services.some(s => ['PostgreSQL', 'MySQL', 'MongoDB'].includes(s)) && (
          <button onClick={openDatabase} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-border-1 text-text-3 hover:text-text-1 hover:bg-surface-2 transition-colors">
            <Database size={12} /> Open in Database
          </button>
        )}
        {selected.services.some(s => s.toLowerCase().includes('kafka') || s.toLowerCase().includes('rabbit') || s.toLowerCase().includes('redis')) && (
          <button onClick={openBroker} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-border-1 text-text-3 hover:text-text-1 hover:bg-surface-2 transition-colors">
            <Radio size={12} /> Open in Broker
          </button>
        )}

        {showFileTabs && (
          <>
            <button onClick={copyCurrent} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-border-1 text-text-3 hover:text-text-1 hover:bg-surface-2 transition-colors">
              {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
              {copied ? 'Copiato' : 'Copia'}
            </button>
            <button
              onClick={() => {
                const ext = tab === 'compose' ? 'yml' : tab === 'env' ? 'env' : 'md'
                const content = tab === 'compose' ? compose : tab === 'env' ? envContent : readme
                const mime = ext === 'yml' ? 'text/yaml' : ext === 'md' ? 'text/markdown' : 'text/plain'
                download(`docker-${tab === 'compose' ? 'compose' : tab}.${ext}`, content, mime)
              }}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-border-1 text-text-3 hover:text-text-1 hover:bg-surface-2 transition-colors"
            >
              <Download size={12} />
              Salva {tab === 'compose' ? 'compose.yml' : tab === 'env' ? '.env' : 'README.md'}
            </button>
          </>
        )}

        {isRunning ? (
          <button
            onClick={handleStop}
            disabled={stopping}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-error/15 text-error hover:bg-error/25 border border-error/25 transition-colors font-medium disabled:opacity-60"
          >
            {stopping ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
            {stopping ? 'Stopping…' : 'Stop Lab'}
          </button>
        ) : (
          <button
            onClick={() => handleLaunch(selected)}
            disabled={launching}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-success/15 text-success hover:bg-success/25 border border-success/20 transition-colors font-medium disabled:opacity-60"
          >
            {launching ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            {launching ? 'Launching…' : 'Launch Lab'}
          </button>
        )}
      </div>
    </div>
  )
}
