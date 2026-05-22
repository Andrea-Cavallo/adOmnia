# Troubleshooting

## Windows SmartScreen Warning

Unsigned `.exe` files may show a SmartScreen warning.

Check that you downloaded the file from the official GitHub Release or Actions run. Code signing can be configured later to reduce warnings.

## macOS Gatekeeper Warning

Unsigned or non-notarized `.dmg` builds may be blocked by Gatekeeper.

This is expected for development releases. Notarized releases require Apple Developer signing credentials in CI.

## Linux App Does Not Launch

Wails Linux builds require system WebKitGTK/GTK runtime libraries.

On Debian/Ubuntu-like systems, install:

```bash
sudo apt-get update
sudo apt-get install -y libgtk-3-0 libwebkit2gtk-4.0-37 libayatana-appindicator3-1
```

Package names vary by distribution.

## Docker Build Fails Locally

Make sure Docker Desktop or the Docker daemon is running:

```bash
docker info
```

The Linux artifact build uses:

```bash
docker build -f Dockerfile.linux --target artifact --output type=local,dest=dist .
```

## npm Install or Build Fails

Use Node.js 20+ and install from the frontend directory:

```bash
cd frontend
npm ci
npm run build
```

If dependencies are stale, remove `frontend/node_modules` and run `npm ci` again.

## Wails CLI Not Found

Install the pinned Wails CLI:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
```

Make sure your Go bin directory is on `PATH`.

## Proxy or Mock Ports Are Busy

Another process may already be using the selected local port. Stop the other process or choose a different port.

## Secrets or Tokens Appear in Exports

Workspaces, HAR files, proxy captures, and logs can contain sensitive headers, payloads, URLs, cookies, or tokens. Review exports before sharing them.
