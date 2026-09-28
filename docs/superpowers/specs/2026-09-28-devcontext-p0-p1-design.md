# Developer Context (P0 + P1) — Design

Date: 2026-09-28 · Branch: `feat/goide-phase3` · Status: draft for review

## Why

adOmnia modules do not share a data model. Cross-panel navigation is ~12 ad-hoc
DOM `CustomEvent`s plus one parked handoff (`lib/loginspector/handoff.ts`) and
the untyped palette deep links (`COMMAND_PALETTE_DEEP_LINKS`). A route, a DB
table or a Kafka topic exists only inside its own panel, so every integration
would be point-to-point (N×N).

This sub-project builds the two foundations every later integration needs:

- **P0 — Entity router:** one typed way to say "open this thing with this intent".
- **P1 — Developer Context:** adOmnia understands the project opened in gO and
  exposes its services, datasources, env vars, contracts, routes, tables and
  topics as entities, searchable from the command palette.

Later sub-projects (not in scope here): P2 gO code lenses + env resolver,
P3 runtime correlation, P4 OTLP trace, P5 Flow nodes, P6 System view / Service
Map / contract drift / stack launcher.

## Decisions

| Topic | Decision |
|---|---|
| Context root | The **gO session** project folder. No context without an open gO project. |
| Ownership | Backend-owned (`internal/devcontext`); frontend only reads. |
| Parsing | `go/parser` (stdlib, no type-checking) for Go; `yaml.v3` (already in `go.mod`) for compose/OAS. |
| Watching | No fsnotify. Full scan on session open, per-file rescan on gO save, mtime check on window focus, manual rescan. |
| Persistence | In-memory per session. bbolt cache only if initial scan proves slow on real repos. |
| Edges | None in v1. Relations live in `Attrs` and `Sources`; a real graph arrives with runtime (P3). |
| Config side effects | Context **proposes** connections/base URLs; never creates persistent config on its own. |
| Secrets | Values of secret-looking keys never reach the frontend (mask + source only). |
| False positives | Every AST-derived entity is `inferred` and shows its `file:line`. No "ignore" state in v1. |
| Migration | Palette deep links move onto the router. Other existing `CustomEvent`s stay untouched. |

## P0 — Entity router (frontend)

Location: `frontend/src/lib/entities/`.

```ts
type EntityKind = 'route' | 'symbol' | 'service' | 'datasource' | 'envvar'
  | 'contract' | 'table' | 'topic' | 'file'

interface EntityRef {
  kind: EntityKind
  id: string                  // same id as the backend Entity
  label: string
  attrs?: Record<string, string>
  source?: { file: string; line: number }
}

registerOpener(kind, intent, { title, isDefault?, run(ref) })
actionsFor(ref): Opener[]     // intents available for this ref
openEntity(ref, intent?)      // default intent when omitted
```

- Parked request (same pattern as `handoff.ts`): if the target panel is not
  mounted, `openEntity` switches the rail and parks the ref; the panel consumes
  it on mount.
- Openers are registered once at app bootstrap from `lib/entities/openers/*.ts`.
- An opener that cannot run (missing target, e.g. no datasource for a `table`)
  shows a toast saying what is missing. Never silent.

### Openers v1

| Kind | Intent | Target |
|---|---|---|
| `route` | **send** (default) | API Client new tab: method, `{{baseUrl}}` + path, `{id}` → `{{id}}` |
| `route` | handler | gO at the handler reference `file:line` |
| `route` | mock | Mock Server endpoint for method + path |
| `service` | use as baseUrl | Proposes `baseUrl` in the active env (confirm toast) |
| `datasource` | **connect** | DB Studio / Broker Studio with prefilled, unsaved form |
| `contract` | **open** | API Docs (OAS) / gRPC (proto) / SOAP (wsdl) |
| `contract` | import | Existing collection import flow |
| `envvar` | **show** | Popover: value or mask + every source `file:line` |
| `envvar` | go to | gO at first source |
| `table` | **query** | DB Studio, `SELECT * FROM <t> LIMIT 100` on a chosen datasource |
| `topic` | **open** | Broker Studio on that topic |
| `file` / `symbol` | **open** | gO |

## P1 — Developer Context (backend)

