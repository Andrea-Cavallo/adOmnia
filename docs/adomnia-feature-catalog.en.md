# adOmnia — Feature Catalog

**adOmnia** is a local-first desktop API Development Toolbox built with Go (Wails 3) + React 19 (TypeScript), with an integrated Code Studio (IDE).  
All features are offline-first: no account, no telemetry, and no data sent outside the machine.

---

## MACRO-CATEGORY INDEX

### Navigation interactions (v0.9.25)

- Single-click requests open a replaceable preview; double-click, editing, pinning or sending keeps the tab. F2/context menu renames tree items.
- Ctrl/Cmd-click toggles requests, Shift-click selects a visible range. Drag selected requests together in visual order, with a labelled ghost and before/after/inside indicators. Invalid nested moves are rejected.
- Hover folders for 550 ms to expand; drag near tree edges to scroll. Drop requests on the tab strip to open them at that position, or onto an empty workspace to open them.
- Tree moves show an Undo action. Undo is refused if the affected collections have subsequently changed, so newer edits are never overwritten.
- Returning to the API panel preserves tree expansion, query, focus and scroll per workspace for the current app session. Existing tab view-state preservation remains in place.
- Rail icons directly open their category's last-used visible tool; the small arrow, right-click or ArrowRight opens the complete category menu. Since v0.9.26, hovering for 220 ms also opens it; it stays open after pointer exit or item selection until closed with X/Escape, an outside click or another category. Icons have a plain background and a larger side marker; Send/Record use flat skin-token colors.
- Compatibility: tab `preview` is optional (old tabs remain permanent); no workspace schema migration. `adomnia.railQuick.v1` is an optional localStorage preference, ignored safely if malformed; tree navigation state stays in memory. No network services or telemetry added.

