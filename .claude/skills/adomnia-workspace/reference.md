# adomnia-workspace — Reference

Authoritative shapes and skeletons for generating importable `.adomnia` files.
All output is **version 2** workspace JSON consumed by `applyWorkspaceState`
(`frontend/src/lib/workspaceState.ts`), which restores these arrays: `collections`,
`environments` (+ `activeEnvId`), `settings`, `flows`. Extra fields are ignored.

The user imports the file via **Workspace panel → Import**.

---

## Output envelope

Every generated file uses this wrapper:

```json
{
  "version": 2,
  "savedAt": "2026-06-28T00:00:00.000Z",
  "name": "My Workspace",
  "environments": [
    { "id": "env-lab", "name": "Local Lab", "variables": { "sidecarBase": "http://localhost:34115" } }
  ],
  "activeEnvId": "env-lab",
  "collections": [],
  "flows": []
}
```

- `savedAt`: ISO 8601, current time.
- `environments[].variables`: a flat key→string map. Reference them anywhere as `{{key}}`.
- `sidecarBase` is dynamic — the app shows the runtime sidecar port; tell the user to
  update it after import.

---

## Shapes

### Request (verbatim from `workspaces/ForgeCore.adomnia`)

```json
{
  "id": "r1",
  "name": "GET health",
  "type": "request",
  "method": "GET",
  "url": "{{baseUrl}}/healthz",
  "params": [],
  "headers": [{ "id": "h1", "key": "Content-Type", "value": "application/json", "enabled": true }],
  "bodies": [{ "id": "b1", "type": "none", "raw": "", "lang": "json", "form": [], "name": "Body 1" }],
  "activeBodyIdx": 0,
  "auth": { "type": "none", "token": "", "username": "", "password": "" }
}
```

- For a JSON body: `bodies[0].type = "raw"`, `raw` = the JSON string (escaped), `lang = "json"`.
- `method` ∈ GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS.

### Collection + folder

```json
{
  "id": "col1",
  "name": "Kafka Control",
  "children": [
    { "id": "f1", "name": "Topics", "type": "folder", "children": [] }
  ]
}
```

A `children` entry is either a folder (`type:"folder"` with its own `children`) or a request.

### Environment

```json
{ "id": "env-lab", "name": "Local Lab", "variables": { "key": "value" } }
```

### SavedFlowDefinition (v3)

```json
{
  "id": "flow1",
  "name": "Login flow",
  "graph": { "nodes": [], "edges": [], "settings": { "maxSteps": 80, "failOnHttpError": true, "stopOnMissingBranch": true } },
  "updatedAt": "2026-06-28T00:00:00.000Z",
  "version": 3
}
```

Node types: `start | end | request | condition | extract`. Edge branches:
`next | success | error | true | false | else`. See the Flows skeleton below.

---

## Kafka

Sidecar endpoints (all POST, body is raw JSON):

| Endpoint | Body |
|----------|------|
| `/kafka/topics` | the `config` object directly |
| `/kafka/produce` | `{ config, key, value, headers, partition? }` |
| `/kafka/consume` | `{ config, maxWait, maxMsgs, fromStart }` |
| `/kafka/consumer-groups` | `{ config, topic }` |

`config` shape:
`{ brokers: [], topic, groupId?, clientId?, tls, sasl?: { enabled, mechanism, username, password } }`

### Skeleton

