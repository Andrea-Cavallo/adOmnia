/**
 * The local WebSocket mock server (one per app, run by the sidecar): rules that auto-reply to
 * incoming messages, and the hits they produced. Its rules stay in `adomnia.wsmock.rules`.
 */
import { useCallback, useEffect, useState } from 'react'
import { Play, Plus, Square, Trash2, Zap } from 'lucide-react'
import { serverUrl, sidecarFetch, useServerPort } from '@/lib/useServerPort'
import { visibleInterval } from '@/lib/visiblePolling'
import { safeSetItem } from '@/lib/safeLocalStorage'
import { uid } from '@/lib/types'
import { cn } from '@/lib/utils'
import { MiniButton } from './wsUi'

type ConditionType = 'any' | 'exact' | 'contains' | 'regex' | 'jsonpath_eq' | 'jsonpath_exists'
interface MockCondition { type: ConditionType; field: string; value: string }
interface MockRule { id: string; name: string; enabled: boolean; condition: MockCondition; response: string; delayMs: number }
interface MockHit { timestamp: number; ruleId: string; ruleName: string; incoming: string; response: string; matched: boolean }

const MOCK_RULES_KEY = 'adomnia.wsmock.rules'
const POLL_MS = 1200

function loadRules(): MockRule[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(MOCK_RULES_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed as MockRule[] : []
  } catch {
    return []
  }
}

function newRule(): MockRule {
  return { id: uid(), name: 'New Rule', enabled: true, condition: { type: 'any', field: '', value: '' }, response: '{"status":"ok","echo":"{{$MSG}}"}', delayMs: 0 }
}

const CONDITION_LABELS: Record<ConditionType, string> = {
  any: 'Any message',
  exact: 'Exact match',
  contains: 'Contains',
  regex: 'Regex',
  jsonpath_eq: 'JSONPath =',
  jsonpath_exists: 'JSONPath exists',
}