Package: `internal/devcontext`. Binding: `devcontext_bindings.go` (thin),
service registered in `main.go`.

### Model

```go
type Entity struct {
    ID         string            `json:"id"`         // kind + stable key, e.g. "route:POST /payments/{id}"
    Kind       string            `json:"kind"`
    Label      string            `json:"label"`
    Attrs      map[string]string `json:"attrs"`      // method, path, host, port, image, module, handler…
    Sources    []Source          `json:"sources"`
    Confidence string            `json:"confidence"` // "certain" | "inferred"
}
type Source struct {
    Detector string `json:"detector"`
    File     string `json:"file"` // root-relative
    Line     int    `json:"line"`
}
type Snapshot struct {
    SessionID string    `json:"sessionId"`
    Root      string    `json:"root"`
    Version   int64     `json:"version"`
    Entities  []Entity  `json:"entities"`
    Warnings  []string  `json:"warnings"`
    ScannedAt time.Time `json:"scannedAt"`
}
```

Entities with the same ID from different detectors are merged: sources are
appended, attrs are unioned (first writer wins on conflict), confidence is
`certain` if any source is certain.

### Detectors

Each detector is a plain function over the root (full scan) or a single file
(incremental). A failing detector adds a warning and never blocks the others.
Walk limits and skipped dirs reuse the `sourcemap` rules (120k files; skip
`.git`, `vendor`, `node_modules`, build dirs).

**gomod** — every `go.mod` (and `go.work` members) → `module` attrs; dirs with
`package main` → `service` candidate (`inferred`).

**compose** — `docker-compose*.yml`, `compose*.yml`.
- Each service → `service {name, image, ports host:container}` (`certain`).
- Image prefix `postgres`, `mysql`, `mariadb`, `mongo`, `redis`,
  `bitnami/kafka` / `confluentinc/*` / `redpanda`, `rabbitmq`, `nats` →
  `datasource {type, host: localhost, port: hostPort, user, db}` from the
  service `environment:` (`POSTGRES_USER/PASSWORD/DB`, `MYSQL_*`, …).
- `${VAR}` / `${VAR:-default}` resolved against `.env`; anything else stays
  literal and marks the entity `inferred`. No `extends`, no profiles.

**dotenv** — `.env`, `.env.local`, `.env.*`; `KEY=VAL`, quotes, `export`,
comments → `envvar {name}` with source. Keys matching `PASSWORD|SECRET|TOKEN|KEY`
(case-insensitive) have their value replaced by a mask before leaving the
backend. DSN/URL-looking values (`postgres://`, `mongodb://`, `redis://`,
`amqp://`, `nats://`, Kafka broker lists) → also a `datasource`.

**contracts** — `.proto` → `contract {type: proto}`; `.wsdl` → `contract
{type: wsdl}`; yaml/json with root key `openapi:` or `swagger:` (first 4KB
sniff) → `contract {type: oas}` plus one `route` per `paths` operation
(`certain`, detector `oas`).

**goroutes** (`inferred`) — only these call shapes:
- `X.HandleFunc/Handle("GET /x/{id}", h)` — Go 1.22 ServeMux pattern.
- `X.GET/POST/PUT/PATCH/DELETE/…("/x/:id", h)` — gin / echo.
- `X.Get/Post/…("/x/{id}", h)` and `X.Method("GET", "/x", h)` — chi.
- `X.HandleFunc("/x", h).Methods("GET")` — gorilla.
- `Route("/api", func(r){…})` / `Group("/api")`: prefix concatenated only when
  it is a literal in the same function; otherwise attr `partialPrefix=true`.
- Handler argument recorded as attr `handler` (expression text) with its
  `file:line`; definition lookup is delegated to gopls on demand.
- Path normalisation: `:id` and `{id}` → `{id}`; ID `route:<METHOD> <path>` so
  code and OAS routes merge.

**goliterals** (`inferred`)
- `os.Getenv/LookupEnv("X")` and struct tags `env:"X"` / `envconfig:"X"` →
  `envvar` source.
- SQL: first string-literal (or `const`) argument of
  `Query/QueryRow/Exec/*Context/Get/Select/NamedExec` that starts with
  `SELECT|INSERT|UPDATE|DELETE|WITH` → `table` entities from a light
  `FROM|JOIN|INTO|UPDATE <ident>` regex. No SQL parser.
