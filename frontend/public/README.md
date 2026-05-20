# adOmnia

![adOmnia](icon.png)

adOmnia is a local-first API workbench for backend and integration work.

It brings HTTP collections, environments, mock server tools, proxy/interceptor workflows, Kafka utilities, load testing, developer tools, browser debugging helpers, and detachable dev logs into one Windows desktop app.

Built with **Wails 2**, **Go**, **React**, **Vite**, **TypeScript**, **Tailwind CSS**, and **Zustand**.

No account. No cloud lock-in. Workspaces stay on your machine.

## Status

This repository is currently focused on the Windows desktop build.

The supported build output is:

```text
adomnia.exe
```

The executable is generated in the project root by `build.sh`.

## Main Modules

- **Collections**: HTTP request composer, environments, variables, headers, auth, params, body editor, response viewer, OpenAPI 3.0 import.
- **Mock Server**: local endpoints, responses, latency, hit log, and mock API workflow.
- **Proxy / Interceptor**: capture, inspect, map remote/local, rules, traffic export helpers.
- **Kafka**: producer/consumer focused UI with Kafka-oriented workspace examples.
- **Load Test**: concurrent request runner with metrics and reports.
- **Dev Tools**: encoders, hash/HMAC, JWT, JSON/YAML tools, regex, fake data, HTTP status reference, PEM/JKS helpers, network utilities.
- **Dev Logs**: captures frontend console logs, frontend runtime errors, unhandled promises, and backend Go JSONL logs. The log viewer can pop out into a separate window.
- **Storage / Workspace**: local persistence, import/export, demo workspaces.

## Requirements

Install these on Windows:

- Go 1.22+
- Node.js 18+
- npm
- Git Bash or another shell that can run `bash ./build.sh`
- WebView2 Runtime

The build script drives the Windows toolchain through PowerShell, so running it from PowerShell is fine:

```powershell
bash ./build.sh
```

## Build

From the repository root:

```powershell
bash ./build.sh
```

The script:

1. Builds the frontend with `npm run build`.
2. Runs `go test ./...`.
3. Builds the Wails Windows executable.
4. Copies the generated executable to:

```text
./adomnia.exe
```

## Frontend Development

```powershell
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Frontend production check:

```powershell
cd frontend
npm run build
```

## Backend Check

```powershell
go test ./...
```

## Project Layout

```text
.
├─ app.go                    Wails app lifecycle and app bindings
├─ main.go                   Wails entrypoint
├─ devlog.go                 backend JSONL dev logging
├─ server.go                 local HTTP sidecar
├─ mock.go                   mock server backend
├─ proxy*.go                 proxy/interceptor backend modules
├─ kafka.go                  Kafka backend module
├─ loadtest.go               load testing backend module
├─ frontend/                 React/Vite frontend
├─ frontend/src/components/  UI modules
├─ frontend/src/stores/      Zustand stores
├─ assets/images/            source images and project artwork
├─ docker/adomnia-lab/       local lab/mock workspace support
├─ workspaces/               sample `.adomnia` workspaces
├─ winres/                   Windows icon/resource inputs
└─ build.sh                  Windows exe build script
```

## Dev Logs

Dev Logs collect both sides of the app:

- `FE`: frontend console output and runtime errors.
- `BE`: Go backend logs written to `logs/debug-YYYY-MM-DD.jsonl`.

Open them from the left rail with `LOG`, or use:

```text
Ctrl + Shift + D
```

The viewer can be popped out into its own window so logs do not have to live only inside the main UI.

## Workspaces

adOmnia uses `.adomnia` workspace files for portable local setups.

Example workspaces live in:

```text
workspaces/
```

OpenAPI 3.0 JSON/YAML files can be imported from the Collections header with the upload button. Operations are converted into request folders using the first operation tag when available.

## Local Lab

The Docker lab lives under:

```text
docker/adomnia-lab/
```

It contains a mock API and compose setup useful for local integration testing.

## Git Ignore Policy

Generated outputs are intentionally ignored:

- `adomnia.exe`
- `build/bin/`
- `frontend/dist/`
- `frontend/node_modules/`
- `logs/`
- local caches, temp files, secrets, certificates, and packaged artifacts

Source files, build scripts, frontend package manifests, Docker lab files, workspaces, and app resources should stay versioned.

## License

MIT License. See [LICENSE.md](LICENSE.md).

Developed by Andrea Cavallo.
