/**
 * Starting points: each is a blueprint, laid out by ELK when it is created. One worked example is
 * enough to show what a finished diagram looks like; the rest is drawn from the shape library.
 *
 * The set is curated, not a catalogue: each preset has to show a capability that is otherwise
 * invisible (containers, swimlanes, messaging, the debug loop). Adding a variant that only renames
 * the shapes makes the New menu harder to read. `templates.test.ts` builds every one of them.
 */
import type { DiagramBlueprint } from './blueprint'
import type { LayoutDirection } from './layout'

export interface DiagramTemplate {
  id: string
  label: string
  description: string
  /** Group heading in the New menu. */
  category: string
  /** A blueprint laid out by ELK, or a sequence diagram written as text (sequence.ts). */
  blueprint?: DiagramBlueprint
  sequence?: string
  /** Layout of a blueprint; left to right unless the diagram reads better stacked, or 'lanes' for swimlanes. */
  layout?: LayoutDirection | 'lanes'
}

export const DIAGRAM_TEMPLATES: readonly DiagramTemplate[] = [
  // Sequence
  {
    id: 'sequence-debug-request',
    label: 'Debug request · sequence',
    description: 'The adOmnia loop: the API client sends the request, the IDE starts the service under Delve, the breakpoint stops it, SQL and the event are captured.',
    category: 'Sequence',
    sequence: `sequenceDiagram
autonumber
actor Dev as Developer
participant API as API Workspace
participant IDE as Code Studio
participant SVC as Order Service
participant DB as Orders DB
participant MQ as orders topic
Dev->>API: Debug Request on POST /orders
API->>IDE: start the service and wait for the port
IDE->>SVC: dlv debug
SVC-->>IDE: listening on :8080
IDE-->>API: ready
rect blue
  API->>SVC: POST /orders
  SVC->>SVC: breakpoint · CreateOrder
  SVC->>DB: INSERT INTO orders
  DB-->>SVC: id 42
  SVC-)MQ: OrderPlaced
end
SVC-->>API: 201 Created
API-->>Dev: 201 · 42 ms · tests green
opt request capture enabled
  IDE->>IDE: attach SQL and the event to this request
end`,
  },
  {
    id: 'sequence-kafka-retry',
    label: 'Kafka retry and DLQ · sequence',
    description: 'A consumer fails: retries with backoff on a retry topic, then parks the event in the dead-letter queue and alerts.',
    category: 'Sequence',
    sequence: `sequenceDiagram
autonumber
participant O as Order Service
participant T as orders topic
participant C as Billing Consumer
participant R as orders.retry
participant D as orders.dlq
O-)T: OrderPlaced
T-)C: OrderPlaced
C->>C: charge the card
alt card accepted
  C-)T: PaymentSettled
  C->>C: commit offset
else transient failure
  rect amber
    loop attempts 2 and 3 with backoff
      C-)R: republish with backoff
      R-)C: redelivery
      C->>C: charge again
    end
  end
  rect red
    C-)D: park the event
    C->>C: alert the team
  end
end`,
  },
  {
    id: 'sequence-saga',
    label: 'Saga (orchestrated) · sequence',
    description: 'The orchestrated Saga as a UML sequence: forward steps in blue, success in green, the failure in red and the compensations in amber.',
    category: 'Sequence',
    sequence: `sequenceDiagram
autonumber
actor C as Client
participant O as Order Service
participant S as Saga Orchestrator
participant I as Inventory Service
participant P as Payment Service
participant H as Shipping Service
C->>O: POST /orders
O->>S: start OrderSaga(orderId)
S->>S: saga log: STARTED
O-->>C: 202 Accepted
rect rgb(76, 143, 214)
  S->>I: ReserveStock
  I-->>S: StockReserved
  S->>P: ChargeCard
  P-->>S: CardCharged
  S->>H: ScheduleShipment
end
alt shipment scheduled
  rect rgb(63, 185, 107)
    H-->>S: ShipmentScheduled
    S->>S: saga log: COMPLETED
    S-)O: OrderCompleted
  end
else shipping failed
  rect rgb(214, 90, 90)
    H-->>S: ShipmentFailed
  end
  rect rgb(212, 160, 58)
    S->>P: RefundCard (compensate)
    P-->>S: CardRefunded
    S->>I: ReleaseStock (compensate)
    I-->>S: StockReleased
    S->>S: saga log: COMPENSATED
    S-)O: OrderRejected
  end
end
O-)C: order status notification`,
  },
  {
    id: 'sequence-registration',
    label: 'Sequence (registration and login)',
    description: 'A UML sequence diagram: lifelines, sync calls, replies, activation bars and an alt fragment.',
    category: 'Sequence',
    sequence: `sequenceDiagram
autonumber
actor User
participant Admin as Administrator
participant Register
participant Login as Log in
participant Interface
participant DB as Database user
User->>Register: Register(), enter registration information
Register->>Interface: Submit registration information
Interface->>DB: Connect to the database
DB->>DB: Repetition verification
alt username already taken
  DB-->>User: Username duplicated, registration failed
else new username
  DB->>Admin: Check the credit voucher
  Admin-->>DB: Inspection passed
  DB-->>User: Registration succeeded, return to the login page
end
User->>Login: Log in(), enter login information
Login->>Interface: Submit login information
Interface->>DB: Connect to the database
DB->>DB: Verification
alt wrong credentials
  DB-->>User: Verification failed, wrong username or password
else valid
  DB-->>User: Login succeeded, return to the first page
end`,
  },

  // Architecture
  {
    id: 'architecture-platform',
    label: 'Service platform',
    description: 'Gateway, two services inside a backend boundary, a shared database, a cache, an event bus and an external SOAP system.',
    category: 'Architecture',
    blueprint: {
      nodes: [
        { key: 'web', shape: 'client', label: 'Web app', subtitle: 'React', color: 'violet' },
        { key: 'edge', shape: 'gateway', label: 'API gateway', subtitle: 'mTLS', color: 'graphite' },
        { key: 'backend', shape: 'boundary', label: 'Backend', subtitle: 'Kubernetes', color: 'graphite' },
        { key: 'orders', shape: 'go-service', label: 'Order service', subtitle: 'Go · net/http', color: 'blue', parent: 'backend' },
        { key: 'payments', shape: 'java-service', label: 'Payment service', subtitle: 'Java · Spring', color: 'amber', parent: 'backend' },
        { key: 'orders-db', shape: 'database', label: 'Orders DB', subtitle: 'PostgreSQL', color: 'graphite' },
        { key: 'session', shape: 'cache', label: 'Session cache', subtitle: 'Redis', color: 'graphite' },
        { key: 'topic', shape: 'kafka-topic', label: 'orders', subtitle: 'topic', color: 'green' },
        { key: 'bank', shape: 'soap-endpoint', label: 'Bank', subtitle: 'WSDL · WS-Security', color: 'red' },
      ],
      links: [
        { from: 'web', to: 'edge', label: 'HTTPS', flow: true, color: 'blue' },
        { from: 'edge', to: 'orders', label: 'POST /orders', flow: true, color: 'blue' },
        { from: 'edge', to: 'payments', label: 'POST /payments' },
        { from: 'orders', to: 'orders-db', label: 'SQL' },
        { from: 'orders', to: 'session', label: 'cache-aside', dashed: true },
        { from: 'orders', to: 'topic', label: 'OrderPlaced', flow: true, color: 'green' },
        { from: 'topic', to: 'payments', label: 'consume', flow: true, color: 'green' },
        { from: 'payments', to: 'bank', label: 'charge', color: 'amber' },
      ],
    },
  },
  {
    id: 'swimlane-request',
    label: 'Request across layers · swimlanes',
    description: 'One POST /orders seen by each layer: client, edge, service, database and event-bus lanes, with the commit and the reply.',
    category: 'Architecture',
    layout: 'lanes',
    blueprint: {
      nodes: [
        { key: 'client-lane', shape: 'swimlane', label: 'Client' },
        { key: 'edge-lane', shape: 'swimlane', label: 'Edge' },
        { key: 'service-lane', shape: 'swimlane', label: 'Order service' },
        { key: 'db-lane', shape: 'swimlane', label: 'Database' },
        { key: 'bus-lane', shape: 'swimlane', label: 'Event bus' },
        { key: 'place', shape: 'terminator', label: 'Place order', color: 'violet', parent: 'client-lane' },
        { key: 'show', shape: 'terminator', label: '201 Created', color: 'violet', parent: 'client-lane' },
        { key: 'post', shape: 'rest-endpoint', label: 'POST /orders', subtitle: 'HTTP', color: 'blue', parent: 'edge-lane' },
        { key: 'jwt', shape: 'process', label: 'Validate JWT', color: 'blue', parent: 'edge-lane' },
        { key: 'route', shape: 'process', label: 'Route to handler', color: 'blue', parent: 'edge-lane' },
        { key: 'create', shape: 'process', label: 'CreateOrder', color: 'green', parent: 'service-lane' },
        { key: 'insert', shape: 'process', label: 'INSERT order', color: 'green', parent: 'service-lane' },
        { key: 'table', shape: 'stored-data', label: 'orders table', color: 'graphite', parent: 'db-lane' },
        { key: 'commit', shape: 'process', label: 'COMMIT', color: 'graphite', parent: 'db-lane' },
        { key: 'publish', shape: 'event', label: 'OrderPlaced', color: 'green', parent: 'bus-lane' },
      ],
      links: [
        { from: 'place', to: 'post', flow: true, color: 'violet' },
        { from: 'post', to: 'jwt' },
        { from: 'jwt', to: 'route' },
        { from: 'route', to: 'create', flow: true, color: 'blue' },
        { from: 'create', to: 'insert' },
        { from: 'insert', to: 'table', label: 'SQL' },
        { from: 'table', to: 'commit', label: 'commit', dashed: true },
        { from: 'insert', to: 'publish', label: 'OrderPlaced', flow: true, color: 'green' },
        { from: 'publish', to: 'show', label: 'reply', flow: true, color: 'green' },
      ],
    },
  },

  // Patterns
  {
    id: 'saga',
    label: 'Saga (orchestrated)',
    description: 'An orchestrator runs three local transactions in order and compensates backwards on failure.',
    category: 'Patterns',
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

/** The order the New menu reads: the worked example first, then the sequences, then the architectures. */
const CATEGORY_ORDER = ['Patterns', 'Sequence', 'Architecture']

/** The templates of the New menu, grouped in menu order; a category missing from the order list goes last. */
export function templatesByCategory(): Array<{ category: string; templates: DiagramTemplate[] }> {
  const groups: Array<{ category: string; templates: DiagramTemplate[] }> = []
  for (const template of DIAGRAM_TEMPLATES) {
    const group = groups.find((candidate) => candidate.category === template.category)
    if (group) group.templates.push(template)
    else groups.push({ category: template.category, templates: [template] })
  }
  const rank = (category: string) => {
    const index = CATEGORY_ORDER.indexOf(category)
    return index === -1 ? CATEGORY_ORDER.length : index
  }
  return groups.sort((a, b) => rank(a.category) - rank(b.category))
}
