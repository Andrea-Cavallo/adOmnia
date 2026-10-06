# adOmnia

![adOmnia banner](assets/images/banner.png)

**A Go IDE and the whole API toolbox in one local-first desktop app.**

Write the service. Run it. Call it. Debug it. Inspect its database, messages and logs, without leaving the workspace.

**gO Studio** is a complete Go IDE: gopls, Delve, tests, coverage, Git and an integrated terminal. It runs next to an API client (REST, GraphQL, SOAP, gRPC, WebSocket, SSE), message broker clients, database explorers, a mock server, an intercepting proxy, browser debugging and a log inspector. They are not separate tools glued together: a Go service you start from gO Studio becomes a **live session** that every other tool can see.

adOmnia runs on Windows, macOS and Linux. It needs no account, collects no telemetry and keeps your data on your machine; AI features are optional and connect only to the provider you configure.

[![Release](https://img.shields.io/github/v/release/Andrea-Cavallo/adOmnia?color=8A2BE2)](https://github.com/Andrea-Cavallo/adOmnia/releases/latest)
[![Build](https://img.shields.io/github/actions/workflow/status/Andrea-Cavallo/adOmnia/build.yml?branch=master&label=build)](https://github.com/Andrea-Cavallo/adOmnia/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.md)
[![Website](https://img.shields.io/badge/website-adomnia--dev.com-8A2BE2)](https://www.adomnia-dev.com)

[gO Studio](#go-studio-the-go-ide) · [All in one](#from-code-to-runtime-in-one-app) · [Download](#download) · [API toolbox](#api-and-runtime-toolbox) · [Workflows](#workflows) · [AI](#ai) · [CLI](#command-line-and-ci) · [Building from source](#building-from-source) · [Documentation](#documentation)

![gO Studio in the light appearance: project tree, editor with inline debug values, Copilot chat and the concurrency-first debugger](assets/images/go-ide-white.png)

## gO Studio: the Go IDE

gO Studio is the Go IDE built into adOmnia. It is designed for day-to-day Go work on real machines, including corporate PCs behind a VPN or proxy.

| Area | What you get |
| --- | --- |
| **Editing** | Completion, navigation, hover, rename, Change Signature, extract and other refactorings via gopls; diagnostics, quick fixes, CodeLens, golangci-lint, staticcheck and optional SonarQube (issues imported into the IDE, copyable and fixable with AI); a three-way merge editor. |
| **Run and test** | Run from the gutter next to `func main` or a test; test explorer with coverage in the gutter; Makefile targets, Dockerfiles and docker compose services; a Run console that colours log levels (`log`, slog, zap, zerolog, logrus). |
| **Debugging** | Delve with conditional, hit-count and function breakpoints, logpoints, stop on panic and Run to Cursor. A **concurrency-first** view groups goroutines by origin, shows where each one started and evaluates expressions in the selected frame. |
| **Go insight** | Dependency graph with transitive versions, licenses, updates and `govulncheck`; a visual `go.mod` editor (Go version, toolchain, `exclude`, `retract`, version downgrade, `tidy` preview); a Context Propagation Inspector for `context.Context`. |
| **AI** | GitHub Copilot chat, [milk](https://github.com/scoutme/milk) (cheap/deep agent routing over ACP) and the a0 assistant beside the editor; *Fix with AI* proposes a diff you can apply per file or per change block. Files listed in `.adomnia/aiignore` and secrets in code never leave the machine. |
| **Workspace** | Git in the editor, an integrated terminal, local history, crash recovery of unsaved buffers, multiple projects side by side, any of them in its own window. |
| **Toolchain** | Uses the project's Go SDK, detected locally in milliseconds or installed from the official distribution; per-project `GOPROXY`, `GOPRIVATE`, `CGO_ENABLED`, `GOOS`/`GOARCH` and build tags; no silent toolchain downloads. |

**Trust model.** A newly opened project can be browsed and edited, but no Go tool, build or process runs against it until you explicitly trust it.

![gO Studio in the dark appearance](assets/images/go-ide.png)

See the [gO Studio guide](docs/GO-STUDIO.md) for trust rules, optional tools, storage and keyboard shortcuts.

## From code to runtime in one app

Most Go developers switch between an IDE, an API client, a database GUI, a Kafka tool, a log viewer and a terminal. In adOmnia these are views of the same running service.

```text
code → running service → API request → breakpoint → code → response
```

Start a service from gO Studio with Run or Debug and it becomes a [Live Development Session](docs/LIVE-SESSION.md):

- **Debug Request** next to *Send* starts the service under Delve if needed, waits for its port, sends the request and follows it. When it stops at a breakpoint, the response area shows where, and the split view puts the code and the request side by side.
- **Request ↔ handler.** The API Workspace shows the Go handler that serves a request; in gO Studio a CodeLens on the handler opens, runs or debugs its linked request.
- **Everything one request touched.** Response tabs list the SQL queries, Kafka messages and log lines the request caused, next to status, timing and breakpoints hit. *Mock this response* turns it into a mock.
- **Runtime enrichment.** gO Studio overlays what actually ran (routes, files, datasources, topics, latency, errors) on the static dependency picture, and flags dependencies that never appeared at runtime.
- **One keyboard.** Ctrl+Tab cycles the code at the breakpoint, the request, its SQL, its Kafka message and its logs; Alt+Shift+1…5 jump between gO Studio, API Workspace, Database, Broker Studio and the service logs.

## Download

Download the latest build from **[GitHub Releases](https://github.com/Andrea-Cavallo/adOmnia/releases/latest)**.

| Platform | Artifact | Requirements |
| --- | --- | --- |
| Windows x64 | `adomnia-<version>-windows-amd64.exe` | WebView2 runtime |
| macOS (Intel and Apple Silicon) | `adomnia-<version>-macos-universal.dmg` | — |
| Linux x64 | `adomnia-<version>-linux-amd64-gtk3-webkitgtk-4.1.tar.gz` | GTK 3, WebKitGTK 4.1 |

Each release includes `SHA256SUMS.txt`. See the [installation guide](docs/INSTALL.md) for platform-specific steps.

### Getting started

1. **Go project:** open **gO Studio**, choose *Open Folder* on a folder with a `go.mod`, then trust it to enable gopls, Run, Debug and tests.
2. **First request:** open **API Workspace**, create a **New Request**, set method, URL, headers, authentication and body, then send it.
3. **Connect them:** run the service from gO Studio and use **Debug Request** in the API Workspace to stop at your handler's breakpoint.

## API and runtime toolbox

![adOmnia API workspace with request editing and response inspection](assets/images/adOmniaInterface1.png)

| Area | Summary |
| --- | --- |
| **API client** | REST and GraphQL requests, environments and variables, authentication (OAuth 2.0, AWS Signature v4, Digest and others), pre/post scripts, assertions, response history, code generation, Postman/cURL/OpenAPI import, OpenAPI editor with governance rules. |
| **Testing and flows** | Collection runner with CSV datasets, recorded or AI-assisted flows, variables extracted from responses, failure branches, contract checks, and flow load tests with latency, throughput and APDEX thresholds. |
| **Protocols and brokers** | SOAP/WSDL with WS-Security, gRPC (including streaming), WebSocket, SSE, Kafka, RabbitMQ, MQTT, Redis Pub/Sub and NATS. |
| **Mocking and traffic** | Schema-based mock responses, conditional expectations, record/replay, HTTPS interception, breakpoints, map local/remote, throttling, HTTP/gRPC load testing and a local Docker lab. |
| **Debugging** | Browser debugging via the Chrome DevTools Protocol, application log inspector, HAR viewer, network diagnostics, payload utilities and redacted evidence export. |
| **Data and documents** | SQLite, PostgreSQL, MySQL and MongoDB explorers; Markdown, Mermaid and LaTeX editing; PDF annotation, forms and digital signatures. |
| **Git** | Clone and init, staging, commits, history graph, branches, merge, push/pull, diff, conflict resolution, and collection export to a reviewable folder layout. |
| **AI and MCP** | Optional cloud or local models, the a0 assistant, a local agent gateway, an MCP client/debugger and an MCP server generator. |
| **Security and customization** | Encrypted vault, private environments, mTLS with PEM and JKS keystores, certificate tools, JavaScript plugins, templates and themes. |

The [feature catalog](docs/adomnia-feature-catalog.en.md) lists every module in detail. Current status and open work are tracked in [docs/ISSUES.md](docs/ISSUES.md).

## Workflows

### Recording a flow

Press **Record**, send requests from the Composer, then stop recording. The sequence becomes an editable flow: map response values into later requests, add assertions and recovery branches, generate a Mermaid diagram and replay it.

![Recording API requests and converting the sequence into a Flow](assets/images/example-rec.gif)

### Mocking the current request

**Mock this tab** configures the open request as an endpoint in the Mock Server. Existing mock definitions are kept; the view stays focused on the selected endpoint until **Show all endpoints** is chosen. If the server is already running, it picks up the change without a restart or port change.

The Traffic view shows which response was served for each call, or why a call did not match (missing route, authentication failure, CORS preflight).

### Investigating logs

Load log files, paste output, or attach `kubectl`, `oc` and Docker log streams. The Log Inspector places events on a timeline, pairs request and response payloads and groups recurring errors. It accepts structured queries:

```text
duration_ms > 1000 AND (status = 500 OR status = 502)
```

Investigations can be saved with their queries, layout, bookmarks and notes. Individual calls can be exported as redacted evidence or converted into a request, flow or mock. Large files are indexed on disk and paginated.

![Application Log Inspector with file import and live source options](assets/images/application-logs.png)

### Versioning collections with Git

**Git Sync → Collection Folder** exports a collection to a deterministic folder layout, imports it back, and reports differences between the app and the files on disk:

```text
my-collection/
├── adomnia.collection.json
├── collection.json
├── folders/
│   ├── 001-auth/
│   │   ├── folder.json
│   │   └── 001-login.request.json
│   └── 002-users/
│       └── 001-list-users.request.json
└── .adomnia-sync.json
```

Collection and folder settings can define shared authentication, headers, variables and scripts.

## AI

AI features are optional and disabled until a provider is configured in **Settings → AI Engine**. The a0 assistant becomes available once the selected provider and model pass **Test connection**.

Supported providers: Anthropic, Amazon Bedrock, OpenAI, Google Gemini, DeepSeek, Hugging Face, Ollama and OpenAI-compatible endpoints.

### Credentials

API keys are resolved from process environment variables, adOmnia environments or `.env` files, with the encrypted vault as fallback:

| Provider | Variables |
| --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Google Gemini | `GEMINI_API_KEY`, `GOOGLE_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |
| Hugging Face | `HUGGINGFACE_API_KEY`, `HF_TOKEN` |
| OpenAI-compatible | `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_API_KEY` |

`ADOMNIA_AI_API_KEY` is used as a generic fallback. Amazon Bedrock uses the standard AWS SDK credential chain (environment, shared profiles, IAM Identity Center/SSO, workload identity). On Windows, restart adOmnia after changing environment variables.

### Agent actions

When **Agent actions** is enabled (off by default), a0 can create request definitions at workspace root from explicit instructions in chat. Created requests open for review and are not sent automatically. The action currently supports name, method, URL, headers and an optional body.

## Data and privacy

- No account, no telemetry, no automatic cloud sync.
- Editing and inspection work offline; network traffic goes only to endpoints you call.
- Cloud AI providers receive the prompt and the workspace context you supply. Ollama or another local endpoint keeps inference on your machine.
- Local storage is not encrypted by default. Store secrets in the **encrypted vault**. Environments marked **Private** are excluded from exports, and exported public environments replace secret values with empty placeholders.

## Command line and CI

The desktop executable also provides headless commands. Examples below assume `adomnia` is on your `PATH`.

### Running a collection

```bash
adomnia run ./my-collection --env prod --folder "Smoke" --reporter junit --out report.xml --bail
```

Supports environment overrides, assertions, sandboxed scripts and CLI, JSON or JUnit reports. Failed requests or assertions return a non-zero exit code.

### Load-testing a flow

Export a **CI plan** from the Flow Stress panel, then run it:

```bash
adomnia stress ./checkout.stress.json --dataset users.csv --env-var BASE_URL=https://staging.example.com --reporter junit --out stress.xml
```

Exit code `1` means a request or performance threshold failed; `2` means the plan is invalid.

### Linting OpenAPI

```bash
adomnia lint ./openapi.yaml --reporter json --out lint-report.json
adomnia lint ./my-collection --ruleset adomnia.oaslint.json --fail-on-warn
```

The same rules are available under **API Docs → Governance**. Errors fail the command; warnings fail it only with `--fail-on-warn`.

<details>
<summary>Environments and credentials in headless runs</summary>

- `--env <name>` loads `environments/<name>.json`; `--env-var KEY=VALUE` overrides a single variable.
- Precedence: collection variables, collection `.env`, named environment, CLI overrides.
- Supported: non-interactive OAuth grants, AWS Signature v4, a per-run cookie jar and multipart file uploads.
- Interactive OAuth (authorization code/PKCE) requires the desktop app; use a refresh token or a non-interactive grant in CI.
- Vault references are resolved from `ADOMNIA_VAULT_<VARIABLE_NAME>` environment variables. The runner does not decrypt exported vault data.

</details>

## Screenshots

<details>
<summary>Light theme, Sketch theme, Hub, Git and Power Tools</summary>

![adOmnia API workspace in the light appearance](assets/images/white.png)

![adOmnia Sketch appearance across workspaces](assets/images/sketch-previews.png)

![The adOmnia Hub in the Sketch appearance](assets/images/adomnia-hub-sketch.png)

![adOmnia Git workspace](assets/images/GIT.png)

![Power Tools with searchable and pinnable utilities](assets/images/powertools.png)

</details>

## Building from source

adOmnia is built with Go, Wails 3, React and TypeScript. Requirements: Go 1.26.5, Node.js 22.13.0 or later, the Wails 3 CLI and the platform WebView development packages.

```bash
git clone https://github.com/Andrea-Cavallo/adOmnia.git
cd adOmnia
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.25
npm --prefix frontend ci
wails3 task dev
```

Production build and packaging:

```bash
wails3 task build
wails3 task package
```

Checks (build the frontend first; the Go binary embeds its assets):

```bash
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run check:startup
go build ./...
go test ./...
```

On Linux, builds use the GTK 3 build tag. See the [build guide](docs/BUILD.md) for native dependencies, per-platform commands and release metadata.

## Documentation

| Document | Contents |
| --- | --- |
| [Installation](docs/INSTALL.md) | Downloads and platform setup |
| [Build](docs/BUILD.md) | Toolchain, native dependencies, packaging |
| [Feature catalog](docs/adomnia-feature-catalog.en.md) | Module-by-module reference |
| [gO Studio](docs/GO-STUDIO.md) | Go IDE usage, trust model, tools, shortcuts |
| [Live Development Session](docs/LIVE-SESSION.md) | Code ↔ running service ↔ API request, debugging across tools |
| [FAQ](docs/FAQ.md) | Common questions |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Diagnostics and recovery |
| [Architecture](docs/ARCHITECTURE.md) | Application structure |
| [Startup performance](docs/PERFORMANCE.md) | Loading strategy and bundle budget |
| [Changelog](CHANGELOG.md) | Changes by version |
| [Release process](docs/RELEASE.md) | Release notes and publishing |

## Contributing

Report bugs and propose changes through [GitHub Issues](https://github.com/Andrea-Cavallo/adOmnia/issues). Include the app version, operating system and steps to reproduce, and remove credentials or private data from examples.

Before submitting code, read [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md), follow the conventions of the module you are changing and describe how you verified the change. Report security vulnerabilities privately as described in the [security policy](.github/SECURITY.md).

## Acknowledgements

Thanks to [albertize](https://github.com/albertize) and [plunix](https://github.com/plunix) for their contributions.

## License

[MIT](LICENSE.md). Copyright © 2026 adOmnia Contributors.
