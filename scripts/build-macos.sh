#!/usr/bin/env bash
# scripts/build-macos.sh — adOmnia macOS build script
#
# Run this on a macOS host (Intel or Apple Silicon).
# macOS builds CANNOT be cross-compiled from Windows or Linux (CGO + Xcode requirement).
#
# Usage:
#   ./scripts/build-macos.sh              # version=dev
#   ./scripts/build-macos.sh 1.2.3        # tagged release
#
# Env overrides:
#   VERSION   - version string
#   WAILS_BIN - path to wails executable
#   GO_BIN    - path to go executable
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

VERSION="${1:-${VERSION:-dev}}"
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo -e "${CYAN}===========================================${NC}"
echo -e "${CYAN}  adOmnia macOS Build  v${VERSION}${NC}"
echo -e "${CYAN}===========================================${NC}"
echo ""

# ---- Must run on macOS -------------------------------------------------------
if [[ "$(uname -s)" != "Darwin" ]]; then
    echo -e "${RED}ERR  This script must run on macOS.${NC}"
    echo ""
    echo "     macOS builds require CGO + Xcode and cannot be cross-compiled."
    echo ""
    echo "     Options:"
    echo "       1. Run this script on a macOS machine:  ./scripts/build-macos.sh $VERSION"
    echo "       2. Use GitHub Actions with a macos runner:"
    echo "          jobs:"
    echo "            build-macos:"
    echo "              runs-on: macos-latest"
    echo "              steps:"
    echo "                - run: ./scripts/build-macos.sh $VERSION"
    echo ""
    exit 1
fi

# ---- Prerequisites -----------------------------------------------------------
if ! command -v go &>/dev/null; then
    echo -e "${RED}ERR  Go not found. Install: https://go.dev/dl/${NC}"; exit 1
fi
echo -e "${GREEN}OK  ${NC} Go: $(go version | awk '{print $3}')"

if ! command -v node &>/dev/null; then
    echo -e "${RED}ERR  Node.js not found. Install: https://nodejs.org/${NC}"; exit 1
fi
echo -e "${GREEN}OK  ${NC} Node.js: $(node --version)"

# Locate Wails
WAILS_BIN="${WAILS_BIN:-}"
if [[ -z "$WAILS_BIN" ]]; then
    if command -v wails &>/dev/null; then
        WAILS_BIN="$(command -v wails)"
    else
        GOPATH_BIN="$(go env GOPATH)/bin"
        if [[ -x "$GOPATH_BIN/wails" ]]; then
            WAILS_BIN="$GOPATH_BIN/wails"
        fi
    fi
fi

if [[ -z "$WAILS_BIN" ]]; then
    echo -e "${RED}ERR  Wails CLI not found.${NC}"
    echo "     Install: go install github.com/wailsapp/wails/v2/cmd/wails@latest"
    exit 1
fi
echo -e "${GREEN}OK  ${NC} Wails: $("$WAILS_BIN" version 2>/dev/null | head -1 || echo ok)"

# ---- [1] Icon generation -----------------------------------------------------
echo ""
echo "==> [1/4] Generating icons..."
if [[ -f "scripts/generate-icons.sh" ]]; then
    bash scripts/generate-icons.sh || echo -e "${YELLOW}WARN Icon generation failed — using existing icons${NC}"
else
    echo -e "${YELLOW}WARN scripts/generate-icons.sh not found — using existing icons${NC}"
fi

if [[ ! -f "build/appicon.png" ]]; then
    echo -e "${RED}ERR  build/appicon.png missing (required by Wails)${NC}"; exit 1
fi
echo -e "${GREEN}OK  ${NC} build/appicon.png found"

# ---- [2] Frontend ------------------------------------------------------------
echo ""
echo "==> [2/4] Building frontend..."
(cd frontend && npm install --silent && npm run build)
echo -e "${GREEN}OK  ${NC} Frontend built."

# ---- [3] Wails build ---------------------------------------------------------
GIT_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
BUILD_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
LDFLAGS="-s -w -X main.Version=$VERSION -X main.BuildDate=$BUILD_DATE -X main.GitCommit=$GIT_COMMIT"

echo ""
echo "==> [3/4] Building macOS app with Wails..."
echo "    Version:  $VERSION"
echo "    Commit:   $GIT_COMMIT"
echo ""

"$WAILS_BIN" build -ldflags "$LDFLAGS" -platform darwin/amd64,darwin/arm64

APP_ARM="build/bin/adOmnia-darwin-arm64.app"
APP_AMD="build/bin/adOmnia-darwin-amd64.app"
APP_UNI="build/bin/adOmnia.app"

# Wails puts single output at build/bin/adOmnia.app when building both arches
if [[ ! -d "$APP_UNI" && ! -d "$APP_ARM" && ! -d "$APP_AMD" ]]; then
    echo -e "${RED}ERR  Expected .app bundle not found in build/bin/${NC}"; exit 1
fi

# ---- [4] DMG packaging (optional, requires create-dmg or hdiutil) -----------
echo ""
echo "==> [4/4] Packaging DMG..."

OUT_DMG="build/bin/adOmnia-$VERSION-macos.dmg"
APP_PATH="$APP_UNI"
[[ ! -d "$APP_PATH" ]] && APP_PATH="$APP_ARM"
[[ ! -d "$APP_PATH" ]] && APP_PATH="$APP_AMD"

if command -v create-dmg &>/dev/null; then
    create-dmg \
        --volname "adOmnia $VERSION" \
        --window-pos 200 120 \
        --window-size 800 400 \
        --icon-size 100 \
        --app-drop-link 600 185 \
        "$OUT_DMG" \
        "$APP_PATH" \
    && echo -e "${GREEN}OK  ${NC} DMG: $OUT_DMG" \
    || echo -e "${YELLOW}WARN create-dmg failed — .app bundle is still in build/bin/${NC}"
elif command -v hdiutil &>/dev/null; then
    hdiutil create -volname "adOmnia $VERSION" -srcfolder "$APP_PATH" \
        -ov -format UDZO "$OUT_DMG" \
    && echo -e "${GREEN}OK  ${NC} DMG: $OUT_DMG" \
    || echo -e "${YELLOW}WARN hdiutil failed — .app bundle is still in build/bin/${NC}"
else
    echo -e "${YELLOW}SKIP No DMG tool found (install create-dmg: brew install create-dmg)${NC}"
    echo -e "     .app bundle: $APP_PATH"
fi

# ---- Summary -----------------------------------------------------------------
echo ""
echo -e "${GREEN}===========================================${NC}"
echo -e "${GREEN}  macOS Build Complete!${NC}"
echo -e "${GREEN}===========================================${NC}"
echo ""
ls -lh build/bin/ | grep -E '\.(app|dmg)' || ls -lh build/bin/
echo ""
echo "  Next: notarize or distribute via:"
echo "    gh release create v$VERSION build/bin/*.dmg"
echo ""
