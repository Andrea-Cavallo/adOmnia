# Build adOmnia from Source

adOmnia is a Wails 3 desktop application with a Go backend and a React/TypeScript frontend.

## Requirements

- Go `1.26.5` (the version declared in `go.mod`)
- Node.js 22.13.0+ and npm
- Wails CLI `v3.0.0-beta.5`
- Native WebView development packages for the target OS

Install the pinned Wails CLI:

```bash
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.5
```

## Development and checks

```bash
wails3 dev -config ./build/config.yml
cd frontend && npx tsc --noEmit && npm run build
go build ./... && go test ./...
```

## Production builds

The Taskfile is the canonical build interface. It generates bindings, builds the
frontend, and then builds the native executable for the current platform.

```bash
wails3 task build
wails3 task package
```

Set release metadata through environment variables:

```bash
VERSION=1.2.3 BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" GIT_COMMIT="$(git rev-parse HEAD)" wails3 task build
```

Windows produces `bin/adomnia.exe`. macOS packaging produces an `.app` bundle;
use `scripts/build-macos.sh <version>` on a macOS host for the universal DMG.

## Linux

Wails 3 defaults to GTK4/WebKitGTK 6.0. Release builds deliberately use the
supported `gtk3` compatibility tag, which links against GTK3/WebKitGTK 4.1 and
is available on current LTS distributions and CI runners.

```bash
sudo apt-get install build-essential libayatana-appindicator3-dev libgtk-3-dev libwebkit2gtk-4.1-dev pkg-config
bash build/linux/package-native-tarballs.sh 1.2.3
```

The package is named `adomnia-<version>-linux-amd64-gtk3-webkitgtk-4.1.tar.gz`.

## CI releases

The release workflows build Windows, Linux GTK3/WebKitGTK 4.1 and universal
macOS artifacts on their native runners. Cross-compiling macOS desktop builds
from Windows or Linux is not supported because Wails needs Xcode and CGO.
