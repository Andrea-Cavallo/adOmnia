#!/usr/bin/env bash
# Canonical release build for the host platform. Use CI for cross-platform releases.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="${1:-${VERSION:-dev}}"
BUILD_DATE="${BUILD_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
GIT_COMMIT="${GIT_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)}"
WAILS3_BIN="${WAILS3_BIN:-$(command -v wails3 || true)}"
if [[ -z "$WAILS3_BIN" && -x "$(go env GOPATH)/bin/wails3" ]]; then
    WAILS3_BIN="$(go env GOPATH)/bin/wails3"
fi
if [[ -z "$WAILS3_BIN" ]]; then
    echo "Wails 3 CLI not found. Install: go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.5" >&2
    exit 1
fi

VERSION="$VERSION" BUILD_DATE="$BUILD_DATE" GIT_COMMIT="$GIT_COMMIT" "$WAILS3_BIN" task build
case "$(go env GOOS)" in
    windows) artifact="bin/adomnia.exe" ;;
    *) artifact="bin/adomnia" ;;
esac
test -f "$artifact"
echo "Created $artifact"
