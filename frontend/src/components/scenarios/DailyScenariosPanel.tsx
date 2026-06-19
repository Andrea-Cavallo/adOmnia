import { useMemo, useState } from 'react'
import {
  Activity,
  ArrowRight,
  Bug,
  Check,
  Container,
  Database,
  GitBranch,
  Layers,
  Link2,
  Play,
  Plus,
  Radio,
  Send,
  Server,
  Shield,
  Trash2,
  Zap,
} from 'lucide-react'
import type { Collection, RequestItem, TreeNode } from '@/lib/types'
import { uid } from '@/lib/types'
import { safeSetItem } from '@/lib/safeLocalStorage'
import { cn } from '@/lib/utils'
import { useAppStore, type RailItem } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useTabsStore } from '@/stores/tabs'

interface ScenarioRequestRef {
  collectionId: string
  requestId: string
}

type ScenarioTool =
  | ''
  | 'collections'
  | 'broker'
  | 'database'
  | 'mock'
  | 'proxy'
  | 'browser'
  | 'flows'
  | 'grpc'
  | 'soap'
  | 'websocket'
  | 'sse'
  | 'observe'
  | 'dockerlab'

interface ScenarioSlot {
  id: string
  title: string
  tool: ScenarioTool
  note: string
  requestRef: ScenarioRequestRef | null
}

interface DailyScenario {
  id: string
  name: string
  envId: string
  correlationKey: string
  slots: ScenarioSlot[]
  updatedAt: string
}

interface LegacyScenario extends Omit<DailyScenario, 'slots'> {
  slots?: ScenarioSlot[]
  kafkaTask?: string
  mongoTask?: string
  requestRef?: ScenarioRequestRef | null
  mockTask?: string
}

interface RequestOption extends ScenarioRequestRef {
  request: RequestItem
  label: string
}

interface ToolOption {
  id: Exclude<ScenarioTool, ''>
  label: string
  rail: RailItem
  icon: React.ElementType
  description: string
}

const STORAGE_KEY = 'adomnia.dailyScenarios.v1'

const TOOL_OPTIONS: ToolOption[] = [
  { id: 'collections', label: 'REST / API Request', rail: 'collections', icon: Send, description: 'Open or send a saved API request.' },
  { id: 'broker', label: 'Broker Studio', rail: 'broker', icon: Radio, description: 'Kafka, RabbitMQ, MQTT, Redis or NATS.' },
  { id: 'database', label: 'Database Studio', rail: 'database', icon: Database, description: 'Run a saved SQL or MongoDB verification.' },
  { id: 'mock', label: 'Mock Server', rail: 'mock', icon: Server, description: 'Start or inspect a local mocked dependency.' },
  { id: 'proxy', label: 'Proxy Interceptor', rail: 'proxy', icon: Shield, description: 'Capture or rewrite traffic.' },
  { id: 'browser', label: 'Browser Debug', rail: 'browser', icon: Bug, description: 'Inspect a real browser flow.' },
  { id: 'flows', label: 'Flows', rail: 'flows', icon: GitBranch, description: 'Open a multi-step verification flow.' },
  { id: 'grpc', label: 'gRPC Client', rail: 'grpc', icon: Send, description: 'Exercise a gRPC endpoint.' },
  { id: 'soap', label: 'SOAP Studio', rail: 'soap', icon: Layers, description: 'Exercise WSDL or SOAP workflows.' },
  { id: 'websocket', label: 'WebSocket', rail: 'websocket', icon: Zap, description: 'Open a live WebSocket workflow.' },
  { id: 'sse', label: 'SSE Client', rail: 'sse', icon: Radio, description: 'Inspect a server event stream.' },
  { id: 'observe', label: 'Observability', rail: 'observe', icon: Activity, description: 'Inspect logs and correlated traces.' },
  { id: 'dockerlab', label: 'Docker Lab', rail: 'dockerlab', icon: Container, description: 'Bring up local infrastructure.' },
]

function blankSlot(index: number): ScenarioSlot {
  return {
    id: uid(),
    title: `Step ${index + 1}`,
    tool: '',
    note: '',
    requestRef: null,
  }
}

function newScenario(name = 'My daily scenario'): DailyScenario {
  return {
    id: uid(),
    name,
    envId: '',
    correlationKey: '',
    slots: [0, 1, 2, 3].map(blankSlot),
    updatedAt: new Date().toISOString(),
  }
}