```json
{
  "version": 2,
  "savedAt": "2026-06-28T00:00:00.000Z",
  "name": "Kafka Lab",
  "environments": [
    { "id": "env-kafka", "name": "Kafka Lab", "variables": {
      "sidecarBase": "http://localhost:34115",
      "kafkaBroker": "localhost:19092",
      "kafkaTopic": "adomnia.lab.events"
    } }
  ],
  "activeEnvId": "env-kafka",
  "collections": [
    {
      "id": "col-kafka",
      "name": "Kafka Control",
      "children": [
        {
          "id": "k1", "name": "List topics", "type": "request", "method": "POST",
          "url": "{{sidecarBase}}/kafka/topics", "params": [],
          "headers": [{ "id": "h1", "key": "Content-Type", "value": "application/json", "enabled": true }],
          "bodies": [{ "id": "b1", "type": "raw", "lang": "json", "form": [], "name": "Body 1",
            "raw": "{\n  \"brokers\": [\"{{kafkaBroker}}\"],\n  \"topic\": \"{{kafkaTopic}}\",\n  \"tls\": false\n}" }],
          "activeBodyIdx": 0, "auth": { "type": "none", "token": "", "username": "", "password": "" }
        },
        {
          "id": "k2", "name": "Produce message", "type": "request", "method": "POST",
          "url": "{{sidecarBase}}/kafka/produce", "params": [],
          "headers": [{ "id": "h1", "key": "Content-Type", "value": "application/json", "enabled": true }],
          "bodies": [{ "id": "b1", "type": "raw", "lang": "json", "form": [], "name": "Body 1",
            "raw": "{\n  \"config\": { \"brokers\": [\"{{kafkaBroker}}\"], \"topic\": \"{{kafkaTopic}}\", \"tls\": false },\n  \"key\": \"demo-key\",\n  \"value\": \"{\\\"hello\\\":\\\"world\\\"}\",\n  \"headers\": {}\n}" }],
          "activeBodyIdx": 0, "auth": { "type": "none", "token": "", "username": "", "password": "" }
        },
        {
          "id": "k3", "name": "Consume messages", "type": "request", "method": "POST",
          "url": "{{sidecarBase}}/kafka/consume", "params": [],
          "headers": [{ "id": "h1", "key": "Content-Type", "value": "application/json", "enabled": true }],
          "bodies": [{ "id": "b1", "type": "raw", "lang": "json", "form": [], "name": "Body 1",
            "raw": "{\n  \"config\": { \"brokers\": [\"{{kafkaBroker}}\"], \"topic\": \"{{kafkaTopic}}\", \"groupId\": \"adomnia-cli\", \"tls\": false },\n  \"maxWait\": 3000,\n  \"maxMsgs\": 20,\n  \"fromStart\": true\n}" }],
          "activeBodyIdx": 0, "auth": { "type": "none", "token": "", "username": "", "password": "" }
        },
        {
          "id": "k4", "name": "Consumer groups", "type": "request", "method": "POST",
          "url": "{{sidecarBase}}/kafka/consumer-groups", "params": [],
          "headers": [{ "id": "h1", "key": "Content-Type", "value": "application/json", "enabled": true }],
          "bodies": [{ "id": "b1", "type": "raw", "lang": "json", "form": [], "name": "Body 1",
            "raw": "{\n  \"config\": { \"brokers\": [\"{{kafkaBroker}}\"], \"topic\": \"{{kafkaTopic}}\", \"tls\": false },\n  \"topic\": \"{{kafkaTopic}}\"\n}" }],
          "activeBodyIdx": 0, "auth": { "type": "none", "token": "", "username": "", "password": "" }
        }
      ]
    }
  ],
  "flows": []
}
```

For SASL/TLS, set `tls: true` and add a `sasl` object to each `config`.

---

## Database

Sidecar endpoints (POST):

| Endpoint | Body |
|----------|------|
| `/database/test` | the `connection` object directly |
| `/database/query` | `{ connection, query, limit, timeoutMs, explain, confirm }` |

`connection` shape:
`{ id, name, driver, dsn, host, port, database, username, password }`
— `driver` ∈ `sqlite | postgres | mysql | db2 | mongodb`. Default ports: postgres 5432,
mysql 3306, sqlite 0 (use `dsn` = file path).

### Skeleton

