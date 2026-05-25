# adOmnia

**Everything you need to build, debug, and test APIs — in a single desktop app. No account. No cloud. 100% local.**

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

### What is adOmnia

A desktop toolbox for API development, testing, and debugging. REST, SOAP, gRPC, WebSocket, SSE, GraphQL, Kafka, RabbitMQ, MQTT, Redis, NATS — all in one app. Mock servers, proxy interception, browser debugging, database access, load testing, encrypted vault. No account required, no telemetry, nothing leaves your machine.

| Area | What you get |
|---|---|
| **API Workspace** | Collections, environments, variables, auth, scripts, assertions, cURL & OpenAPI import |
| **Protocols** | SOAP/WSDL Studio, gRPC, WebSocket, SSE |
| **Brokers** | Kafka, RabbitMQ, MQTT, Redis, NATS |
| **Simulation** | Mock server, proxy/interceptor, record & replay, Docker Lab |
| **Debugging** | Browser DevTools (CDP), HAR viewer, DNS, CORS, port scanner |
| **Data & Security** | Database Studio, encrypted vault, secret scanner, cert tools (PEM/JKS) |
| **Customization** | Themes, skins, WASM plugins, Python SDK |

### Download

**[→ Go to Releases](../../releases/latest)** and download the file for your platform. No installation required.

| Platform | File | Steps |
|---|---|---|
| Windows | `adOmnia-*-windows-amd64.exe` | Download → double-click → done |
| macOS | `adOmnia-*-macos-universal.dmg` | Download → open DMG → drag to Applications |
| Linux | `adOmnia-*-linux-amd64.AppImage` | Download → `chmod +x` → double-click or run |

No installation, no dependencies. The Linux AppImage bundles everything (including WebKitGTK) — it runs on any distro out of the box.

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

### Qué es adOmnia

Toolbox desktop para desarrollo, pruebas y debugging de APIs. REST, SOAP, gRPC, WebSocket, Kafka, mock servers, proxy, browser debugging, bases de datos — todo en una sola app. Sin cuenta, sin telemetría, sin nube.

| Área | Qué incluye |
|---|---|
| **API Workspace** | Colecciones, entornos, variables, auth, scripts, import cURL y OpenAPI |
| **Protocolos** | SOAP/WSDL Studio, gRPC, WebSocket, SSE |
| **Mensajería** | Kafka, RabbitMQ, MQTT, Redis, NATS |
| **Simulación** | Mock server, proxy/interceptor, record & replay, Docker Lab |
| **Debugging** | Browser DevTools (CDP), HAR viewer, DNS, CORS, port scanner |
| **Datos y seguridad** | Database Studio, vault cifrado, secret scanner, PEM/JKS |
| **Personalización** | Temas, skins, plugins WASM, SDK Python |

### Descarga

**[→ Ir a Releases](../../releases/latest)** y descarga el archivo para tu plataforma. Sin instalación.

| Plataforma | Archivo | Pasos |
|---|---|---|
| Windows | `adOmnia-*-windows-amd64.exe` | Descarga → doble clic → listo |
| macOS | `adOmnia-*-macos-universal.dmg` | Descarga → abre el DMG → arrastra a Aplicaciones |
| Linux | `adOmnia-*-linux-amd64.AppImage` | Descarga → `chmod +x` → doble clic o ejecuta |

Sin instalación, sin dependencias. El AppImage incluye todo (WebKitGTK incluido) y funciona en cualquier distribución.

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

### Cos'è adOmnia

Una toolbox desktop per sviluppare, testare e fare debug di API. REST, SOAP, gRPC, WebSocket, Kafka, mock server, proxy, browser debugging, database — tutto in un'unica app. Nessun account, nessuna telemetria, nessun dato esce dalla tua macchina.

| Area | Cosa include |
|---|---|
| **API Workspace** | Collezioni, ambienti, variabili, auth, script, assertion, import cURL e OpenAPI |
| **Protocolli** | SOAP/WSDL Studio, gRPC, WebSocket, SSE |
| **Broker** | Kafka, RabbitMQ, MQTT, Redis, NATS |
| **Simulazione** | Mock server, proxy/interceptor, record & replay, Docker Lab |
| **Debugging** | Browser DevTools (CDP), HAR viewer, DNS, CORS, port scanner |
| **Dati e sicurezza** | Database Studio, vault cifrato, secret scanner, PEM/JKS |
| **Personalizzazione** | Temi, skin, plugin WASM, SDK Python |

### Download

**[→ Vai alle Releases](../../releases/latest)** e scarica il file per la tua piattaforma. Nessuna installazione richiesta.

| Piattaforma | File | Passi |
|---|---|---|
| Windows | `adOmnia-*-windows-amd64.exe` | Scarica → doppio clic → fatto |
| macOS | `adOmnia-*-macos-universal.dmg` | Scarica → apri il DMG → trascina in Applicazioni |
| Linux | `adOmnia-*-linux-amd64.AppImage` | Scarica → `chmod +x` → doppio clic o avvia da terminale |

Nessuna installazione, nessuna dipendenza. L'AppImage porta tutto dentro (WebKitGTK incluso) — funziona su qualsiasi distro senza installare nulla.

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
