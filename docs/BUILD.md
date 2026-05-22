# Build adOmnia from Source

adOmnia is a Wails 2 desktop application with a Go backend and React/TypeScript frontend.

## Requirements

- Go matching `go.mod`
- Node.js 20+
- npm
- Wails CLI `v2.12.0`
- Platform-specific WebView and native build dependencies

Install Wails:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
```

## Frontend

```bash
cd frontend
npm install
npm run build
```

## Backend Checks

```bash
go test ./...
```

## Development Mode

```bash
wails dev
```

## Production Builds

Windows:

```powershell
wails build -clean -platform windows/amd64 -ldflags "-s -w -H windowsgui"
```

Linux:

```bash
wails build -clean -platform linux/amd64 -ldflags "-s -w"
```

macOS:

```bash
wails build -clean -platform darwin/universal -ldflags "-s -w"
```

## Linux Docker Build

The CI Linux build uses [Dockerfile.linux](../Dockerfile.linux). It builds a Linux executable and exports:

- `adOmnia-<version>-linux-amd64`
- `adOmnia-<version>-linux-amd64.tar.gz`

The GitHub workflow exports files with Docker BuildKit:

```bash
docker build \
  -f Dockerfile.linux \
  --target artifact \
  --output type=local,dest=dist \
  .
```

## GitHub Actions

[.github/workflows/build.yml](../.github/workflows/build.yml) builds:

- Windows `.exe`
- Linux executable and `.tar.gz`
- macOS universal `.dmg`
- SHA256 checksums

Pushes to `master`, `main`, or `develop` create artifacts. Tags like `v0.1.0` also publish a GitHub Release.
