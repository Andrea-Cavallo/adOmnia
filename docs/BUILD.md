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

Linux native build for WebKitGTK 4.1:

```bash
wails build -clean -platform linux/amd64 -tags webkit2_41 -ldflags "-s -w"
```

macOS:

```bash
wails build -clean -platform darwin/universal -ldflags "-s -w"
```

## Linux Docker Build

The CI Linux build uses [Dockerfile.linux](../Dockerfile.linux). It builds and exports:

- `adOmnia-<version>-linux-amd64.AppImage`

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
- Linux `.AppImage`
- macOS universal `.dmg`
- SHA256 checksums

Pushes to `master`, `main`, or `develop` create artifacts. Tags like `v0.1.0` also publish a GitHub Release.

[.github/workflows/release.yml](../.github/workflows/release.yml) builds the standard native release artifacts, including the Linux amd64 `.tar.gz` linked against WebKitGTK 4.0 for broader compatibility.

[.github/workflows/linux-native-webkitgtk41.yml](../.github/workflows/linux-native-webkitgtk41.yml) builds a native Linux amd64 `.tar.gz` linked against WebKitGTK 4.1. It uses Ubuntu 24.04, installs `libwebkit2gtk-4.1-dev`, passes the Wails/Go build tag `webkit2_41`, and uploads:

- `adOmnia-<version>-linux-amd64-webkitgtk-4.1.tar.gz`
- `adOmnia-<version>-linux-amd64-webkitgtk-4.1.tar.gz.sha256`

It can be run manually from GitHub Actions, or automatically by pushing a tag that starts with `webkitgtk-4.1`.
