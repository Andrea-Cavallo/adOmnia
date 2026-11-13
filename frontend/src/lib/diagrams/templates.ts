/**
 * Starting points: each is a blueprint, laid out by ELK when it is created. One worked example is
 * enough to show what a finished diagram looks like; the rest is drawn from the shape library.
 */
import type { DiagramBlueprint } from './blueprint'

export interface DiagramTemplate {
  id: string
  label: string
  description: string
  blueprint: DiagramBlueprint
}

export const DIAGRAM_TEMPLATES: readonly DiagramTemplate[] = [
  {
    id: 'saga',
    label: 'Saga (orchestrated)',
    description: 'An orchestrator runs three local transactions in order and compensates backwards on failure.',
    blueprint: {
      nodes: [
        { key: 'start', shape: 'terminator', label: 'Place order', color: 'green' },
        { key: 'orchestrator', shape: 'saga-orchestrator', label: 'Order saga', subtitle: 'orchestrator', color: 'violet' },
        { key: 'reserve', shape: 'saga-step', label: 'Reserve stock', subtitle: 'inventory-service', color: 'blue' },
        { key: 'charge', shape: 'saga-step', label: 'Charge card', subtitle: 'payment-service', color: 'blue' },
        { key: 'ship', shape: 'saga-step', label: 'Ship order', subtitle: 'shipping-service', color: 'blue' },
        { key: 'log', shape: 'database', label: 'saga log', subtitle: 'state · outbox', color: 'graphite' },
        { key: 'refund', shape: 'saga-step', label: 'Refund card', subtitle: 'compensation', color: 'amber' },
        { key: 'release', shape: 'saga-step', label: 'Release stock', subtitle: 'compensation', color: 'amber' },
        { key: 'ok', shape: 'event', label: 'OrderCompleted', color: 'green' },
        { key: 'failed', shape: 'event', label: 'OrderRejected', color: 'red' },
      ],
      links: [
        { from: 'start', to: 'orchestrator', flow: true, color: 'green' },
        { from: 'orchestrator', to: 'reserve', label: '1 · reserve', flow: true, color: 'blue' },
        { from: 'orchestrator', to: 'charge', label: '2 · charge', flow: true, color: 'blue' },
        { from: 'orchestrator', to: 'ship', label: '3 · ship', flow: true, color: 'blue' },
        { from: 'orchestrator', to: 'log', label: 'persist state', color: 'graphite' },
        { from: 'ship', to: 'ok', label: 'success', color: 'green' },
        { from: 'ship', to: 'refund', label: 'shipping failed', dashed: true, color: 'red' },
        { from: 'charge', to: 'release', label: 'payment failed', dashed: true, color: 'red' },
        { from: 'refund', to: 'release', label: 'then', dashed: true, color: 'amber' },
        { from: 'release', to: 'failed', label: 'rejected', color: 'red' },
      ],
    },
  },
]