function normalizeScenario(value: LegacyScenario): DailyScenario {
  if (Array.isArray(value.slots)) {
    return {
      id: value.id || uid(),
      name: value.name || 'My daily scenario',
      envId: value.envId || '',
      correlationKey: value.correlationKey || '',
      slots: [0, 1, 2, 3].map((index) => value.slots?.[index] ?? blankSlot(index)),
      updatedAt: value.updatedAt || new Date().toISOString(),
    }
  }
  return {
    id: value.id || uid(),
    name: value.name || 'Consumer verification - local',
    envId: value.envId || '',
    correlationKey: value.correlationKey || '',
    slots: [
      { id: uid(), title: 'Kafka Consumer', tool: 'broker', note: value.kafkaTask || '', requestRef: null },
      { id: uid(), title: 'MongoDB Query', tool: 'database', note: value.mongoTask || '', requestRef: null },
      { id: uid(), title: 'REST API', tool: 'collections', note: '', requestRef: value.requestRef ?? null },
      { id: uid(), title: 'Mocks', tool: 'mock', note: value.mockTask || '', requestRef: null },
    ],
    updatedAt: value.updatedAt || new Date().toISOString(),
  }
}

function loadScenarios(): DailyScenario[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as LegacyScenario[]
    return Array.isArray(parsed) && parsed.length > 0 ? parsed.map(normalizeScenario) : [newScenario()]
  } catch {
    return [newScenario()]
  }
}

function collectRequests(collection: Collection, nodes: TreeNode[], prefix = ''): RequestOption[] {
  return nodes.flatMap((node) => {
    if (node.type === 'folder') {
      return collectRequests(collection, node.children, `${prefix}${node.name} / `)
    }
    return [{
      collectionId: collection.id,
      requestId: node.id,
      request: node,
      label: `${collection.name} / ${prefix}${node.name || node.url || 'Untitled request'}`,
    }]
  })
}

function requestRefValue(ref: ScenarioRequestRef | null): string {
  return ref ? `${ref.collectionId}:${ref.requestId}` : ''
}

function dispatchAfterPanelMount(rail: RailItem, eventName: string) {
  let attempts = 0
  const tryDispatch = () => {
    if (useAppStore.getState().activeRail !== rail) return
    const detail = { handled: false }
    document.dispatchEvent(new CustomEvent(eventName, { detail }))
    if (!detail.handled && attempts < 120) {
      attempts += 1
      window.requestAnimationFrame(tryDispatch)
    }
  }
  window.requestAnimationFrame(tryDispatch)
}