| # | Category | Sections | Features |
|---|-----------|---------|-------------|
| A | [API Core](#a-api-core) | HTTP Client, Authentication, Assertions, Runner, Flows, Test Data, Visual Tests, Contract Validation | ~73 |
| B | [Protocols & Streaming](#b-protocols--streaming) | gRPC, SOAP, WebSocket, SSE, Broker Studio | ~65 |
| C | [Infrastructure & Simulation](#c-infrastructure--simulation) | Mock Server (+ Smart Mock), Proxy/Interceptor, Docker Lab, Load Testing | ~47 |
| D | [Debugging & Analysis](#d-debugging--analysis) | Browser Debug (+ Discovery), HAR Viewer, Network Tools, JSON Tools, XML Tools, Power Tools, Dev Logs, Observability, Secret Scanner, PDF Editor | ~110 |
| E | [Local Data](#e-local-data) | Database Studio, Storage Inspector, Workspace, Vault, Document Studio | ~62 |
| F | [Customization & Extensibility](#f-customization--extensibility) | Themes, JavaScript plugins, Template | ~51 |
| G | [Platform](#g-platform) | Settings, Infrastructure, UI Framework | ~76 |
| H | [API Design](#h-api-design) | OpenAPI Import/Export, Schema Components, Visual OpenAPI Editor | ~10 |
| I | [MCP (Model Context Protocol)](#i-mcp-model-context-protocol) | Server Generator, Agent Integration | ~12 |
| J | [Code Studio (IDE)](#j-code-studio-ide) | Projects & Windows, Editor & gopls, Lint & AI, Run/Test/Debug, Toolchain, Git & Integration, Java/Spring/JVM | ~43 |
| K | [Security Intelligence](#k-security-intelligence) | CVE Intelligence Engine, Risk-based prioritisation, Reachability, Maven & Go Analyzers, Remediation, SBOM & Export, Security Center | ~13 |

---

## A. API CORE

### A1. HTTP Client & Collections

| # | Feature | Description |
|---|-------------|-------------|
| A1.1 | **Request Composer** | Full HTTP builder: method selector (GET, QUERY, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, CONNECT, TRACE), URL bar with variable highlighting, Send / Save / Load-Test buttons. |
| A1.2 | **Query Parameters** | Key-value editor with enable/disable toggles, row add/remove, and variable substitution `{{var}}`. |
| A1.3 | **HTTP Headers** | Key-value editor with toggles, common header suggestions, and variable substitution. A per-row generate action recognizes Request-ID, Correlation-ID and Idempotency/Idempotence-Key (including X- prefixes) for local UUID v7 generation; Timestamp, Request-Timestamp and Webhook-Timestamp support Unix seconds/milliseconds or ISO UTC, and Date generates HTTP-date. Values change only on explicit click and remain editable. |
| A1.4 | **Body Editor — Raw** | Multi-type editor: JSON, XML, Text, HTML, JavaScript with syntax highlighting and multiple body variants per request. The JSON colors menu customizes keys, strings, numbers, array/object brackets, booleans and null, with per-category and full theme reset. Optional local appearance overrides are stored separately for dark/light modes; absent keys inherit the theme, so existing settings/workspaces require no migration. |
| A1.5 | **Body Editor — Form** | URL-Encoded and multipart Form Data with a key-value pair editor. |
| A1.6 | **Body Editor — GraphQL** | GraphQL query editor with a separate variables editor. |
| A1.7 | **Pre/Post Request Scripts** | Pre-request and post-response script editor with `pm.*` Postman-compatible API. |
| A1.8 | **Response Viewer** | Colored status badge, size/time metrics, JSON body with syntax highlighting and expandable tokens, raw view, headers view, copy to clipboard. |
| A1.8b | **Idle Copy** | The empty response panel rotates 20 title/subtitle pairs, a different one on each mount, remembered in `adomnia.apiPhrase.v1` so two consecutive visits never repeat it. |
| A1.9 | **Response History** | Navigate previous responses per tab, with a configurable maximum count. |
| A1.10 | **Code Generation** | Equivalent snippets in 13 languages using resolved URL/body and effective auth headers, including AWS Signature v4 calculated when copying. |
| A1.11 | **cURL Import** | cURL command parser: extracts method, URL, headers, body, and auth (Bearer, Basic). |
| A1.12 | **Collections Tree** | Hierarchical organization of folders/requests, search, CRUD context menus, collection colors. |
| A1.13 | **Drag & Drop Reordering** | Reorder requests and folders by dragging them in the tree. |
| A1.13b | **Drag & Drop Import** | Drag a file anywhere in the window: `.json`/`.yaml`/`.adomnia` import collections or workspaces, `.har` opens HAR Viewer, `.wsdl` opens SOAP Studio, and `.class` opens Class File Inspector. Visual overlay + toast feedback. |
| A1.14 | **Tab Management** | Multi-tab navigation, dirty-state indicator, close/close others/close all, pinning, tab reordering. |
| A1.15 | **Variable Substitution** | Resolves `{{variableName}}` from the active environment in URL, headers, params, body, and auth before every request. |
| A1.16 | **Variable Highlight Input** | The URL field visually highlights inline `{{variable}}` patterns. |
| A1.17 | **Timeout & Redirect** | Configurable per-request timeout, follow/block redirect toggle, configurable max redirects. |
| A1.18 | **adOmnia Lab Demo Workspace** | Preloaded demo workspace with sample collections and environments. |
| A1.19 | **Request Notes** | Notes tab for persisted multi-line request documentation; preserves descriptions through OpenAPI and Postman import/export. |

---

### A2. Authentication

| # | Feature | Description |
|---|-------------|-------------|
| A2.1 | **No Auth** | Request without authentication (default). |
| A2.2 | **Bearer Token** | `Authorization: Bearer <token>` header. |
| A2.3 | **Basic Auth** | HTTP Basic with username/password and automatic Base64 encoding. |
| A2.4 | **API Key (Header/Query)** | Authentication via custom header or query parameter. |
| A2.5 | **OAuth 2.0** | Client credentials/password/refresh and Authorization Code + PKCE: opens the system browser, generates challenge/state, captures the local loopback callback, and exchanges the code without copy/paste. |
| A2.6 | **AWS Signature v4** | AWS4 signing: access key, secret key, region, service, optional session token. |
| A2.7 | **Digest Auth** | HTTP Digest with challenge-response. |

---

### A3. Assertions Editor

| # | Feature | Description |
|---|-------------|-------------|
| A3.1 | **Assertion Target** | Choose what to assert on: Status Code, Response Time, Header, Body Text, JSON Path, Array Length, XML Path, Content-Type, Schema. |
| A3.2 | **Operators** | eq, neq, gt, lt, gte, lte, contains, !contains, matches, exists, type. |
| A3.3 | **Contextual Inputs** | Target-specific fields: JSON/XML path, header name, expected value, type selector (string/number/boolean/object/array). |
| A3.4 | **Enable/Disable per Assertion** | Toggle a single assertion without deleting it. |
| A3.5 | **Export Postman Snippet** | Copy assertion as a Postman-compatible pm.expect snippet. |
| A3.6 | **Empty State** | Guidance message when no assertion is defined. |

---

### A4. Runner (Suite Execution)

| # | Feature | Description |
|---|-------------|-------------|
| A4.1 | **Scope Selection** | Run a single request, a folder, or an entire collection. |
| A4.2 | **Iterations** | Configurable number of iterations (1–999). |
| A4.3 | **Delay Between Requests** | Pause in milliseconds between each request. |
| A4.4 | **Retry** | Number of attempts in case of failure (0–9). |
| A4.5 | **Stop on Failure** | Stops execution at the first error. |
| A4.6 | **CSV/JSON Dataset** | Load CSV or JSON test data; dataset variables replace request variables on each iteration. |
| A4.7 | **Progress Bar** | Progress bar with real-time completion percentage. |
| A4.8 | **Per-Request Log** | For each request: pass/fail icon, index, method, status code, duration in ms, name, error message. |
| A4.9 | **Final Summary** | Total passed/failed, total duration, average duration per request. |
| A4.10 | **Export Report** | Export results as Markdown, HTML, JSON, JUnit XML. |
| A4.11 | **Assertions in Runner** | Assertions defined on requests are evaluated on each iteration; pass/fail counters are included in the report. |

---

### A5. Flows (Multi-Step Workflow)

| # | Feature | Description |
|---|-------------|-------------|
| A5.1 | **Mermaid Input** | Paste or import a Mermaid diagram as the source of truth; users are not forced to draw a graph manually. |
| A5.2 | **Automatic Generation** | Converts the diagram into a mostly read-only visual API flow with steps, conditions, branches, and execution order. |
| A5.3 | **API Catalog Binding** | Automatically matches API steps to real local collection/API catalog requests, with a light override when needed. |
| A5.4 | **Response Conditions** | Decision nodes evaluate status, headers, JSON body paths, variables, or expressions from real API responses. |
| A5.5 | **End-to-End Execution** | The runner follows the Mermaid sequence and chooses success/error/true/false branches. |
| A5.6 | **Runtime Status** | Each step shows pending, running, success, failed, or skipped with duration, HTTP status, and readable messages. |
| A5.7 | **Environment Variables** | Reuses the existing request engine, so `{{var}}`, auth, cookies, scripts, and assertions stay compatible. |
| A5.8 | **Side Inspector** | Shows request mapping, condition configuration, and the local request catalog. |
| A5.9 | **Run Log** | Shows execution order, request/response status, duration, assertions, and readable errors. |
| A5.10 | **Flow Validation** | Flags empty Mermaid, missing request URLs, incomplete conditions, and missing branches. |
| A5.11 | **Save / Load Flow** | Persists version 4 flow definitions in local bbolt storage, retaining edited positions and mappings. Older graphs and localStorage recordings are loaded without discarding their content. |
| A5.12 | **Export Flow JSON** | Exports the flow definition as JSON with Mermaid, nodes, edges, config, and settings. |
| A5.13 | **Export Markdown Report** | Exports the last run result as a Markdown report. |
| A5.14 | **Record API Calls** | Record → send API requests → Stop → Create Flow opens an editable sequence. Exact, unambiguous JSON response values copied to later bodies, parameters or bearer auth become response extractions and variable references. Review mappings before replay; ambiguous values stay literal. Response bodies remain session-only. |
| A5.15 | **Canvas Controls** | Compact nodes with readable directional arrows, arrangement preserving branches, smooth drag/pan, cursor-anchored Ctrl-scroll zoom, F to fit and Shift-drag grid snapping. Inspector, timeline, Mermaid import and AI panels can close, float, resize and maximize; toolbar buttons reopen inspector/timeline and toggle canvas focus. Saved flows are available from the header switcher. |
| A5.16 | **Flow-Scoped Variables** | Inside a step's request editor, `{{var}}` references extracted by other steps (or produced by the last run) are shown as defined instead of unresolved, with the producing step or last value in the tooltip. Nothing is copied into the environment. |
| A5.17 | **Stress Test** | The **Stress** dock runs the whole flow with up to 200 isolated local virtual users. Smoke/load/spike/soak presets join custom iterations/duration and editable staged workloads with ramp, target VUs and measured warm-up/cooldown phases. Results include overall and per-step p50/p90/p95/p99, throughput/data rate, APDEX, status and normalized error groups, explicit p95/error/RPS/APDEX release gates, deterministic bottleneck/tail/regression guidance, baseline comparison, and CSV/JSON/JUnit/HTML evidence. |
| A5.18 | **AI Flow Architect** | Converts natural-language orchestration into an editable Flow using the existing AI Engine and local API catalog. It explicitly maps earlier response JSONPaths into named `{{variables}}` consumed by later URLs, headers, query or bodies; transport/timeout/HTTP/assertion failures become `error` recovery branches while successful calls follow `success`. Preview exposes calls, data handoffs, recovery paths, missing data and destructive operations before import. |
| A5.19 | **Stress Datasets** | A local CSV dataset supplies variables on every flow iteration with sequential, per-VU or pseudo-random row allocation. `__vu`, `__iteration`, `__timestamp` and `__uuid` are always available and dataset values remain outside exported CI plans. |
| A5.20 | **Performance Charts & History** | Independent traffic/error axes, actual active-VU timeline, per-step percentile bars, latency distribution, SLO/baseline markers and a persisted 12-run p95/RPS trend remain readable in resized panels and offline HTML reports. |
| A5.21 | **Headless Flow Stress** | **CI plan** exports a portable graph/workload file with the exact shape the Flow Builder writes (nodes, edges, extractions, conditions, `extract` steps). `adomnia stress` executes it without the UI with response data extraction, retries, success/error branches, scripts, assertions, cookies, staged load, CSV/env injection, CLI/JSON/JUnit reporters and exit code 1 when requests or release gates fail. Failure reasons come back grouped (`errorGroups`: message, count, steps) in JSON, CLI and the Markdown report; failures count as *frustrated* in APDEX and only requests that never received an HTTP response stay out of the latency percentiles. A plan that cannot run is rejected with a reason (node without id/type, duplicate id, unknown type, edge to a missing node, no reachable request) instead of reporting zero requests. |

Storage compatibility: the `flows` bucket is created automatically when opening existing databases. Existing v3/v4 definitions and the `adomnia.flows.v1` fallback are retained; no destructive migration is required. Recorded mappings use the existing extraction schema. JSON body substitutions escape strings and preserve unquoted numeric/object values.

Existing `{{variable}}` references are also linked when their current environment value uniquely matches a previous recorded response field. This lets replay refresh the variable instead of reusing an old ID. Environment values are used only for matching and are not added to saved flow metadata.

---

### A7. Test Data Studio

| # | Feature | Description |
|---|-------------|-------------|
| A7.1 | **Generators — Person** | First name, Last name, Email, Username. |
| A7.2 | **Generators — Contact** | Phone. |
| A7.3 | **Generators — Tech** | IP address, UUID v4. |
| A7.4 | **Generators — General** | Date, Integer, Float, Boolean. |
| A7.5 | **Generators — Finance** | IBAN. |
| A7.6 | **Generators — Italy** | Italian tax code, VAT number. |
| A7.7 | **Generators — Address** | Street, City, Province, Postal Code. |
| A7.8 | **Generators — Text** | Lorem Ipsum. |
| A7.9 | **Generators — Commerce** | Product, Description. |
| A7.10 | **Constant Value** | "Custom" type: enter a fixed value for each row. |
| A7.11 | **Configure Fields** | Add/remove/rename fields; choose a generator for each field. |
| A7.12 | **Number of Rows** | Configure how many rows to generate (1–9999). |
| A7.13 | **JSON / CSV Output** | Toggle output format; inline preview. |
| A7.14 | **Download** | Download the generated dataset as a file. |
| A7.15 | **Copy** | Copy output to the clipboard. |
| A7.16 | **Send to Runner** | Opens the Runner directly with the generated dataset preloaded. |
| A7.17 | **Presets** | Save/load named field configurations; sidebar shows field and record counts. |

---

### A8. Visual Test Orchestration (No-Code)

| # | Feature | Description |
|---|-------------|-------------|
| A8.1 | **Block Types** | Build multi-step tests from cards: Request (pick a saved collection request), Assert (body/status/header + operator + expected), Set Variable (name = expression with `${var}` resolution). |
| A8.2 | **Visual Canvas** | Vertical card stack with an "Add block" dropdown, up/down reorder, and per-card delete — no scripting required. |
| A8.3 | **Sequential Runner** | "Run Test" executes blocks in order; each card shows running → pass/fail with a message. Request responses feed subsequent asserts; SetVar/extracted variables flow to later blocks. |
| A8.4 | **Export to Flow** | Converts a visual test into a Flow graph definition (request → request node with extractions, assert → condition node, setvar → extract node) and appends it to the Flows store. |
| A8.5 | **Persistence** | Tests stored locally in `adomnia.visualTests`; survive reloads. |

---

### A9. Response Schema Validation (Contract)

| # | Feature | Description |
|---|-------------|-------------|
| A9.1 | **Auto-Validation** | After each response, validates it against the endpoint's OpenAPI schema (status code, content type, headers, body structure) when a spec is present on the collection. |
| A9.2 | **Contract Tab** | Dedicated response tab with a PASS/FAIL badge, violations grouped by category (status/contentType/header/body) with detail, and warnings. |
| A9.3 | **Report Export** | Export the contract validation result as Markdown, HTML, or JSON. |
| A9.4 | **Toggle** | Settings → Requests → "Auto-validate response schema" (default on) enables/disables validation globally. |

---

## B. PROTOCOLS & STREAMING

### B1. gRPC Client

| # | Feature | Description |
|---|-------------|-------------|
| B1.1 | **Server Reflection** | Connect to a gRPC server and automatically retrieve the list of services and methods. |
| B1.2 | **Method Discovery** | For each method: name, input type, output type, client streaming flag, server streaming flag. |
| B1.3 | **Message Schema** | Describes a protobuf type: fields, type, number, repeated flag. |
| B1.4 | **Unary Invoke** | Invokes a unary gRPC method with a JSON payload; timing is measured. |
| B1.5 | **TLS Support** | TLS on/off toggle for the connection. |
| B1.6 | **Metadata Headers** | Key-value editor for custom gRPC metadata (sent with every request). |
| B1.7 | **Prettify Payload** | Formats JSON in the payload with indentation. |
| B1.8 | **Connection Presets** | Save address+TLS as a local preset; chips for quick loading. |
| B1.9 | **Streaming Invocation** | Runs server, client and bidirectional streaming calls; client/bidi streams accept ordered JSONL messages and display streamed responses. |
| B1.10 | **Copy Response** | Copy JSON response to the clipboard. |

---

### B2. SOAP Studio

| # | Feature | Description |
|---|-------------|-------------|
| B2.1 | **Import WSDL from File** | Loads a local WSDL file and analyzes the service structure. |
| B2.2 | **Import WSDL from URL** | Downloads and analyzes a WSDL from a remote URL with readable error handling. |
| B2.3 | **Import WSDL from Text** | Paste WSDL XML directly into the text field. |
| B2.4 | **Service/Port/Operation Navigator** | Sidebar with tree structure; select an operation to prefill the envelope. |
| B2.5 | **SOAP 1.1 and 1.2** | SOAP version selector; sets the correct Content-Type and SOAPAction. |
| B2.6 | **WS-Security UsernameToken** | Adds a WS-Security header with username/password to the envelope. |
| B2.7 | **Custom SOAP Headers** | Key-value editor for custom SOAP headers. |
| B2.8 | **Envelope Generation** | Automatically generates a SOAP envelope from the selected operation schema. |
| B2.9 | **Envelope Editor** | Textarea to manually edit the envelope before sending. |
| B2.10 | **Send Request** | Sends the SOAP envelope with loading state and error handling. |
| B2.11 | **XML/JSON Response** | Displays the response in XML or JSON mode; XML validation with indicator. |
| B2.12 | **Response Metrics** | HTTP status badge, response time in ms, size in bytes. |
| B2.13 | **Copy Response** | Copy response to the clipboard. |
| B2.14 | **Export cURL** | Generates the cURL command equivalent to the SOAP request. |
| B2.15 | **Generate Client Code** | Python and Node.js snippets for the SOAP call. |
| B2.16 | **Request History** | Sidebar with the last 10 requests; click to reload. |
| B2.17 | **Save to Collection** | Saves the operation as a request in the active collection. |

---

### B3. WebSocket Client

| # | Feature | Description |
|---|-------------|-------------|
| B3.1 | **Connect / Disconnect** | Open and close a WebSocket connection with a colored status indicator. |
| B3.2 | **Authentication** | Auth support: none, Bearer token, Basic. |
| B3.3 | **Custom Headers** | Header editor with enable/disable toggles; active header count badge. |
| B3.4 | **Auto-Reconnect** | Automatic reconnection with configurable delay in seconds. |
| B3.5 | **Message Mode** | Text / JSON toggle with automatic prettify. |
| B3.6 | **Send Message** | Send button and Enter shortcut (Shift+Enter for newline). |
| B3.7 | **Ping** | Ping button available when connected. |
| B3.8 | **Message Log** | Displays inbound/outbound/system messages with type (message/ping/pong/close/error), timestamp, expandable JSON payload. |
| B3.9 | **Copy Payload** | Copy the payload of a single message to the clipboard. |
| B3.10 | **Auto-Scroll** | Automatically scrolls to the latest received message. |
| B3.11 | **Export Conversation** | Exports the entire message session as JSONL. |
| B3.12 | **On-Message Script** | Run in-browser JavaScript on each inbound message; execution errors shown inline. |
| B3.13 | **Mock WebSocket Server — Start/Stop** | Starts a local mock WebSocket server on a configurable port; auto-connect button. |
| B3.14 | **Mock WebSocket Server — Rules** | Response rules with condition type (any, exact match, contains, regex, JSONPath), JSLT-lite response (`{{.field}}`, `{{$MSG}}`, `{{$NOW}}`, `{{$UUID}}`), delay ms. |
| B3.15 | **Mock WebSocket Server — Hit Log** | Match log with incoming message preview and generated response. |

---

### B4. SSE Client (Server-Sent Events)

| # | Feature | Description |
|---|-------------|-------------|
| B4.1 | **Connect / Disconnect** | Starts and stops SSE streams with status indicator (connected/connecting/disconnected/error). |
| B4.2 | **Authentication** | None, Bearer token, Basic auth. |
| B4.3 | **Custom Headers** | Editor with enable/disable toggle for each header. |
| B4.4 | **Variable Substitution** | Supports `{{var}}` in URL and headers. |
| B4.5 | **Pause / Resume** | Pause capture while buffering events; resume by displaying them all. Buffered event counter. |
| B4.6 | **Event Type Filter** | Dropdown to filter events by type (event field). |
| B4.7 | **Payload Search** | Text field to filter events by payload content. |
| B4.8 | **Counters** | Total received and visible events (after filtering). |
| B4.9 | **Event Card** | Shows timestamp, type, event ID, retry flag, payload with pretty-print toggle. |
| B4.10 | **Copy Payload** | Copy the payload of a single event. |
| B4.11 | **Clear All** | Clears the event log. |
| B4.12 | **Save Stream** | Persists the current session with timestamp in localStorage. |
| B4.13 | **Saved Streams Sidebar** | List of saved streams with deletion; click to load. |
| B4.14 | **Replay Stream** | Reloads and replays a saved stream. |
| B4.15 | **Export JSONL** | Exports all visible events as a JSONL file. |

---

### B5. Broker Studio

#### B5.0 Shared — Common features across all protocols

| # | Feature | Description |
|---|-------------|-------------|
| B5.0.1 | **Protocol Selector** | Sidebar with Kafka / RabbitMQ / MQTT / Redis / NATS tabs; distinct colors per protocol. |
| B5.0.2 | **Shared Message Log** | Right panel collects messages consumed from all protocols: timestamp, topic, content, headers, metadata. |
| B5.0.3 | **Message Expansion** | Click to expand a message: payload, headers, metadata, JSON visualization with JsonGraph. |
| B5.0.4 | **Export Messages** | Exports all log messages as JSON. |
| B5.0.5 | **Message Presets** | Save/load/delete message presets per protocol through the bbolt backend. |
| B5.0.6 | **Persistent Connection Profiles** | Autosaves and restores connection metadata for Kafka, RabbitMQ, MQTT, Redis and NATS; plaintext credentials remain session-only while persistent profiles store encrypted `vault:` references. |
| B5.0.7 | **Message Counter** | Badge with the number of messages in the log; clear button. |
| B5.0.8 | **Backend Status** | Connection indicator for the local sidecar with port. |
| B5.0.9 | **Protected Credentials** | Replaces plaintext broker passwords, tokens and credential-bearing URLs with encrypted Vault references, then resolves them only in memory for the broker action. |
| B5.0.10 | **Workspace Restore** | Restores the active protocol, selected saved profile and Kafka resource tab after restart without reconnecting automatically. |

#### B5.1 Kafka

| # | Feature | Description |
|---|-------------|-------------|
| B5.1.1 | **Produce** | Publishes a message to a topic: key, value, custom headers, optional partition. |
| B5.1.2 | **Bulk Produce** | Batch with count (1–10,000), delay between messages in ms, JSON field to vary per iteration. |
| B5.1.3 | **Consume** | Consumes messages: max wait, max messages, consumer group, read-from-beginning option. Consumed messages are forwarded to the shared Message Log. |
| B5.1.4 | **Topics** | Lists cluster topics and brokers. |
| B5.1.5 | **Connessione** | Lista broker, topic, group ID, client ID, TLS, SASL (PLAIN, SCRAM-SHA-256, SCRAM-SHA-512). |
| B5.1.6 | **Info Broker** | Shows the ID and address of all connected brokers. |
| B5.1.7 | **Producer Load Test** | Runs concurrent publishes by count or duration with ramp-up, JSON variation, and throughput/latency metrics (P50/P95/P99, error rate, timeline). |

#### B5.2 RabbitMQ

| # | Feature | Description |
|---|-------------|-------------|
| B5.2.1 | **Publish** | Publishes a message to an exchange with routing key, content-type, mandatory flag. |
| B5.2.2 | **Consume** | Consumes messages from a queue with configurable auto-ack. |
| B5.2.3 | **AMQP Connection** | Host, port, vhost, username, password, TLS. |

#### B5.3 MQTT

| # | Feature | Description |
|---|-------------|-------------|
| B5.3.1 | **Publish** | Publishes a message to an MQTT topic with QoS (0/1/2) and retain flag. |
| B5.3.2 | **Subscribe** | Subscribes to a topic with QoS; received messages appear in the shared Message Log. |
| B5.3.3 | **Connessione** | Broker URL (mqtt/mqtts), client ID, username/password, clean session, keep-alive. |

#### B5.4 Redis Pub/Sub

| # | Feature | Description |
|---|-------------|-------------|
| B5.4.1 | **Publish** | Publishes a message to a Redis channel. |
| B5.4.2 | **Subscribe** | Subscribes to a channel or glob pattern; messages appear in the shared Message Log. |
| B5.4.3 | **Connessione** | Host, port, password, database index, TLS. |

#### B5.5 NATS

| # | Feature | Description |
|---|-------------|-------------|
| B5.5.1 | **Publish** | Publishes a message to a NATS subject with optional headers. |
| B5.5.2 | **Subscribe** | Subscribes to a subject; messages appear in the shared Message Log. |
| B5.5.3 | **Auth Token** | Authentication with NATS token. |
| B5.5.4 | **Connessione** | NATS server URL (nats://), optional queue group. |

---

## C. INFRASTRUCTURE & SIMULATION

### C1. Mock Server

| # | Feature | Description |
|---|-------------|-------------|
| C1.1 | **Start/Stop** | Starts and stops the local HTTP mock server on a configurable port. |
| C1.2 | **Endpoint Configuration** | Path pattern, HTTP method (or `*` wildcard), multiple response variants per endpoint. |
| C1.3 | **Pattern Matching** | Exact matching, `:param` (named parameters), `*` (single segment), `**` (multi-segment). |
| C1.4 | **Response Selection Mode** | First Active, Random, Round-Robin (configurable per endpoint). |
| C1.5 | **Response Configuration** | Status code, headers, body, delay ms, active/inactive toggle per variant. |
| C1.6 | **Record & Replay** | Records a real HTTP request/response and automatically adds it as a mock endpoint. |
| C1.7 | **Hit Log** | Real-time log: timestamp, method, path, match, response ID, status. Max 500 entries. |
| C1.8 | **Authentication Server** | Protection via `X-Mock-Auth` header. |
| C1.9 | **Auto CORS** | Automatic CORS header injection in mock responses. |
| C1.10 | **Real-Time Status** | Queries running/stopped status and active port. |
| C1.11 | **Smart Mock Engine** | Schema-driven response generation: when a response is set to `schema` mode, the server generates a realistic JSON body from a JSON Schema on every request, using Go-based Faker logic (string formats email/uuid/date-time/name/uri, number ranges, enum values, required fields, nested objects/arrays). |
| C1.12 | **Conditional Expectations** | Each response can carry conditions evaluated against the incoming request (query, header, path param, body via JSONPath) with AND logic; responses are tried in order and the first full match wins. An unconditional response acts as the fallback. |
| C1.13 | **Schema Editor + Live Preview** | Per-response JSON Schema editor with a live preview of a generated sample body. |

---

### C2. Proxy / Interceptor

| # | Feature | Description |
|---|-------------|-------------|
| C2.1 | **Proxy Start/Stop** | HTTP/HTTPS interceptor proxy on a configurable port. |
| C2.2 | **Traffic Capture** | Real-time capture: method, URL, headers, body, status, duration, errors. |
| C2.3 | **HTTPS Interception** | CONNECT tunneling with dynamic per-host certificate generation (internal CA). |
| C2.4 | **CA Management** | Generates, exports (PEM/DER), checks status, and deletes the local CA. Valid for 10 years. |
| C2.5 | **Map Local** | Redirects URLs to local files with glob matching. |
| C2.6 | **Map Remote** | Rewrites upstream URLs to alternative destinations. |
| C2.7 | **Breakpoint** | URL patterns that flag matching traffic for manual inspection. |
| C2.8 | **IP/CIDR Rules** | Allow/block/intercept filters for IPs and CIDR ranges. |
| C2.9 | **Domain Rules** | Domain pattern matching with `*.` wildcard. |
| C2.10 | **Regex Rules** | Rules with regular expressions on URLs. |
| C2.11 | **Rule Testing** | Tests configured rules on sample URLs before activation. |
| C2.12 | **Throttling** | Artificial latency in ms and bandwidth limit in kbps on proxy responses. |
| C2.13 | **Replay Request** | Resends a captured request with original method, URL, headers, body. |
| C2.14 | **Export Traffic** | Exports traffic as JSON, HAR 1.2, cURL — single selection or all. |
| C2.15 | **Header Masking** | Automatic redaction of Authorization, Cookie, Set-Cookie and headers containing "token/secret/key" → `***redacted***`. |
| C2.16 | **Detailed Timing** | DNS lookup, TCP connection, TLS handshake, request sent, TTFB, response receive. |
| C2.17 | **Traffic Limits** | Max entries (default 500), request body limit (default 32KB), response body limit (default 64KB). |

---

### C3. Docker Lab

| # | Feature | Description |
|---|-------------|-------------|
| C3.1 | **14 Presets** | REST Mock + PostgreSQL, REST Mock + Kafka, Kafka + UI, RabbitMQ, Redis Stack, PostgreSQL, MySQL, MongoDB, OpenTelemetry Collector, Jaeger Tracing, Prometheus, Grafana, Mock Server WireMock, Full Observability Stack. |
| C3.2 | **docker-compose.yml** | Generates a Docker Compose file for the selected preset. |
| C3.3 | **.env** | Generates a .env file with environment variables for the preset. |
| C3.4 | **README.md** | Generates a guide with startup instructions, ports, and default credentials. |
| C3.5 | **Tab Switcher** | Naviga tra i tre file generati (compose / env / readme). |
| C3.6 | **Copy** | Copies the content of the active view to the clipboard. |
| C3.7 | **Download** | Downloads the active file with the correct extension (`.yml`, `.env`, `.md`). |

---

### C4. Load Testing

| # | Feature | Description |
|---|-------------|-------------|
| C4.1 | **HTTP Load Test** | URL, method, headers, body, concurrency (1–200), total requests (1–50,000), duration mode, timeout, ramp-up, cooldown. |
| C4.2 | **gRPC Load Test** | Address, service, method, payload, concurrency, total requests, timeout, TLS. |
| C4.3 | **Metriche HDR Histogram** | Distribuzione latenza: avg, min, max, P50, P75, P90, P95, P99, P99.9. Precisione ms, 3 cifre significative. |
| C4.4 | **Timeline Chart** | Per-request timeline: elapsed, latency, status code, success/failure flag. |
| C4.5 | **Timeline Throughput** | Bucket per-secondo: req/s e latenza media. |
| C4.6 | **Warmup** | First N requests excluded from final metrics. |
| C4.7 | **Cooldown** | Delay in ms after the test before calculating metrics. |
| C4.8 | **Rate Limiter QPS** | Ticker-based pacing for target queries-per-second. |
| C4.9 | **Export Report** | JSON, Markdown (tabella), HTML (pagina dark stilizzata). |
| C4.10 | **Save/Load Scenario** | Saves configuration as a named scenario; lists and loads scenarios. |
| C4.11 | **Confronto Side-by-Side** | Confronta due risultati: delta percentuali throughput, latenza avg, P95, tasso errore. |
| C4.12 | **Quick Drawer** | Slide-out panel for load tests directly from the Composer. |

---

## D. DEBUGGING & ANALYSIS

### D1. Browser Debugging

| # | Feature | Description |
|---|-------------|-------------|
| D1.1 | **Browser Launch** | Chromium/Edge instance with remote debugging (CDP port 9223) pointed to the specified URL. |
| D1.2 | **CDP Connection** | WebSocket connection to the Chrome DevTools Protocol for the page target. |
| D1.3 | **Network Monitor** | Captures page traffic: URL, method, status, MIME, headers, timing, size. Filterable by URL/method/MIME type (XHR, Doc, CSS, JS, Img, Font). Max 500 entries. |
| D1.4 | **Request/Response Bodies** | Retrieves full bodies (POST data and response body) for captured entries. |
| D1.5 | **Console JavaScript** | Captures `consoleAPICalled` events (log/error/warn/info). Evaluates JS expressions in the page context with REPL. Max 200 entries. |
| D1.6 | **Debugger JS** | Combined Sources view from CDP scripts and page resource tree, browser cache disabled through CDP, reload Sources without cache, code view with line numbers and minimal theme-aware syntax highlighting, clickable/conditional breakpoints also via `scriptId`, current line highlighted while paused, pause/resume/step-over/step-into/step-out, call stack. |
| D1.7 | **DOM Inspector** | DOM tree with configurable depth, visible non-element nodes (document, doctype, text, comment), CSS querySelector, formatted HTML source, computed styles, node highlighting and DOM breakpoints on subtree/attributes/removal. |
| D1.8 | **Storage Viewer** | Cookies (domain, path, expiration, HttpOnly, Secure, SameSite), localStorage, sessionStorage, IndexedDB. Delete cookies. |
| D1.9 | **Network Throttling** | Profili: No Throttling, Slow 3G, Fast 3G, Regular 4G, WiFi, Offline. Kbps/latenza custom. |
| D1.10 | **Active Browser Discovery** | Scans ports 9222–9230 to find browser instances with remote debugging already active. Shows target list (tabs/pages) for each discovered browser with title, URL, favicon. |
| D1.11 | **Process Detection** | Scans running `chrome.exe`/`msedge.exe` processes (via wmic/PowerShell) looking for the `--remote-debugging-port` flag; returns PID, browser, port. |
| D1.12 | **Connessione a Target Specifico** | Connetti a qualsiasi tab/pagina aperta tramite ID target o URL WebSocket diretto, senza dover lanciare un nuovo browser. |
| D1.13 | **Target Navigation** | Navigates the connected target to a new URL via `Page.navigate` without losing the CDP connection. |
| D1.14 | **Page Screenshot** | Captures a screenshot of the current page in PNG/JPEG/WebP format with configurable quality. |
| D1.15 | **Page Source** | Retrieves `document.documentElement.outerHTML` for the connected page. |
| D1.16 | **Device Emulation** | Overrides viewport dimensions (width/height), mobile flag, device scale factor to simulate mobile devices. |
| D1.17 | **Performance Metrics** | Retrieves CDP performance metrics (`Performance.getMetrics`) for the page: DOM nodes, layouts, JS heap, etc. |
| D1.18 | **Launch with Debug** | Starts the browser on the specified port and returns the list of available targets after bootstrap (6s polling). |
| D1.19 | **Send to Composer** | From Network view, sends a captured request directly to the HTTP Composer as a new tab. |
| D1.20 | **Add as Mock** | Dalla vista Network, aggiungi una coppia request/response catturata come endpoint nel Mock Server. |

---

### D2. HAR Viewer

| # | Feature | Description |
|---|-------------|-------------|
| D2.1 | **Import File HAR** | Loads a local HAR file. |
| D2.2 | **Import from Proxy** | Loads traffic captured directly from the Proxy Interceptor. |
| D2.3 | **Export HAR** | Riesporta il HAR caricato. |
| D2.4 | **URL Filter** | Text search on URL. |
| D2.5 | **Domain Filter** | Dropdown with all domains present in the HAR. |
| D2.6 | **Status Filter** | Buttons: All / 2xx / 3xx / 4xx / 5xx / err. |
| D2.7 | **MIME Filter** | Dropdown by MIME type. |
| D2.8 | **Minimum Duration Filter** | Excludes requests faster than N milliseconds. |
| D2.9 | **Anomaly Counters** | Badges for errors, slow requests, heavy requests in the filtered set. |
| D2.10 | **Lista Richieste** | Colonne: status, metodo, URL, icone anomalia, MIME, durata, mini timing bar. |
| D2.11 | **Dettaglio — Timings** | Waterfall breakdown: DNS / TCP / TLS / Send / TTFB / Download with proportional bars. |
| D2.12 | **Details — Request** | Full URL, HTTP/version and sizes, query string, headers, cookies and request body; sending to Composer preserves query and cookies. |
| D2.13 | **Details — Response** | Status, HTTP/version and sizes, MIME, redirect URL, headers, cookies and body. Copy body. |
| D2.14 | **Compare Mode** | Confronta due HAR affiancati: colonne metodo, URL, durata A, durata B, differenza (▼ faster / ▲ slower / ≈ simile). |

---

### D3. Network Tools

| # | Feature | Description |
|---|-------------|-------------|
| D3.1 | **DNS Lookup** | Resolves records of any type (A, AAAA, CNAME, MX, TXT, NS, SOA, SRV, CAA, PTR, HINFO…) with configurable DNS server. |
| D3.2 | **DNS Trace** | Complete resolution chain from root to authoritative server with per-server timing. |
| D3.3 | **DNS Compare** | Interroga Google, Cloudflare, Quad9 in parallelo e confronta risultati. |
| D3.4 | **DNS Cache** | In-memory cache with TTL expiration; get and clear operations. |
| D3.5 | **Port Scanner** | TCP scan: host, port range, timeout, max 50 parallel connections; known service names for 20+ protocols. |
| D3.6 | **CORS Tester** | Preflight OPTIONS + GET; checks all CORS headers and shows compliance. |

---

### D4. JSON Tools

| # | Feature | Description |
|---|-------------|-------------|
| D4.1 | **JSON Path Query** | Queries JSON with gjson syntax (`data.items.0.name`); returns value, raw, type, existence. |
| D4.2 | **JSON Set / Mutate** | Mutates JSON with sjson; creates intermediate structures when needed. |
| D4.3 | **JSON Diff RFC 6902** | Genera JSON Patch RFC 6902; flag identico/non, operazioni patch, conteggio. |
| D4.4 | **JSON Humanizer** | Converti byte in KB/MB/GB; converti ms in durate leggibili. |
| D4.5 | **JSON Streaming Validator** | Valida ed estrae struttura JSON fino a 10MB senza unmarshal completo. |
| D4.6 | **MIME Type Detector** | Detects MIME type from raw bytes; returns string, extension, category. |
| D4.7 | **JSON Graph Visualizer** | Displays nested JSON as an indented/expandable tree. |
| D4.8 | **Visual JSON Diff** | Visual comparison between two JSON documents with diff patch view (Utils panel). |
| D4.9 | **Log Inspector** | First-class local investigation workspace for JSON, JSONL, mixed OpenShift logs and Java/Go stack traces, with managed multi-source sessions, controlled acquisition deduplication, span-aware service waterfalls, paired request/response payloads, request diffs, surrounding context, error fingerprints, custom field columns, masking and export. Advanced analysis adds portable parsing profiles, explicit per-source clock correction and incomplete-chain signals, route/service/version percentiles with before/after comparison, versioned diagnostic rules, and an optional explicitly-triggered redacted AI summary. |

---

### D5. XML Tools

| # | Feature | Description |
|---|-------------|-------------|
| D5.1 | **Format XML** | Indentation and pretty-printing of XML documents. |
| D5.2 | **Validate XML** | Syntax check with error feedback. |
| D5.3 | **XML → JSON** | Conversione documenti XML in rappresentazione JSON. |
| D5.4 | **XPath Query** | Queries XML with XPath expressions. |
| D5.5 | **Diff XML** | Confronto tra due documenti XML. |
| D5.6 | **Encode/Decode Entities** | Encode and decode XML entities (`&amp;`, `&lt;`, etc.). |

---

### D6. Power Tools (UtilsPanel)

| # | Feature | Description |
|---|-------------|-------------|
| D6.1 | **Base64 Encode/Decode** | Codifica e decodifica testo. |
| D6.2 | **URL Encode/Decode** | Encode e decode query string, path, frammenti. |
| D6.3 | **JSON ↔ YAML** | Conversione bidirezionale. |
| D6.4 | **Hash Generator** | MD5, SHA-1, SHA-256, SHA-384, SHA-512. |
| D6.5 | **HMAC Generator** | HMAC signature with configurable algorithm and key. |
| D6.6 | **JWT Decoder** | Ispezione header, payload e struttura firma locale. |
| D6.7 | **Password Generator** | Lunghezza e set caratteri configurabili (simboli, cifre, maiuscole, minuscole). |
| D6.8 | **UUID v4 Generator** | Single and batch UUID generation. |
| D6.9 | **Timestamp Converter** | Conversione Unix ↔ ISO 8601 ↔ UTC ↔ ora locale. |
| D6.10 | **Fake Data Generator** | Nomi, email, telefoni, IP, lorem ipsum. |
| D6.11 | **Query String Parser** | Analizza URL o query string in oggetti JSON. |
| D6.12 | **Regex Tester** | Tests regular expressions with match visualization. |
| D6.13 | **YAML Validator** | Validazione sintassi e struttura. |
| D6.14 | **HTTP Status Reference** | Codes 100–511 with category and description. |
| D6.15 | **PEM / JKS Inspector** | Identifica blocchi certificato/chiave PEM. |
| D6.16 | **Java Class Decompiler** | Loads `.class` files locally, checks JVM magic/version, reads method bytecode and reconstructs readable Java source for common instructions, with a raw details view. |
| D6.17 | **Docker Compose Generator** | Generates a starter docker-compose.yml file for mock services and local dependencies. |

---

### D7. Dev Logs

| # | Feature | Description |
|---|-------------|-------------|
| D7.1 | **Dual-Source** | Raccoglie log frontend (console/runtime) e log backend Go. |
| D7.2 | **Formato JSONL** | Voci strutturate: indice, timestamp, sorgente, funzione, livello (DEBUG/INFO/ERROR), messaggio. |
| D7.3 | **Date-Based Rotation** | File `debug-YYYY-MM-DD.jsonl` nella directory `logs/`. |
| D7.4 | **Overlay Log Viewer** | Slide-in overlay with auto-refresh (1.5s polling). Ctrl+Shift+D toggle. |
| D7.5 | **Pulizia Log** | Tronca file log backend e svuota buffer frontend. |
| D7.6 | **Open Log Folder** | Opens the log directory in the system file manager. |
| D7.7 | **Developer Mode** | Flag diagnostica estesa toggleabile. |
| D7.8 | **Forward Log Frontend** | The frontend can send console logs to the backend file. |

---

### D8. Observability

| # | Feature | Description |
|---|-------------|-------------|
| D8.1 | **Log File Browser** | Lists JSONL files in the log directory with size and date. |
| D8.2 | **Level Filter** | Quick tabs for filtering: All, ERROR, WARN, INFO, DEBUG, LOG. |
| D8.3 | **Source Filter** | Frontend or backend. |
| D8.4 | **Full-Text Search** | Searches log message and metadata. |
| D8.5 | **Correlation ID** | Filtra log correlati tramite trace/correlation ID. |
| D8.6 | **Trace Waterfall** | Trace span visualization with proportional timeline, service, duration, status. |
| D8.7 | **Export Log** | Scarica file log selezionato. |
| D8.8 | **Auto Refresh** | Periodic log viewer refresh. |

---

### D9. Secret Scanner

| # | Feature | Description |
|---|-------------|-------------|
| D9.1 | **Workspace Scan** | Analyzes collections and environments to detect exposed secrets (Bearer, API key, AWS, passwords, private keys, connection strings, high entropy). |
| D9.2 | **Risk Levels** | HIGH / MEDIUM / LOW classification with distinct icons and colors. |
| D9.3 | **Risk Filter** | Filters results by risk level. |
| D9.4 | **Result Search** | Text search across findings. |
| D9.5 | **Show/Hide Value** | Toggle visibility of the found secret (masked by default). |
| D9.6 | **Export Markdown Report** | Generates a downloadable security report in Markdown format. |
| D9.7 | **Copy Finding** | Copies finding details to the clipboard. |
| D9.8 | **Automatic Masking** | Sensitive values are masked by default in the UI. |

---

### D10. PDF Editor

| # | Feature | Description |
|---|-------------|-------------|
| D10.1 | **Open PDF** | Opens a PDF from disk through drag-and-drop or file picker and renders pages lazily with pdf.js. |
| D10.2 | **Open from API Response** | Opens `application/pdf` HTTP responses directly from the Response panel, including robust base64-backed bodies. |
| D10.3 | **Free Text** | Adds movable and resizable text boxes on any page, with color controls and double-click editing. |
| D10.4 | **Annotations** | Supports highlight, rectangle, ellipse, line, arrow, and freehand ink annotations. |
| D10.5 | **Form Filling** | Detects AcroForm text, checkbox, radio, and dropdown fields and makes them editable as overlays. |
| D10.6 | **Visible Signature** | Adds a drawn or image-based visible signature layer, positioned directly on the page. |
| D10.7 | **Editable Layer** | Keeps annotations separate from the source PDF; projects reopen from local bbolt storage for further edits. |
| D10.8 | **Flattened PDF Export** | Exports a new PDF with text, annotations, visible signature images, and form values flattened through pdf-lib. |
| D10.9 | **Zoom & Navigation** | Zoom in/out/reset and multi-page scrolling with stable page dimensions. |
| D10.10 | **Project Management** | Saved project sidebar with open/delete flows. |
| D10.11 | **Page Operations** | Rotates, reorders, deletes, merges, appends, and splits PDF pages locally. |
| D10.12 | **Search & Copy Text** | Searches document text, jumps to matches, and copies extracted page text. |
| D10.13 | **Native Desktop Export** | Saves through the native Wails file dialog instead of relying only on browser Blob downloads. |
| D10.14 | **Large PDF Storage** | Stores project metadata and PDF bytes separately to handle documents beyond localStorage limits. |
| D10.15 | **Unicode Export** | Uses fallback font handling when standard PDF fonts cannot encode the exported text. |
| D10.16 | **Cryptographic PDF Signing** | Signs PDFs locally with P12/PFX or PEM/key material through the Go backend. |
| D10.17 | **Signature Verification** | Verifies existing PDF signatures and reports readable results in the UI. |
| D10.18 | **JKS / Certificate Tools Workflow** | Works with the certificate tooling to inspect/extract material useful for signing workflows. |
| D10.19 | **Document Studio Hub** | PDF lives beside Markdown and Mermaid in the left-side Document Studio hub. |

---

### D11. Live Development Session

| # | Feature | Description |
|---|-------------|-------------|
| D11.1 | **Live session** | A Code Studio Run or Debug becomes a session shared by every tool: service name, PID, port (run config, printed address, new listening socket or by hand), state, paused location. |
| D11.2 | **Debug bar** | Bottom bar in every tool except Code Studio: state, paused `file:line`, Continue / Step Over / Into / Out / Stop (F9, F8, F7, Shift+F8, Ctrl+F2), request in flight, split view, service drawer. |
| D11.3 | **Debug Request** | Next to Send: starts or reuses the service under Delve, waits for its port or health path, sends and follows the request; PAUSED AT BREAKPOINT in the response area; Replay from a copy of the tab. |
| D11.4 | **Linked requests** | `{{service:name}}` targets a service: Local run (follows the port), Docker Compose port or a remote URL. *Link to service* rewrites `localhost:PORT`. |
| D11.5 | **API ↔ code** | Handler that serves a request (declaration, not the router line) with Open handler; contract drift warning against the service's OpenAPI; handler CodeLens in Code Studio (open, run, debug request, last response, history). |
| D11.6 | **Request Context** | Code Studio debugger tab: method, path/query params, headers with credentials masked, body, request id; Open full request. |
| D11.7 | **Request views** | Logs, Debug, Timeline, DB and Kafka of each request plus a completion summary (status, time, code path, queries, events, logs, breakpoints) and *Mock this response*. |
| D11.8 | **Correlation** | `X-AdOmnia-Request-ID` on API Workspace and Interceptor requests; logs, SQL and messages tied by id (certain) or by time (labelled). |
| D11.9 | **SQL and Kafka** | SQL from the service's logs; opt-in loopback capture proxy for Postgres/MySQL; Kafka watch from the newest offset without consumer group. Open in Database / Broker Studio with the way back to the request. |
| D11.10 | **Service drawer** | Logs (filters, Log Inspector live source) and service view: project, routes, runtime and target, databases, Kafka, logs, debugger, preferences, service name. |
| D11.11 | **Context navigation** | Code Studio and API Workspace stay mounted; Split Debug View (auto on breakpoint); Ctrl+Tab context switcher; Alt+Shift+1…5 tool keys; palette commands. |

---

## E. LOCAL DATA

### E1. Database Studio

| # | Feature | Description |
|---|-------------|-------------|
| E1.1 | **Driver SQLite** | SQLite connection with file path. `modernc.org/sqlite` driver — no external libraries. |
| E1.2 | **Driver PostgreSQL** | Host, porta, database, user, password, SSL mode. Driver `pgx/v5/stdlib`. |
| E1.3 | **Driver MySQL / MariaDB** | Host, porta, database, user, password. Driver `go-sql-driver/mysql`. |
| E1.4 | **Driver MongoDB** | Host, porta, database, collection, user, password, URI options (`authSource`, `tls`, `replicaSet`…) and SRV (`mongodb+srv`). Driver `mongo-driver v2`. Auto-retries SCRAM-SHA-256 when the server disables SCRAM-SHA-1 and, for field-based connections, `authSource=<database>` when the user lives in the selected database. |
| E1.4.1 | **MongoDB Explorer (Compass-style)** | Database → collection tree with estimated counts, create/drop collection; collection header with document count, storage, avg document and index sizes. The legacy JSON runner stays available via the Explorer / JSON runner switch. |
| E1.4.2 | **Documents** | Query bar (Filter, Project, Sort, Skip, Limit) accepting Extended JSON or mongosh syntax (`ObjectId()`, `ISODate()`, unquoted keys); server-side paging with total; List (expandable nested fields, typed BSON values), JSON and Table views; edit in place, clone, copy, delete per document with BSON types preserved (canonical Extended JSON round trip); insert one or many; import JSON / NDJSON / CSV; export all matching documents (JSON, up to 100k); Explain plan (COLLSCAN/IXSCAN, docs vs keys examined, stage tree); export query to mongosh, Node.js, Python, Go, Java. |
| E1.4.3 | **Aggregations** | Stage-based pipeline builder with operator picker, enable/disable, reorder, per-stage live preview (10 docs, disabled for `$out`/`$merge`), full run with confirmation for write stages, copy pipeline, export to code. |
| E1.4.4 | **Schema** | Samples up to 10k documents (respecting the current filter) and shows every field path, BSON type distribution, presence percentage and sample values; click a field to filter on it. |
| E1.4.5 | **Indexes** | Index list with key directions, type (regular/compound/text/geo/hashed/wildcard), size, usage ops, unique/sparse/partial/TTL/hidden badges; create (multi-field, unique, sparse, TTL, partial filter) and drop. |
| E1.4.6 | **Validation** | View and edit `$jsonSchema` / query validators with validation level and action (`collMod`). |
| E1.6 | **DSN Override** | Raw DSN textarea for advanced override. |
| E1.7 | **Connection Test** | Stateless database ping with success/error feedback; Test opens and closes a separate client. |
| E1.8 | **Connection Management** | Saved connections with Connect/Disconnect, live status and latency, client reuse, keepalive, retry backoff and configurable idle timeout. |
| E1.9 | **Query Editor** | Textarea with `{{var}}` variable substitution. |
| E1.10 | **Esegui Query** | Invia query al database backend; risultati in griglia. |
| E1.11 | **Explain Plan** | Esegui EXPLAIN (SQL); MongoDB explain lives in the Explorer Documents tab. |
| E1.12 | **Limit / Timeout** | Limit righe e timeout ms configurabili. |
| E1.13 | **Destructive Query Detection** | Confirmation warning for DROP, DELETE without WHERE, TRUNCATE. |
| E1.14 | **Griglia Risultati** | Colonne ordinabili, valori NULL evidenziati. |
| E1.15 | **Export JSON / CSV** | Scarica risultati correnti. |
| E1.16 | **Query History** | Sidebar with previous queries; click to reload. |
| E1.17 | **Query Favorite** | Toggle preferito su ogni query; sidebar dedicata. |
| E1.18 | **Vault Integration** | Automatically encrypts passwords and all DSNs at save time using a system-keychain master key; opaque references are resolved only in Go. Optional passphrase protection and legacy Vault references remain supported. See [connection migration](DATABASE-CONNECTIONS.md). |
| E1.19 | **Row Counter** | Shows returned rows and affected rows. |
| E1.20 | **Query Workspace Restore** | Restores open query tabs, active query, row limit and timeout from local storage after restart. |
| E1.21 | **Query Console** | Collapsible panel beside the editor with query templates grouped by category (Search, Insert, Update, Delete, Aggregate, Schema & admin; Redis shows key-oriented categories) for MongoDB, PostgreSQL, MySQL, SQLite and Redis. Each template carries a Read / Write / Destructive badge; picking a table or collection precompiles it, and **Tab / Shift+Tab** walk its placeholders (choice lists offer real column names). Read templates can run directly. |
| E1.22 | **Query Interpreter** | A plain-language line under the editor says what the query will do and flags it (no filter, multiple statements, full document replacement, unknown table/column, unindexed field), with one-click fixes (Add WHERE, Add LIMIT, Count rows, Count first, Add filter). Destructive runs ask for confirmation that explains why and, when it can be counted safely, how many rows/documents will be affected. SQL scripts run per statement (**Ctrl+Enter** the statement or selection, **Ctrl+Shift+Enter** all, stopping at the first error). The backend applies the same rules (strings and comments ignored, real `WHERE` detection). |
| E1.23 | **Context-aware Completion** | SQL completion narrows by position (columns of the updated table after `SET`, of the target table inside `INSERT INTO t (`, columns in scope after `WHERE`/`ON`) and shows column types; MongoDB/Redis JSON completes operations, collections, sampled field names and `$` operators. Mongo fields are sampled lazily from the collection a query names, only on a live connection. |
| E1.24 | **Saved Queries and Ask AI** | Saved queries keep a name, category and connection scope, can be renamed, filtered, pinned as personal templates and exported/imported as a file (connection ids dropped, secret-looking values redacted). **Ask AI** (only with a verified provider) turns a request into a proposed query shown as a diff with its risk; the request carries schema names and the current query, never result rows, and nothing runs until you run it. |

---

### E2. Storage Inspector

| # | Feature | Description |
|---|-------------|-------------|
| E2.1 | **Browse Bucket** | Browses all bbolt buckets with key and value lists. |
| E2.2 | **Edit Value** | Edits the value of an existing key. |
| E2.3 | **Delete Entry** | Deletes a key-value pair from a bucket. |
| E2.4 | **Add Entry** | Inserts a new key-value pair into any bucket. |
| E2.5 | **Full-Text Search** | Searches all buckets by key name or value content. Max 50 results. |
| E2.6 | **Statistics** | File size, key count per bucket. |
| E2.7 | **Export Snapshot** | Exports the full database as a redacted JSON `.adomnia-snapshot`; plaintext credentials are never included and encrypted Vault references remain intact. |
| E2.8 | **Snapshot Restore** | Restores from a snapshot file (max 50MB). |
| E2.9 | **Export/Import Bucket** | Exports redacted single-bucket contents as JSON and imports compatible bucket data. |
| E2.10 | **localStorage Migration** | One-shot migration from `adomnia.v2` / `adomnia.settings` / `adomnia.mock` to bbolt. |

---

### E3. Workspace Management

| # | Feature | Description |
|---|-------------|-------------|
| E3.1 | **Named Workspaces** | Saves and switches across multiple workspaces; each includes collections, environments, tabs, settings. |
| E3.2 | **Save Workspace** | Current snapshot with name, timestamp, tab count. |
| E3.3 | **Load Workspace** | Restores state from a named workspace and updates the local recently opened workspace history. |
| E3.4 | **Delete Workspace** | Removes workspace from the registry. |
| E3.5 | **Import/Export `.adomnia`** | Portable JSON format (v1.0) with mandatory secret redaction; encrypted `vault:` references remain portable. |
| E3.6 | **Import OpenAPI 3.0** | Parses JSON/YAML specs; operations converted into folders grouped by tag. |
| E3.7 | **Reset Demo** | Loads the adOmnia Lab demo workspace with one click. |
| E3.8 | **Live Collaboration (LAN)** | Workspace › Live Collaboration: host a session on a chosen interface (TLS 1.3, per-session self-signed cert pinned by the invite), single-use expiring invites with Viewer/Editor/Controller roles, revoke, and share collections / open requests / non-private environments. Secrets are stripped in Go before anything leaves the machine (preview shows what was removed); received content waits in an inbox and is imported only on consent, with a warning when it carries scripts. Backend `internal/collab`. |

---

### E4. Vault (Encrypted Secrets)

| # | Feature | Description |
|---|-------------|-------------|
| E4.1 | **Lock / Unlock** | Passphrase with scrypt key derivation (age encryption). Auto-lock after inactivity timeout. |
| E4.2 | **Cifra / Decifra** | Cifra testo in base64 age; decifra ciphertext. |
| E4.3 | **Tipi Segreto** | token, API key, password, OAuth2 secret; note opzionali. |
| E4.4 | **Encrypted Export** | Exports the entire encrypted workspace with age passphrase in `adomnia-age` format. |
| E4.5 | **Encrypted Import** | Imports an encrypted backup with passphrase decryption. |
| E4.6 | **Stato** | Controlla bloccato/sbloccato. |
| E4.7 | **X25519 Identity** | Supporta crittografia identity-based X25519 oltre a passphrase scrypt. |

---

### E5. Document Studio

| # | Feature | Description |
|---|-------------|-------------|
| E5.1 | **Markdown Notes** | Markdown writing with real-time preview. |
| E5.2 | **Supported Syntax** | H1–H4, bold, italic, inline code, code block with language, links, images, HR, blockquote, lists. |
| E5.3 | **Toolbar** | Pulsanti Bold, Italic, Code, Link, Immagine, Heading. |
| E5.4 | **Split View** | Editor e anteprima affiancati. |
| E5.5 | **Resizable Columns** | Markdown workspace columns can be widened or narrowed by dragging handles left or right. |
| E5.6 | **Persistent Layout** | Column widths are saved locally and restored when the panel reopens. |
| E5.7 | **Mermaid Diagrams** | The same hub includes Mermaid diagram editing, preview, zoom, and fullscreen viewing. |
| E5.8 | **PDF Editor & Sign** | The same hub includes PDF editing, annotation, page operations, text search, and signatures. |
| E5.9 | **Clearer Left Menu Name** | The left menu is no longer a generic "Markdown" area; it is now "Document Studio". |
| E5.10 | **Direct PDF Drop** | The global file router accepts PDFs alongside Postman, OpenAPI, Mermaid, HAR, WSDL, and Java class files. |
| E5.11 | **LaTeX Studio** | Local `.tex` editor inside Document Studio with source on the left and visual preview on the right. |
| E5.12 | **Lorem CV Presets** | Modern and academic CV templates with placeholder content, inspired by Awesome-CV-style workflows but proprietary and editable. |
| E5.13 | **A4 CV Preview** | Local page-like preview for checking hierarchy, sections, skills, experience, projects, and education. |
| E5.14 | **Export `.tex`** | Downloads the LaTeX source for external compilation or file-based sharing. |
| E5.15 | **Import / Drop `.tex`** | Imports LaTeX files from picker or global drag-and-drop and opens LaTeX Studio directly. |
| E5.16 | **Local LaTeX Persistence** | Last document and selected preset are saved locally for continuity. |
| E5.17 | **Technical Report Preset** | Includes a LaTeX technical/API findings report template in addition to CV presets. |

---

## F. CUSTOMIZATION & EXTENSIBILITY

### F1. Themes & Skins

| # | Feature | Description |
|---|-------------|-------------|
| F1.1 | **11 Themes Integrati** | adOmnia Dark, adOmnia Light, Midnight, Forest, Sunset, Nord, Tokyo Night, Catppuccin Mocha, Solarized Dark, Gruvbox Dark, Legacy Enterprise. |
| F1.2 | **Windows 95 Skin** | Vintage skin with dedicated `icon95.png` icon. |
| F1.3 | **CRUD Themes** | Create, edit, delete custom themes. |
| F1.4 | **Theme Import/Export** | Import from string/JSON file; export as formatted JSON. |
| F1.5 | **Import from URL** | Downloads and installs a theme JSON file from URL (max 1MB). |
| F1.6 | **Visual Editor** | Edits tokens with live color preview. |
| F1.7 | **Validazione Schema** | Verifica 17 token obbligatori; avvisa su token opzionali mancanti. |
| F1.8 | **WCAG Contrast Check** | Evaluates AA/AAA compliance for 7 key text/background pairs. |
| F1.9 | **Directory Skins** | Scans `~/.adomnia/skins/*.json`; saves themes to disk. |
| F1.10 | **Hot Reload** | Polls the skins directory every 2s; detects new, modified, deleted files. |
| F1.11 | **Design Token Schema** | 27 colori, 3 font, 7 spaziatura, 5 raggio, 4 ombra. |
| F1.12 | **HTTP Method Tokens** | Colors for method-get/post/put/patch/delete/head. |
| F1.13 | **Theme Provider** | React context that applies CSS custom properties to the root. |
| F1.14 | **Personal Appearance** | Primary/base colors, monochrome dark/light defaults, isolated and temporary whole-app previews, and up to 50 named local profiles. Readable surface/text/action shades are derived automatically. Cancel or leaving Appearance restores the saved style. Settings schema 14 preserves existing explicit accents and custom themes. |

---

### F2. Plugin System

| # | Feature | Description |
|---|-------------|-------------|
| F2.1 | **Plugin Manifest** | JSON with ID, metadata, permissions, hooks, settings, JavaScript entry point, icon, `ui_slots` panels and actions; Python and new WASM installs are rejected. |
| F2.2 | **Install/Uninstall** | Installs complete folders for executable plugins or manifest-only registrations; installed plugins reload at startup and appear in `PWR > Plugins`. |
| F2.3 | **Enable/Disable** | Toggle with hook registration/deregistration; persisted state. |
| F2.4 | **12 Hook Events** | onRequest, onResponse, onSend, onSave, onImport, onExport, onStartup, onShutdown, onThemeChange, onEnvChange, onTabOpen, onTabClose. |
| F2.5 | **Hook Execution** | Enabled JavaScript handlers execute sequentially and return a HookResult (modified, data, error); HTTP request/response hooks are connected to the real send path. |
| F2.6 | **Settings Plugin** | Chiave, etichetta, tipo, default, opzioni, descrizione; UI dedicata. |
| F2.7 | **JavaScript Runtime Guardrails** | Fresh goja VM per invocation, 64MB input/output budget, 10s timeout, per-plugin concurrency guard and usage tracking. |
| F2.8 | **8 Permission-Aware Host Functions** | `http.fetch`, `storage.get/set/delete`, `log.info/error`, `ui.notify`, `env.get`; privileged groups require their manifest permission. |
| F2.9 | **Plugin DevTools** | Executes exported plugin functions with JSON arguments and displays the real result, error, duration and sandbox usage. |

---

### F3. Template

| # | Feature | Description |
|---|-------------|-------------|
| F3.1 | **5 Categorie** | Richieste, Collezioni, Flows, Mock Servers, Ambienti. |
| F3.2 | **CRUD Template** | Create, edit, delete templates. |
| F3.3 | **Search** | By name, description, tag (case-insensitive). |
| F3.4 | **Import/Export** | Da/verso stringa o file JSON. |
| F3.5 | **Installa Template** | Restituisce il contenuto; traccia conteggio download. |
| F3.6 | **8 Template Integrati** | REST API CRUD, OAuth2 PKCE Flow, Stripe API, Health Check Flow, Load Test Basic, GitHub API, JWT Auth Environment, SOAP Service. |
| F3.7 | **Marketplace** | Browse available templates by category. |
| F3.8 | **Detail View** | Shows complete content with install option. |

---

### F4. Plugin Runtime Policy

| # | Feature | Description |
|---|-------------|-------------|
| F4.1 | **Python runtime removed** | No Python bridge, worker process, virtualenv or Python SDK is initialized or shipped. |
| F4.2 | **Supported runtime** | Complete local JavaScript plugin folders execute ESM-style named exports or CommonJS `module.exports`; legacy WASM manifests remain readable but cannot be enabled. |
| F4.3 | **Python manifest rejection** | `runtime: "python"` is rejected by the backend during install and package repair. |
| F4.4 | **Executable actions** | Declared actions execute their matching JavaScript export from the plugin panel and show success data or a readable runtime error. |
---

## G. PLATFORM

### G1. Settings

#### G1.A Generali
| # | Impostazione |
|---|-------------|
| G1.1 | Confirm before closing modified tabs |
| G1.2 | Ripristina tab all'avvio |
| G1.3 | Show welcome on empty workspace |
| G1.4 | Comportamento all'avvio: riprendi l'ultima schermata aperta oppure apri sempre una sezione rail specifica |
| G1.5 | Intervallo auto-salvataggio (ms) |
| G1.6 | Backup workspace all'avvio |
| G1.7 | Max concurrent requests |

#### G1.B Aspetto
| # | Impostazione |
|---|-------------|
| G1.8 | Tema (dark/light) |
| G1.9 | Density (compact/comfortable/spacious) |
| G1.10 | Dimensione font |
| G1.11 | Dimensione font monospace |
| G1.12 | Lingua (en/it) |
| G1.13 | Larghezza sidebar |
| G1.14 | Show rail icons only |
| G1.15 | Presets colore accent |

#### G1.C Richieste
| # | Impostazione |
|---|-------------|
| G1.16 | Timeout predefinito (ms) |
| G1.17 | Segui redirect |
| G1.18 | Save responses in history |
| G1.19 | Max response history per tab |
| G1.20 | Metodo HTTP predefinito |
| G1.21 | Salta verifica certificato |
| G1.22 | Certificato client (PEM) |
| G1.23 | Passphrase certificato client |
| G1.24 | Invia cookie automaticamente |
| G1.25 | Preserva cookie tra tab |
| G1.26 | Codifica URL automaticamente |
| G1.27 | Trim whitespace negli header |
| G1.28 | Max redirect |
| G1.29 | Rimuovi auth su redirect |

#### G1.D Proxy
| # | Impostazione |
|---|-------------|
| G1.30 | Porta proxy predefinita |
| G1.31 | Max voci traffico |
| G1.32 | Request body limit (KB) |
| G1.33 | Response body limit (KB) |
| G1.34 | Proxy upstream |
| G1.35 | Host no-proxy |
| G1.36 | Abilita HTTPS |

#### G1.E Mock
| # | Impostazione |
|---|-------------|
| G1.37 | Porta mock predefinita |
| G1.38 | Default response delay (ms) |
| G1.39 | Password mock server |
| G1.40 | CORS headers auto |
| G1.41 | Log hit su file |

#### G1.F Vault
| # | Impostazione |
|---|-------------|
| G1.42 | Timeout auto-blocco (min) |
| G1.43 | Blocca vault su minimizza |
| G1.44 | Show vault in autocomplete |

#### G1.G Editor
| # | Impostazione |
|---|-------------|
| G1.45 | Dimensione tab (2/4/8) |
| G1.46 | Soft tabs (spazi) |
| G1.47 | Word wrap |
| G1.48 | Line numbers |
| G1.49 | Auto-chiusura parentesi |
| G1.50 | Automatically format response |
| G1.51 | Max response rendering size (KB) |

#### G1.H Altre sezioni
| # | Sezione |
|---|--------|
| G1.52 | Privacy & Dati |
| G1.53 | Shortcut Tastiera |
| G1.54 | About (versione, build, crediti) |
| G1.55 | Developer (developer mode, dev tools) |
| G1.56 | Search settings by section, label and description with automatic result-section opening |

#### G1.I AI Engine
| # | Impostazione |
|---|-------------|
| G1.57 | **Guided AI Profiles** | Recommended, best quality, fast/efficient, or private local AI profiles simplify setup without hiding the exact model choice. |
| G1.58 | **Live Model Discovery** | Lists models directly from OpenAI, Anthropic, Amazon Bedrock, Gemini, Hugging Face, Ollama, or an OpenAI-compatible runtime; provider metadata is cached locally. |
| G1.59 | **Model Update Control** | Optional, explicit auto-check when the AI Engine screen opens. It calls only the selected provider/runtime and never changes the selected model silently. |
| G1.60 | **Actionable Diagnostics** | Credential, connection, unavailable-model, and local-runtime failures are explained with a corrective action. |
| G1.61 | **Enterprise Claude via Amazon Bedrock** | Runs Claude through Bedrock Converse using the AWS SDK credential chain (profiles, IAM Identity Center/SSO, assume-role, web identity, or workload roles) without storing AWS secrets. Region, named profile, private runtime endpoint, and inference-profile ID/ARN are configurable. |
| G1.62 | **Local Agent Gateway** | Exposes Ollama, OpenAI, Hugging Face, or another OpenAI-compatible runtime on a loopback-only `/v1` endpoint for OpenCode, Pi, and other coding agents. Uses a persistent generated Bearer token, preserves streaming and tool calls through transparent proxying, and provides copy-ready client configuration. |

---

### G2. Infrastructure & Platform

| # | Feature | Description |
|---|-------------|-------------|
| G2.1 | **Local-First** | No account, no telemetry, no data leaves the machine without explicit action. |
| G2.2 | **Embedded bbolt Database** | Single-file ACID key-value database with multiple buckets; auto-creation and migration. |
| G2.3 | **HTTP Sidecar Go** | Local HTTP server on OS-random port for frontend↔backend communication. |
| G2.4 | **Single Binary** | Self-contained desktop executable; no external runtime dependencies. |
| G2.5 | **Configurable Titlebar** | App or system titlebar on restart (Linux defaults to system). Linux uses the native session backend, Wayland or X11, without forcing XWayland; legacy XWayland settings load as app chrome. App titlebar controls are frontend-rendered, not GTK-themed native controls. System titlebar permits native theme shadows and rounded corners where supported. Settings changes start saving immediately, independently of the workspace autosave interval, with ordered writes. |
| G2.6 | **Hidden Windows Processes** | A shared process policy prevents background Git, Go, Docker, Kubernetes, MCP and analysis tools from flashing a console; an architecture test rejects direct background `os/exec` launchers. Visible desktop, browser, editor, terminal and file-manager launches remain explicit. |
| G2.7 | **Internazionalizzazione** | Supporto Inglese e Italiano; dizionario traduzioni completo. |
| G2.8 | **State Management Zustand** | Stores: app, collections, environments, tabs, settings, devLogs, themes, plugin, browser-debug. |
| G2.9 | **Onboarding / Welcome Panel** | Home with feature catalog, quick-start, shortcuts, live metrics, and a Recent Workspaces section for one-click reopen of local workspaces. |
| G2.10 | **Keyboard Shortcuts** | Ctrl/Cmd+K opens the Command Palette; Ctrl+N creates a tab, Ctrl+Enter sends, Alt+← navigates back, Ctrl+Shift+D opens dev logs. |
| G2.11 | **Confirm Dialog** | Reusable component for destructive actions with customizable message. |
| G2.12 | **Command Palette** | Instant fuzzy search across panels, recent requests, collections, environments, and quick actions such as starting Mock/Proxy. |
| G2.13 | **Fast Session Resume** | Restores the last panel before the first render, batches critical state in one local transaction, hydrates only the active collection workspace shard, and loads other workspace data on first access while preserving a complete downgrade-compatible snapshot. |
| G2.14 | **Recoverable Desktop Updates** | Prepares the update helper before shutdown, keeps staging and rollback data in the private updater cache, waits for WebView data locks, relaunches the desktop GUI visibly, restores the previous version after a failed startup, and exposes the apply log from the rollback notice. |

---

### G3. CSS & UI Framework

| # | Feature | Description |
|---|-------------|-------------|
| G3.1 | **CSS Custom Properties** | Design token system: surface, text, borders, accent, semantic colors, methods, density, font. |
| G3.2 | **Tailwind CSS** | Utility-first with custom theme integration. |
| G3.3 | **shadcn/ui Primitives** | Button, Dialog, Prompt, Input, ConfirmDialog. |
| G3.4 | **Lucide Icons** | 50+ React icons for navigation, actions, states. |
| G3.5 | **VarHighlightInput** | Input that highlights inline `{{variable}}` patterns. |
| G3.6 | **JsonGraph** | Expandable tree component for nested JSON. |
| G3.7 | **JsonEditor** | Editor JSON con syntax highlighting. |
| G3.8 | **Syntax Highlighting JSON** | Tokenizer lato client: chiavi, stringhe, numeri, booleani, null, punteggiatura. |
| G3.9 | **Dark + Light Mode** | Theme toggle through CSS class on `<html>`. |
| G3.10 | **Custom Scrollbar** | Thin scrollbar consistent with the developer-tool aesthetic. |

### G4. Developer Context & Entity Router

| # | Feature | Description |
|---|-------------|-------------|
| G4.1 | **Project Context** | Opening a folder in gO scans it locally: go.mod modules, `package main` services, docker compose services and datasources (Postgres/MySQL/Mongo/Redis/Kafka/RabbitMQ/NATS), `.env` variables, OpenAPI/proto/WSDL contracts, Go routes (net/http 1.22, gin, echo, chi, gorilla), `os.Getenv`/`env` tags, SQL tables and Kafka/AMQP/NATS topics in string literals. Every item shows its file:line; code-derived items are marked *inferred*. |
| G4.2 | **Live updates** | Saving in gO rescans that file; returning to the window rescans files changed elsewhere. |
| G4.3 | **Secrets stay local** | Secret-looking `.env` values are masked, URL passwords redacted, compose passwords never read. |
| G4.4 | **Palette: Project & Symbols** | Ctrl+K finds routes, tables, topics, services, env vars, contracts and gopls symbols of the active gO project. Enter runs the default action, Tab lists all actions. |
| G4.5 | **Entity actions** | Route → Send in API Client / Go to handler / Add to Mock; service → use as baseUrl (confirm); datasource → Database or Broker Studio (no password copied); contract → API Docs / gRPC / SOAP; table → query; topic → Broker Studio; any item → open source in gO. |

---

## H. API DESIGN

Spec-first design module: define and maintain OpenAPI specs and reusable models, and round-trip them with collections.

### H1. OpenAPI Import / Export

| # | Feature | Description |
|---|-------------|-------------|
| H1.1 | **First-Class Import** | Import dialog with three modes — File (`.yaml`/`.json`), URL (fetch a remote spec), and Paste — for OpenAPI 3.x and Swagger 2.x, converting the spec into a collection. |
| H1.2 | **Export to OpenAPI** | Export a collection back to OpenAPI 3 from its context menu, as JSON or YAML; emits paths, parameters, request bodies, and security schemes. |
| H1.3 | **Round-Trip** | Import → export → re-import preserves endpoint names and paths via a shared mapping. |

### H2. Schema Components (Reusable Models)

| # | Feature | Description |
|---|-------------|-------------|
| H2.1 | **Schema Registry** | Workspace-level registry of named JSON Schema models, persisted in `adomnia.schemas`. |
| H2.2 | **`$ref` Resolver** | Resolves `#/components/schemas/<name>` references (including nested), depth-limited to prevent circular loops. |
| H2.3 | **Schemas Panel** | List + JSON Schema editor with name/description, Ctrl+S save, JSON validation, and a copyable `$ref` hint. |
| H2.4 | **OAS Export Integration** | Registered schemas are injected into `components.schemas` of exported OpenAPI documents. |

### H3. Visual OpenAPI Editor

| # | Feature | Description |
|---|-------------|-------------|
| H3.1 | **Endpoint List** | Lists endpoints from the collection's stored spec, or synthesizes them from the collection's requests when no spec exists yet. |
| H3.2 | **Form Editor** | Edit an operation without writing YAML: method, path, path/query/header parameter tables, request body (content type + schema), and responses (status + description + schema/`$ref`). |
| H3.3 | **Save & Merge** | Saving merges the edited operation back into the collection's `_openapiSpec` (handles add and method/path rename), feeding export, validation, and docs. |

---

## I. MCP (MODEL CONTEXT PROTOCOL)

AI-integration module: generate MCP servers — exposing API endpoints as AI-invocable tools.

The standalone MCP client and its session transports have been removed. Existing local client configuration is left untouched.

### I3. MCP Server Generator

| # | Feature | Description |
|---|-------------|-------------|
| I3.1 | **Collection → MCP Server** | Generates a self-contained TypeScript/Node.js MCP server from a collection (optionally with `_openapiSpec`) or a bare list of requests. |
| I3.2 | **Endpoints as Tools** | Each endpoint becomes an AI-invocable tool, ready for Claude Code or any MCP-compatible agent. |
| I3.3 | **Auth Passthrough** | The generated server passes through authentication for the mapped requests. |
| I3.4 | **Output Directory Picker** | Choose the output directory; generation runs from the MCP Server Generator panel. |

### I4. MCP for AI Agents

| # | Feature | Description |
|---|-------------|-------------|
| I4.1 | **Context Servers for Agents** | One list of MCP servers (stdio or HTTP) in the milk settings, passed to Claude Code and milk (v0.7+) at every new chat session. The project AI policy gates the list: `off` sends none, `local-only` sends only stdio servers. |
| I4.2 | **`adomnia mcp` Server** | Built-in stdio server handed to each agent: list and run an exported collection, and start/inspect/stop a local mock server (`mock_hits` shows what the agent's code sent). Per-agent switch to turn it off. |
| I4.3 | **Review Agent Changes** | After a milk or Claude Code turn, the files the agent created, modified or deleted are listed above the chat and in *Tools → Review Agent Changes…*; accept or reject each change, each file or the whole turn. Rejections never overwrite a file changed after the review was shown. |

---

## J. CODE STUDIO (IDE)

A Code Studio inside adOmnia. Projects open without running anything; local tools run only after the project is trusted. Full guide: [docs/CODE-STUDIO.md](CODE-STUDIO.md).

### J1. Projects, Sessions & Windows

| # | Feature | Description |
|---|-------------|-------------|
| J1.1 | **Open / Create Project** | Opens a module, a `go.work` workspace or a folder inside a repository; *New Project* offers Go templates (`go mod init` after confirmation) plus Static website and Node.js script templates that only write files; *Tools → Install All Language Servers…* installs gopls and the web language servers in one explicit step. |
| J1.2 | **Project Trust** | An opened project only reads and saves files. *Trust Project Tools* allows gopls, linters, build, run, tests, debugging, terminal and installs; revoking trust stops the project's processes. |
| J1.3 | **Isolated Sessions** | Several projects stay open together; output, diagnostics, run configurations, terminals, Git state and local history never mix. |
| J1.4 | **Session Restore & Recovery** | Tabs, layout, bookmarks, navigation history and breakpoints are restored; unsaved buffers are recovered only on request. |
| J1.5 | **Code Studio Workspaces** | Named groups of projects, separate from adOmnia API workspaces; the same project can live in several. |
| J1.6 | **Separate Project Windows** | *Open Project in New Window* gives a project its own native window; only one window edits a project at a time. Covered by automated tests; manual check pending. |
| J1.7 | **External Change Handling** | A file watcher reloads clean buffers and offers Reload / Keep / Compare for modified ones; the same file open in two projects is detected. |

### J2. Editor & Code Intelligence (gopls)

| # | Feature | Description |
|---|-------------|-------------|
| J2.1 | **Monaco Editor** | Tabs with pinning, reopen closed tab, split editor with its own tabs, atomic saves, configurable keymap, multi-caret and column selection. |
| J2.2 | **Completion & Diagnostics** | gopls completion with auto-imports and diagnostics computed on unsaved buffers. |
| J2.3 | **Navigation** | Ctrl+click / Ctrl+B declaration, implementations, super method, usages, symbol search, Search Everywhere (fuzzy matching ranked by prefix/word/substring/subsequence, with recently used actions pushed up), back/forward history, bookmarks, structure view and symbolic breadcrumb. |
| J2.4 | **Implementation Markers** | Gutter markers for implementations and implemented interfaces, including SDK interfaces. |
| J2.5 | **Refactoring** | Rename with multi-file preview and gopls code actions (extract variable/constant/function, inline, move to new file), applied all-or-nothing. |
| J2.6 | **Semantic Editing** | Semantic highlighting, inlay hints, quick documentation, parameter info, Implement Interface. |
| J2.7 | **Formatting** | Reformat code and optimize imports, optionally on save; gofumpt optional. |
| J2.8 | **File Icons** | Gopher for Go sources (test marker), Go logo for module files, Simple Icons brands for Docker, Git, GitHub Actions, `.env` and common formats; readable on both themes. |
| J2.9 | **Markdown & Mermaid documents** | `.md` files open in Preview with the eye / split / editor switch remembered per file; `.mmd`/`.mermaid` render as diagrams with the same switch and show syntax errors under the diagram. **Markdown tools** side panels: outline with click-to-jump, backlinks found by project search, and a local graph of the note with unresolved/orphan toggles and a folder filter. Covered by automated tests; manual check pending. |
| J2.10 | **Auto save** | Save on focus change and auto save after a pause in typing (1/2/5/10 seconds, off by default), independent and combinable. The delay restarts at every keystroke and never overlaps an in-flight save; save actions (format, imports, lint) still run. |

### J3. Lint & AI

| # | Feature | Description |
|---|-------------|-------------|
| J3.1 | **Linters** | golangci-lint or staticcheck with the project's configuration, lint on save, quick fixes and line suppression. |
| J3.2 | **Fix with AI** | Quick fix and Problems action that sends the file (and the local package of an `undefined: pkg.Name` error) to the configured AI provider; the answer can touch only those files and always opens in a preview. |
| J3.3 | **Problems Window** | gopls, linter and build problems grouped by file with navigation. |
| J3.4 | **Copilot Ask Chat** | Per-project streaming chat backed by the official Copilot language server, with optional current-file, live-selection and filtered workspace-manifest context, Stop and New Chat. Its header lists account-available chat models and starts a clean conversation when the model changes. Secret patterns and `.adomnia/aiignore` are enforced before context is sent; history remains session-only. |
| J3.5 | **AI di a0 Tool Window** | The existing provider-configured a0 assistant lives in the same closable right tool window as Structure, Project and Copilot instead of a floating launcher. Its header switches cached or custom model IDs after live verification, without opening Settings. It keeps its API-workspace actions, local permission boundary and verified-provider requirement. |
| J3.6 | **Inline Assistant** | **Ctrl+Enter on a selection** (or the enclosing declaration) opens a small instruction popup anchored under the code; Enter sends the fragment and the instruction to the configured AI provider and the proposal opens as an **inline diff in the editor**: removed lines struck through, proposed lines in green blocks, ✓/✗ per change block plus Accept all / Reject all. Nothing is written without accepting; accepted changes are unsaved, undoable edits and stay inside the edited fragment. Secrets are redacted, `.adomnia/aiignore` and the project AI policy are enforced, and a prose reply is refused instead of replacing code. |

### J4. Run, Test & Debug

| # | Feature | Description |
|---|-------------|-------------|
| J4.1 | **Build / Run / Stop** | Structured `go build`/`go run` with stdin, clickable output, restart, and stop of the whole process tree. Executable packages under `cmd/`, nested modules and `go.work` members run from their owning module. |
| J4.2 | **Run Configurations** | Saved per project; the first Play creates the resolved main-package configuration, and multiple entry points use the active file, the conventional module command or an explicit picker. Secret environment values are prompted and never persisted. |
| J4.3 | **Gutter Run Actions** | ▶ next to `func main`, tests, benchmarks, fuzz tests and examples with Run / Debug / Run with Coverage. |
| J4.4 | **Test Runner** | Tree of results from `go test -json`, recursive folder scopes, failure navigation, compiler diagnostics with exit codes, and Rerun Failed. |
| J4.5 | **Coverage** | Coverage in the editor across nested project modules, cleared when the source no longer matches; empty profiles are reported explicitly. |
| J4.6 | **Delve Debugger** | Breakpoints, stepping, stack, variables, watches and evaluate; launch, attach to a process or connect to a remote `dlv --headless`. Stop leaves no `dlv` or debuggee behind. |
| J4.7 | **Terminal** | Real PTY (ConPTY on Windows) per project, closing its whole process tree. |
| J4.8 | **Go Tools** | `go vet`, `go generate`, `go fix`, `go mod why`, `go mod graph`, `go doc` with an exact command preview. |
| J4.9 | **Background Task Status** | Long architecture, error-handling and semantic-move analyses publish project-scoped tasks with a spinner and label in the IDE status bar. |

### J5. Toolchain & Dependencies

| # | Feature | Description |
|---|-------------|-------------|
| J5.1 | **Go SDK Management** | Detects Go or installs official releases (SHA-256 verified); a different SDK per project without changing `PATH`. |
| J5.2 | **Tool Installation** | Confirmed installs of gopls, golangci-lint, staticcheck and Delve into the adOmnia tools folder; custom tool paths. |
| J5.3 | **Dependencies** | Previewed `go get`, `go mod tidy`, update, download and verify. Python units get a read-only tab in the same dialog: declared spec, version resolved by `poetry.lock`/`uv.lock`, dev marker, file and line, and the worst advisory of the manifest open in the editor. |
| J5.5 | **Dependency source code** | `View code` and `Browse files` on each go.mod requirement (and Ctrl+click on the module path) open the module source: a local `replace` folder, another module of the project or a project imported in adOmnia (editable), or the Go module cache (read-only). A missing module is downloaded on demand with `go mod download <module>`. |
| J5.4 | **Extra Go Tools** | Detects, installs with confirmation and runs govulncheck, goimports, mockgen, stringer and user-defined tools with structured arguments, the project SDK and Run-console output. |

### J6. Git & adOmnia Integration

| # | Feature | Description |
|---|-------------|-------------|
| J6.1 | **VCS in the Editor** | Branch and changes in the toolbar, gutter diff with hunk revert, blame, file history, commit and branch switch. |
| J6.2 | **Project Git Workbench** | Each open project has its own bottom Git workbench, scoped to the repository root detected from that session (including projects opened from a subfolder), with Changes, Log, branches, Pull/Push and Worktrees. Multiple folders in one IDE workspace keep distinct Git state. |
| J6.3 | **Go Optimization Workbench** | Go projects get a conditional Go tool window for pprof profiles, compiler escape/inlining reports, struct field-alignment analysis and project-scoped Go tools. It is absent when the project has no Go module. |
| J6.4 | **Project Services** | Opens Docker Lab, Database Studio and Broker Studio preconfigured for services detected in the project manifests — `go.mod` for Go, `pyproject.toml`/`requirements*.txt` for Python (psycopg, PyMySQL, pymongo, redis, Kafka, RabbitMQ, OpenTelemetry, Prometheus) — and for the databases declared by Spring in `spring.datasource.*` (`application.properties`/`.yml` and their profiles). A Spring datasource opens Database Studio with host, port, database, user and SSL mode prefilled, from the URL or the separate keys; the profile, active profile and `file:line` are shown, placeholders (`${DB_HOST}`) are listed as still needed, and another vendor (SQL Server, Oracle, H2…) is shown as not supported. Passwords are never read or copied: only their presence is recorded, and Database Studio asks for the credentials, sealed in the Vault. No connection or process starts when the project opens. |
| J6.5 | **Open in API Client** | CodeLens on HTTP route handlers — Go (net/http, gorilla/mux, gin, echo, fiber, chi), Java (Spring MVC) and Python (FastAPI, Flask, Django `path()`/`re_path()`) — opens a prefilled request. |
| J6.6 | **Plugin Events** | Read-only Code Studio events for plugins (contract v1). |
| J6.7 | **SonarQube Integration** | Optional: runs `sonar-scanner` on the trusted project, waits for the server to process the report, and imports open issues (SonarQube 9.9 LTA, 10.x incl. MQR severities, SonarCloud). Severity/security filters, file:line navigation, *Copy problems*, *Resolve with AI* and a versionable `.adomnia/sonar-baseline.json`. Token in memory only; respects Offline mode, proxy and corporate CA. |
| J6.8 | **Security panel: code scan** | Offline scan of the project files (no network, no processes): hardcoded secrets and committed private keys (masked), disabled TLS verification and obsolete TLS versions, weak crypto and small RSA keys, plain HTTP, SQL built from strings, shell commands built from data, path traversal and zip slip, gob decoding of untrusted input, unbounded request bodies, world-writable permissions. Suppression only with a written reason (panel or `// adomnia:security-ignore <rule>: <reason>`), versionable baseline in `.adomnia/security.json`, Markdown export for AI. |
| J6.9 | **Security panel: dependencies (govulncheck)** | On-demand govulncheck scan ranked by reachability (called / imported / required only), advisory detail and aliases, found → fixed version, call paths from project code that open each source, module dependency path, upgrade preview with confirmed `go get`, Markdown export for AI. |
| J6.10 | **AI commit message** | *Draft message with AI* in the Commit Dialog (Ctrl+K) summarises the diff and the changed symbols of the ticked files into a Conventional Commits message, editable before committing. Secrets in the diff are redacted and stay redacted in the draft, `.adomnia/aiignore` files are listed without their content, and the project AI policy (`off` / `local-only`) is enforced like the other AI features. |
| J6.11 | **Partial staging** | Stage and unstage single change blocks from the editor gutter popup (*Stage* / *Unstage* next to *Revert*) and single lines from *Stage/Unstage single lines…* or the ✂ button on a change row of the project Git workbench. The buffer is saved first, only the chosen hunks move to or from the index, and the change list refreshes. |
| J6.12 | **Project settings and keymap in JSON** | `.adomnia/settings.json` (schema, autocompletion in the editor, errors marked and skipped) layers the project over the user settings: editor behavior (tab size, soft tabs, wrap, line numbers, font, vim/emacs mode, sticky scroll — winning over `.editorconfig`) and the keymap (preset plus per-command bindings). Shortcuts accept `when` contexts (`editor && vim.normal`, `!input`, `vim.visual`, `terminal`, …) with fall-through across layers. The legacy `adomnia.codestudio.keymap` storage migrates into the settings JSON once. |

---

### J7. Java, Spring and JVM

| ID | Feature | Description |
|---|---|---|
| J7.1 | **Java without the language server** | Completion and Structure from a local analysis of the current buffer when Eclipse JDT LS is absent, stopped or importing: nested types, records, anonymous classes, overloaded methods with signatures, fields, enum constants, parameters and locals with scopes, keywords and snippets; UTF-16-correct positions, no suggestions inside comments/strings, declared limits (256k characters / 50k tokens) over which nothing is guessed. Never invents external members, resolved overloads or auto-imports. The status bar states the source (*Local Java analysis* vs the server name). Covered by automated tests; manual check pending. |
| J7.2 | **Eclipse JDT LS as the semantic owner** | JDT LS 1.60 (Lombok agent, Java Debug Server bundle) provides semantics, hover, cross-file navigation and launchable classes when ready; it starts with the Code Studio for Java projects because importing a Maven/Gradle reactor takes minutes, and shows the import phase in the status bar. Local rules are a marked fallback only. |
| J7.3 | **Code Vision and implementation markers** | Above each class, interface, enum, method, constant or package variable, Code Vision shows the usage count from JDT references (click to list them) and the git author of the latest change, with `*` for uncommitted lines; it is hidden while the buffer has unsaved changes. A gutter marker (I↓) appears on types and methods that have implementations or overrides in the project, with the count in the tooltip, and one click opens the list (or the only target). JDT LS answers `textDocument/implementation` downwards — subtypes and overridden methods — so the direction comes from the adapter (`implementedBy`), unlike gopls on concrete types. Inlay hints stay off for Java until JDT LS applies the preference in our client: no toggle that does nothing. Covered by a real-JDT-LS integration test and Vitest; desktop check `JS-2.M3`. |
| J7.3 | **Multimodule toolchain** | The Java version required by a project is read from every module of the reactor (Maven `<modules>`, Gradle `include`), not just the root; the suggested JDK is the smallest installed one that satisfies it, the selected one (`.adomnia/java.local.json`) is shared by Run, Debug and Tests and passed to JDT LS as an execution environment. |
| J7.4 | **Run/Test/Debug like Go** | Maven/Gradle runs, JUnit tree with per-method outcomes and class roll-up, rerun failed, Java Debug Server with stepping filters and hot swap, `quarkus:dev` attach on 5005, Spring endpoints in the Developer Context, dependency lenses and CVE scan on `pom.xml`/`build.gradle`. Verbose runs publish coalesced output so the UI stays responsive; the Run console applies terminal line semantics (`\r` redraws, chunk-split lines). |

## K. SECURITY INTELLIGENCE

One security engine with per-ecosystem adapters. CVE matching, normalisation, risk
modelling and remediation live once in `internal/securityintel`; Maven, Go and PyPI are
adapters. Backend: `internal/securityintel` (core), `…/maven`, `…/gomod`, `…/pypi`, `…/govuln`.
Wails service `SecurityIntel` (`securityintel_bindings.go`). UI: **Security Center**
rail panel.

| # | Feature | Description |
|---|-------------|-------------|
| K1.1 | **CVE Intelligence Engine** | Automatic scan of `pom.xml`, `go.mod`/`go.work`, `pyproject.toml` and `requirements*.txt`. Direct and transitive dependencies, actually resolved (Maven effective graph, Go minimal version selection, Python `poetry.lock`/`uv.lock`). Python dependencies without an exact version are reported as a warning instead of being matched against every version. Advisories from OSV (batch API), GitHub Advisory Database and the Go Vulnerability Database, deduplicated by alias. |
| K1.2 | **Severity and exploitation signals kept separate** | CVSS 3.1 and CVSS 4.0 base scores. When the advisory source (NVD, GHSA) publishes a score it stays authoritative; when it does not, the score is computed from the vector and labelled `computed` (CVSS 3.1 formula, CVSS 4.0 macrovector algorithm from the FIRST specification, verified against the official FIRST validation reference vectors). FIRST EPSS (30-day exploitation probability) and the CISA KEV catalog add signals no advisory source has. EPSS is a probability, not a severity: the signals are shown separately and combined only through explicit prioritisation rules. |
| K1.3 | **Risk-based prioritisation** | Every finding carries a priority (P0-P3) and the list of the rules that produced it. Signals: CVSS, EPSS, CISA KEV, reachability, component exposure, fix availability. A KEV finding is never demoted by test/build-only exposure. No fix published changes the action, never the risk. |
| K1.4 | **Reachability analysis** | Go: `govulncheck` symbol-level analysis with the call paths from project code to the vulnerable symbol, stdlib and toolchain included. Maven: bytecode-level analysis of the compiled classes (`target/classes/**/*.class` and the JARs in `target/`), with the distinction Java requires: *confirmed* only when a real invocation instruction targets the vulnerable symbol, *potentially reachable* when the vulnerable class/method is referenced without a provable call (reflection, dynamic class loading, frameworks, OSGi) or the vulnerable library's classes are used, *inconclusive* when nothing is found but reachability cannot be excluded. Absence of a call path is an analysis result, never a safety guarantee, and an inconclusive analysis never becomes "not reachable". |
| K1.5 | **Dependency graph** | Involved-dependency path from the manifest root to the vulnerable component, with origin (declared, inherited from parent/BOM, managed, transitive, plugin, toolchain) and Maven scope / Go `replace` shown. |
| K1.6 | **Maven Security Analyzer** | Effective dependency scan (parent POM chain, `dependencyManagement`, imported BOMs, property interpolation), scope analysis, plugin dependency scanning, optional `mvn dependency:tree` for the real resolved graph. Falls back to local analysis with explicit warnings when Maven is unavailable or the scan runs offline. |
| K1.7 | **Go Module Security Analyzer** | `go.mod` / `go.work` resolution, `replace` and `exclude` inspection, stdlib and toolchain advisories, build-context awareness (build tags, GOOS/GOARCH) for reachability. |
| K1.8 | **Explain My Vulnerability** | Clicking a finding shows the responsible dependency, its transitive origin, call paths when available, severity, exploitability, exposure and the possible fix - each signal with its own meaning. The same inspector carries the Security Impact Before Update preview: which advisories the upgrade closes, which remain open and which new ones the target version brings in, compared per component by advisory identity. |
| K1.9 | **Remediation** | Upgrade suggestion with the fixed version, compatibility class (patch / minor / major), what the same change also closes and what the upgrade brings in. One-click Safe Remediation prepares the manifest change, shows the exact diff, then runs dependency resolution, compile, tests and a rescan compared against the impact preview - every step with its own state and output. The change stays provisional with a backup and becomes definitive only after user review (or is discarded and restored); any step that launches an external tool requires explicit authorization and is otherwise reported as skipped. Fixes that cannot be applied automatically (no published fix, version managed by a parent POM/BOM, transitive dependency) are marked blocked with the reason instead of proposing a command that would fail. |
| K1.10 | **Accept the risk with a reason** | Suppressions require a written reason and an expiry, and are stored versionable in `.adomnia/dependency-security.json`. An expired suppression reactivates the finding. |
| K1.11 | **Privacy by design and offline** | Only package coordinates leave the machine, never sources or file names. Local advisory database for offline scans, corporate mirror endpoints for every source, network policy and Offline mode respected. |
| K1.12 | **Export and SBOM** | JSON, SARIF 2.1.0 (code-review importable), standalone HTML report, CycloneDX 1.5 and SPDX 2.3 SBOMs with the purl of each component, and a CycloneDX VEX document (`not_affected` only for a suppression with a written reason, `exploitable` only when the code calls the vulnerable symbol, everything else `in_triage`). |
| K1.13 | **Security Center dashboard** | Workspace-wide view across ecosystems: findings by priority, exploited-in-the-wild and reachable counters, per-ecosystem cards (Java/Maven, Go Modules, Python/PyPI), filters by band and ecosystem, data-source freshness. |
| K1.14 | **CVEs in the editor** | `requirements*.txt` and `pyproject.toml` get the same integration as `go.mod` and `pom.xml`: a *Scan vulnerabilities* lens, a marker on each pinned requirement, the fixed version as a lens and a one-click quick fix that edits the version (only `==` pins are matched; an unpinned requirement is never matched against every version). `go.mod` gets the same editor integration as `pom.xml`: a *Scan vulnerabilities* lens, a marker on each vulnerable `require`, the fixed version as a lens and a quick fix (an undoable edit of the version), and an *Install govulncheck…* lens when reachability is off. In `pom.xml` a direct dependency that brings in a vulnerable transitive library is flagged too, with the library and the advisory. |
| K1.15 | **Transitive Maven without Maven** | Offline and without authorizing processes, the Maven graph is walked from the POMs in the local repository (`~/.m2`): nearest-wins mediation, scope propagation, optional/provided/test excluded, `<exclusions>`, and the project's `dependencyManagement` applied to transitive versions. A POM that was never downloaded is declared ("N dependency POMs are not in the local repository"), never guessed. |
| K1.17 | **Pentest with Strix** | Security Center → *Pentest (Strix)*: runs the open-source Strix AI agents (Docker sandbox) on a private copy of a project picked from the recent ones, with scan depth, budget and focus. The model is the one from Settings → AI (or a custom LiteLLM id); a confirmation states that code goes to that provider. Findings come from Strix' SARIF, the full assessment exports as Markdown. Strix is installed on request with `uv`/`pipx` (never `curl \| bash`). Dependency reports also export as Markdown. |
| K1.18 | **Code audit with an agent skill** | Security Center → *Audit · Agent skill*: runs Cloudflare's open-source [security-audit skill](https://github.com/cloudflare/security-audit-skill) (MIT) with the coding agent chosen in the Code Studio AI chat (Pi, Claude Code or milk). The choice is shared with that chat, so the agent's model, credentials and permissions are the same; Copilot and Local LLM are listed as unsupported, with the reason. The skill is installed on request, at a pinned commit, in `~/.agents/skills/security-audit` (a copy the user installed is used as it is). The audit runs as an Agent Task (visible in Code Studio → AI → Tasks, stoppable, with permission prompts answerable from the Security Center), respects `.adomnia/ai-policy.json`, and writes to `~/security-audit-skill/<project>/run-N` outside the repository, so runs from the terminal and from adOmnia add up. The panel shows confirmed, needs-validation and rejected findings from `findings.json` and the run's `REPORT.md`. |
| K1.16 | **CI gate** | `go run ./cmd/secscan -root . -fail-on high -format sarif` runs the same engine from a pipeline, writes any export format and exits 1 when an unsuppressed finding is at or above the threshold (0 pass, 2 error). |

---

## SUMMARY

| Category | Sections | Features |
|-----------|---------|-------------|
| **A — API Core** | HTTP Client, Auth, Assertions, Runner, Flows, Test Data, Visual Tests, Contract Validation | 73 |
| **B — Protocols & Streaming** | gRPC, SOAP, WebSocket, SSE, Broker Studio (5 broker) | 65 |
| **C — Infrastructure & Simulation** | Mock Server (+ Smart Mock), Proxy, Docker Lab, Load Testing | 47 |
| **D — Debugging & Analysis** | Browser Debug (+ Discovery), HAR, Network Tools, JSON Tools, XML Tools, Dev Utils, Dev Logs, Observability, Secret Scanner, PDF Editor | 110 |
| **E — Local Data** | Database Studio, Storage Inspector, Workspace, Vault, Document Studio | 62 |
| **F — Customization & Extensibility** | Themes, JavaScript plugins, Template | 51 |
| **G — Platform** | Settings, Infrastructure, UI Framework | 76 |
| **H — API Design** | OpenAPI Import/Export, Schema Components, Visual OpenAPI Editor | 10 |
| **I — MCP (Model Context Protocol)** | Server Generator, Agent Integration | 12 |
| **J - Code Studio (IDE)** | Projects & Windows, Editor & gopls, Lint & AI, Run/Test/Debug, Toolchain, Git & Integration | 39 |
| **K - Security Intelligence** | CVE Intelligence Engine, Risk-based prioritisation, Reachability, Maven & Go Analyzers, Remediation, SBOM & Export, Security Center | 13 |
| **Total** | 45 sections | **~586** |


### Hub dot-matrix arcade

The Home Hub (2026-10-24) has its own sidebar (Home, Code Studio, API Client, Database, Messaging, Tools, Settings, About) under the adOmnia wordmark with an animated electric outline (own SVG, no WebGL; static with reduced motion). The main column shows a rotating title and subtitle from 30 built-in pairs (a different one on every visit, remembered in `adomnia.hubPhrase.v1` so it never repeats twice in a row), a dot-matrix clock, **Continue coding** (reopens the last file and its project in Code Studio) and the five most recent files. Recent files are recorded locally by Code Studio in `adomnia.recentFiles.v1` (max 20, newest first). Below them, **Recent requests** lists up to five saved request history entries (method, name, URL, status, age), one row per method + URL: clicking one reopens its captured response in an API tab, and **History** opens the full Request History panel. The section appears only after a response has been saved locally. The former tile grid, Customize mode, pixel-art logo and the `adomnia.hubLayout` record are no longer used; an old record is simply ignored.


For the v1 release surface, the Home Hub no longer exposes Arcade. Its implementation is retained. LaTeX, standalone PDF, Kubernetes and Plugins remain implemented but are omitted from primary discovery; Live Collaboration is opt-in beta. PDF imports and opening a PDF from a Code Studio project retain the complete editor, forms, annotations and signing. See `mds/V1-RELEASE-SCOPE-TODO.md` for the stable scope and acceptance gates.

The arcade pauses on window blur, hidden documents and when scrolled out of view. Idle and paused games do not run a continuous animation loop. The background matrix is cached, real-time physics uses small substeps and resizing preserves the logical board. Best scores stay local; the former Snake best-score key remains readable.

### API workspace typography

API collections, request tabs, controls, and response guidance use locally bundled Geist Sans. URLs, HTTP methods, payloads, and technical details use Geist Mono. Palette colors remain theme-driven, and custom skins retain their explicit typography overrides.

Collaboration inbox supports import-as-new, explicit replacement, and field-by-field merge with local-revision guards. Environment secrets require per-variable opt-in and an exact payload preview; private environments and vault references remain excluded by the Go backend. Canonical transfer revisions reuse collectionfs SHA-256 hashing. Operational audit is local in devlog and excludes shared values and invitation credentials.

### Central activity and idle policy

Window/workspace activity is tracked locally as Active, Background, Idle or
Suspended (released automatic resources). Hidden-panel polling stops, secondary
analysis and decorative refresh pause during inactivity, and normal status polls
slow down. Explicit terminal/debug/request/recording/run activity is protected;
only eligible automatic language servers use the existing reversible suspension
path. Detached windows and both visible split panes contribute visibility. No
workspace migration or telemetry is introduced. Native CPU measurements at
5/15/30 minutes is available for an empty Hub (Idle confirmed after five minutes,
0.04% average total CPU at 15/30 minutes); populated API/IDE and interaction
acceptance remain pending. See `docs/PERFORMANCE.md` and REF-11 in
`mds/MANUAL-CHECK.md`.

### Incremental language-server synchronization

Servers negotiating incremental document sync receive contiguous UTF-16 edits
with Unicode/CRLF-safe boundaries; full-sync servers retain complete updates.
Complete buffers are retained for restart replay. Superseded completion, hover,
signature, semantic-token, inlay-hint, highlight and document-symbol reads are
canceled by document/method, also on synchronized buffer change or closure.
Explicit rename, formatting and commands are preserved. Sessions keep separate
connections and overlays; sharing a root does not merge unsaved documents.
Validated with installed gopls v0.23.0; desktop acceptance remains REF-2.M1.

### Automatic project rules for IDE agent chat

Copilot, milk and Claude chats attach `.rules`, `AGENTS.md`, `CLAUDE.md` and
`.cursorrules` from the open workspace root at send time. A per-chat Project
rules toggle opts out, and sent-message context chips identify included files.
The existing AI policy, ignore list, secret redactor and 64 KiB prompt budget
apply; each rule file is capped at 8 KiB with an explicit truncation marker.
Files are never executed, referenced paths are not followed, and slash commands
retain their original meaning. Native UI acceptance remains Z1.4.M1.


### Application resource diagnostics

The status bar and Code Studio resource monitor provide live backend GOMEMLIMIT changes, gopls limit/restart for a selected Go project, timed CPU/RSS recordings, per-process charts, observed OS parent PIDs and registered Code Studio ownership. Export full history as JSON/CSV, a Markdown summary or standalone HTML with charts. Backend heap/GC, logical-core normalization, unavailable CPU and incomplete observations are explicit. No remote telemetry. [Measurement and compatibility details](performance/resources-2026-10-19.md).

### Python IDE adapter (2026-10-21)

Code Studio supports Python like its other languages. Detection reads project markers and manifests statically (TOML parsed, never executed; `setup.py` is never imported) and recognizes nested units and loose scripts. The interpreter is resolved per unit — saved choice, project environment (`.venv`/`venv`/`env`), then PATH — or set explicitly per configuration; **Python → Select Python Interpreter…** lists candidates with versions and installed tools (probe only on trusted projects) and stores the choice in `.adomnia/python.local.json`. Run supports script and module kinds (no shell, unbuffered output, scripts confined to the project) with static, verifiable suggestions (entry scripts, Django `manage.py runserver`, FastAPI/uvicorn and Flask only with an unambiguous app, verified `python -m` entry points, pytest). The Test panel runs pytest through an adOmnia-shipped plugin that records real node IDs, phase outcomes, durations and tracebacks (structured tree, single-node rerun, rerun failed, collection errors marked per file). Debug uses debugpy (`python -m debugpy --listen 127.0.0.1:<port>`) with the shared debug panels — breakpoints, step, threads, stack, variables, watch, evaluate; missing debugpy is solved by the explicit, confirmed **Install debugpy…** action (pinned version). The editor uses basedpyright (pinned, explicitly installed into the adOmnia tools folder, offline afterwards) with the selected interpreter as `python.pythonPath`; pip reports the SHA-256 of every downloaded artifact and a tools folder that does not match the recorded manifest is refused with a reinstall prompt. Each unit gets its own language server, so two units with different virtualenvs resolve their own imports instead of sharing one multi-root interpreter. HTTP endpoints of FastAPI, Flask and Django are recognised statically (no execution, no import) — router and blueprint prefixes included — and reach the Developer Context as routes, so the Architecture view and the editor lenses open them in the API client like Go and Spring routes; Project Services reads `pyproject.toml`/`requirements*.txt` to preselect Database Studio, Broker Studio and Docker Lab. Security Center scans Python manifests through the PyPI ecosystem. All processes go through the trust/process layer and start only on explicit action. Debug adds exception breakpoints, optional coverage through pytest-cov and Ruff formatting on request; an explicit local attach to a debugpy listener you started is supported. Not in scope yet: notebooks, remote/attach debugging, Conda lifecycle. Native desktop acceptance pending (PY-M*). This does not restore the removed Python plugin runtime.

### Run configuration interface (2026-10-21)

The shared editor now searches saved configurations and types, prioritizes project languages, defaults cwd only for a unique matching unit, and reviews detected entries before saving. Other installed language types remain accessible in a disclosure. Compact parameter sections retain environment/tasks/target/restart, pin/share, ordering and shell presets; discard checks protect modified drafts. Browser fixture checked in both themes; native Wails acceptance pending (RC-UI.M1).

### Claude Code / milk chat additions (2026-10-21)

Shared context includes live unsaved source, optional selection, project rules, filtered paths and language units. Header selector

### Rust IDE adapter — in preparation (2026-10-23)

Code Studio is learning Rust like its other languages; the adapter is complete in code and tests but is **not announced as supported yet** — the manual app checks are open in `mds/MANUAL-CHECK.md` (RS-M1…RS-M10, RS-M7 being the integration gate). Detection reads `Cargo.toml` statically (packages and virtual workspaces, `build.rs`/proc-macros never executed, `target/` excluded); the toolchain per project comes from `rust-toolchain.toml`, a saved choice or the PATH and is installed only after you confirm the exact `rustup` command. Run covers `bin`/`example`/`bench`/`build`/`check`/`clippy` with features, profile and target; build errors land in Problems with clickable `file:line:col` and the console shows rustc's own text. rust-analyzer (one server per Cargo unit, its own build folder) powers editing, `rustfmt` formats on save, `cargo test` fills the Test tree with a structured tree and rerun, and CodeLLDB (pinned release, SHA-256 verified) debugs binaries and examples with a `rust_panic` breakpoint. axum/actix/rocket routes, `utoipa` OpenAPI, sqlx/diesel/sea-orm databases, tonic gRPC, WebSocket/SSE, broker topics, env vars and Cargo modules reach the Developer Context like Go/Java/Python, and a running `cargo run` becomes a Live Session.s use advertised ACP models; external UTF-8 text files and images can be attached without storing their bytes in transcripts. Milk 0.7 adds configured-primary selection (global config + new project chat), native routing/reasoning controls, task-plan display and fresh-session semantics. Existing local milk is not upgraded automatically. **ACP image delivery (2026-10-22):** when the agent advertises `promptCapabilities.image` adOmnia sends native `image` blocks; otherwise it writes the image to a private temporary folder and prefixes the turn with an `@<absolute path>` reference, the same convention milk's own TUI uses for its CLI agent, so an agent that can read images (Claude Code) can see it. Files are deleted when the turn ends. **Slash commands:** adOmnia consumes `available_commands_update` and offers the agent's real commands (`/workflow`, `/bg`, `/tasks`, `/usage`, `/memory`, `/escalate`, …) in a keyboard-driven palette in the composer. **Background agents:** turns milk starts on its own when a background job finishes are shown as an assistant turn marked *background* instead of being dropped. Native account/model/image checks pending in AI-CHAT.M1–M4.
