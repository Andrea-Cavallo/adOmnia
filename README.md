# adOmnia

![adOmnia banner](assets/images/banner.png)

## Everything a developer needs. One local workspace.

**adOmnia is an all-in-one, local-first desktop workspace for building, running and debugging software.**

Design and test APIs, write and debug the services behind them, inspect traffic, trace browser behavior, query databases, manage Git and troubleshoot distributed systems — without switching between a dozen tools.

adOmnia brings together REST, GraphQL, SOAP, gRPC, WebSocket, Kafka and other brokers, mocks, an intercepting proxy, browser debugging, log analysis, database explorers, Git and developer utilities. **gO Studio**, the integrated Go IDE, completes the picture with gopls, Delve debugging, tests, coverage and a real terminal.

From the first request to the code that serves it, the whole loop happens in one place.

**One app. One workflow. Your entire development toolbox.**

Available for Windows, macOS and Linux. No account required, no telemetry. Your projects and credentials stay on your machine; optional AI connects only to the provider you choose.

[![Release](https://img.shields.io/github/v/release/Andrea-Cavallo/adOmnia?color=8A2BE2)](https://github.com/Andrea-Cavallo/adOmnia/releases/latest)
[![Build](https://img.shields.io/github/actions/workflow/status/Andrea-Cavallo/adOmnia/build.yml?branch=master&label=build)](https://github.com/Andrea-Cavallo/adOmnia/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.md)
[![Website](https://img.shields.io/badge/website-adomnia--dev.com-8A2BE2)](https://www.adomnia-dev.com)

[Download](#download) · [Capabilities](#capabilities) · [Workflows](#workflows) · [AI](#ai-and-a0) · [CLI](#command-line-and-ci) · [Development](#development) · [Documentation](#documentation)

![adOmnia API workspace with request editing and response inspection](assets/images/adOmniaInterface1.png)

![gO Studio, the Go IDE inside adOmnia: project tree, editor with gutter run actions and the Run console after go run](assets/images/go-ide.png)

*gO Studio: open a real Go project, run it with the ▶ next to `func main`, and read its output in the Run console. Makefile targets, Dockerfiles and docker compose services run from the same gutter.*

## Download

Download the latest desktop build from **[GitHub Releases](https://github.com/Andrea-Cavallo/adOmnia/releases/latest)**. Go and Node.js are only needed when building from source.

| Platform | Release artifact | Getting started |
| --- | --- | --- |
| Windows x64 | `adomnia-<version>-windows-amd64.exe` | Run the executable. The system must have WebView2 available. |
| macOS, Intel and Apple Silicon | `adomnia-<version>-macos-universal.dmg` | Open the disk image and copy the app to Applications. |
| Linux x64 | `adomnia-<version>-linux-amd64-gtk3-webkitgtk-4.1.tar.gz` | Extract and run with GTK 3 and WebKitGTK 4.1 installed. |

Releases include `SHA256SUMS.txt` for download verification. Platform instructions are available in the [installation guide](docs/INSTALL.md); packaging and native dependencies are documented in the [build guide](docs/BUILD.md).

### Your first request

1. Open **API Workspace** and create a **New Request** at workspace root or inside a collection.
2. Select the method, enter the URL and configure headers, authentication or a body as needed.
3. Send the request and inspect its status, timing, headers, response body and assertions.
4. Add an Environment for reusable `{{variables}}`, or import an existing collection, cURL command or OpenAPI document.

Requests at workspace root appear outside your named collections and persist with the active workspace.

## Why adOmnia

- **API client and Go IDE in one ecosystem.** Call an endpoint, open the Go handler behind it in gO Studio, run or debug it locally with Delve, and send the next request without switching tools.
- **Local workspace ownership.** Collections, history and settings live on your machine. Export workspaces as files or collections as folders that can be reviewed and versioned with Git.
- **API and browser investigation together.** Inspect browser network activity, console output, JavaScript, DOM and storage alongside API requests and responses.
- **Support for enterprise systems.** Work with SOAP/WSDL, WS-Security, gRPC streaming, mTLS, certificate keystores and API authentication flows.
- **A customizable desktop workspace.** Choose themes and skins, share templates and extend workflows with local JavaScript plugins.

## Capabilities

| Workspace | Highlights |
| --- | --- |
| **gO Studio (Go IDE)** | Open and trust real Go projects; gopls completion, navigation, refactoring and diagnostics; golangci-lint/staticcheck; build, run, tests with coverage, the Delve debugger and a real terminal; Makefile targets, Dockerfile build & run and docker compose from the gutter; Git in the editor; Fix with AI; links to Docker Lab, Database/Broker Studio and the API Client. |
| **API requests and design** | REST, GraphQL, environments, authentication, scripts, assertions, response history, code generation, Postman/cURL/OpenAPI import, visual OpenAPI editing and governance checks. |
| **Testing and flows** | Collection runner, CSV datasets, visual tests, recorded and AI-assisted flows, response-to-request variables, failure branches, contract checks and flow stress testing with latency, throughput and APDEX gates. |
| **Protocols and brokers** | SOAP/WSDL, gRPC, WebSocket, SSE, Kafka, RabbitMQ, MQTT, Redis Pub/Sub and NATS, with saved connections and message inspection. |
| **Mocks and infrastructure** | Schema-driven mock responses, conditional expectations, record/replay, endpoint traffic inspection, HTTPS interception, breakpoints, mapping, throttling, HTTP/gRPC load tests and Docker Lab. |
| **Debugging and analysis** | Browser DevTools, Application Log Inspector, HAR inspection, network diagnostics, payload tools, stack-to-source navigation and redacted evidence exports. |
| **Data and documents** | SQLite, PostgreSQL, MySQL and MongoDB exploration; local storage inspection; Markdown, Mermaid, LaTeX and PDF editing, annotation, forms and digital signatures. |
| **Git and portable collections** | Clone/init, staging, commits, history graph, branches, merges, push/pull, diffs, conflict resolution and deterministic collection-folder export/import. |
| **AI and MCP** | Configurable cloud/local AI, the a0 assistant, opt-in request creation, model discovery, a local agent gateway, an MCP client/debugger and an MCP server generator. |
| **Security and customization** | Encrypted Vault references, private Environments, certificate tools, local JavaScript plugins, templates and built-in/custom appearances. |

See the [feature catalog](docs/adomnia-feature-catalog.en.md) for module details and the [active work queue](docs/ISSUES.md) for current implementation status.

## Workflows

### Record requests as a Flow

Press **Record**, send requests through the Composer, then stop recording. adOmnia turns the sequence into an editable Flow. Connect response values to later requests, add assertions and recovery branches, generate a Mermaid view and replay the scenario.

![Recording API requests and converting the sequence into a Flow](assets/images/example-rec.gif)

### Mock the request you are working on

Choose **Mock this tab** from an open request to configure its endpoint in the Mock Server. Existing mock definitions remain saved; the selected endpoint stays in focus until you choose **Show all endpoints**. A running server receives the focused configuration without changing its port.

The Traffic view identifies the selected response or explains why a call failed to match, including missing routes, authentication failures and CORS preflight handling.

### Investigate application logs

Drop log files, paste application output or attach supported live `kubectl`, `oc` and Docker sources. Application Log Inspector correlates events on a timeline, pairs request/response payloads and groups recurring errors.

Use structured queries such as:

```text
duration_ms > 1000 AND (status = 500 OR status = 502)
```

Save investigations with their queries, layouts, bookmarks and notes. Export redacted evidence or turn an observed call into an editable request, Flow or mock proposal. Large files use a disk-backed index with paginated results.

![Application Log Inspector with file import and live source options](assets/images/application-logs.png)

### Keep collections in Git

Use **Git Sync → Collection Folder** to export a collection, import a folder-backed collection or check for drift between the app and files on disk. The deterministic layout makes changes easier to review:

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

Collection and folder settings can supply shared authentication, headers, variables and scripts. The built-in Git client handles staging, commits, branch operations, remotes and conflict resolution.

### Develop Go projects in Go Studio

Open a Go module, workspace or repository folder and choose **Trust** to allow local Go tools for that project; until then nothing runs. Go Studio uses the project's Go SDK (detected or installed from the official catalog) for gopls, linting, build, run, tests, coverage and Delve debugging. Several projects stay isolated side by side, and one can move into its own window.

Errors offer **Fix with AI**, which sends the affected code to the AI provider you configured and shows the proposed change as a preview before anything is applied. Git Studio follows the open project's repository, and *Project Services* opens Docker Lab, Database Studio or Broker Studio for the services found in `go.mod`.

See the [Go Studio guide](docs/GO-STUDIO.md) for trust rules, optional tools, storage and shortcuts.

## AI and a0

AI is optional. Configure a provider in **Settings → AI Engine**, select a model and use **Test connection**. The a0 assistant becomes available after the selected provider and model pass the connection check.

Supported providers are **Anthropic, Amazon Bedrock, OpenAI, Google Gemini, DeepSeek, Hugging Face, Ollama and OpenAI-compatible endpoints**. Model discovery and Balanced, Quality, Fast or Local only profiles help with setup while keeping the selected model under your control.

### Credential discovery

Automatic discovery checks process variables, adOmnia Environments and standard `.env` files, with an encrypted Vault fallback. Recognized provider variables include:

| Provider | Credential variables |
| --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Google Gemini | `GEMINI_API_KEY`, `GOOGLE_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |
| Hugging Face | `HUGGINGFACE_API_KEY`, `HF_TOKEN` |
| OpenAI-compatible | `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_API_KEY` |

`ADOMNIA_AI_API_KEY` is a generic fallback. Amazon Bedrock uses the AWS SDK credential chain, including environment credentials, shared profiles, IAM Identity Center/SSO and workload identities. On Windows, restart adOmnia after changing user or system environment variables.

### Agent actions

Enable **Agent actions** to let a0 create supported request definitions at workspace root from explicit chat instructions. For example, “Create a greeting API request outside my collections” creates and opens a request for review. Request definitions belong to the API client; the target API or mock server supplies the response when you send them.

Agent actions are disabled by default. The current creation action supports a name, method, URL, headers and an optional body. a0 replies in English and uses credential placeholders in its suggestions.

## Data and privacy

adOmnia stores workspace data locally and does not require an adOmnia account, collect telemetry or provide automatic cloud workspace sync. Core editing and inspection tools work offline; network operations connect to the endpoints you choose.

Cloud AI sends prompts and the supplied workspace context to your selected provider. Local AI can use Ollama or a locally hosted compatible endpoint. Model discovery also contacts the configured provider when requested, or when the optional refresh-on-open setting is enabled.

Use the **encrypted Vault** for sensitive values. Ordinary request and environment fields are not encrypted simply because they are stored locally. Environments marked **Private** are excluded from workspace-file and collection-folder exports; exported public environment secrets use empty placeholders.

## Command line and CI

The desktop executable also exposes headless commands. The examples below use `adomnia`; substitute the downloaded executable path when it is not on your `PATH`.

### Run a collection

```bash
adomnia run ./my-collection --env prod --folder "Smoke" --reporter junit --out report.xml --bail
```

The runner supports environment overrides, assertions, sandboxed scripts and CLI/JSON/JUnit reports. Failed requests or assertions produce a non-zero exit code.

### Stress-test a Flow

Export a **CI plan** from the Flow Stress dock, then run it with an optional dataset:

```bash
adomnia stress ./checkout.stress.json --dataset users.csv --env-var BASE_URL=https://staging.example.com --reporter junit --out stress.xml
```

The plan preserves graph execution, response variables and recovery branches. Exit code `1` indicates a failed request or configured performance gate; `2` indicates an invalid plan.

### Lint OpenAPI

```bash
adomnia lint ./openapi.yaml --reporter json --out lint-report.json
adomnia lint ./my-collection --ruleset adomnia.oaslint.json --fail-on-warn
```

The same rules are available in **API Docs → Governance**. Errors fail the command; warnings fail it only with `--fail-on-warn`.

<details>
<summary>Runner environments and credentials</summary>

- Use `--env` to load `environments/<name>.json`, or `--env-var KEY=VALUE` to override a variable.
- Variable precedence is collection variables, collection-local `.env`, named Environment, then CLI overrides.
- Headless runs support non-interactive OAuth grants, AWS Signature v4, a run-scoped cookie jar and multipart file parts.
- Interactive OAuth authorization-code/PKCE flows belong to the desktop; use a refresh token or non-interactive grant in CI.
- Supply Vault references through matching `ADOMNIA_VAULT_<VARIABLE_NAME>` process variables. The runner does not decrypt exported Vault ciphertext.

</details>

## Interface gallery

<details>
<summary>Explore the light, Sketch, Git and Power Tools workspaces</summary>

### Light appearance

![adOmnia API workspace in the light appearance](assets/images/white.png)

### Sketch appearance

![adOmnia Sketch appearance across workspaces](assets/images/sketch-previews.png)

### Hub

![The adOmnia Hub in the Sketch appearance](assets/images/adomnia-hub-sketch.png)

### Git Sync

![adOmnia Git workspace](assets/images/GIT.png)

### Power Tools

![Power Tools Studio with searchable and pinnable utilities](assets/images/powertools.png)

</details>

## Development

adOmnia uses **Go, Wails 3, React and TypeScript**. Source builds require Go `1.26.5`, Node.js `22.13.0+`, npm, the pinned Wails CLI and platform WebView development dependencies.

```bash
git clone https://github.com/Andrea-Cavallo/adOmnia.git
cd adOmnia
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.5
npm --prefix frontend ci
wails3 task dev
```

Build a native executable or distributable bundle:

```bash
wails3 task build
wails3 task package
```

Run the frontend build before Go checks, because the desktop embeds the generated frontend assets:

```bash
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run check:startup
go build ./...
go test ./...
```

Linux checks and builds use the GTK 3 compatibility tag; see [the build guide](docs/BUILD.md) for native packages, platform commands and release metadata.

## Documentation

| Guide | Contents |
| --- | --- |
| [Installation](docs/INSTALL.md) | Desktop downloads and platform setup. |
| [Build from source](docs/BUILD.md) | Toolchain, native dependencies and packaging. |
| [Feature catalog](docs/adomnia-feature-catalog.en.md) | Detailed module inventory. |
| [Go Studio](docs/GO-STUDIO.md) | Go IDE usage, project trust, optional tools, persistence and shortcuts. |
| [FAQ](docs/FAQ.md) | Common product and setup questions. |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Diagnostics and recovery steps. |
| [Architecture](docs/ARCHITECTURE.md) | Application structure and technical context. |
| [Startup performance](docs/PERFORMANCE.md) | Loading strategy, bundle budget and measurement limits. |
| [Changelog](CHANGELOG.md) | Version-by-version changes. |
| [Release guide](docs/RELEASE.md) | Release notes and publishing process. |

## Contributing

Report reproducible bugs or propose improvements through [GitHub Issues](https://github.com/Andrea-Cavallo/adOmnia/issues). Include the app version, operating system and steps to reproduce; redact credentials and private payloads from examples.

For code contributions, read [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md), follow existing module conventions and include relevant verification with your pull request. Report vulnerabilities privately through the [security policy](.github/SECURITY.md).

## Acknowledgements and license

Thanks to [albertize](https://github.com/albertize) and [plunix](https://github.com/plunix) for their contributions and support.

Released under the [MIT License](LICENSE.md). Copyright © 2026 adOmnia Contributors.
