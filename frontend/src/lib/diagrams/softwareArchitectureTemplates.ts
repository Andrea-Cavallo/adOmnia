import type { DiagramTemplate } from './templates'

export const SOFTWARE_ARCHITECTURE_TEMPLATES: readonly DiagramTemplate[] = [
  {
    id: 'architecture-hexagonal-checkout',
    label: 'Hexagonal checkout',
    description: 'Ports and adapters around an order domain: HTTP and worker inputs, a repository, an atomic order/outbox write and an asynchronous event relay. Blue inputs, violet domain, amber persistence, green events.',
    category: 'Patterns',
    layout: 'lanes',
    laneGap: 140,
    blueprint: {
      nodes: [
        { key: 'inbound', shape: 'swimlane', label: 'Inbound adapters', subtitle: 'transport + DTO mapping', color: 'blue' },
        { key: 'core', shape: 'swimlane', label: 'Application + domain', subtitle: 'no framework / SQL / broker', color: 'violet' },
        { key: 'persistence', shape: 'swimlane', label: 'Persistence adapter', subtitle: 'one local transaction', color: 'amber' },
        { key: 'delivery', shape: 'swimlane', label: 'Event delivery', subtitle: 'at-least-once + deduplication', color: 'green' },
        { key: 'browser', shape: 'client', label: 'Web / mobile', subtitle: 'POST /orders', color: 'blue', parent: 'inbound' },
        { key: 'http', shape: 'service', label: 'HTTP adapter', subtitle: 'DTO + idempotency key', color: 'blue', parent: 'inbound' },
        { key: 'worker', shape: 'service', label: 'Message adapter', subtitle: 'PlaceOrder command', color: 'blue', parent: 'inbound' },
        { key: 'usecase', shape: 'uml-component', label: 'PlaceOrder', subtitle: 'inbound port + use case', color: 'violet', parent: 'core' },
        { key: 'domain', shape: 'uml-component', label: 'Order aggregate', subtitle: 'invariants + domain events', color: 'violet', parent: 'core' },
        { key: 'repository', shape: 'uml-component', label: 'OrderRepository', subtitle: 'outbound port: save(order)', color: 'amber', parent: 'core' },
        { key: 'events', shape: 'uml-component', label: 'OrderEventOutbox', subtitle: 'outbound port: append(event)', color: 'green', parent: 'core' },
        { key: 'postgres', shape: 'service', label: 'Postgres adapter', subtitle: 'implements both ports', color: 'amber', parent: 'persistence' },
        { key: 'db', shape: 'database', label: 'Orders + outbox', subtitle: 'one local transaction', color: 'graphite', parent: 'persistence' },
        { key: 'relay', shape: 'service', label: 'Outbox relay', subtitle: 'poll + publish + mark', color: 'green', parent: 'delivery' },
        { key: 'topic', shape: 'kafka-topic', label: 'orders.events', subtitle: 'eventId for deduplication', color: 'green', parent: 'delivery' },
        { key: 'consumer', shape: 'service', label: 'Fulfillment', subtitle: 'idempotent consumer', color: 'green', parent: 'delivery' },
      ],
      links: [
        { from: 'browser', to: 'http', label: 'HTTPS', flow: true, color: 'blue' },
        { from: 'http', to: 'usecase', label: 'PlaceOrder(command)', color: 'blue' },
        { from: 'worker', to: 'usecase', label: 'same inbound port', color: 'blue' },
        { from: 'usecase', to: 'domain', label: 'validate + decide', color: 'violet' },
        { from: 'usecase', to: 'repository', color: 'amber' },
        { from: 'usecase', to: 'events', color: 'green' },
        { from: 'repository', to: 'postgres', label: 'implemented by', dashed: true, color: 'amber' },
        { from: 'events', to: 'postgres', label: 'implemented by', dashed: true, color: 'green' },
        { from: 'postgres', to: 'db', label: 'order + event + key', color: 'amber' },
        { from: 'db', to: 'relay', label: 'unpublished rows', dashed: true, color: 'green' },
        { from: 'relay', to: 'topic', label: 'at-least-once delivery', flow: true, color: 'green' },
        { from: 'topic', to: 'consumer', label: 'OrderPlaced(eventId)', flow: true, color: 'green' },
      ],
    },
  },
  {
    id: 'sequence-hexagonal-checkout',
    label: 'Hexagonal checkout · sequence',
    description: 'Idempotent order creation through ports and adapters: domain rejection, atomic order/outbox commit, database failure and broker retry after commit.',
    category: 'Sequence',
    sequence: `sequenceDiagram
autonumber
actor C as Client
participant H as HTTP adapter
participant U as PlaceOrder
participant D as Order domain
participant R as Postgres adapter
participant DB as Orders + outbox
participant W as Outbox relay
participant B as orders.events
rect blue
  C->>H: POST /orders + Idempotency-Key
  H->>U: PlaceOrder(validated DTO, key)
  U->>R: begin + claim unique key
  R->>DB: BEGIN; claim key (INSERT ON CONFLICT)
end
alt key already completed
  R->>DB: ROLLBACK; read the stored result
  DB-->>R: stored response
  R-->>U: existing order
  U-->>H: replay stored result
  H-->>C: 201 Created (same order)
else matching key is still in progress
  R->>DB: ROLLBACK
  R-->>U: operation in progress
  U-->>H: retry later with the same key
  H-->>C: 409 + Retry-After
else new request owns the key
  DB-->>R: key claimed
  R-->>U: transaction ready
  rect violet
    U->>D: createOrder(items, quantities)
    D->>D: check order invariants
  end
  alt domain rejects the order
    rect red
      D-->>U: invalid quantity / empty order
      U->>R: rollback key claim
      R->>DB: ROLLBACK
      U-->>H: domain validation failed
      H-->>C: 422 validation error
    end
  else domain accepts the order
    D-->>U: order + OrderPlaced(eventId)
    rect amber
      U->>R: save order + append event
      R->>DB: INSERT orders + outbox in same transaction
    end
    alt write and commit succeed
      rect green
        R->>DB: store response for key; COMMIT
        DB-->>R: committed
        R-->>U: order persisted
        U-->>H: created order
        H-->>C: 201 Created
      end
    else write fails before commit
      rect red
        DB-->>R: write error
        R->>DB: ROLLBACK
        R-->>U: persistence failed
        U-->>H: unavailable
        H-->>C: 503; retry with the same key
      end
    end
  end
end
opt transaction committed; event not yet published
  loop polling cycles until broker acknowledgement
    W->>DB: claim unpublished outbox row
    DB-->>W: OrderPlaced + stable eventId
    W-)B: publish OrderPlaced(eventId)
    alt broker acknowledges
      rect green
        B-->>W: acknowledged
        W->>DB: mark event published
      end
    else broker unavailable or acknowledgement lost
      rect amber
        W->>W: keep row pending; retry with backoff
      end
    end
  end
end`,
  },
  {
    id: 'architecture-resilient-cache',
    label: 'Resilient catalog · cache-aside',
    description: 'A cache-aside catalog with local request coalescing, a circuit breaker, a retained stale window and an authoritative origin. Green hits, amber refresh, red degradation, violet telemetry.',
    category: 'Patterns',
    blueprint: {
      nodes: [
        { key: 'client', shape: 'client', label: 'Web / mobile', subtitle: 'GET /catalog/:id', color: 'blue' },
        { key: 'service', shape: 'boundary', label: 'Catalog service', subtitle: 'one process / replica', color: 'blue' },
        { key: 'api', shape: 'service', label: 'Catalog API', subtitle: 'freshness + response policy', color: 'blue', parent: 'service' },
        { key: 'flight', shape: 'uml-component', label: 'Single-flight gate', subtitle: 'one refresh per key / process', color: 'amber', parent: 'service' },
        { key: 'breaker', shape: 'uml-component', label: 'Circuit breaker', subtitle: 'timeout + recovery probe', color: 'red', parent: 'service' },
        { key: 'cache', shape: 'cache', label: 'Redis cache', subtitle: 'freshUntil + hard expiry', color: 'green' },
        { key: 'origin', shape: 'service', label: 'Catalog origin', subtitle: 'authoritative service', color: 'amber' },
        { key: 'db', shape: 'database', label: 'Catalog DB', subtitle: 'source of truth', color: 'graphite' },
        { key: 'fallback', shape: 'process', label: 'Degraded response', subtitle: 'retained stale value or 503', color: 'red' },
        { key: 'telemetry', shape: 'service', label: 'Metrics + traces', subtitle: 'hit ratio / age / timeouts', color: 'violet' },
      ],
      links: [
        { from: 'client', to: 'api', label: 'concurrent reads', flow: true, color: 'blue' },
        { from: 'api', to: 'cache', label: 'GET + freshness check', color: 'green' },
        { from: 'api', to: 'flight', label: 'miss / stale', color: 'amber' },
        { from: 'flight', to: 'breaker', label: 'leader', color: 'amber' },
        { from: 'breaker', to: 'origin', label: 'bounded origin read', flow: true, color: 'amber' },
        { from: 'origin', to: 'db', label: 'SELECT item', color: 'graphite' },
        { from: 'flight', to: 'cache', label: 'SET value + jittered TTL', color: 'green' },
        { from: 'breaker', to: 'fallback', label: 'open / timeout', dashed: true, color: 'red' },
        { from: 'fallback', to: 'api', label: 'explicit freshness status', dashed: true, color: 'red' },
        { from: 'api', to: 'telemetry', label: 'cache outcome', dashed: true, color: 'violet' },
        { from: 'breaker', to: 'telemetry', label: 'state + latency', dashed: true, color: 'violet' },
      ],
    },
  },
  {
    id: 'sequence-resilient-cache',
    label: 'Resilient catalog · sequence',
    description: 'Fresh hit, concurrent misses joining one local refresh, origin timeout, stale fallback, hard-expired data rejection and a half-open recovery probe.',
    category: 'Sequence',
    sequence: `sequenceDiagram
autonumber
actor A as Reader A
actor B as Reader B
participant API as Catalog API
participant C as Redis cache
participant F as Single-flight gate
participant CB as Circuit breaker
participant O as Catalog origin
participant M as Metrics + traces
loop request waves for the same catalog key
rect blue
  A->>API: GET /catalog/42
  API->>C: GET item + freshUntil + hard expiry
  C-->>API: cached entry or miss
end
alt cached entry is fresh
  rect green
    API-->>A: 200 fresh cached value
    API-)M: cache.hit + entry age
  end
else cache miss or retained stale entry
  rect amber
    API->>F: join refresh(42)
    B->>API: concurrent GET /catalog/42
    API->>C: GET item + freshness
    C-->>API: same miss / stale entry
    API->>F: join refresh(42); await same result
  end
  F->>CB: leader: permit origin read?
  alt breaker permits a call
    CB->>O: GET /catalog/42 with deadline
    alt origin responds within deadline
      rect green
        O-->>CB: authoritative item
        CB-->>F: success; close breaker
        F->>C: SET item + freshUntil + jittered hard expiry
        F-->>API: resolve both waiting requests
        API-->>A: 200 refreshed value
        API-->>B: 200 same refreshed value
      end
    else origin times out or fails
      rect red
        O-->>CB: deadline / upstream error
        CB->>CB: count failure; open at threshold
        CB-->>F: refresh failed
        F-->>API: resolve waiters with failure
        alt retained entry is still within stale window
          rect amber
            API-->>A: 200 retained value + stale status
            API-->>B: 200 retained value + stale status
          end
        else no retained entry or hard expiry reached
          API-->>A: 503 + Retry-After
          API-->>B: 503 + Retry-After
        end
      end
    end
  else breaker already open
    rect red
      CB-->>F: fail fast; no origin request
      F-->>API: unavailable; use the same stale/503 policy
      API-->>A: retained value or 503
      API-->>B: retained value or 503
    end
  end
  API-)M: hit/miss, stale age, waiters and outcome
end
end
opt open breaker cooldown elapsed; a later request arrives
  rect violet
    API->>F: refresh(42)
    F->>CB: request half-open probe
    CB->>O: one bounded recovery probe
    alt origin recovered
      O-->>CB: authoritative item
      CB-->>F: close breaker; refresh succeeds
      F->>C: replace retained entry + freshness metadata
    else probe failed
      O-->>CB: error / timeout
      CB->>CB: reopen; restart cooldown
    end
    CB-)M: circuit transition + probe outcome
  end
end`,
  },
]
