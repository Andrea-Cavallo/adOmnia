# Live Development Session

A Go service started from Go Studio (Run or Debug) becomes a **live
session** that every adOmnia tool sees: the API Workspace, the Log
Inspector, Database Studio, Broker Studio, the Interceptor and Browser
Debug. The developer works on `users-service`, not on "the IDE" and "the
API client".

```text
code → running service → API request → breakpoint → code → response
```

## What you get

| Where | What |
|---|---|
| **Debug bar** (bottom, every tool except Go Studio) | Service, port, state, paused `file:line`, Continue / Step Over / Step Into / Step Out / Stop, the request in flight, split view, service drawer. Keys: F9 continue, F8 step over, F7 step into, Shift+F8 step out, Ctrl+F2 stop. |
| **Debug Request** (next to Send) | One click: finds the service or starts the active Debug configuration of its Go Studio project, waits until its port (and optional health path) answers, sends the request and follows it. Progress is shown in the response area. |
| **PAUSED AT BREAKPOINT** (response area) | Location, a request ──●── response line, Open in Go Studio, Continue, Step Over, Step Into, Split view, Replay, Stop. The response waits for the debugger; the request timeout is lifted to 30 minutes under Delve. |
| **Response tabs** | Response · Logs · Debug · Timeline · DB · Kafka, and a completion summary: status, time, code path, queries, events, log lines, breakpoints hit, *Mock this response*. |
| **Request strip** (under the URL bar) | Target of a linked request (Local run / Docker / remote), the Go handler that serves it with *Open handler*, and a warning when the route is missing from the service's OpenAPI. |
| **Go Studio debugger → Request tab** | Method, path and query parameters, headers (credentials masked), body, request id; *Open full request*. |
| **Handler CodeLens** (Go Studio) | On `func UpdateUser(...)`: open the linked request, Run, Debug request, Last response, History. |
| **Split Debug View** | Go Studio and the API request side by side. Opens by itself when a request sent from the API Workspace stops at a breakpoint (can be turned off); the pane you click owns the keyboard. |
| **Context switcher** (Ctrl+Tab) | Hold Ctrl, Tab through the elements of the current flow: code at the breakpoint, the request, its SQL, its Kafka message, the logs. Release to jump. |
| **Tool keys** | Alt+Shift+1 Go Studio · 2 API Workspace · 3 Database · 4 Broker Studio · 5 service logs (Log Inspector without a live service). Alt+digit stays with Go Studio's panes. |
| **Service drawer** | Logs (filter, "only lines tied to requests", open in the Log Inspector as a live source) and the service view: Go project, REST routes, runtime and target, databases (SQL capture), Kafka (watch), logs, debugger, preferences. |
| **Command palette** | Debug this request, Go to handler / current request / current breakpoint / service / logs, Open Split Debug View, Continue, Step…, Stop. |

Go Studio and the API Workspace stay mounted once opened: switching tools
keeps open files, cursor, expanded variables, tabs and scroll.

## Linked requests

`{{service:users-service}}/users/123` targets the service, not a port. The
local target follows the live session when its port changes; the service
view can point it at a Docker Compose port or a remote URL (DEV). *Link to
service* in the request strip rewrites a `localhost:PORT` URL for you.

The service name defaults to the project folder; rename it in the service
drawer (saved per project folder).

## How a request is tied to what the service does

Every request sent to a live service gets a **request run** and, unless
turned off in the service view, the header `X-AdOmnia-Request-ID`.

| Evidence | Match |
|---|---|
| A log line, SQL statement or Kafka header that carries the request id | **id** — certain |
| Something that happened while the request was in flight (or up to 1 s after its response) | **time** — a guess, labelled as such |
| A breakpoint hit with one request in flight | *likely* |
| A breakpoint hit with several requests in flight | *probable*, given to the newest |

Requests forwarded by the Interceptor to a live service carry the header
too; requests of a page under Browser Debug are tracked by time.

## Ports

In order: the `PORT` the run configuration injected, an address the service
prints (`listening on :8080`, `http://localhost:8080`, `addr=[::]:8443`), a
listening socket that appeared after the start and does not belong to
tooling (dlv, gopls, go). Click the port in the debug bar to set it by hand.

## SQL and Kafka

* **SQL from logs** — statements printed by the service (GORM, sqlx, pgx and
  most query loggers) are picked up with no setup.
* **SQL capture** (opt-in) — a loopback proxy for Postgres or MySQL. Point
  the service's database address at the proxy and restart it. Bytes are
  forwarded unchanged; startup and auth packets are never parsed or stored.
  TLS to the database is refused through the proxy (SSLRequest answered `N`,
  MySQL `CLIENT_SSL` cleared), so a service that *requires* TLS fails to
  connect through it.
* **Kafka watch** (opt-in) — partition consumers from the newest offset,
  **no consumer group**: offsets of real groups never move. Plaintext
  brokers only.

Queries open in Database Studio (never executed) and messages open their
topic in Broker Studio; both keep an *Open request* way back.

## Architecture

```text
Go Studio (internal/goide) ── events ──┐
Interceptor (internal/proxy) ─ observer ┤
Browser Debug (internal/browser) ───────┤
                                        ▼
                     internal/devsession.Manager  (single owner)
                     sessions · request runs · logs · queries · messages
                                        │  "devsession:event"
                                        ▼
                     stores/devSession (Zustand, loaded after first frame)
          Debug bar · API Workspace · Go Studio Request tab · drawers
```

* `internal/devsession` has no dependency on Go Studio: the root binding
  (`devsession_bindings.go`) translates gO events and passes debugger
  operations as plain functions.
* Events: `service.started|updated|stopped`, `debug.started|paused|resumed|stopped`,
  `request.started|updated|completed`, `breakpoint.hit`, `log.received`,
  `database.query`, `kafka.produced`.
* Nothing is persisted except preferences (targets, health paths, known
  services, toggles in `localStorage` `adomnia.devsession`) and declared
  service names (bbolt `devsession/services`). Logs are a 5000-line ring per
  session.
* The API Workspace never imports Go Studio statically; Go Studio is mounted
  hidden only when Debug Request has to start a service.

## Limits

* Correlation without the request id is by time; with concurrent requests a
  breakpoint is attributed to the newest one.
* The timeline is built from breakpoint stacks, SQL, messages and error
  logs; without breakpoints it shows only what those sources saw. There is
  no OTLP receiver yet.
* "Stop only on this request" (a breakpoint condition on the request id) is
  not offered: it would rewrite the user's breakpoints on every send.
* The Interceptor keeps its own 30 s upstream timeout, also for a paused
  request.
