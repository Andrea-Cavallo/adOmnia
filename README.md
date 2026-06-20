# adOmnia
![adOmnia banner](assets/images/banner.png)

**The entire API toolchain — REST to Kafka, mock to MITM proxy, database to PDF signing — in one portable app that never leaves your machine.**

REST · gRPC · SOAP · GraphQL · WebSocket · SSE · Kafka · RabbitMQ · MQTT · Redis · NATS
Mock servers · HTTPS proxy · Browser DevTools · Load testing · Database Studio · Encrypted vault
OpenAPI design · Visual test builder · AI mock generation · Git Sync
MCP Client + Server Generator · PDF & LaTeX Studio · WASM + JS plugins · 11 themes

> **Stop paying a subscription to send an HTTP request.** No account. No cloud. No telemetry. One executable, **507+ features**, your data stays yours.

> Proudly listed on **[Awesome Wails](https://github.com/wailsapp/awesome-wails)** and **[Awesome HTTP Clients](https://github.com/mrmykey/awesome-http-clients/tree/main)**.

[![Website](https://img.shields.io/badge/Get%20started%20for%20free-8A2BE2)](https://www.adomnia-dev.com)
[![Awesome Wails](https://img.shields.io/badge/Awesome-Wails-FF3E00?logo=go&logoColor=white)](https://github.com/wailsapp/awesome-wails)
[![Awesome HTTP Clients](https://img.shields.io/badge/Awesome-HTTP_Clients-4285F4?logo=googlechrome&logoColor=white)](https://github.com/mrmykey/awesome-http-clients/tree/main)
![Local First](https://img.shields.io/badge/local--first-yes-22c55e)
![No Telemetry](https://img.shields.io/badge/telemetry-none-0ea5e9)
![License](https://img.shields.io/badge/license-MIT-blue)

---

![adOmnia interface](assets/images/adOmniaInterface1.png)

or white skin:

![adOmnia interface white](assets/images/white.png)

### Why adOmnia

Most API tools went the wrong way: they moved your requests, secrets, and history into someone else's cloud, put your team behind a login wall, and charged you monthly for it. adOmnia is the opposite bet — **one fast desktop app that does more than the cloud suites, while keeping everything on your machine.**

It replaces a whole shelf of tools:

> **Postman + Insomnia + Charles/Fiddler + browser DevTools + a database client + a SOAP/WSDL tool + a load tester + a secrets manager + a PDF signer** — collapsed into a single portable executable that never phones home.

Four things set it apart — and **no other tool combines all four**:

-  **Local-first, for real** — no account, no telemetry, no cloud sync. Your collections, secrets, and traffic never leave your disk. Workspaces are plain files you can put in Git.
-  **Browser debugging built in** — inspect and debug real web pages (network, console, JS debugger, DOM, storage) *inside* the same tool you test APIs with. No competitor does this.
-  **Enterprise & legacy as first-class citizens** — SOAP/WSDL with WS-Security, mTLS, PKCS#12/JKS, gRPC streaming, and **real eIDAS-grade PDF digital signatures** (TSA timestamping + LTV). The boring-but-critical stuff Postman ignores.
-  **Yours to extend** — WASM/JS plugins, importable skins, shareable templates, and 11 built-in themes.

check rest apis:

![adOmnia rest](assets/images/REST.png)


### What you get — 507+ features across 10 areas

| Area | What you get |
|---|---|
| **API Workspace** | Multiple local workspaces with independent collections and tabs, HTTP client (all methods), environments, `{{variable}}` substitution, OAuth2 PKCE, AWS Signature v4, Digest, cURL/OpenAPI import, scripts, assertions, code generation, response history |
| **API Design (spec-first)** | Native OpenAPI 3.x / Swagger 2.x import (file/URL/paste) and round-trip export (JSON/YAML), **Visual OpenAPI Editor** (form-based endpoints, no YAML), read-only **API Docs / Swagger viewer** |
| **API Catalog** | Installable public REST API starters, including curated no-auth/free endpoints inspired by `public-apis/public-apis`, imported directly into local adOmnia collections |
| **Collection Runner & Testing** | Test runner with iterations/delay/retry/CSV datasets, assertion editor (JSONPath, XPath, schema), Mermaid-generated API flows, **no-code Visual Test builder** (block-based, export to Flow), **response schema/contract validation**, test data studio |
| **Protocols** | SOAP/WSDL Studio (1.1 & 1.2, WS-Security), gRPC (server reflection, unary + streaming), WebSocket client + mock server, SSE client, **MCP Client/Debugger** + **MCP Server Generator** (collection/OAS → runnable MCP server; stdio multi-session + HTTP transport) |
| **Brokers** | Kafka (produce/consume/bulk/load test), RabbitMQ, MQTT, Redis Pub/Sub, NATS — shared message log, persistent connection profiles |
| **Simulation & Infrastructure** | Mock server with **Smart Mock Engine** (schema-driven Faker generation) and **conditional expectations** (per-field matching), record & replay, round-robin; HTTPS proxy/interceptor (MITM CA, breakpoints, map local/remote, throttling), Docker Lab (14 presets), load testing (HTTP + gRPC, HDR histogram, P99, side-by-side comparison) |
| **Debugging & Analysis** | Browser DevTools via CDP (network, console, JS debugger, DOM inspector, storage, screenshots), HAR viewer, DNS lookup/trace/compare, port scanner, CORS tester, JSON/XML/YAML tools, observability panel, secret scanner |
| **Document & Productivity Studio** | **PDF Editor** (view, annotate, fill forms, flatten/export) with **real cryptographic signing** — PEM or PKCS#12/JKS keystore import, RFC-3161 **TSA timestamping**, and **LTV** (chain + OCSP/CRL); **LaTeX Studio** (live `.tex` editor + preview + templates); Markdown studio; Mermaid diagrams |
| **Data, Security & Extensibility** | Database Studio (SQLite/PostgreSQL/MySQL/MongoDB), bbolt storage inspector, encrypted vault (age/scrypt), **Git Sync** (commit/push/pull to any repo), **AI engine** (Anthropic/OpenAI/Gemini/Ollama — AI mock generation), WASM/JS plugin sandbox, 11 built-in themes + custom skin system |

### ⬇️ Download

**[→ Go to Releases](../../releases/latest)** and grab the file for your platform. No installation, no dependencies.

| Platform | File | Steps |
|---|---|---|
| Windows | `adOmnia-*-windows-amd64.exe` | Download → double-click → done |
| macOS | `adOmnia-*-macos-universal.dmg` | Download → open DMG → drag to Applications |
| Linux | `adOmnia-*-linux-amd64.AppImage` | Download → `chmod +x` → double-click or run |


### Build from source

Only needed if you want to compile it yourself. Requires Go, Node.js, and Wails.

```bash
git clone https://github.com/Andrea-Cavallo/adOmnia.git && cd adomnia
cd frontend && npm install && cd ..
wails dev          # dev mode
.\build.ps1        # Windows production build
bash build/build-wails.sh linux  # Linux production build
```

Full instructions: [docs/BUILD.md](docs/BUILD.md)

### License

MIT © Andrea Cavallo — [LICENSE.md](LICENSE.md).

---

Special thanks to:
- https://github.com/albertize
- https://github.com/plunix