```json
{
  "version": 2,
  "savedAt": "2026-06-28T00:00:00.000Z",
  "name": "Postgres DB",
  "environments": [
    { "id": "env-db", "name": "Postgres DB", "variables": {
      "sidecarBase": "http://localhost:34115",
      "dbHost": "localhost", "dbPort": "5432", "dbName": "appdb",
      "dbUser": "postgres", "dbPassword": "postgres"
    } }
  ],
  "activeEnvId": "env-db",
  "collections": [
    {
      "id": "col-db",
      "name": "DB Control",
      "children": [
        {
          "id": "d1", "name": "Test connection", "type": "request", "method": "POST",
          "url": "{{sidecarBase}}/database/test", "params": [],
          "headers": [{ "id": "h1", "key": "Content-Type", "value": "application/json", "enabled": true }],
          "bodies": [{ "id": "b1", "type": "raw", "lang": "json", "form": [], "name": "Body 1",
            "raw": "{\n  \"id\": \"conn-1\", \"name\": \"appdb\", \"driver\": \"postgres\",\n  \"dsn\": \"\", \"host\": \"{{dbHost}}\", \"port\": 5432,\n  \"database\": \"{{dbName}}\", \"username\": \"{{dbUser}}\", \"password\": \"{{dbPassword}}\"\n}" }],
          "activeBodyIdx": 0, "auth": { "type": "none", "token": "", "username": "", "password": "" }
        },
        {
          "id": "d2", "name": "Run query", "type": "request", "method": "POST",
          "url": "{{sidecarBase}}/database/query", "params": [],
          "headers": [{ "id": "h1", "key": "Content-Type", "value": "application/json", "enabled": true }],
          "bodies": [{ "id": "b1", "type": "raw", "lang": "json", "form": [], "name": "Body 1",
            "raw": "{\n  \"connection\": { \"id\": \"conn-1\", \"name\": \"appdb\", \"driver\": \"postgres\", \"dsn\": \"\", \"host\": \"{{dbHost}}\", \"port\": 5432, \"database\": \"{{dbName}}\", \"username\": \"{{dbUser}}\", \"password\": \"{{dbPassword}}\" },\n  \"query\": \"SELECT 1\",\n  \"limit\": 100,\n  \"timeoutMs\": 15000,\n  \"explain\": false,\n  \"confirm\": false\n}" }],
          "activeBodyIdx": 0, "auth": { "type": "none", "token": "", "username": "", "password": "" }
        }
      ]
    }
  ],
  "flows": []
}
```

Note: `port` in the body is a number; mirror `dbPort` here when you change driver.
For write statements (INSERT/UPDATE/DELETE/DDL) set `confirm: true`.

---

## Flows

A complete login → extract token → status check → end skeleton. Coordinates are layout
hints; the app re-normalizes them.

