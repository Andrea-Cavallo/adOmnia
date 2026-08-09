#!/usr/bin/env bash
# Build a signed-ready universal adOmnia.app and an optional DMG on macOS.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="${1:-${VERSION:-dev}}"
BUILD_DATE="${BUILD_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
GIT_COMMIT="${GIT_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)}"
APP_NAME="adomnia"
DIST_DIR="dist"
APP_PATH="$DIST_DIR/${APP_NAME}.app"
WAILS3_BIN="${WAILS3_BIN:-$(command -v wails3 || true)}"

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "This script must run on macOS: native Wails builds require Xcode and CGO." >&2
    exit 1
fi

for command in go node npm lipo plutil; do
    command -v "$command" >/dev/null || { echo "Missing prerequisite: $command" >&2; exit 1; }
done
if [[ -z "$WAILS3_BIN" && -x "$(go env GOPATH)/bin/wails3" ]]; then
    WAILS3_BIN="$(go env GOPATH)/bin/wails3"
fi
if [[ -z "$WAILS3_BIN" ]]; then
    echo "Wails 3 CLI not found. Install: go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.5" >&2
    exit 1
fi

echo "Building adOmnia ${VERSION} for macOS (universal)"
"$WAILS3_BIN" generate bindings -clean=true -ts ./...
(cd frontend && npm ci && npm run build)

mkdir -p "$DIST_DIR" "$APP_PATH/Contents/MacOS" "$APP_PATH/Contents/Resources"
LDFLAGS="-s -w -X main.Version=${VERSION} -X main.BuildDate=${BUILD_DATE} -X main.GitCommit=${GIT_COMMIT}"

for architecture in arm64 amd64; do
    GOARCH="$architecture" CGO_ENABLED=1 go build \
        -buildvcs=false -trimpath -tags production -ldflags "$LDFLAGS" \
        -o "/tmp/${APP_NAME}-${architecture}" .
done
lipo -create -output "$APP_PATH/Contents/MacOS/$APP_NAME" \
    "/tmp/${APP_NAME}-arm64" "/tmp/${APP_NAME}-amd64"
rm -f "/tmp/${APP_NAME}-arm64" "/tmp/${APP_NAME}-amd64"
chmod +x "$APP_PATH/Contents/MacOS/$APP_NAME"

cp build/darwin/Info.plist "$APP_PATH/Contents/Info.plist"
plutil -replace CFBundleVersion -string "$VERSION" "$APP_PATH/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$APP_PATH/Contents/Info.plist"
if [[ -f build/darwin/iconfile.icns ]]; then
    cp build/darwin/iconfile.icns "$APP_PATH/Contents/Resources/iconfile.icns"
fi

if [[ -n "${APPLE_SIGN_IDENTITY:-}" ]]; then
    codesign --force --deep --sign "$APPLE_SIGN_IDENTITY" --timestamp --options runtime "$APP_PATH"
else
    codesign --force --deep --sign - "$APP_PATH"
fi

OUT_DMG="$DIST_DIR/${APP_NAME}-${VERSION}-macos-universal.dmg"
rm -f "$OUT_DMG"
if command -v create-dmg >/dev/null; then
    create-dmg --volname "adOmnia ${VERSION}" --window-pos 200 120 --window-size 800 400 \
        --icon-size 100 --app-drop-link 600 185 "$OUT_DMG" "$APP_PATH"
else
    hdiutil create -volname "adOmnia ${VERSION}" -srcfolder "$APP_PATH" -ov -format UDZO "$OUT_DMG"
fi

echo "Created $APP_PATH and $OUT_DMG"
