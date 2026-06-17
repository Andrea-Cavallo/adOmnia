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

Linux native build for WebKitGTK 4.0:

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

## Linux Native Tarballs

The main CI Linux build in [.github/workflows/build.yml](../.github/workflows/build.yml) builds two native amd64 tarballs:

- `adOmnia-<version>-linux-amd64-webkitgtk-4.0.tar.gz`
- `adOmnia-<version>-linux-amd64-webkitgtk-4.1.tar.gz`

Both tarballs include the executable, Linux icons, `.desktop` file, `install.sh`, `uninstall.sh`, and SHA256 checksum files. They rely on GTK 3 and the matching WebKitGTK runtime from the user's Linux distribution.

The WebKitGTK 4.0 tarball uses the default Wails Linux target. The WebKitGTK 4.1 tarball passes the Wails/Go build tag `webkit2_41`.

## GitHub Actions

[.github/workflows/build.yml](../.github/workflows/build.yml) builds:

- Windows `.exe`
- Linux native `.tar.gz` packages for WebKitGTK 4.0 and 4.1
- macOS universal `.dmg`
- SHA256 checksums

Pushes to `master`, `main`, or `develop` create artifacts. Tags like `v0.1.0` also publish a GitHub Release.

[.github/workflows/release.yml](../.github/workflows/release.yml) builds the standard native release artifacts, including the Linux amd64 `.tar.gz` linked against WebKitGTK 4.0 for broader compatibility.
