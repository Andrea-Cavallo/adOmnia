import { useMemo, useState } from 'react'
import { CheckCircle2, HelpCircle, Server, Workflow, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { loadFlowDefinitions, saveFlowDefinitions } from '@/lib/flowStorage'
import { appendMockEndpoints } from '@/lib/mockEndpointStore'
import { useAppStore } from '@/stores/app'
import {
  buildChainProposal,
  chainProposalToFlow,
  chainProposalToMockEndpoints,
  type AnalyzedRequest,
  type LogEvent,
} from '@/lib/loginspector'

interface ChainProposalPanelProps {
  events: LogEvent[]
  request: AnalyzedRequest
  onClose: () => void
  onSelectEventId: (id: number) => void
}

export function ChainProposalPanel({ events, request, onClose, onSelectEventId }: ChainProposalPanelProps) {
  const proposal = useMemo(() => buildChainProposal(events, request), [events, request])
  const [status, setStatus] = useState('')
  const confirmed = proposal.mappings.filter((mapping) => mapping.confidence === 'confirmed')
  const mockEndpoints = useMemo(() => chainProposalToMockEndpoints(proposal), [proposal])

  const createFlow = async () => {
    try {
      const flow = chainProposalToFlow(proposal, `Log chain ${proposal.key}`)
      const existing = await loadFlowDefinitions()
      await saveFlowDefinitions([flow, ...existing])
      useAppStore.getState().setActiveRail('flows')
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : 'Could not save the flow')
    }
  }

  const createMocks = async () => {
    try {
      await appendMockEndpoints(mockEndpoints)
      useAppStore.getState().setActiveRail('mock')
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : 'Could not save the mock fixtures')
    }
  }

  return (
    <div className="absolute inset-4 z-40 flex flex-col overflow-hidden rounded-lg border border-border-2 bg-surface-0 shadow-[0_18px_60px_rgba(0,0,0,.65)]">
      <header className="flex items-center gap-3 border-b border-border-1 bg-surface-1 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Chain to flow and mock</p>
          <p className="truncate font-mono text-[11px] text-text-1">{proposal.key}</p>
        </div>
        <button
          onClick={() => void createFlow()}
          disabled={proposal.steps.length === 0}
          title="Create a flow that replays these steps"
          className="flex h-7 items-center gap-1.5 rounded border border-accent/40 bg-accent/12 px-2 text-[10px] text-accent-light hover:bg-accent/20 disabled:opacity-40"
        >
          <Workflow size={11} /> Create flow ({proposal.steps.length} steps)
        </button>
        <button
          onClick={() => void createMocks()}
          disabled={mockEndpoints.length === 0}
          title="Create Mock Server fixtures from the observed responses"
          className="flex h-7 items-center gap-1.5 rounded border border-border-2 px-2 text-[10px] text-text-2 hover:border-accent/40 hover:text-text-1 disabled:opacity-40"
        >
          <Server size={11} /> Create mock fixtures ({mockEndpoints.length})
        </button>
        <button onClick={onClose} title="Close" className="grid h-7 w-7 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-error"><X size={13} /></button>
      </header>

      {status && <p className="border-b border-border-1 bg-error/10 px-3 py-1 text-[10px] text-error">{status}</p>}

      <div className="min-h-0 flex-1 overflow-auto">
        <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-4">Proposed steps</p>
        {proposal.steps.length === 0 ? (
          <p className="px-3 pb-3 text-[11px] text-text-4">
            This chain has no request/response payload that can be replayed. Only calls with a logged payload become steps.
          </p>
        ) : (
          <table className="w-full table-fixed border-collapse text-left font-mono text-[10px]">
            <thead className="bg-surface-1 text-[9px] uppercase tracking-wider text-text-4">
              <tr>
                <th className="w-8 px-2 py-1">#</th>
                <th className="w-24 px-2 py-1">Service</th>
                <th className="w-16 px-2 py-1">Method</th>
                <th className="px-2 py-1">URL</th>
                <th className="w-14 px-2 py-1">Status</th>
                <th className="w-[30%] px-2 py-1">Not in the log</th>
              </tr>
            </thead>
            <tbody>
              {proposal.steps.map((step) => (
                <tr
                  key={step.id}
                  tabIndex={0}
                  role="button"
                  onClick={() => onSelectEventId(step.eventId)}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectEventId(step.eventId) } }}
                  className="cursor-pointer border-t border-border-1 text-text-2 outline-none hover:bg-surface-1 focus-visible:bg-accent/10"
                  title="Open the log event of this step"
                >
                  <td className="px-2 py-1 text-text-4">{step.order + 1}</td>
                  <td className="truncate px-2 py-1">{step.service || 'n/d'}</td>
                  <td className="px-2 py-1">{step.method}</td>
                  <td className="truncate px-2 py-1" title={step.url}>{step.url || 'n/d'}</td>
                  <td className={cn('px-2 py-1', step.status !== null && step.status >= 400 ? 'text-error' : 'text-success')}>{step.status ?? 'n/d'}</td>
                  <td className="truncate px-2 py-1 text-warning" title={step.missing.join('; ')}>{step.missing.join('; ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-text-4">
          Response → request mappings · {confirmed.length} confirmed of {proposal.mappings.length}
        </p>
        {proposal.mappings.length === 0 ? (
          <p className="px-3 pb-3 text-[11px] text-text-4">No value observed in a response reappears in a later request.</p>
        ) : (
          <table className="w-full table-fixed border-collapse text-left font-mono text-[10px]">
            <thead className="bg-surface-1 text-[9px] uppercase tracking-wider text-text-4">
              <tr>
                <th className="w-24 px-2 py-1">Confidence</th>
                <th className="w-20 px-2 py-1">Variable</th>
                <th className="w-[22%] px-2 py-1">From</th>
                <th className="w-[22%] px-2 py-1">To</th>
                <th className="px-2 py-1">Why</th>
              </tr>
            </thead>
            <tbody>
              {proposal.mappings.map((mapping) => (
                <tr key={mapping.id} className="border-t border-border-1 text-text-2">
                  <td className="px-2 py-1">
                    <span className={cn(
                      'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-sans text-[9px]',
                      mapping.confidence === 'confirmed' ? 'bg-success/12 text-success' : 'bg-warning/12 text-warning',
                    )}>
                      {mapping.confidence === 'confirmed' ? <CheckCircle2 size={9} /> : <HelpCircle size={9} />}
                      {mapping.confidence === 'confirmed' ? 'Confirmed' : 'Coincidence'}
                    </span>
                  </td>
                  <td className="truncate px-2 py-1 text-accent-light">{mapping.confidence === 'confirmed' ? `{{${mapping.variable}}}` : '—'}</td>
                  <td className="truncate px-2 py-1" title={mapping.fromPath}>{mapping.fromPath}</td>
                  <td className="truncate px-2 py-1" title={mapping.toPath}>{mapping.toPath}</td>
                  <td className="truncate px-2 py-1 text-text-4" title={mapping.reason}>{mapping.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="px-3 py-2 text-[10px] text-text-4">
          Only confirmed mappings become flow variables. Everything else is copied into the step note, unchanged.
        </p>
      </div>
    </div>
  )
}