export function WsMockServer({ onConnectToMock, onSystem }: {
  onConnectToMock: (url: string) => void
  onSystem: (content: string) => void
}) {
  const port = useServerPort()
  const [running, setRunning] = useState(false)
  const [mockPort, setMockPort] = useState<number | null>(null)
  const [rules, setRules] = useState<MockRule[]>(loadRules)
  const [hits, setHits] = useState<MockHit[]>([])

  const syncRules = useCallback(async (next: MockRule[]) => {
    setRules(next)
    safeSetItem(MOCK_RULES_KEY, JSON.stringify(next))
    if (!port) return
    await sidecarFetch(serverUrl(port, '/ws/mock/rules'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => {})
  }, [port])

  const poll = useCallback(async () => {
    if (!port) return
    try {
      const response = await sidecarFetch(serverUrl(port, '/ws/mock/status'))
      const data = await response.json() as { running?: boolean; port?: number; hits?: MockHit[] }
      setRunning(Boolean(data.running))
      setMockPort(data.running ? data.port ?? null : null)
      setHits(data.hits ?? [])
    } catch {
      setRunning(false)
      setMockPort(null)
    }
  }, [port])

  useEffect(() => {
    void poll()
  }, [poll])

  useEffect(() => {
    if (!port || !running) return undefined
    return visibleInterval(() => void poll(), POLL_MS, { scope: 'websocket', kind: 'live' })
  }, [poll, port, running])

  const startMock = async () => {
    if (!port) return
    await syncRules(rules)
    const response = await sidecarFetch(serverUrl(port, '/ws/mock/start'), { method: 'POST' })
    const data = await response.json() as { port: number }
    setRunning(true)
    setMockPort(data.port)
    onSystem(`Mock server enabled on ws://localhost:${data.port}`)
  }

  const stopMock = async () => {
    if (!port) return
    await sidecarFetch(serverUrl(port, '/ws/mock/stop'), { method: 'POST' }).catch(() => {})
    setRunning(false)
    setMockPort(null)
    onSystem('Mock server stopped')
  }

  const clearHits = async () => {
    if (!port) return
    await sidecarFetch(serverUrl(port, '/ws/mock/hits/clear'), { method: 'POST' }).catch(() => {})
    setHits([])
  }

  const mockUrl = mockPort ? `ws://localhost:${mockPort}` : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <button type="button" onClick={stopMock} className="inline-flex h-8 items-center gap-2 rounded border border-error/30 bg-error/10 px-3 text-[11px] font-semibold text-error hover:bg-error/20">
            <Square size={12} /> Stop Mock
          </button>
        ) : (
          <button type="button" onClick={startMock} disabled={!port} className="inline-flex h-8 items-center gap-2 rounded bg-accent px-3 text-[11px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40">
            <Play size={12} /> Start Mock
          </button>
        )}
        {mockUrl && (
          <>
            <code className="rounded border border-accent/20 bg-accent/10 px-2 py-1 font-mono text-[11px] text-accent">{mockUrl}</code>
            <MiniButton onClick={() => onConnectToMock(mockUrl)}><Zap size={12} /> Connect</MiniButton>
          </>
        )}
        <div className="ml-auto flex items-center gap-2 text-[10px] text-text-4">
          <span className={cn('h-2 w-2 rounded-full', running ? 'bg-success' : 'bg-text-4')} />
          {hits.length} hit{hits.length === 1 ? '' : 's'}
        </div>
      </div>

      <div className="rounded-md border border-border-2 bg-surface-0">
        <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_76px_58px] border-b border-border-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-4">
          <span>When incoming</span>
          <span>Then reply</span>
          <span>Delay</span>
          <span>Enabled</span>
        </div>
        <div className="divide-y divide-border-2/70">
          {rules.length === 0 && <div className="px-3 py-4 text-[11px] text-text-4">No rules. Add one to auto-reply to incoming messages.</div>}
          {rules.map((rule) => (
            <div key={rule.id} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_76px_58px] items-center gap-2 px-3 py-2">
              <div className="min-w-0">
                <input
                  value={rule.name}
                  onChange={(event) => syncRules(rules.map((item) => item.id === rule.id ? { ...item, name: event.target.value } : item))}
                  className="mb-1 h-6 w-full rounded border border-border-2 bg-surface-1 px-2 text-[11px] text-text-1 outline-none focus:border-accent/50"
                />
                <div className="flex gap-1">
                  <select
                    value={rule.condition.type}
                    onChange={(event) => syncRules(rules.map((item) => item.id === rule.id ? { ...item, condition: { ...item.condition, type: event.target.value as ConditionType } } : item))}
                    className="h-6 min-w-0 flex-1 rounded border border-border-2 bg-surface-1 px-2 text-[10px] text-text-2 outline-none"
                  >
                    {(Object.keys(CONDITION_LABELS) as ConditionType[]).map((condition) => <option key={condition} value={condition}>{CONDITION_LABELS[condition]}</option>)}
                  </select>
                  {(rule.condition.type === 'jsonpath_eq' || rule.condition.type === 'jsonpath_exists') && (
                    <input
                      value={rule.condition.field}
                      onChange={(event) => syncRules(rules.map((item) => item.id === rule.id ? { ...item, condition: { ...item.condition, field: event.target.value } } : item))}
                      placeholder="path"
                      className="h-6 min-w-0 flex-1 rounded border border-border-2 bg-surface-1 px-2 font-mono text-[10px] text-text-1 outline-none"
                    />
                  )}
                  {rule.condition.type !== 'any' && rule.condition.type !== 'jsonpath_exists' && (
                    <input
                      value={rule.condition.value}
                      onChange={(event) => syncRules(rules.map((item) => item.id === rule.id ? { ...item, condition: { ...item.condition, value: event.target.value } } : item))}
                      placeholder="value"
                      className="h-6 min-w-0 flex-1 rounded border border-border-2 bg-surface-1 px-2 font-mono text-[10px] text-text-1 outline-none"
                    />
                  )}
                </div>
              </div>
              <textarea
                value={rule.response}
                onChange={(event) => syncRules(rules.map((item) => item.id === rule.id ? { ...item, response: event.target.value } : item))}
                rows={3}
                className="min-h-[54px] resize-none rounded border border-border-2 bg-surface-1 px-2 py-1 font-mono text-[10px] leading-4 text-text-1 outline-none focus:border-accent/50"
              />
              <input
                type="number"
                min={0}
                max={30000}
                value={rule.delayMs}
                onChange={(event) => syncRules(rules.map((item) => item.id === rule.id ? { ...item, delayMs: Number(event.target.value) } : item))}
                className="h-7 rounded border border-border-2 bg-surface-1 px-2 font-mono text-[10px] text-text-1 outline-none"
              />
              <div className="flex items-center gap-1">
                <input type="checkbox" checked={rule.enabled} onChange={(event) => syncRules(rules.map((item) => item.id === rule.id ? { ...item, enabled: event.target.checked } : item))} className="h-3 w-3" />
                <button type="button" onClick={() => syncRules(rules.filter((item) => item.id !== rule.id))} className="flex h-6 w-6 items-center justify-center rounded text-text-4 hover:bg-error/10 hover:text-error"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <MiniButton onClick={() => syncRules([...rules, newRule()])}><Plus size={12} /> Add Rule</MiniButton>
        <MiniButton onClick={clearHits} disabled={hits.length === 0}><Trash2 size={12} /> Clear Hits</MiniButton>
      </div>
    </div>
  )
}
