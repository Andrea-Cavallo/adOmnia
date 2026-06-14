# adOmnia

**The entire API toolchain — REST to Kafka, mock to MITM proxy, database to PDF signing — in one portable app that never leaves your machine.**

REST · gRPC · SOAP · GraphQL · WebSocket · SSE · Kafka · RabbitMQ · MQTT · Redis · NATS
Mock servers · HTTPS proxy · Browser DevTools · Load testing · Database Studio · Encrypted vault
OpenAPI design · Visual test builder · Scheduled tasks · AI mock generation · Git Sync
MCP Client + Server Generator · PDF & LaTeX Studio · WASM + Python plugins · 11 themes

> **Stop paying a subscription to send an HTTP request.** No account. No cloud. No telemetry. One executable, **507+ features**, your data stays yours.

> Proudly listed on **[Awesome Wails](https://github.com/wailsapp/awesome-wails)** and **[Awesome HTTP Clients](https://github.com/mrmykey/awesome-http-clients/tree/main)**.

[![Website](https://img.shields.io/badge/Get%20started%20for%20free-8A2BE2)](https://www.adomnia-dev.com)
[![Awesome Wails](https://img.shields.io/badge/Awesome-Wails-FF3E00?logo=go&logoColor=white)](https://github.com/wailsapp/awesome-wails)
[![Awesome HTTP Clients](https://img.shields.io/badge/Awesome-HTTP_Clients-4285F4?logo=googlechrome&logoColor=white)](https://github.com/mrmykey/awesome-http-clients/tree/main)
![Local First](https://img.shields.io/badge/local--first-yes-22c55e)
![No Telemetry](https://img.shields.io/badge/telemetry-none-0ea5e9)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Languages · Idiomas · Lingue
[English](#english) · [Español](#español) · [Italiano](#italiano)

---

## English

![adOmnia interface](assets/images/adOmniaInterface1.png)

or white skin:

![adOmnia interface white](assets/images/white.png)

### Why adOmnia

Most API tools went the wrong way: they moved your requests, secrets, and history into someone else's cloud, put your team behind a login wall, and charged you monthly for it. adOmnia is the opposite bet — **one fast desktop app that does more than the cloud suites, while keeping everything on your machine.**

It replaces a whole shelf of tools:

> **Postman + Insomnia + Charles/Fiddler + browser DevTools + a database client + a SOAP/WSDL tool + a load tester + a secrets manager + a PDF signer** — collapsed into a single portable executable that never phones home.

Four things set it apart — and **no other tool combines all four**:

- 🔒 **Local-first, for real** — no account, no telemetry, no cloud sync. Your collections, secrets, and traffic never leave your disk. Workspaces are plain files you can put in Git.
- 🌐 **Browser debugging built in** — inspect and debug real web pages (network, console, JS debugger, DOM, storage) *inside* the same tool you test APIs with. No competitor does this.
- 🏛️ **Enterprise & legacy as first-class citizens** — SOAP/WSDL with WS-Security, mTLS, PKCS#12/JKS, gRPC streaming, and **real eIDAS-grade PDF digital signatures** (TSA timestamping + LTV). The boring-but-critical stuff Postman ignores.
- 🧩 **Yours to extend** — WASM and Python plugins, importable skins, shareable templates, and 11 built-in themes.

check rest apis:

![adOmnia rest](assets/images/REST.png)

![adOmnia rest](assets/images/REST1.png)

### What you get — 507+ features across 10 areas

| Area | What you get |
|---|---|
| **API Workspace** | Multiple local workspaces with independent collections and tabs, HTTP client (all methods), environments, `{{variable}}` substitution, OAuth2 PKCE, AWS Signature v4, Digest, cURL/OpenAPI import, scripts, assertions, code generation, response history |
| **API Design (spec-first)** | Native OpenAPI 3.x / Swagger 2.x import (file/URL/paste) and round-trip export (JSON/YAML), **Visual OpenAPI Editor** (form-based endpoints, no YAML), reusable **Schema Components** with `$ref` resolution, read-only **API Docs / Swagger viewer** |
| **API Catalog** | Installable public REST API starters, including curated no-auth/free endpoints inspired by `public-apis/public-apis`, imported directly into local adOmnia collections |
| **Collection Runner & Testing** | Test runner with iterations/delay/retry/CSV datasets, assertion editor (JSONPath, XPath, schema), Mermaid-generated API flows, **no-code Visual Test builder** (block-based, export to Flow), **Scheduled Tasks** (local cron runner with history), **response schema/contract validation**, test data studio |
| **Protocols** | SOAP/WSDL Studio (1.1 & 1.2, WS-Security), gRPC (server reflection, unary + streaming), WebSocket client + mock server, SSE client, **MCP Client/Debugger** + **MCP Server Generator** (collection/OAS → runnable MCP server; stdio multi-session + HTTP transport) |
| **Brokers** | Kafka (produce/consume/bulk/load test), RabbitMQ, MQTT, Redis Pub/Sub, NATS — shared message log, persistent connection profiles |
| **Simulation & Infrastructure** | Mock server with **Smart Mock Engine** (schema-driven Faker generation) and **conditional expectations** (per-field matching), record & replay, round-robin; HTTPS proxy/interceptor (MITM CA, breakpoints, map local/remote, throttling), Docker Lab (14 presets), load testing (HTTP + gRPC, HDR histogram, P99, side-by-side comparison) |
| **Debugging & Analysis** | Browser DevTools via CDP (network, console, JS debugger, DOM inspector, storage, screenshots), HAR viewer, DNS lookup/trace/compare, port scanner, CORS tester, JSON/XML/YAML tools, observability panel, secret scanner |
| **Document & Productivity Studio** | **PDF Editor** (view, annotate, fill forms, flatten/export) with **real cryptographic signing** — PEM or PKCS#12/JKS keystore import, RFC-3161 **TSA timestamping**, and **LTV** (chain + OCSP/CRL); **LaTeX Studio** (live `.tex` editor + preview + templates); Markdown studio; Mermaid diagrams |
| **Data, Security & Extensibility** | Database Studio (SQLite/PostgreSQL/MySQL/MongoDB), bbolt storage inspector, encrypted vault (age/scrypt), **Git Sync** (commit/push/pull to any repo), **AI engine** (Anthropic/OpenAI/Gemini/Ollama — AI mock generation), WASM plugin sandbox, Python Plugin SDK, 11 built-in themes + custom skin system |

### ⬇️ Download

**[→ Go to Releases](../../releases/latest)** and grab the file for your platform. No installation, no dependencies.

| Platform | File | Steps |
|---|---|---|
| Windows | `adOmnia-*-windows-amd64.exe` | Download → double-click → done |
| macOS | `adOmnia-*-macos-universal.dmg` | Download → open DMG → drag to Applications |
| Linux | `adOmnia-*-linux-amd64.AppImage` | Download → `chmod +x` → double-click or run |

The Linux AppImage bundles everything (including WebKitGTK) and runs on any distro out of the box.

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

## Español

![adOmnia interface](assets/images/adOmniaInterface1.png)

### Por qué adOmnia

La mayoría de las herramientas de API se fueron por el camino equivocado: llevaron tus peticiones, secretos e historial a la nube de otra empresa, pusieron a tu equipo detrás de un login y te cobran cada mes por ello. adOmnia apuesta por lo contrario — **una app de escritorio rápida que hace más que las suites en la nube, manteniendo todo en tu máquina.**

Reemplaza una estantería entera de herramientas:

> **Postman + Insomnia + Charles/Fiddler + DevTools del navegador + un cliente de base de datos + una herramienta SOAP/WSDL + un load tester + un gestor de secretos + un firmador de PDF** — en un único ejecutable portable que nunca envía datos.

Cuatro cosas la diferencian — y **ninguna otra herramienta combina las cuatro**:

- 🔒 **Local-first de verdad** — sin cuenta, sin telemetría, sin sync en la nube. Tus colecciones, secretos y tráfico nunca salen del disco. Los workspaces son archivos que puedes versionar en Git.
- 🌐 **Depuración de navegador integrada** — inspecciona y depura páginas web reales (red, consola, debugger JS, DOM, storage) *dentro* de la misma herramienta con la que pruebas APIs. Ningún competidor lo hace.
- 🏛️ **Empresa y legacy como ciudadanos de primera** — SOAP/WSDL con WS-Security, mTLS, PKCS#12/JKS, gRPC streaming y **firmas digitales de PDF reales** (sellado TSA + LTV).
- 🧩 **Tuya para extender** — plugins WASM y Python, skins importables, plantillas compartibles y 11 temas.

### 507+ funciones en 10 áreas

| Área | Qué incluye |
|---|---|
| **API Workspace** | Workspaces locales múltiples con colecciones y pestañas independientes, cliente HTTP completo, entornos, sustitución `{{variable}}`, OAuth2 PKCE, AWS v4, import cURL/OpenAPI, scripts, assertions, generación de código |
| **Diseño de API (spec-first)** | Import nativo OpenAPI 3.x / Swagger 2.x (archivo/URL/pegar) y export round-trip (JSON/YAML), **Editor OpenAPI visual** (endpoints por formulario, sin YAML), **Schema Components** reutilizables con `$ref`, **visor API Docs / Swagger** |
| **Testing y Runner** | Runner con iteraciones/delay/CSV, assertion editor (JSONPath, XPath, schema), flows API desde Mermaid, **constructor de tests visual no-code** (por bloques, export a Flow), **Tareas Programadas** (cron local con historial), **validación de schema/contract de la respuesta**, test data studio |
| **Protocolos** | SOAP/WSDL Studio (WS-Security), gRPC (reflection + streaming), WebSocket + mock server, SSE, **MCP Client/Debugger** + **MCP Server Generator** (colección/OAS → servidor MCP ejecutable; stdio multi-sesión + HTTP) |
| **Mensajería** | Kafka, RabbitMQ, MQTT, Redis Pub/Sub, NATS — log compartido, perfiles persistentes |
| **Simulación e Infraestructura** | Mock server con **Smart Mock Engine** (generación Faker desde schema) y **expectations condicionales** (match por campo), record & replay, round-robin; proxy HTTPS (MITM CA, breakpoints, throttling), Docker Lab (14 presets), load testing (HTTP + gRPC, P99, HDR histogram) |
| **Debugging y Análisis** | Browser DevTools vía CDP (red, consola, debugger JS, DOM, storage, screenshots), HAR viewer, DNS, port scanner, CORS tester, herramientas JSON/XML, secret scanner |
| **Studio de Documentos y Productividad** | **Editor PDF** (ver, anotar, rellenar formularios, aplanar/exportar) con **firma criptográfica real** — import PEM o keystore PKCS#12/JKS, **sellado TSA** RFC-3161 y **LTV** (cadena + OCSP/CRL); **LaTeX Studio** (editor `.tex` con preview y plantillas); Markdown; diagramas Mermaid |
| **Datos, Seguridad y Extensibilidad** | Database Studio (SQLite/PostgreSQL/MySQL/MongoDB), vault cifrado (age/scrypt), **Git Sync**, **IA** (Anthropic/OpenAI/Gemini/Ollama — generación de mocks), plugins WASM, SDK Python, 11 temas |

### Descarga

**[→ Ir a Releases](../../releases/latest)** y descarga el archivo para tu plataforma. Sin instalación, sin dependencias.

| Plataforma | Archivo | Pasos |
|---|---|---|
| Windows | `adOmnia-*-windows-amd64.exe` | Descarga → doble clic → listo |
| macOS | `adOmnia-*-macos-universal.dmg` | Descarga → abre el DMG → arrastra a Aplicaciones |
| Linux | `adOmnia-*-linux-amd64.AppImage` | Descarga → `chmod +x` → doble clic o ejecuta |

El AppImage incluye todo (WebKitGTK incluido) y funciona en cualquier distribución.

### Compilar desde el código fuente

Solo necesario si quieres compilarlo tú mismo. Requiere Go, Node.js y Wails.

```bash
git clone https://github.com/Andrea-Cavallo/adOmnia.git && cd adomnia
cd frontend && npm install && cd ..
wails dev
.\build.ps1        # Windows
bash build/build-wails.sh linux  # Linux
```

Guía completa: [docs/BUILD.md](docs/BUILD.md)

### Licencia

MIT © Andrea Cavallo — [LICENSE.md](LICENSE.md).

---

## Italiano

![adOmnia interface](assets/images/adOmniaInterface1.png)

### Perché adOmnia

La maggior parte degli strumenti per API ha preso la strada sbagliata: ha spostato le tue richieste, i tuoi segreti e lo storico nel cloud di qualcun altro, ha messo il tuo team dietro un login e ti fa pagare un abbonamento per questo. adOmnia fa la scommessa opposta — **una sola app desktop veloce che fa più delle suite cloud, tenendo tutto sulla tua macchina.**

Sostituisce un'intera libreria di strumenti:

> **Postman + Insomnia + Charles/Fiddler + DevTools del browser + un client database + uno strumento SOAP/WSDL + un load tester + un gestore di segreti + un firmatore di PDF** — in un unico eseguibile portatile che non invia mai dati fuori dalla tua macchina.

Quattro cose la rendono diversa — e **nessun altro strumento le combina tutte e quattro**:

- 🔒 **Local-first sul serio** — nessun account, nessuna telemetria, nessun sync sul cloud. Collection, segreti e traffico non lasciano mai il tuo disco. I workspace sono file che puoi versionare in Git.
- 🌐 **Debug del browser integrato** — ispeziona e fai il debug di vere pagine web (rete, console, debugger JS, DOM, storage) *dentro* lo stesso strumento con cui testi le API. Nessun concorrente lo fa.
- 🏛️ **Enterprise e legacy trattati da protagonisti** — SOAP/WSDL con WS-Security, mTLS, PKCS#12/JKS, gRPC streaming e **firme digitali PDF reali** (marca temporale TSA + LTV). Le cose noiose ma critiche che Postman ignora.
- 🧩 **Tua da estendere** — plugin WASM e Python, skin importabili, template condivisibili e 11 temi integrati.

### 507+ funzionalità in 10 aree

| Area | Cosa include |
|---|---|
| **API Workspace** | Workspace locali multipli con collection e tab indipendenti, client HTTP completo, ambienti, sostituzione `{{variabile}}`, OAuth2 PKCE, AWS Signature v4, import cURL/OpenAPI, script, assertion, generazione codice |
| **API Design (spec-first)** | Import nativo OpenAPI 3.x / Swagger 2.x (file/URL/incolla) ed export round-trip (JSON/YAML), **Editor OpenAPI visuale** (endpoint a form, senza YAML), **Schema Components** riusabili con `$ref`, **viewer API Docs / Swagger** |
| **Testing e Runner** | Runner con iterazioni/delay/CSV, assertion editor (JSONPath, XPath, schema), flow API generati da Mermaid, **builder di test visuale no-code** (a blocchi, export verso Flow), **Attività Pianificate** (cron locale con storico), **validazione schema/contract della risposta**, test data studio |
| **Protocolli** | SOAP/WSDL Studio (WS-Security), gRPC (server reflection + streaming), WebSocket + mock server, SSE, **MCP Client/Debugger** + **MCP Server Generator** (collection/OAS → server MCP eseguibile; stdio multi-sessione + HTTP) |
| **Broker** | Kafka, RabbitMQ, MQTT, Redis Pub/Sub, NATS — log messaggi condiviso, profili connessione persistenti |
| **Simulazione e Infrastruttura** | Mock server con **Smart Mock Engine** (generazione Faker da schema) ed **expectations condizionali** (match per campo), record & replay, round-robin; proxy HTTPS (MITM CA, breakpoint, map local/remote, throttling), Docker Lab (14 preset), load testing (HTTP + gRPC, P99, istogramma HDR) |
| **Debugging e Analisi** | Browser DevTools via CDP (rete, console, debugger JS, DOM, storage, screenshot), HAR viewer, DNS, port scanner, CORS tester, strumenti JSON/XML, secret scanner |
| **Studio Documenti e Produttività** | **Editor PDF** (visualizza, annota, compila moduli, appiattisci/esporta) con **firma crittografica reale** — import PEM o keystore PKCS#12/JKS, **marca temporale TSA** RFC-3161 e **LTV** (catena + OCSP/CRL); **LaTeX Studio** (editor `.tex` con preview e template); Markdown; diagrammi Mermaid |
| **Dati, Sicurezza e Estendibilità** | Database Studio (SQLite/PostgreSQL/MySQL/MongoDB), vault cifrato (age/scrypt), **Git Sync**, **AI engine** (Anthropic/OpenAI/Gemini/Ollama — generazione mock AI), plugin WASM, SDK Python, 11 temi + skin custom |

### Download

**[→ Vai alle Releases](../../releases/latest)** e scarica il file per la tua piattaforma. Nessuna installazione, nessuna dipendenza.

| Piattaforma | File | Passi |
|---|---|---|
| Windows | `adOmnia-*-windows-amd64.exe` | Scarica → doppio clic → fatto |
| macOS | `adOmnia-*-macos-universal.dmg` | Scarica → apri il DMG → trascina in Applicazioni |
| Linux | `adOmnia-*-linux-amd64.AppImage` | Scarica → `chmod +x` → doppio clic o avvia da terminale |

L'AppImage porta tutto dentro (WebKitGTK incluso) — funziona su qualsiasi distro senza installare nulla.

### Build da sorgente

Solo se vuoi compilarlo tu. Richiede Go, Node.js e Wails.

```bash
git clone https://github.com/Andrea-Cavallo/adOmnia.git && cd adomnia
cd frontend && npm install && cd ..
wails dev
.\build.ps1        # Windows
bash build/build-wails.sh linux  # Linux
```

Guida completa: [docs/BUILD.md](docs/BUILD.md)

### Licenza

MIT © Andrea Cavallo — [LICENSE.md](LICENSE.md).

---

Special thanks to:
- https://github.com/albertize
- https://github.com/plunix
