# adOmnia — Feature Catalog

**adOmnia** is a local-first desktop API Development Toolbox built with Go (Wails) + React 18 (TypeScript).  
All features are offline-first: no account, no telemetry, and no data sent outside the machine.

---

## MACRO-CATEGORY INDEX

| # | Category | Sections | Features |
|---|-----------|---------|-------------|
| A | [API Core](#a-api-core) | HTTP Client, Authentication, Assertions, Runner, Flows, Matrix, Test Data | ~74 |
| B | [Protocols & Streaming](#b-protocols--streaming) | gRPC, SOAP, WebSocket, SSE, Broker Studio | ~65 |
| C | [Infrastructure & Simulation](#c-infrastructure--simulation) | Mock Server, Proxy/Interceptor, Docker Lab, Load Testing | ~44 |
| D | [Debugging & Analysis](#d-debugging--analysis) | Browser Debug (+ Discovery), HAR Viewer, Network Tools, JSON Tools, XML Tools, Power Tools, Dev Logs, Observability, Secret Scanner | ~90 |
| E | [Local Data](#e-local-data) | Database Studio, Storage Inspector, Workspace, Vault, Markdown | ~44 |
| F | [Customization & Extensibility](#f-customization--extensibility) | Themes, Plugin WASM, Template, Python Plugin SDK | ~51 |
| G | [Platform](#g-platform) | Settings, Infrastructure, UI Framework | ~76 |

---

## A. API CORE

### A1. HTTP Client & Collections

| # | Feature | Description |
|---|-------------|-------------|
| A1.1 | **Request Composer** | Full HTTP builder: method selector (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, CONNECT, TRACE), URL bar with variable highlighting, Send / Save / Load-Test buttons. |
| A1.2 | **Query Parameters** | Key-value editor with enable/disable toggles, row add/remove, and variable substitution `{{var}}`. |
| A1.3 | **HTTP Headers** | Key-value editor with toggles, common header suggestions, and variable substitution. |
| A1.4 | **Body Editor — Raw** | Multi-type editor: JSON, XML, Text, HTML, JavaScript with syntax highlighting and multiple body variants per request. |
| A1.5 | **Body Editor — Form** | URL-Encoded and multipart Form Data with a key-value pair editor. |
| A1.6 | **Body Editor — GraphQL** | GraphQL query editor with a separate variables editor. |
| A1.7 | **Pre/Post Request Scripts** | Pre-request and post-response script editor with `pm.*` Postman-compatible API. |
| A1.8 | **Response Viewer** | Colored status badge, size/time metrics, JSON body with syntax highlighting and expandable tokens, raw view, headers view, copy to clipboard. |
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
| A5.1 | **Request Step** | Add a step with name, HTTP method, URL, and body (POST/PUT/PATCH). |
| A5.2 | **Sequential Execution** | Run the flow from start to finish, or a single isolated step. |
| A5.3 | **Step Status** | idle / running / ok / error indicator with error message and duration. |
| A5.4 | **Variable Extraction** | Automatically extract variables from responses and pass them to subsequent steps. |
| A5.5 | **Environment Variables** | Replaces `{{var}}` variables from the active environment in URL and body. |
| A5.6 | **Per-Step Assertions** | Assertions configured on requests are evaluated for each step. |
| A5.7 | **Step CRUD Management** | Add, rename, delete, and reorder steps. |
| A5.8 | **Save / Load Flow** | Persists flow definitions locally in bbolt, migrates legacy data, and retains Request, Condition, Wait, and Script steps across restart. |
| A5.9 | **Variables Panel** | Sidebar shows variables extracted from runs as key/value pairs. |
| A5.10 | **Last Run Panel** | Results sidebar kept separate from saved definitions: status, duration, pass/fail assertions, error per step. |
| A5.11 | **Inline Mock Recorder** | Records a real request/response and automatically creates a mock endpoint (method, real URL, mock path). |
| A5.12 | **Export Flow JSON** | Exports the flow definition as a JSON file. |
| A5.13 | **Export Markdown Report** | Exports the last run result as a Markdown report. |

---

### A6. Environment Matrix (Cross-Environment Testing)

| # | Feature | Description |
|---|-------------|-------------|
| A6.1 | **Mode** | Run in matrix mode: single request, full collection, or multi-step flow. |
| A6.2 | **Environment Selection** | Multi-select checkboxes for available environments; each selected item adds a column to the result. |
| A6.3 | **Field Exclusion** | List of fields to exclude from comparison (comma- or newline-separated). |
| A6.4 | **Flow Configuration** | Inline step editor (method, URL, body) for flow mode without opening the Flows panel. |
| A6.5 | **Parallel Execution** | Launches the same requests across all selected environments in parallel. |
| A6.6 | **Results Table** | Columns: item, environment, HTTP status, duration ms, size bytes, Content-Type. |
| A6.7 | **Difference Detection** | Compares field values across environments; highlights differences with critical/normal badges. |
| A6.8 | **Anomaly Counters** | Badges with counts for errors, slow responses, and heavy responses. |
| A6.9 | **Save Configuration** | Persists the last matrix configuration. |
| A6.10 | **Export** | Exports results as Markdown, HTML, full JSON, raw JSON. |

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
| B5.0.6 | **Persistent Connection Profiles** | Autosaves and restores the last connection for Kafka, RabbitMQ, MQTT, Redis and NATS; saves/loads/deletes named profiles in local bbolt storage. |
| B5.0.7 | **Message Counter** | Badge with the number of messages in the log; clear button. |
| B5.0.8 | **Backend Status** | Connection indicator for the local sidecar with port. |
| B5.0.9 | **Credential Note** | Explains that profiles, including credentials, remain local and directs users to Vault for managed secrets. |

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
| B5.2.3 | **Info Exchange** | Retrieves metadata for the exchange and associated queues. |
| B5.2.4 | **AMQP Connection** | Host, port, vhost, username, password, TLS. |

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
| D2.12 | **Details — Request** | URL, headers, request body. |
| D2.13 | **Dettaglio — Response** | Status, dimensione, MIME, headers, body. Copy body. |
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
| D6.16 | **Class File Inspector** | Verifica magic bytes `CAFEBABE` e versione .class Java. |
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

## E. LOCAL DATA

### E1. Database Studio

| # | Feature | Description |
|---|-------------|-------------|
| E1.1 | **Driver SQLite** | SQLite connection with file path. `modernc.org/sqlite` driver — no external libraries. |
| E1.2 | **Driver PostgreSQL** | Host, porta, database, user, password, SSL mode. Driver `pgx/v5/stdlib`. |
| E1.3 | **Driver MySQL / MariaDB** | Host, porta, database, user, password. Driver `go-sql-driver/mysql`. |
| E1.4 | **Driver MongoDB** | Host, porta, database, collection, user, password. Driver `mongo-driver v2`. |
| E1.5 | **Driver Db2** | Visible configuration with warning "Db2 needs IBM CLI/ODBC client libraries". |
| E1.6 | **DSN Override** | Raw DSN textarea for advanced override. |
| E1.7 | **Connection Test** | Database ping with success/error feedback. |
| E1.8 | **Connection Management** | Dropdown with saved connections; add, select, delete. |
| E1.9 | **Query Editor** | Textarea with `{{var}}` variable substitution. |
| E1.10 | **Esegui Query** | Invia query al database backend; risultati in griglia. |
| E1.11 | **Explain Plan** | Esegui EXPLAIN (SQL only). |
| E1.12 | **Limit / Timeout** | Limit righe e timeout ms configurabili. |
| E1.13 | **Destructive Query Detection** | Confirmation warning for DROP, DELETE without WHERE, TRUNCATE. |
| E1.14 | **Griglia Risultati** | Colonne ordinabili, valori NULL evidenziati. |
| E1.15 | **Export JSON / CSV** | Scarica risultati correnti. |
| E1.16 | **Query History** | Sidebar with previous queries; click to reload. |
| E1.17 | **Query Favorite** | Toggle preferito su ogni query; sidebar dedicata. |
| E1.18 | **Vault Integration** | Marks connection as managed by the Vault with a visual badge. |
| E1.19 | **Row Counter** | Shows returned rows and affected rows. |

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
| E2.7 | **Export Snapshot** | Esporta intero database come JSON `.adomnia-snapshot`. |
| E2.8 | **Snapshot Restore** | Restores from a snapshot file (max 50MB). |
| E2.9 | **Export/Import Bucket** | Exports/imports single-bucket contents as JSON. |
| E2.10 | **localStorage Migration** | One-shot migration from `adomnia.v2` / `adomnia.settings` / `adomnia.mock` to bbolt. |

---

### E3. Workspace Management

| # | Feature | Description |
|---|-------------|-------------|
| E3.1 | **Named Workspaces** | Saves and switches across multiple workspaces; each includes collections, environments, tabs, settings. |
| E3.2 | **Save Workspace** | Current snapshot with name, timestamp, tab count. |
| E3.3 | **Load Workspace** | Restores state from a named workspace and updates the local recently opened workspace history. |
| E3.4 | **Delete Workspace** | Removes workspace from the registry. |
| E3.5 | **Import/Export `.adomnia`** | Portable JSON format (v1.0): collections, environments, activeEnvId, mockConfig, proxyConfig, flows. |
| E3.6 | **Import OpenAPI 3.0** | Parses JSON/YAML specs; operations converted into folders grouped by tag. |
| E3.7 | **Reset Demo** | Loads the adOmnia Lab demo workspace with one click. |

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

### E5. Editor Markdown

| # | Feature | Description |
|---|-------------|-------------|
| E5.1 | **Editor Live** | Markdown writing with real-time preview. |
| E5.2 | **Supported Syntax** | H1–H4, bold, italic, inline code, code block with language, links, images, HR, blockquote, lists. |
| E5.3 | **Toolbar** | Pulsanti Bold, Italic, Code, Link, Immagine, Heading. |
| E5.4 | **Split View** | Editor e anteprima affiancati. |

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

---

### F2. Plugin System

| # | Feature | Description |
|---|-------------|-------------|
| F2.1 | **Manifest Plugin** | JSON con: ID, nome, versione, autore, descrizione, homepage, licenza, permessi, hook, impostazioni, entry point, icona. |
| F2.2 | **Installa/Disinstalla** | Da manifest JSON; disinstalla rimuove directory e pulisce hook. |
| F2.3 | **Enable/Disable** | Toggle with hook registration/deregistration; persisted state. |
| F2.4 | **12 Hook Events** | onRequest, onResponse, onSend, onSave, onImport, onExport, onStartup, onShutdown, onThemeChange, onEnvChange, onTabOpen, onTabClose. |
| F2.5 | **Hook Execution** | Each handler returns a HookResult (modified, data, error). |
| F2.6 | **Settings Plugin** | Chiave, etichetta, tipo, default, opzioni, descrizione; UI dedicata. |
| F2.7 | **WASM Sandbox** | Limite memoria 64MB, timeout 10s, guardia concorrenza, tracciamento memoria. |
| F2.8 | **8 Host Functions** | `http.fetch`, `storage.get/set/delete`, `log.info/error`, `ui.notify`, `env.get`. |
| F2.9 | **Plugin DevTools** | Debug and test panel for plugin developers. |

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

### F4. Python Plugin SDK

| # | Feature | Description |
|---|-------------|-------------|
| F4.1 | **Bridge gRPC Bidirezionale** | Comunicazione Go↔Python via due canali gRPC: `worker.proto` (Go→Python) e `sdk.proto` (Python→Go). |
| F4.2 | **Worker Manager** | Python worker lifecycle management: spawn, monitor, kill, idle-reap (60s inactivity timeout). Max 4 simultaneous workers. |
| F4.3 | **Spawn Worker** | Starts an isolated Python process with environment variables: `ADOMNIA_GRPC_PORT`, `ADOMNIA_SDK_PORT`, `ADOMNIA_PLUGIN_ID`, `ADOMNIA_DATA_DIR`. |
| F4.4 | **Execute Action** | Invokes a named action on a Python worker with JSON payload; supports both synchronous and streaming (chunked) execution. |
| F4.5 | **Health Check (Ping)** | Checks worker status with uptime and memory statistics. |
| F4.6 | **Graceful Shutdown** | Coordinated shutdown with configurable grace period; forced kill after timeout. |
| F4.7 | **Init Worker** | Initialization with plugin configuration and data directory. |
| F4.8 | **SDK API — GetCurrentRequest** | The Python plugin can read the current HTTP request from the Composer. |
| F4.9 | **SDK API — EmitEvent** | The plugin can emit events to the frontend via Wails `EventsEmit`. |
| F4.10 | **SDK API — Log** | Structured logging (debug/info/warn/error) forwarded to the Go log system. |
| F4.11 | **SDK API — GetEnvVariables** | Reads active environment variables from the bbolt store. |
| F4.12 | **SDK API — Storage** | Persistent plugin storage: `get`/`set` in the bbolt `plugin_storage` bucket. |
| F4.13 | **BaseWorker Class** | Python base class: subclass it and use the `@action(name, streaming=False)` decorator to register handlers. |
| F4.14 | **@action Decorator** | Registers Python functions as actions invokable via gRPC without needing `protoc`. |
| F4.15 | **JSON-over-gRPC** | Native JSON serialization without protobuf code generation (no `protoc` required for plugin authors). |
| F4.16 | **Auto-Discovery Runtime** | Python runtime discovery: first embedded in `<dataDir>/python-runtime/python.exe`, then `python3`/`python` from PATH. |
| F4.17 | **Configurable Limits** | Timeout (ms), max memory (MB), max worker count — editable from frontend. |
| F4.18 | **Stato Worker** | Macchina a stati: `starting` → `ready` → `running` → `stopping` → `dead`. Esposta al frontend. |
| F4.19 | **Idle Reaper** | Goroutine that every 30s terminates workers inactive for more than 60s to free resources. |
| F4.20 | **SDK Server** | Go gRPC server that responds to reverse calls from Python plugins (upstream channel). |
| F4.21 | **Plugin Manifest Python** | `manifest.json` with `main.py` entry point; directory structure `<dataDir>/plugins/<id>/`. |

---

## G. PLATFORM

### G1. Settings

#### G1.A Generali
| # | Impostazione |
|---|-------------|
| G1.1 | Confirm before closing modified tabs |
| G1.2 | Ripristina tab all'avvio |
| G1.3 | Show welcome on empty workspace |
| G1.4 | Sezione rail predefinita all'avvio |
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

---

### G2. Infrastructure & Platform

| # | Feature | Description |
|---|-------------|-------------|
| G2.1 | **Local-First** | No account, no telemetry, no data leaves the machine without explicit action. |
| G2.2 | **Embedded bbolt Database** | Single-file ACID key-value database with multiple buckets; auto-creation and migration. |
| G2.3 | **HTTP Sidecar Go** | Local HTTP server on OS-random port for frontend↔backend communication. |
| G2.4 | **Single Binary** | Self-contained desktop executable; no external runtime dependencies. |
| G2.5 | **Configurable Titlebar** | Default frameless mode with app titlebar; on Linux explicit choice between native Wayland, XWayland, and system titlebar on restart. |
| G2.6 | **Nasconde Console Windows** | Sopprime la finestra console in produzione. |
| G2.7 | **Internazionalizzazione** | Supporto Inglese e Italiano; dizionario traduzioni completo. |
| G2.8 | **State Management Zustand** | Stores: app, collections, environments, tabs, settings, devLogs, themes, plugin, browser-debug. |
| G2.9 | **Onboarding / Welcome Panel** | Home with feature catalog, quick-start, shortcuts, live metrics, and a Recent Workspaces section for one-click reopen of local workspaces. |
| G2.10 | **Keyboard Shortcuts** | Ctrl/Cmd+K opens the Command Palette; Ctrl+N creates a tab, Ctrl+Enter sends, Alt+← navigates back, Ctrl+Shift+D opens dev logs. |
| G2.11 | **Confirm Dialog** | Reusable component for destructive actions with customizable message. |
| G2.12 | **Command Palette** | Instant fuzzy search across panels, recent requests, collections, environments, and quick actions such as starting Mock/Proxy. |

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

---

## SUMMARY

| Category | Sections | Features |
|-----------|---------|-------------|
| **A — API Core** | HTTP Client, Auth, Assertions, Runner, Flows, Matrix, Test Data | 74 |
| **B — Protocols & Streaming** | gRPC, SOAP, WebSocket, SSE, Broker Studio (5 broker) | 65 |
| **C — Infrastructure & Simulation** | Mock Server, Proxy, Docker Lab, Load Testing | 44 |
| **D — Debugging & Analysis** | Browser Debug (+ Discovery), HAR, Network Tools, JSON Tools, XML Tools, Dev Utils, Dev Logs, Observability, Secret Scanner | 90 |
| **E — Local Data** | Database Studio, Storage Inspector, Workspace, Vault, Markdown | 44 |
| **F — Customization & Extensibility** | Themes, Plugin WASM, Template, Python Plugin SDK | 51 |
| **G — Platform** | Settings, Infrastructure, UI Framework | 76 |
| **Total** | 33 sezioni | **~444** |