- Topics: literal topic/subject in sarama `ProducerMessage{Topic:}`, franz-go
  `kgo.Record{Topic:}` / `ConsumeTopics(...)`, segmentio `kafka.Writer{Topic:}` /
  `ReaderConfig{Topic:}`, amqp `Publish(exchange, key, …)`, nats
  `Publish/Subscribe(subj, …)` → `topic`. The library is identified from the
  file's imports, never from the method name alone.
- Dynamic strings (`Sprintf`, concatenation with variables) are ignored.

### Lifecycle

- `GetContext(sessionID)` returns the cached snapshot or runs the first scan.
- `RescanContext(sessionID)` forces a full scan.
- gO calls `devcontext.Invalidate(sessionID, relPath)` after `SaveDocument`
  (single-file rescan) and `Drop(sessionID)` on `CloseSession`.
- Frontend calls `CheckStale(sessionID)` on window focus (mtime comparison of
  scanned files; rescans changed ones).
- Scans run with `context.WithTimeout(30s)`; one scan per session at a time,
  a request arriving mid-scan sets a dirty flag and triggers one follow-up.
- Every snapshot change emits Wails event `devcontext:changed {sessionId, version}`.

## Frontend

- `lib/devcontext-api.ts` — wrapper over the generated bindings.
- `stores/devcontext.ts` — Zustand: snapshot per session; active session follows gO.
- Command palette:
  - **Project** group: context entities, ranked with the existing `fuzzyScore`
    over label + attrs.
  - **Symbols** group: gopls `WorkspaceSymbols` for the active session, debounced
    150ms, query ≥ 2 chars.
  - Row: kind icon, label, `file:line` subtitle, `inferred` badge.
  - `Enter` runs the default intent; `Tab` lists intents from `actionsFor`.
  - Snapshot warnings shown as one muted line at the bottom of the group.
- Shortcuts: `Ctrl+K` always opens the global palette. `Ctrl+P` opens gO Quick
  Open when gO has focus, otherwise the palette (current behaviour).
- Palette deep links re-expressed as openers; `COMMAND_PALETTE_DEEP_LINKS`
  kept as data, dispatch goes through the router.

## Testing

- Go table tests per detector on `internal/devcontext/testdata/` fixture repo:
  stdlib + chi + gin routes with groups, compose with Postgres/Kafka/Redis and
  `${VAR:-x}`, `.env` with secret keys, OAS 3 + Swagger 2, `.proto`, `.wsdl`,
  SQL and topic literals (including dynamic ones that must be ignored).
- Go tests for merge (code + OAS same route), secret masking, incremental
  rescan, timeout/coalescing.
- Vitest: router (default intent, parked request, missing-target toast),
  palette ranking with mixed entity kinds.
- Manual smoke in `wails3 task dev`: open a real Go project in gO → `Ctrl+K`
  "payment" → send route, jump to handler, connect Postgres from compose,
  open a topic.

## Tasks

- [ ] P0: `lib/entities` types, router, parked request + Vitest
- [ ] P0: palette deep links dispatched through the router
- [ ] P1: `internal/devcontext` model, merge, walk limits
- [ ] P1: detectors `gomod`, `compose`, `dotenv` (+ masking)
- [ ] P1: detector `contracts` (OAS routes, proto, wsdl)
- [ ] P1: detector `goroutes`
- [ ] P1: detector `goliterals` (getenv, SQL tables, topics)
- [ ] P1: lifecycle (cache, invalidate on save, stale check, coalescing, event)
- [ ] P1: binding + `main.go` registration + generated TS bindings
- [ ] Frontend: `devcontext-api.ts`, `stores/devcontext.ts`
- [ ] Frontend: openers v1 for all kinds in the table
- [ ] Frontend: palette Project + Symbols groups, `Tab` actions, `Ctrl+K`/`Ctrl+P`
- [ ] Docs: feature catalog, ISSUES.md, AGENTS.md (router usage for new panels)
- [ ] Manual smoke on a real project

## Out of scope

Code lenses/hover in gO, env resolver with precedence, runtime correlation,
OTLP, Service Map, Flow nodes, "ignore" for false positives, context without gO,
edges/graph, bbolt persistence of snapshots.