```json
{
  "version": 2,
  "savedAt": "2026-06-28T00:00:00.000Z",
  "name": "Login flow",
  "environments": [{ "id": "env-f", "name": "Flow env", "variables": { "baseUrl": "https://api.example.com" } }],
  "activeEnvId": "env-f",
  "collections": [],
  "flows": [
    {
      "id": "flow-login", "name": "Login + check", "version": 3, "updatedAt": "2026-06-28T00:00:00.000Z",
      "graph": {
        "settings": { "maxSteps": 80, "failOnHttpError": true, "stopOnMissingBranch": true },
        "viewport": { "x": 0, "y": 0, "zoom": 1 },
        "nodes": [
          { "id": "n-start", "type": "start", "label": "Start", "x": 90, "y": 235, "width": 130, "height": 74, "config": {} },
          { "id": "n-login", "type": "request", "label": "Login API", "x": 330, "y": 210, "width": 230, "height": 126,
            "config": {
              "request": {
                "id": "rq-login", "name": "Login API", "type": "request", "method": "POST",
                "url": "{{baseUrl}}/login", "params": [],
                "headers": [{ "id": "h1", "key": "Content-Type", "value": "application/json", "enabled": true }],
                "bodies": [{ "id": "b1", "type": "raw", "lang": "json", "form": [], "name": "Body 1",
                  "raw": "{\"email\":\"user@example.com\",\"password\":\"secret\"}" }],
                "activeBodyIdx": 0, "auth": { "type": "none", "token": "", "username": "", "password": "" }
              },
              "expectedStatus": "2xx", "stopOnFailure": true,
              "extractions": [{ "id": "ex1", "name": "token", "source": "body", "path": "access_token" }]
            }
          },
          { "id": "n-cond", "type": "condition", "label": "Status 200?", "x": 690, "y": 198, "width": 156, "height": 156,
            "config": { "condition": { "source": "expression", "path": "response.status", "operator": "eq", "value": "200" } } },
          { "id": "n-ok", "type": "end", "label": "End success", "x": 1040, "y": 155, "width": 146, "height": 74, "config": { "endState": "success" } },
          { "id": "n-ko", "type": "end", "label": "End failed", "x": 1040, "y": 310, "width": 146, "height": 74, "config": { "endState": "failed" } }
        ],
        "edges": [
          { "id": "e1", "source": "n-start", "target": "n-login", "branch": "next", "label": "" },
          { "id": "e2", "source": "n-login", "target": "n-cond", "branch": "success", "label": "success" },
          { "id": "e3", "source": "n-cond", "target": "n-ok", "branch": "true", "label": "true" },
          { "id": "e4", "source": "n-cond", "target": "n-ko", "branch": "false", "label": "else" }
        ]
      }
    }
  ]
}
```

Condition `operator` ∈ `exists | not_exists | eq | neq | contains | gt | lt | gte | lte`.
Extraction `source` ∈ `body | header | status | expression`.

---

## from-code patterns

Claude reads the source (Grep/Read) — no library, no execution. Detect routes, emit a
collection where each route is a request: `method` + `{{baseUrl}}/path`, base headers, and a
JSON body inferred from the request type when present. Path params (`:id`, `{id}`, `<id>`)
become `{{id}}`. Group requests into folders by controller / file / router.

### Route detection

| Lang | Framework | Pattern |
|------|-----------|---------|
| Go | net/http | `http.HandleFunc("/path", handler)`, `mux.HandleFunc`, `r.Handle` |
| Go | gin/echo/chi/fiber | `r.GET("/path", h)`, `e.POST(...)`, `app.Get(...)`, `r.Route("/x", ...)` groups |
| Java | Spring MVC | class `@RequestMapping("/base")` + method `@GetMapping/@PostMapping/@PutMapping/@DeleteMapping/@PatchMapping("/sub")` |
| Java | JAX-RS | class `@Path("/base")` + method `@Path("/sub")` + `@GET/@POST/@PUT/@DELETE` |
| Python | Flask | `@app.route("/path", methods=["GET","POST"])`, blueprint `@bp.route` |
| Python | FastAPI | `@app.get("/path")`, `@router.post("/path")` |
| Python | Django | `urls.py` `path("route/", view)` / `re_path(...)`; DRF router registrations |

Combine class-level base path with method-level sub-path to form the full URL.

### Body inference

Infer a JSON object with type-appropriate placeholder values from the request model:

| Source | How |
|--------|-----|
| Go struct | fields with `json:"name"` tags → keys; type → placeholder (`string→""`, `int→0`, `bool→false`, slice→`[]`, nested struct→`{}`) |
| Java DTO | bean fields / record components bound via `@RequestBody` |
| Python Pydantic / dataclass | model fields used as FastAPI body param, or Flask `request.json` keys when visible |

Placeholders by type: string → `""`, number → `0`, boolean → `false`, array → `[]`,
object → `{}`, unknown → `null`. Only attach a body to methods that take one (POST/PUT/PATCH).
GET/DELETE get `bodies[0].type = "none"`.