export function DailyScenariosPanel() {
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const mockRunning = useAppStore((s) => s.mockRunning)
  const collections = useCollectionsStore((s) => s.collections)
  const environments = useEnvironmentsStore((s) => s.environments)
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const setActiveEnv = useEnvironmentsStore((s) => s.setActiveEnv)
  const openTab = useTabsStore((s) => s.openTab)
  const initialScenarios = useMemo(() => loadScenarios(), [])
  const [scenarios, setScenarios] = useState<DailyScenario[]>(initialScenarios)
  const [activeId, setActiveId] = useState(() => initialScenarios[0].id)
  const [saved, setSaved] = useState(false)

  const requestOptions = useMemo(
    () => collections.flatMap((collection) => collectRequests(collection, collection.children)),
    [collections],
  )
  const activeScenario = scenarios.find((scenario) => scenario.id === activeId) ?? scenarios[0]

  const persist = (next: DailyScenario[]) => {
    setScenarios(next)
    safeSetItem(STORAGE_KEY, JSON.stringify(next))
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1200)
  }

  const updateScenario = (patch: Partial<DailyScenario>) => {
    if (!activeScenario) return
    persist(scenarios.map((scenario) => scenario.id === activeScenario.id
      ? { ...scenario, ...patch, updatedAt: new Date().toISOString() }
      : scenario))
  }

  const updateSlot = (slotId: string, patch: Partial<ScenarioSlot>) => {
    updateScenario({
      slots: activeScenario.slots.map((slot) => slot.id === slotId ? { ...slot, ...patch } : slot),
    })
  }

  const addScenario = () => {
    const scenario = newScenario(`Scenario ${scenarios.length + 1}`)
    persist([scenario, ...scenarios])
    setActiveId(scenario.id)
  }

  const deleteScenario = () => {
    if (!activeScenario) return
    const remaining = scenarios.filter((scenario) => scenario.id !== activeScenario.id)
    const next = remaining.length > 0 ? remaining : [newScenario()]
    persist(next)
    setActiveId(next[0].id)
  }

  const useScenarioEnvironment = () => {
    if (activeScenario?.envId) setActiveEnv(activeScenario.envId)
  }

  const openTool = (rail: RailItem) => {
    useScenarioEnvironment()
    setActiveRail(rail)
  }

  const runSlot = (slot: ScenarioSlot, sendNow = false) => {
    const tool = TOOL_OPTIONS.find((candidate) => candidate.id === slot.tool)
    if (!tool) return
    if (slot.tool === 'collections') {
      const request = requestOptions.find((option) => requestRefValue(option) === requestRefValue(slot.requestRef))
      if (!request) {
        openTool('collections')
        return
      }
      useScenarioEnvironment()
      openTab(request.request, request.collectionId)
      setActiveRail('collections')
      if (sendNow) dispatchAfterPanelMount('collections', 'adomnia:send-active-request')
      return
    }
    if (slot.tool === 'mock' && sendNow && !mockRunning) {
      useScenarioEnvironment()
      setActiveRail('mock')
      dispatchAfterPanelMount('mock', 'adomnia:start-mock')
      return
    }
    openTool(tool.rail)
  }

  if (!activeScenario) return null

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[264px_1fr] overflow-hidden bg-surface-0">
      <aside className="flex min-h-0 flex-col border-r border-border-1 bg-surface-1">
        <div className="border-b border-border-1 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Layers size={15} className="text-accent" />
            <h2 className="flex-1 text-sm font-semibold text-text-1">Daily Scenarios</h2>
            <button
              type="button"
              onClick={addScenario}
              title="New scenario"
              className="grid h-7 w-7 place-items-center rounded border border-border-2 text-text-3 hover:text-text-1"
            >
              <Plus size={13} />
            </button>
          </div>
          <p className="text-[10px] leading-relaxed text-text-4">
            Build a four-step desk using the tools you need today.
          </p>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
          {scenarios.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              onClick={() => setActiveId(scenario.id)}
              className={cn(
                'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                scenario.id === activeScenario.id
                  ? 'border-accent/30 bg-accent/10'
                  : 'border-transparent hover:border-border-1 hover:bg-surface-2',
              )}
            >
              <span className="block truncate text-xs font-medium text-text-1">{scenario.name}</span>
              <span className="mt-1 block truncate text-[10px] text-text-4">
                {scenario.slots.filter((slot) => slot.tool).length}/4 configured - {environments.find((env) => env.id === scenario.envId)?.name ?? 'active env'}
              </span>
            </button>
          ))}
        </div>
        <div className="border-t border-border-1 p-3 text-[10px] text-text-4">
          Stored locally on this machine.
        </div>
      </aside>

      <section className="min-h-0 overflow-y-auto">
        <div className="border-b border-border-1 bg-surface-1/50 px-6 py-5">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <input
                value={activeScenario.name}
                onChange={(event) => updateScenario({ name: event.target.value })}
                className="w-full bg-transparent font-sans text-xl font-semibold text-text-1 outline-none placeholder:text-text-4"
                placeholder="Scenario name"
              />
              <p className="mt-1 text-xs text-text-3">
                Pick four tools and keep your usual verification routine one click away.
              </p>
            </div>
            <button
              type="button"
              onClick={deleteScenario}
              title="Delete scenario"
              className="grid h-8 w-8 place-items-center rounded-lg border border-border-2 text-text-4 hover:border-error/30 hover:text-error"
            >
              <Trash2 size={13} />
            </button>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-3">
            <label className="flex min-w-[210px] flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Environment</span>
              <select
                value={activeScenario.envId}
                onChange={(event) => updateScenario({ envId: event.target.value })}
                className="h-8 rounded-lg border border-border-2 bg-surface-2 px-2 text-xs text-text-1 outline-none focus:border-accent"
              >
                <option value="">Use active environment</option>
                {environments.map((environment) => (
                  <option key={environment.id} value={environment.id}>{environment.name}</option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[200px] flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Shared variable (optional)</span>
              <span className="flex h-8 items-center gap-2 rounded-lg border border-border-2 bg-surface-2 px-2">
                <Link2 size={11} className="text-accent" />
                <input
                  value={activeScenario.correlationKey}
                  onChange={(event) => updateScenario({ correlationKey: event.target.value })}
                  className="w-full bg-transparent font-mono text-xs text-text-1 outline-none"
                  placeholder="orderId"
                />
              </span>
            </label>
            {activeScenario.envId && activeScenario.envId !== activeEnvId && (
              <button
                type="button"
                onClick={useScenarioEnvironment}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover"
              >
                Activate environment
              </button>
            )}
            <span className="ml-auto flex h-8 items-center gap-1.5 text-[10px] text-text-4">
              {saved && <><Check size={11} className="text-success" /> Saved locally</>}
            </span>
          </div>
        </div>

        <div className="p-6">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-text-1">Your Four Steps</h2>
            <p className="text-[11px] text-text-4">
              Assign any four tools. {activeScenario.correlationKey && <>Share <span className="font-mono text-accent">{`{{${activeScenario.correlationKey}}}`}</span> across them when useful.</>}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
            {activeScenario.slots.map((slot, index) => {
              const tool = TOOL_OPTIONS.find((candidate) => candidate.id === slot.tool)
              const Icon = tool?.icon ?? Layers
              const hasLinkedRequest = slot.tool === 'collections' && Boolean(
                requestOptions.find((option) => requestRefValue(option) === requestRefValue(slot.requestRef)),
              )
              const primaryLabel = slot.tool === 'collections'
                ? hasLinkedRequest ? 'Open request' : 'Open API Workspace'
                : tool ? `Open ${tool.label}` : 'Choose a tool'
              const quickLabel = slot.tool === 'collections'
                ? 'Send now'
                : slot.tool === 'mock'
                  ? mockRunning ? 'Mock running' : 'Start mock'
                  : null

              return (
                <article key={slot.id} className="flex min-h-[310px] flex-col rounded-xl border border-border-1 bg-surface-1 p-4">
                  <div className="mb-3 flex items-center gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-accent/20 bg-accent/10">
                      <Icon size={15} className="text-accent" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-text-4">Step {index + 1}</span>
                      <input
                        value={slot.title}
                        onChange={(event) => updateSlot(slot.id, { title: event.target.value })}
                        className="block w-full bg-transparent text-xs font-semibold text-text-1 outline-none"
                        placeholder={`Step ${index + 1}`}
                      />
                    </div>
                  </div>

                  <select
                    value={slot.tool}
                    onChange={(event) => updateSlot(slot.id, { tool: event.target.value as ScenarioTool, requestRef: null })}
                    className="mb-3 h-8 w-full rounded-lg border border-border-2 bg-surface-0 px-2 text-[11px] text-text-1 outline-none focus:border-accent"
                  >
                    <option value="">Choose tool...</option>
                    {TOOL_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>

                  {slot.tool === 'collections' && (
                    <select
                      value={requestRefValue(slot.requestRef)}
                      onChange={(event) => {
                        const option = requestOptions.find((item) => requestRefValue(item) === event.target.value)
                        updateSlot(slot.id, { requestRef: option ? { collectionId: option.collectionId, requestId: option.requestId } : null })
                      }}
                      className="mb-3 h-8 w-full rounded-lg border border-border-2 bg-surface-0 px-2 text-[11px] text-text-1 outline-none focus:border-accent"
                    >
                      <option value="">Choose request...</option>
                      {requestOptions.map((option) => (
                        <option key={requestRefValue(option)} value={requestRefValue(option)}>{option.label}</option>
                      ))}
                    </select>
                  )}

                  <p className="mb-2 min-h-[30px] text-[10px] leading-relaxed text-text-4">
                    {tool?.description ?? 'Select a tool for this step.'}
                  </p>
                  <textarea
                    value={slot.note}
                    onChange={(event) => updateSlot(slot.id, { note: event.target.value })}
                    placeholder="What do you verify here?"
                    className="h-16 w-full resize-none rounded-lg border border-border-1 bg-surface-0 p-2 text-[11px] leading-relaxed text-text-2 outline-none focus:border-accent"
                  />

                  {quickLabel && (
                    <button
                      type="button"
                      onClick={() => runSlot(slot, true)}
                      disabled={(slot.tool === 'collections' && !hasLinkedRequest) || (slot.tool === 'mock' && mockRunning)}
                      className={cn(
                        'mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-40',
                        slot.tool === 'mock' && mockRunning
                          ? 'border border-success/25 bg-success/10 text-success'
                          : 'bg-accent text-white hover:bg-accent-hover',
                      )}
                    >
                      <Play size={11} /> {quickLabel}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => runSlot(slot)}
                    disabled={!tool}
                    className="mt-auto flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border-2 bg-surface-2 text-xs font-medium text-text-2 transition-colors hover:border-accent/35 hover:text-text-1 disabled:opacity-40"
                  >
                    {primaryLabel} <ArrowRight size={11} />
                  </button>
                </article>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}
